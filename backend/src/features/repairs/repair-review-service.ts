import { randomUUID } from "node:crypto";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { AppError } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { createReviewNotification } from "@/features/community/comment-service";
import { repairDetailInclude } from "./repair-repository";
import { timeline } from "./repair-service";
import { toRepairView } from "./repair-view";
import type { RepairReviewServiceContract } from "@/types/contracts";
import { assertRepairTransition } from "./repair-state";

export const repairReviewService: RepairReviewServiceContract = {
  async review(recordId, input, actor) {
    requirePermission(actor, "repair:review");
    if (!actor.userId) throw new AppError("UNAUTHENTICATED", "请先登录");
    const key = input.idempotencyKey.trim();
    if (!key || key.length > 128) throw new AppError("VALIDATION_FAILED", "Idempotency-Key 无效");
    const note = input.note?.trim() || null;
    if (input.decision === "REJECTED" && !note)
      throw new AppError("REPAIR_REJECTION_NOTE_REQUIRED", "退回时必须填写原因");
    if (note && note.length > 2000)
      throw new AppError("VALIDATION_FAILED", "审核意见不能超过 2000 字");
    const existing = await getDb().repairReview.findUnique({
      where: { idempotencyKey: key },
      include: { record: { include: repairDetailInclude } },
    });
    if (existing) {
      if (existing.repairRecordId !== recordId || existing.decision !== input.decision)
        throw new AppError("IDEMPOTENCY_CONFLICT", "幂等键与原请求不一致");
      return toRepairView(existing.record, {
        canViewOwnerPhone:
          existing.record.memberProfile.userId === actor.userId ||
          actor.permissions.includes("repair:review"),
      });
    }
    const now = new Date();
    assertRepairTransition("PENDING", input.decision);
    const record = await inSerializableTransaction(async (tx) => {
      const update = await tx.repairRecord.updateMany({
        where: { id: recordId, status: "PENDING", deletedAt: null },
        data: { status: input.decision, reviewedAt: now, version: { increment: 1 } },
      });
      if (update.count !== 1) {
        const found = await tx.repairRecord.findUnique({
          where: { id: recordId },
          select: { id: true },
        });
        if (!found) throw new AppError("REPAIR_NOT_FOUND", "维修记录不存在");
        throw new AppError("REPAIR_STATE_CONFLICT", "该记录已被审核或状态已变化");
      }
      await tx.repairReview.create({
        data: {
          id: randomUUID(),
          repairRecordId: recordId,
          reviewerUserId: actor.userId!,
          decision: input.decision,
          note,
          idempotencyKey: key,
          createdAt: now,
        },
      });
      await timeline(
        tx,
        recordId,
        actor.userId,
        input.decision,
        { decision: input.decision, note },
        now,
      );
      const owner = await tx.repairRecord.findUniqueOrThrow({
        where: { id: recordId },
        select: { memberProfileId: true },
      });
      const actorMember = actor.userId
        ? await tx.memberProfile.findFirst({
            where: { userId: actor.userId, status: "ACTIVE", deletedAt: null },
            select: { id: true },
          })
        : null;
      await createReviewNotification(tx, {
        recordId,
        ownerMemberProfileId: owner.memberProfileId,
        actorMemberProfileId: actorMember?.id ?? null,
        decision: input.decision,
        now,
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: input.decision === "APPROVED" ? "repair.approved" : "repair.rejected",
        targetType: "RepairRecord",
        targetId: recordId,
        result: "SUCCESS",
        before: { status: "PENDING" },
        after: { status: input.decision, note },
      });
      return tx.repairRecord.findUniqueOrThrow({
        where: { id: recordId },
        include: repairDetailInclude,
      });
    });
    return toRepairView(record, {
      canViewOwnerPhone:
        record.memberProfile.userId === actor.userId || actor.permissions.includes("repair:review"),
    });
  },
};
