import { appendAuditLog } from "@/lib/audit/audit-service";
import { AppError } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { materialHashOf, materialOf } from "@/features/knowledge-cases/case-material";
import {
  invalidateRecordSources,
  scheduleTypicalProcessing,
} from "@/features/knowledge-cases/case-service";
import { repairDetailInclude, repairRepository } from "./repair-repository";
import { changedFields, dataFields, timeline } from "./repair-service";
import { repairReviewService } from "./repair-review-service";
import { normalizeDraftFields, validateDraftFields } from "./repair-validation";
import { toRepairView } from "./repair-view";
import {
  ADMIN_BATCH_LIMIT,
  type AuthorizedActor,
  type RepairAdminServiceContract,
  type RepairBatchReviewInput,
  type RepairBatchReviewResult,
} from "@/types/contracts";

/**
 * 批次幂等键的上限。单条审核的键上限是 128（`repair-review-service`），而这里按
 * `${key}:${recordId}` 给每条记录派生一个键，`recordId` 是 `Char(36)`，
 * 所以批次键本身最长 `128 − 1 − 36`。原先写死 96，派生值可达 133，会被单条那一关拒绝。
 */
const BATCH_KEY_MAX_LENGTH = 128 - 1 - 36;

/**
 * 维修记录管理端服务（M6 §64、§68）。
 *
 * 与成员侧的分工：成员只能改自己的 `DRAFT` / `REJECTED`（`assertCanEditRepair`），
 * 这里允许管理员改**任意状态**的记录（需求 §36「修改异常数据」），但：
 * - 必须写 `reason`，进入时间线与审计；
 * - 必须走版本乐观锁，不覆盖别人的并发修改；
 * - **不改状态**：`APPROVED` 改完仍是 `APPROVED`，不触发重新审核，也不写快照表。
 */
export const repairAdminService: RepairAdminServiceContract = {
  async updateFlags(recordId, input, actor) {
    requirePermission(actor, "repair:flag");
    const before = await repairRepository.getById(recordId);
    const changed =
      before.isDifficult !== input.isDifficult || before.isTypical !== input.isTypical;
    if (!changed)
      return toRepairView(before, {
        canViewOwnerPhone:
          before.memberProfile.userId === actor.userId ||
          actor.permissions.includes("repair:review"),
      });
    const now = new Date();
    const updated = await inSerializableTransaction(async (tx) => {
      await tx.repairRecord.update({
        where: { id: recordId },
        data: {
          isDifficult: input.isDifficult,
          isTypical: input.isTypical,
          version: { increment: 1 },
        },
      });
      await timeline(tx, recordId, actor.userId, "FLAG_CHANGED", input, now);
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair.flags.changed",
        targetType: "RepairRecord",
        targetId: recordId,
        result: "SUCCESS",
        before: { isDifficult: before.isDifficult, isTypical: before.isTypical },
        after: input,
      });
      return tx.repairRecord.findUniqueOrThrow({
        where: { id: recordId },
        include: repairDetailInclude,
      });
    });
    // Issue #40：isTypical 的写入共同驱动案例处理/失效 ——
    // 置 true 后台整理；取消时立即移除贡献并按剩余来源重整/撤下。
    if (before.isTypical && !input.isTypical) {
      await invalidateRecordSources(recordId, "管理端取消典型标记");
    } else if (!before.isTypical && input.isTypical) {
      scheduleTypicalProcessing(recordId);
    }
    return toRepairView(updated, {
      canViewOwnerPhone:
        updated.memberProfile.userId === actor.userId ||
        actor.permissions.includes("repair:review"),
    });
  },

  async updateRecord(recordId, input, actor) {
    requirePermission(actor, "repair:review");
    const reason = input.reason?.trim() ?? "";
    if (!reason || reason.length > 2000)
      throw new AppError("REPAIR_ADMIN_REASON_REQUIRED", "修改原因必填且不能超过 2000 字");
    const fields = normalizeDraftFields(input);
    validateDraftFields(fields);
    const before = await repairRepository.getById(recordId);
    if (before.version !== input.version)
      throw new AppError("REPAIR_VERSION_CONFLICT", "记录已被更新，请刷新后重试");
    // 分类若被改动，必须指向存在且启用中的分类（与成员提交时的口径一致）。
    if (fields.categoryId !== undefined && fields.categoryId !== before.categoryId) {
      if (fields.categoryId !== null) {
        const category = await getDb().repairCategory.findFirst({
          where: { id: fields.categoryId, deletedAt: null },
        });
        if (!category) throw new AppError("VALIDATION_FAILED", "所选分类不存在");
        if (!category.isActive) throw new AppError("REPAIR_CATEGORY_INACTIVE", "所选分类已停用");
      }
    }
    const changes = changedFields(before, fields);
    const now = new Date();
    const updated = await inSerializableTransaction(async (tx) => {
      const result = await tx.repairRecord.updateMany({
        where: { id: recordId, version: input.version, deletedAt: null },
        data: { ...dataFields(fields), version: { increment: 1 } },
      });
      if (result.count !== 1)
        throw new AppError("REPAIR_VERSION_CONFLICT", "记录已被更新，请刷新后重试");
      await timeline(
        tx,
        recordId,
        actor.userId,
        "UPDATED",
        { fields: changes, byAdmin: true, reason },
        now,
      );
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair.admin.updated",
        targetType: "RepairRecord",
        targetId: recordId,
        result: "SUCCESS",
        // 只记录变化了的字段名 + 前后值，避免把整行（含长文本）灌进审计。
        before: pick(before, changes),
        after: { ...pick(fields, changes), reason, status: before.status },
      });
      return tx.repairRecord.findUniqueOrThrow({
        where: { id: recordId },
        include: repairDetailInclude,
      });
    });
    // Issue #40：备案正文实质变化（哈希口径，忽略 version/时间戳的自增）→
    // 受影响案例立即停止检索并按剩余来源自动重整。
    if (materialHashOf(materialOf(before)) !== materialHashOf(materialOf(updated))) {
      await invalidateRecordSources(recordId, "管理端修改了备案内容");
    }
    return toRepairView(updated, {
      canViewOwnerPhone:
        updated.memberProfile.userId === actor.userId ||
        actor.permissions.includes("repair:review"),
    });
  },

  /**
   * M6 批量审核。
   *
   * 逐条调用 `repairReviewService.review` —— 状态白名单、`PENDING` 条件更新、
   * 退回原因必填、通知、时间线与审计**全部复用单条路径**，批量不绕过任何规则。
   * 因此结果允许部分成功：已被别人审过的记录会以 `REPAIR_STATE_CONFLICT` 出现在 `failed` 里。
   */
  async batchReview(input: RepairBatchReviewInput, actor: AuthorizedActor) {
    requirePermission(actor, "repair:review");
    const recordIds = [...new Set(input.recordIds.map((id) => id.trim()).filter(Boolean))];
    if (recordIds.length === 0)
      throw new AppError("VALIDATION_FAILED", "批量审核至少需要选择一条记录");
    if (recordIds.length > ADMIN_BATCH_LIMIT)
      throw new AppError(
        "REPAIR_BATCH_LIMIT_EXCEEDED",
        `单次批量最多 ${ADMIN_BATCH_LIMIT} 条记录，请分批执行`,
      );
    const key = input.idempotencyKey.trim();
    if (!key || key.length > BATCH_KEY_MAX_LENGTH)
      throw new AppError("VALIDATION_FAILED", "Idempotency-Key 无效");
    // 退回必填原因：这是**整批**的前置约束，在入口直接拒绝，
    // 而不是让 N 条记录各自失败一次（那只会给界面刷出 N 条同样的错误）。
    if (input.decision === "REJECTED" && !input.note?.trim())
      throw new AppError("REPAIR_REJECTION_NOTE_REQUIRED", "退回时必须填写原因");

    const result: RepairBatchReviewResult = { succeeded: [], failed: [] };
    for (const recordId of recordIds) {
      try {
        await repairReviewService.review(
          recordId,
          // 每条记录有自己的幂等键，整批重放不会重复写审核记录。
          { decision: input.decision, note: input.note, idempotencyKey: `${key}:${recordId}` },
          actor,
        );
        result.succeeded.push(recordId);
      } catch (error) {
        const appError =
          error instanceof AppError
            ? error
            : new AppError("INTERNAL_ERROR", "服务暂时不可用，请稍后重试");
        result.failed.push({
          recordId,
          code: appError.code,
          message: appError.message,
        });
      }
    }
    await inSerializableTransaction(async (tx) => {
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair.batch.reviewed",
        targetType: "RepairRecord",
        targetId: recordIds[0]!,
        result: result.failed.length === 0 ? "SUCCESS" : "FAILURE",
        after: {
          decision: input.decision,
          requested: recordIds,
          succeeded: result.succeeded,
          failed: result.failed.map((item) => `${item.recordId}:${item.code}`),
        },
      });
    });
    return result;
  },
};

/** 从对象里取出指定字段（用于只把变化过的字段写进审计摘要）。 */
function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(
    keys
      .filter((key) => key in source)
      .map((key) => [key, source[key] === undefined ? null : (source[key] as unknown)]),
  );
}
