import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../src/lib/api/errors";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import {
  assertRepairOrderTransition,
  isRepairOrderManager,
  isRepairOrderTransitionAllowed,
  repairOrderStaffActions,
} from "../../src/features/repair-orders/repair-order-policy";
import type { AuthorizedActor, Permission } from "../../src/types/contracts";

/**
 * 报修单工作人员动作与状态机（Issue #38）。
 *
 * 三种视角必须分清：受理人本人、其他工作人员（普通 MEMBER）、管理员。
 * 客户端按 `actions` 渲染按钮，但这些判定是服务端授权的唯一来源，所以在这里钉死。
 */
function actorWith(permissions: readonly Permission[]): AuthorizedActor {
  return {
    actorType: "USER",
    userId: "user-1",
    userStatus: "ACTIVE",
    permissions: [...permissions],
    requestId: "unit-test",
  } as AuthorizedActor;
}

const memberActor = actorWith(permissionsForRoles(["MEMBER"]));
const adminActor = actorWith(permissionsForRoles(["ADMIN"]));
const customerActor = actorWith(permissionsForRoles([]));

function order(overrides: Partial<{
  status: string;
  assigneeMemberProfileId: string | null;
  repairRecordId: string | null;
  deletedAt: Date | null;
}> = {}) {
  return {
    status: "SUBMITTED",
    assigneeMemberProfileId: null,
    repairRecordId: null,
    deletedAt: null,
    ...overrides,
  };
}

test("管理员标志来自 repair:review，MEMBER 客户都不是管理员", () => {
  assert.equal(isRepairOrderManager(adminActor), true);
  assert.equal(isRepairOrderManager(memberActor), false);
  assert.equal(isRepairOrderManager(customerActor), false);
});

test("待受理公共队列：有成员档案的工作人员可以受理，无人可重复受理", () => {
  const actions = repairOrderStaffActions(memberActor, order(), "member-a");
  assert.equal(actions.canAccept, true);
  // 已有人受理时，其他工作人员不能再受理
  const taken = repairOrderStaffActions(
    memberActor,
    order({ status: "ACCEPTED", assigneeMemberProfileId: "member-b" }),
    "member-a",
  );
  assert.equal(taken.canAccept, false);
  // 没有成员档案（如纯 ADMIN 账号）不能凭空成为受理人
  const noProfile = repairOrderStaffActions(adminActor, order(), null);
  assert.equal(noProfile.canAccept, false);
});

test("推进与完成：受理人本人可行，其他普通工作人员不可替其更新", () => {
  const accepted = order({ status: "ACCEPTED", assigneeMemberProfileId: "member-a" });
  const assignee = repairOrderStaffActions(memberActor, accepted, "member-a");
  assert.equal(assignee.canStartRepair, true);
  assert.equal(assignee.canComplete, false, "未进入维修中不能直接完成");
  const other = repairOrderStaffActions(memberActor, accepted, "member-b");
  assert.equal(other.canStartRepair, false);
  assert.equal(other.canComplete, false);

  const repairing = order({ status: "REPAIRING", assigneeMemberProfileId: "member-a" });
  assert.equal(repairOrderStaffActions(memberActor, repairing, "member-a").canComplete, true);
});

test("管理员可以推进任何单据并在未完成前取消，终态不可再动", () => {
  const accepted = order({ status: "ACCEPTED", assigneeMemberProfileId: "member-a" });
  const admin = repairOrderStaffActions(adminActor, accepted, null);
  assert.equal(admin.canStartRepair, true);
  assert.equal(admin.canCancel, true);

  const repairing = order({ status: "REPAIRING", assigneeMemberProfileId: "member-a" });
  assert.equal(repairOrderStaffActions(adminActor, repairing, null).canCancel, false);
  const completed = order({ status: "COMPLETED", assigneeMemberProfileId: "member-a" });
  assert.equal(repairOrderStaffActions(adminActor, completed, null).canCancel, false);
  const cancelled = order({ status: "CANCELLED" });
  assert.equal(repairOrderStaffActions(adminActor, cancelled, null).canAccept, false);
  assert.equal(repairOrderStaffActions(adminActor, cancelled, null).canCancel, false);
});

test("建档：仅受理人本人、未取消且未关联时可建", () => {
  const mine = order({ status: "ACCEPTED", assigneeMemberProfileId: "member-a" });
  assert.equal(repairOrderStaffActions(memberActor, mine, "member-a").canCreateRecord, true);
  assert.equal(
    repairOrderStaffActions(memberActor, mine, "member-b").canCreateRecord,
    false,
    "非受理人不能建档",
  );
  assert.equal(
    repairOrderStaffActions(
      memberActor,
      order({ status: "REPAIRING", assigneeMemberProfileId: "member-a", repairRecordId: "rec-1" }),
      "member-a",
    ).canCreateRecord,
    false,
    "已关联备案不能重复建档",
  );
  assert.equal(
    repairOrderStaffActions(
      memberActor,
      order({ status: "CANCELLED", assigneeMemberProfileId: "member-a" }),
      "member-a",
    ).canCreateRecord,
    false,
    "已取消不能建档",
  );
});

test("报修单状态机与任务书表格逐项一致", () => {
  const allowed: Array<[string, string]> = [
    ["SUBMITTED", "ACCEPTED"],
    ["SUBMITTED", "CANCELLED"],
    ["ACCEPTED", "REPAIRING"],
    ["ACCEPTED", "CANCELLED"],
    ["REPAIRING", "COMPLETED"],
  ];
  for (const [from, to] of allowed)
    assert.equal(isRepairOrderTransitionAllowed(from as never, to as never), true, `${from}→${to}`);
  const rejected: Array<[string, string]> = [
    ["SUBMITTED", "REPAIRING"],
    ["SUBMITTED", "COMPLETED"],
    ["ACCEPTED", "COMPLETED"],
    ["REPAIRING", "CANCELLED"],
    ["REPAIRING", "REPAIRING"],
    ["COMPLETED", "CANCELLED"],
    ["CANCELLED", "SUBMITTED"],
  ];
  for (const [from, to] of rejected)
    assert.equal(isRepairOrderTransitionAllowed(from as never, to as never), false, `${from}→${to}`);
});

test("非法转换被拒绝且错误码是 REPAIR_ORDER_STATE_INVALID", () => {
  assert.throws(
    () => assertRepairOrderTransition("SUBMITTED", "COMPLETED"),
    (error: unknown) => error instanceof AppError && error.code === "REPAIR_ORDER_STATE_INVALID",
  );
});
