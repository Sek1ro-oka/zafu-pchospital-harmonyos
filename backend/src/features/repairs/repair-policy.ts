import { AppError } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/permissions";
import type { AuthorizedActor } from "@/types/contracts";

export function assertCanReadRepair(
  actor: AuthorizedActor,
  record: { memberProfile: { userId: string }; status: string; deletedAt: Date | null },
): void {
  requirePermission(actor, "repair:read");
  if (record.deletedAt) throw new AppError("REPAIR_NOT_FOUND", "维修记录不存在");
  const owner = record.memberProfile.userId === actor.userId;
  const admin = actor.permissions.includes("repair:review");
  if (!owner && !admin && record.status !== "APPROVED")
    throw new AppError("REPAIR_NOT_FOUND", "维修记录不存在");
}

export function assertCanEditRepair(
  actor: AuthorizedActor,
  record: { memberProfile: { userId: string }; status: string; deletedAt: Date | null },
): void {
  requirePermission(actor, "repair:update");
  if (record.deletedAt) throw new AppError("REPAIR_NOT_FOUND", "维修记录不存在");
  if (record.memberProfile.userId !== actor.userId)
    throw new AppError("REPAIR_FORBIDDEN", "只能编辑自己的维修记录");
  if (record.status !== "DRAFT" && record.status !== "REJECTED")
    throw new AppError("REPAIR_STATE_INVALID", "当前状态不能编辑");
}

/** 报修关联备案的机型是联系单快照，备案写入口不能单独改写。 */
export function assertCanChangeRepairDeviceModel(
  record: { deviceModel: string | null; repairOrder: { id: string } | null },
  deviceModel: string | null | undefined,
): void {
  if (record.repairOrder && deviceModel !== undefined && deviceModel !== record.deviceModel) {
    throw new AppError("VALIDATION_FAILED", "关联报修备案的机型只读", {
      fieldErrors: { deviceModel: ["机型来自报修单，关联备案内不能修改"] },
    });
  }
}
