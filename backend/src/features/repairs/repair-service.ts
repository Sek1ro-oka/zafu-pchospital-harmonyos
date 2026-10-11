import { randomUUID } from "node:crypto";
import { defaultRepairResult } from "@/config/repairs";
import type { Prisma } from "@/generated/prisma/client";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { AppError } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { assertCanEditRepair } from "./repair-policy";
import { invalidateRecordSources } from "@/features/knowledge-cases/case-service";
import { repairDetailInclude, repairRepository } from "./repair-repository";
import {
  normalizeDraftFields,
  parseRepairDate,
  validateDraftFields,
  validateSubmission,
} from "./repair-validation";
import { toRepairView } from "./repair-view";
import { assertRepairTransition } from "./repair-state";
import type { RepairDraftFields, RepairServiceContract } from "@/types/contracts";

export const repairService: RepairServiceContract = {
  async createDraft(input, actor) {
    requirePermission(actor, "repair:create");
    const member = await repairRepository.activeMemberForUser(actor.userId);
    const key = input.idempotencyKey.trim();
    if (!key || key.length > 128) throw new AppError("VALIDATION_FAILED", "Idempotency-Key 无效");
    const existing = await getDb().repairRecord.findUnique({
      where: { createRequestKey: key },
      include: repairDetailInclude,
    });
    if (existing) {
      if (existing.memberProfileId !== member.id)
        throw new AppError("IDEMPOTENCY_CONFLICT", "幂等键已被使用");
      return toRepairView(existing);
    }
    const fields = normalizeDraftFields(input);
    validateDraftFields(fields);
    const draft = { ...fields, result: fields.result ?? defaultRepairResult };
    const now = new Date();
    const record = await inSerializableTransaction(async (tx) => {
      const created = await tx.repairRecord.create({
        data: {
          id: randomUUID(),
          memberProfileId: member.id,
          status: "DRAFT",
          createRequestKey: key,
          ...dataFields(draft),
          createdAt: now,
        },
        include: repairDetailInclude,
      });
      await timeline(tx, created.id, actor.userId, "CREATED", { status: "DRAFT" }, now);
      return tx.repairRecord.findUniqueOrThrow({
        where: { id: created.id },
        include: repairDetailInclude,
      });
    });
    return toRepairView(record);
  },

  async update(recordId, input, actor) {
    const record = await repairRepository.getById(recordId);
    assertCanEditRepair(actor, record);
    if (record.version !== input.version)
      throw new AppError("REPAIR_VERSION_CONFLICT", "记录已被更新，请刷新后重试");
    const fields = normalizeDraftFields(input);
    validateDraftFields(fields);
    const changes = changedFields(record, fields);
    const updated = await inSerializableTransaction(async (tx) => {
      const result = await tx.repairRecord.updateMany({
        where: { id: recordId, version: input.version, deletedAt: null },
        data: { ...dataFields(fields), version: { increment: 1 } },
      });
      if (result.count !== 1)
        throw new AppError("REPAIR_VERSION_CONFLICT", "记录已被更新，请刷新后重试");
      await timeline(tx, recordId, actor.userId, "UPDATED", { fields: changes }, new Date());
      return tx.repairRecord.findUniqueOrThrow({
        where: { id: recordId },
        include: repairDetailInclude,
      });
    });
    return toRepairView(updated);
  },

  async submit(recordId, input, actor) {
    requirePermission(actor, "repair:submit");
    const record = await repairRepository.getById(recordId);
    const retry = record.timeline.find((event) => {
      if (event.eventType !== "SUBMITTED" && event.eventType !== "RESUBMITTED") return false;
      const summary = event.summary as { idempotencyKey?: unknown } | null;
      return summary?.idempotencyKey === input.idempotencyKey;
    });
    if (record.status === "PENDING" && retry) return toRepairView(record);
    assertCanEditRepair(actor, record);
    if (record.version !== input.version)
      throw new AppError("REPAIR_VERSION_CONFLICT", "记录已被更新，请刷新后重试");
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 128)
      throw new AppError("VALIDATION_FAILED", "Idempotency-Key 无效");
    const category = record.categoryId
      ? await getDb().repairCategory.findFirst({
          where: { id: record.categoryId, deletedAt: null },
        })
      : null;
    if (record.categoryId && (!category || !category.isActive))
      throw new AppError("REPAIR_CATEGORY_INACTIVE", "所选分类已停用");
    validateSubmission({ ...record, photoCount: record.photos.length });
    const from = record.status;
    assertRepairTransition(from as "DRAFT" | "REJECTED", "PENDING");
    const now = new Date();
    const updated = await inSerializableTransaction(async (tx) => {
      const result = await tx.repairRecord.updateMany({
        where: { id: recordId, version: input.version, status: from, deletedAt: null },
        data: { status: "PENDING", submittedAt: now, reviewedAt: null, version: { increment: 1 } },
      });
      if (result.count !== 1) throw new AppError("REPAIR_STATE_CONFLICT", "记录状态已变化");
      await timeline(
        tx,
        recordId,
        actor.userId,
        from === "REJECTED" ? "RESUBMITTED" : "SUBMITTED",
        { from, to: "PENDING", idempotencyKey: input.idempotencyKey },
        now,
      );
      return tx.repairRecord.findUniqueOrThrow({
        where: { id: recordId },
        include: repairDetailInclude,
      });
    });
    return toRepairView(updated);
  },

  async softDelete(recordId, reason, actor) {
    requirePermission(actor, "repair:delete");
    const note = reason.trim();
    if (!note || note.length > 2000)
      throw new AppError("VALIDATION_FAILED", "删除原因必填且不能超过 2000 字");
    const record = await repairRepository.getById(recordId);
    const now = new Date();
    await inSerializableTransaction(async (tx) => {
      await tx.repairRecord.update({
        where: { id: recordId },
        data: { deletedAt: now, version: { increment: 1 } },
      });
      await timeline(tx, recordId, actor.userId, "DELETED", { reason: note }, now);
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair.deleted",
        targetType: "RepairRecord",
        targetId: recordId,
        result: "SUCCESS",
        before: { status: record.status },
        after: { deleted: true, reason: note },
      });
    });
    // Issue #40：软删的备案不再是有效来源 —— 案例立即退回重整/撤下。
    await invalidateRecordSources(recordId, "备案已被软删除");
  },
};

/** 草稿字段 → 数据库列。管理端编辑（`repair-admin-service`）复用同一映射与 diff 计算。 */
export function dataFields(input: RepairDraftFields) {
  return {
    repairDate: parseRepairDate(input.repairDate),
    durationMinutes: input.durationMinutes,
    categoryId: input.categoryId,
    content: input.content,
    result: input.result,
    remark: input.remark,
  };
}
export function changedFields(
  record: Record<string, unknown>,
  input: Record<string, unknown>,
): string[] {
  return Object.keys(input).filter(
    (key) => input[key] !== undefined && String(record[key] ?? "") !== String(input[key] ?? ""),
  );
}
export async function timeline(
  tx: Prisma.TransactionClient,
  repairRecordId: string,
  actorUserId: string | undefined,
  eventType: string,
  summary: Prisma.InputJsonValue,
  createdAt: Date,
) {
  await tx.repairTimelineEvent.create({
    data: { id: randomUUID(), repairRecordId, actorUserId, eventType, summary, createdAt },
  });
}

/**
 * 活动接待内部落单通道（仅供维修活动 serve 在同一可序列化事务内调用）。
 * 跳过照片必填；仍写 timeline（CREATED + SUBMITTED）与审计；直接落 PENDING。
 */
export type CreateSubmittedForActivityInput = {
  memberProfileId: string;
  categoryId: string;
  repairDate: string; // YYYY-MM-DD（上海日历日）
  content: string;
  remark: string;
  durationMinutes: number;
  /** 报名时选填的机型（issue #68）；没填传 null。 */
  deviceModel: string | null;
  /** 幂等键；建议 `activity-serve:{registrationId}` */
  createRequestKey: string;
  registrationId: string;
  activityId: string;
};

export async function createSubmittedForActivity(
  tx: Prisma.TransactionClient,
  input: CreateSubmittedForActivityInput,
  actor: import("@/types/contracts").AuthorizedActor,
  now: Date,
): Promise<{ repairRecordId: string }> {
  const existing = await tx.repairRecord.findUnique({
    where: { createRequestKey: input.createRequestKey },
  });
  if (existing && !existing.deletedAt) {
    return { repairRecordId: existing.id };
  }

  const repairDate = parseRepairDate(input.repairDate);
  if (!repairDate) {
    throw new AppError("VALIDATION_FAILED", "维修日期无效");
  }

  const recordId = randomUUID();
  await tx.repairRecord.create({
    data: {
      id: recordId,
      memberProfileId: input.memberProfileId,
      status: "PENDING",
      createRequestKey: input.createRequestKey,
      repairDate,
      durationMinutes: input.durationMinutes,
      categoryId: input.categoryId,
      deviceModel: input.deviceModel,
      content: input.content,
      result: defaultRepairResult,
      remark: input.remark,
      submittedAt: now,
      createdAt: now,
    },
  });
  await timeline(tx, recordId, actor.userId, "CREATED", {
    status: "PENDING",
    source: "repair_activity_serve",
    activityId: input.activityId,
    registrationId: input.registrationId,
  }, now);
  await timeline(tx, recordId, actor.userId, "SUBMITTED", {
    from: "DRAFT",
    to: "PENDING",
    source: "repair_activity_serve",
    idempotencyKey: input.createRequestKey,
  }, now);
  await appendAuditLog(tx, {
    actor,
    actorType: "USER",
    actorUserId: actor.userId,
    action: "repair.created_from_activity_serve",
    targetType: "RepairRecord",
    targetId: recordId,
    result: "SUCCESS",
    after: {
      activityId: input.activityId,
      registrationId: input.registrationId,
      categoryId: input.categoryId,
      status: "PENDING",
    },
  });
  return { repairRecordId: recordId };
}
