import { AppError } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/permissions";
import type { AuthorizedActor, RepairOrderStatus } from "@/types/contracts";

/** 报修单状态机。**独立于备案的 `repair-state.ts`**（#38 要求两者分别维护）。 */
const allowedOrderTransitions = new Set<string>([
  // 首次提交
  "SUBMITTED:ACCEPTED",
  "SUBMITTED:CANCELLED",
  "ACCEPTED:REPAIRING",
  "ACCEPTED:CANCELLED",
  "REPAIRING:COMPLETED",
]);

export function isRepairOrderTransitionAllowed(
  from: RepairOrderStatus,
  to: RepairOrderStatus,
): boolean {
  return allowedOrderTransitions.has(`${from}:${to}`);
}

export function assertRepairOrderTransition(from: RepairOrderStatus, to: RepairOrderStatus): void {
  if (!isRepairOrderTransitionAllowed(from, to))
    throw new AppError("REPAIR_ORDER_STATE_INVALID", `报修单不能从 ${from} 变更为 ${to}`);
}

/**
 * 读权限 + 数据归属。
 *
 * 非本人一律抛 `REPAIR_ORDER_NOT_FOUND` 而**不是** `FORBIDDEN`：
 * 后者会暴露「这个 ID 存在但不是你的」，等于给出一个可枚举存在性的接口。
 * 与 `repair-policy.ts` 的 `assertCanReadRepair` 保持同一口径。
 *
 * 工作人员（有 `repair:update`，即 MEMBER/ADMIN）可读全部单据 —— #38 需要它做受理队列。
 */
export function assertCanReadRepairOrder(
  actor: AuthorizedActor,
  order: { submittedByUserId: string; deletedAt: Date | null },
): void {
  requirePermission(actor, "repair.order:read");
  if (order.deletedAt) throw new AppError("REPAIR_ORDER_NOT_FOUND", "报修单不存在");
  const owner = order.submittedByUserId === actor.userId;
  const staff = actor.permissions.includes("repair:update");
  if (!owner && !staff) throw new AppError("REPAIR_ORDER_NOT_FOUND", "报修单不存在");
}
