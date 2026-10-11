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

/**
 * 「管理员」在本系统的业务标志是 `repair:review` 权限（与 `repair-policy.ts` 的
 * `assertCanReadRepair` 同一口径）：ADMIN 角色独有，MEMBER 没有。
 * 管理员可以管理任何报修单；普通工作人员只能处理自己受理的单。
 */
export function isRepairOrderManager(actor: AuthorizedActor): boolean {
  return actor.permissions.includes("repair:review");
}

/** 工作人员在报修单上被允许的动作。服务端计算并随详情下发，客户端只读，不自行推断权限。 */
export type RepairOrderStaffActions = {
  canAccept: boolean;
  canStartRepair: boolean;
  canComplete: boolean;
  canCancel: boolean;
  canCreateRecord: boolean;
};

type RepairOrderStaffRow = {
  status: string;
  assigneeMemberProfileId: string | null;
  repairRecordId: string | null;
  deletedAt: Date | null;
};

/**
 * 计算允许动作（Issue #38）：
 * - 受理：任何有有效成员档案的工作人员都能抢尚未受理的单（先到先得）；
 * - 推进（开始处理/完成）：受理人本人或管理员；
 * - 取消：仅管理员，且只能取消未完成的单；终态不可再动；
 * - 建档：仅受理人本人，且单据未取消、尚未关联备案。
 */
export function repairOrderStaffActions(
  actor: AuthorizedActor,
  order: RepairOrderStaffRow,
  memberProfileId: string | null,
): RepairOrderStaffActions {
  const manager = isRepairOrderManager(actor);
  const assignee = memberProfileId !== null && order.assigneeMemberProfileId === memberProfileId;
  const active = order.deletedAt === null;
  const canHandle = assignee || manager;
  return {
    canAccept:
      active &&
      order.status === "SUBMITTED" &&
      order.assigneeMemberProfileId === null &&
      memberProfileId !== null,
    canStartRepair: active && order.status === "ACCEPTED" && canHandle,
    canComplete: active && order.status === "REPAIRING" && canHandle,
    canCancel: active && manager && (order.status === "SUBMITTED" || order.status === "ACCEPTED"),
    canCreateRecord:
      active &&
      assignee &&
      order.repairRecordId === null &&
      (order.status === "ACCEPTED" || order.status === "REPAIRING" || order.status === "COMPLETED"),
  };
}
