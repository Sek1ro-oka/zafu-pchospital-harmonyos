import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../src/lib/api/errors";
import { customerPermissions, permissionsForRoles, requirePermission } from "../../src/lib/auth/permissions";

/**
 * 方案 B（无角色即客户）的落点测试。
 *
 * 关键约束有两条，缺一条都会让客户报修整条链路走不通：
 * 1. 空角色必须拿到客户权限 —— 否则 `requirePermission("repair.order:create")` 把客户全拒；
 * 2. 客户**不能**因此拿到 `repair:*`（备案权限）—— 那是工作人员的能力，
 *    若一并放开，客户就能读写维修备案，越权面比原来更大。
 */
test("无角色账号拿到客户基础权限，而不是空集", () => {
  const customer = permissionsForRoles([]);
  assert.equal(customer.includes("repair.order:create"), true);
  assert.equal(customer.includes("repair.order:read"), true);
  assert.deepEqual([...customer].sort(), [...customerPermissions].sort());
});

test("客户权限不越界到工作人员能力", () => {
  const customer = permissionsForRoles([]);
  for (const forbidden of [
    "repair:create",
    "repair:read",
    "repair:update",
    "repair:review",
    "repair:delete",
    "member:manage",
    "invite:create",
    "audit:read",
    "data:export",
  ] as const) {
    assert.equal(customer.includes(forbidden), false, `客户不应拥有 ${forbidden}`);
  }
});

test("MEMBER 与 ADMIN 保留原有权限，并新增报修单读取", () => {
  const member = permissionsForRoles(["MEMBER"]);
  const admin = permissionsForRoles(["ADMIN"]);
  for (const role of [member, admin]) {
    assert.equal(role.includes("repair.order:read"), true, "工作人员需能读报修单（#38 受理用）");
  }
  // 原有边界不被这次改动打破
  assert.equal(member.includes("join:read"), false);
  assert.equal(admin.includes("join:review"), true);
  assert.equal(member.includes("member:manage"), false);
  assert.equal(admin.includes("member:manage"), true);
  assert.equal(member.includes("repair:update"), true);
});

test("多角色取并集且去重", () => {
  const both = permissionsForRoles(["MEMBER", "ADMIN"]);
  assert.equal(both.includes("join:review"), true);
  assert.equal(both.includes("repair:update"), true);
  assert.equal(new Set(both).size, both.length, "并集不应含重复项");
});

test("requirePermission 对无权限客户拒绝报修单之外的操作", () => {
  const actor = {
    actorType: "USER" as const,
    userId: "customer-1",
    userStatus: "ACTIVE" as const,
    permissions: permissionsForRoles([]),
    requestId: "req",
  };
  assert.throws(
    () => requirePermission(actor, "repair:create"),
    (error: unknown) => error instanceof AppError && error.code === "FORBIDDEN",
  );
});
