import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { GET as staffQueueRoute } from "../../src/app/api/v1/staff/repair-orders/route";
import { GET as staffDetailRoute } from "../../src/app/api/v1/staff/repair-orders/[id]/route";
import { POST as acceptRoute } from "../../src/app/api/v1/staff/repair-orders/[id]/accept/route";
import { POST as progressRoute } from "../../src/app/api/v1/staff/repair-orders/[id]/progress/route";
import { POST as cancelRoute } from "../../src/app/api/v1/staff/repair-orders/[id]/cancel/route";
import { POST as createRecordRoute } from "../../src/app/api/v1/staff/repair-orders/[id]/record/route";
import { GET as customerListRoute, POST as customerSubmitRoute } from "../../src/app/api/v1/repair-orders/route";
import { GET as customerDetailRoute } from "../../src/app/api/v1/repair-orders/[id]/route";
import { getDb, disconnectDb } from "../../src/lib/db/client";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute } from "./http-harness";
import {
  ADMIN_ID,
  CUSTOMER_ID,
  MP_A_ID,
  MP_B_ID,
  STAFF_A_ID,
  STAFF_B_ID,
  bearerFor,
  cleanupStaffRepairFixtures,
  cookieFor,
  dataOf,
  errorCodeOf,
  listArray,
  prepareStaffRepairFixtures,
} from "./staff-repair-harness";

/**
 * 工作人员处理链路的路由级集成测试（真实 MySQL，Issue #38）。
 *
 * 覆盖：权限矩阵（客户 / 非受理人 / 受理人 / 管理员）、合法与非法状态转换、
 * 并发抢单只一人成功、重复请求不重复写事件、双通道来源校验、
 * 客户时间线真实更新，以及「管理员可管理、无成员档案不能受理」。
 */
const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

before(async () => {
  if (!enabled) return;
  await cleanupStaffRepairFixtures();
  await prepareStaffRepairFixtures();
});

beforeEach(async () => {
  if (!enabled) return;
  // 其他文件可能清过全表，每个用例前重新对齐夹具。
  await prepareStaffRepairFixtures();
});

after(async () => {
  if (!enabled) return;
  await cleanupStaffRepairFixtures();
  await disconnectDb();
});

function submitBody(overrides: Record<string, unknown> = {}) {
  return {
    deviceModel: "ThinkPad E14（Issue38）",
    deviceSerial: "SN-ISSUE38",
    faultDescription: "键盘进水后部分按键失灵，需要检修",
    contactPhone: "13900139000",
    ...overrides,
  };
}

/** 客户提交一单，返回单号。 */
async function newOrder(): Promise<string> {
  const headers = await bearerFor(CUSTOMER_ID);
  const response = await callRoute(customerSubmitRoute, "http://localhost/api/v1/repair-orders", {
    method: "POST",
    headers,
    body: submitBody(),
  });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  return dataOf(response.json).id as string;
}

function acceptAs(headers: Record<string, string>, id: string, body: Record<string, unknown> = {}) {
  return callRoute(acceptRoute, `http://localhost/api/v1/staff/repair-orders/${id}/accept`, {
    method: "POST",
    headers,
    body,
    params: { id },
  });
}

function progressAs(
  headers: Record<string, string>,
  id: string,
  body: Record<string, unknown>,
) {
  return callRoute(progressRoute, `http://localhost/api/v1/staff/repair-orders/${id}/progress`, {
    method: "POST",
    headers,
    body,
    params: { id },
  });
}

function cancelAs(headers: Record<string, string>, id: string, body: Record<string, unknown>) {
  return callRoute(cancelRoute, `http://localhost/api/v1/staff/repair-orders/${id}/cancel`, {
    method: "POST",
    headers,
    body,
    params: { id },
  });
}

function queueAs(headers: Record<string, string>, query: string) {
  return callRoute(staffQueueRoute, `http://localhost/api/v1/staff/repair-orders${query}`, {
    headers,
  });
}

function detailAs(headers: Record<string, string>, id: string) {
  return callRoute(staffDetailRoute, `http://localhost/api/v1/staff/repair-orders/${id}`, {
    headers,
    params: { id },
  });
}

dbTest("队列：客户被拒，工作人员看到待受理单，非法 scope 400", async () => {
  const id = await newOrder();
  const customer = await bearerFor(CUSTOMER_ID);
  const denied = await queueAs(customer, "?scope=unassigned");
  assert.equal(denied.status, 403, "客户访问工作人员队列应 403");

  const staff = await bearerFor(STAFF_A_ID);
  const badScope = await queueAs(staff, "?scope=whatever");
  assert.equal(badScope.status, 400);

  const unassigned = await queueAs(staff, "?scope=unassigned&pageSize=100");
  assert.equal(unassigned.status, 200);
  assert.ok(listArray(unassigned.json).some((item) => item.id === id), "待受理队列应包含新单");

  const mine = await queueAs(staff, "?scope=mine&pageSize=100");
  assert.equal(mine.status, 200);
  assert.equal(listArray(mine.json).some((item) => item.id === id), false, "未被本人受理不应出现在我负责");
});

dbTest("受理：先到先得，重复受理幂等、他人受理收到 409 冲突", async () => {
  const id = await newOrder();
  const staffA = await bearerFor(STAFF_A_ID);
  const staffB = await bearerFor(STAFF_B_ID);

  const first = await acceptAs(staffA, id);
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const accepted = dataOf(first.json);
  assert.equal(accepted.status, "ACCEPTED");
  assert.equal((accepted.assignee as Record<string, unknown>).memberProfileId, MP_A_ID);
  assert.equal((accepted.actions as Record<string, unknown>).canStartRepair, true);

  // 重复点击（同一受理人）= 幂等：返回当前状态且不新增事件。
  const replay = await acceptAs(staffA, id);
  assert.equal(replay.status, 200);
  assert.equal(dataOf(replay.json).status, "ACCEPTED");

  // 另一名工作人员：不能替其更新，受理/推进都被拒。
  const conflict = await acceptAs(staffB, id);
  assert.equal(conflict.status, 409);
  assert.equal(errorCodeOf(conflict.json), "REPAIR_ORDER_STATE_CONFLICT");
  const otherProgress = await progressAs(staffB, id, { toStatus: "REPAIRING" });
  assert.equal(otherProgress.status, 403);
  assert.equal(errorCodeOf(otherProgress.json), "REPAIR_FORBIDDEN");

  // 事件核对：恰好一条「提交」+ 一条「受理」，没有重复受理事件。
  const events = await getDb().repairOrderEvent.findMany({ where: { repairOrderId: id } });
  assert.equal(events.length, 2, "重复受理不得重复写事件");
  assert.equal(events.filter((event) => event.toStatus === "ACCEPTED").length, 1);
});

dbTest("并发抢单：两个工作人员同时受理，只有一人成功且只有一条受理事件", async () => {
  const id = await newOrder();
  const staffA = await bearerFor(STAFF_A_ID);
  const staffB = await bearerFor(STAFF_B_ID);

  const [resultA, resultB] = await Promise.all([acceptAs(staffA, id), acceptAs(staffB, id)]);
  const statuses = [resultA.status, resultB.status].sort();
  assert.deepEqual(statuses, [200, 409], "应恰好一个成功一个冲突");

  const row = await getDb().repairOrder.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, "ACCEPTED");
  assert.ok(
    row.assigneeMemberProfileId === MP_A_ID || row.assigneeMemberProfileId === MP_B_ID,
    "受理人必须是其中一名工作人员",
  );
  const acceptEvents = await getDb().repairOrderEvent.count({
    where: { repairOrderId: id, toStatus: "ACCEPTED" },
  });
  assert.equal(acceptEvents, 1, "并发受理只能生成一条事件");
});

dbTest("推进与完成：受理人推进，客户刷新看到真实变化", async () => {
  const id = await newOrder();
  const staffA = await bearerFor(STAFF_A_ID);
  assert.equal((await acceptAs(staffA, id, { note: "已联系客户" })).status, 200);

  const repairing = await progressAs(staffA, id, { toStatus: "REPAIRING", note: "开始检测键盘" });
  assert.equal(repairing.status, 200, JSON.stringify(repairing.json));
  assert.equal(dataOf(repairing.json).status, "REPAIRING");

  const completed = await progressAs(staffA, id, { toStatus: "COMPLETED" });
  assert.equal(completed.status, 200);
  assert.equal(dataOf(completed.json).status, "COMPLETED");
  assert.equal(
    (dataOf(completed.json).actions as Record<string, unknown>).canCreateRecord,
    true,
    "完成后仍可在未建档时补备案（两套状态独立）",
  );

  // 重复推进 = 幂等：不重复写事件。
  const replay = await progressAs(staffA, id, { toStatus: "COMPLETED" });
  assert.equal(replay.status, 200);
  const events = await getDb().repairOrderEvent.findMany({
    where: { repairOrderId: id },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(
    events.map((event) => event.toStatus),
    ["SUBMITTED", "ACCEPTED", "REPAIRING", "COMPLETED"],
  );

  // 客户时间线能看到工作人员的操作与说明。
  const customer = await bearerFor(CUSTOMER_ID);
  const detail = await callRoute(customerDetailRoute, `http://localhost/api/v1/repair-orders/${id}`, {
    headers: customer,
    params: { id },
  });
  assert.equal(detail.status, 200);
  const view = dataOf(detail.json);
  assert.equal(view.status, "COMPLETED");
  const customerEvents = view.events as Array<Record<string, unknown>>;
  assert.equal(customerEvents.length, 4);
  assert.equal(customerEvents[1].note, "已联系客户");
});

dbTest("非法转换被拒：跳过受理、完成后回退、维修中取消", async () => {
  const id = await newOrder();
  const admin = await bearerFor(ADMIN_ID);
  const staffA = await bearerFor(STAFF_A_ID);

  // 管理员在未受理状态直接推进 → 409（不能跳过受理）。
  const skip = await progressAs(admin, id, { toStatus: "REPAIRING" });
  assert.equal(skip.status, 409);
  assert.equal(errorCodeOf(skip.json), "REPAIR_ORDER_STATE_INVALID");

  assert.equal((await acceptAs(staffA, id)).status, 200);
  assert.equal((await progressAs(staffA, id, { toStatus: "REPAIRING" })).status, 200);
  // 维修中不能再取消（表里没有 REPAIRING→CANCELLED）。
  const cancelRepairing = await cancelAs(admin, id, { note: "客户要求取消" });
  assert.equal(cancelRepairing.status, 409);
  assert.equal(errorCodeOf(cancelRepairing.json), "REPAIR_ORDER_STATE_INVALID");
  // 完成后不能回退到维修中，也不能取消。
  assert.equal((await progressAs(staffA, id, { toStatus: "COMPLETED" })).status, 200);
  const rollback = await progressAs(staffA, id, { toStatus: "REPAIRING" });
  assert.equal(rollback.status, 409);
  const cancelCompleted = await cancelAs(admin, id, { note: "取消已完成单" });
  assert.equal(cancelCompleted.status, 409);
  // 终态单：受理人重复受理 = 幂等返回当前状态；其他人受理 = 409 冲突。
  const reAcceptByAssignee = await acceptAs(staffA, id);
  assert.equal(reAcceptByAssignee.status, 200);
  assert.equal(dataOf(reAcceptByAssignee.json).status, "COMPLETED");
  const reAcceptByOther = await acceptAs(await bearerFor(STAFF_B_ID), id);
  assert.equal(reAcceptByOther.status, 409);
});

dbTest("取消：仅管理员、说明必填、重复取消幂等；客户能看到取消说明", async () => {
  const id = await newOrder();
  const staffA = await bearerFor(STAFF_A_ID);
  const admin = await bearerFor(ADMIN_ID);

  // 普通工作人员不能取消（取消是管理员能力）。
  const staffDenied = await cancelAs(staffA, id, { note: "尝试取消" });
  assert.equal(staffDenied.status, 403);

  // 说明必填。
  const noNote = await cancelAs(admin, id, { note: "   " });
  assert.equal(noNote.status, 400);
  const tooLong = await cancelAs(admin, id, { note: "x".repeat(501) });
  assert.equal(tooLong.status, 400);

  const cancelled = await cancelAs(admin, id, { note: "设备已由客户取回" });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
  assert.equal(dataOf(cancelled.json).status, "CANCELLED");
  const replay = await cancelAs(admin, id, { note: "设备已由客户取回" });
  assert.equal(replay.status, 200, "重复取消应幂等");
  assert.equal(
    await getDb().repairOrderEvent.count({ where: { repairOrderId: id, toStatus: "CANCELLED" } }),
    1,
  );

  // 已取消不能再受理。
  const acceptAfterCancel = await acceptAs(staffA, id);
  assert.equal(acceptAfterCancel.status, 409);

  const customer = await bearerFor(CUSTOMER_ID);
  const detail = await callRoute(customerDetailRoute, `http://localhost/api/v1/repair-orders/${id}`, {
    headers: customer,
    params: { id },
  });
  const events = dataOf(detail.json).events as Array<Record<string, unknown>>;
  assert.equal(events[1].note, "设备已由客户取回");
});

dbTest("管理员可推进他人受理的单，但无成员档案时不能受理", async () => {
  const id = await newOrder();
  const staffA = await bearerFor(STAFF_A_ID);
  const admin = await bearerFor(ADMIN_ID);

  // 纯 ADMIN 账号没有成员档案：不能成为受理人。
  const adminAccept = await acceptAs(admin, id);
  assert.equal(adminAccept.status, 403);
  assert.equal(errorCodeOf(adminAccept.json), "MEMBER_REQUIRED");

  assert.equal((await acceptAs(staffA, id)).status, 200);
  const adminProgress = await progressAs(admin, id, { toStatus: "REPAIRING", note: "管理员协助推进" });
  assert.equal(adminProgress.status, 200, JSON.stringify(adminProgress.json));
  assert.equal(dataOf(adminProgress.json).status, "REPAIRING");
  // 管理员的允许动作也应体现「不能受理/不能建档（非受理人）」。
  const actions = dataOf(adminProgress.json).actions as Record<string, unknown>;
  assert.equal(actions.canAccept, false);
  assert.equal(actions.canCreateRecord, false);
  assert.equal(actions.canComplete, true);
});

dbTest("工作人员详情：受理人、双状态与允许动作为服务端计算", async () => {
  const id = await newOrder();
  const staffB = await bearerFor(STAFF_B_ID);

  const before = await detailAs(staffB, id);
  assert.equal(before.status, 200);
  const view = dataOf(before.json);
  assert.equal(view.assignee, null, "未受理时没有受理人");
  assert.equal(view.record, null, "未建档时备案摘要为空");
  const actions = view.actions as Record<string, unknown>;
  assert.equal(actions.canAccept, true);
  assert.equal(actions.canStartRepair, false);
  assert.equal(actions.canCreateRecord, false);

  // 不存在的单 → 404；客户访问详情 → 403。
  const missing = await detailAs(staffB, "b3800000-0000-4000-8000-00000000dead");
  assert.equal(missing.status, 404);
  const customer = await bearerFor(CUSTOMER_ID);
  const denied = await detailAs(customer, id);
  assert.equal(denied.status, 403);
});

dbTest("双通道来源校验：Cookie 缺 Origin 被拒、带同源放行；Bearer 缺原生头被拒", async () => {
  const id = await newOrder();
  const cookie = await cookieFor(STAFF_A_ID);

  // 直连路由：不带 Origin 的 Cookie 写请求必须 403（同源防线不因 #38 放宽）。
  const rawCookie = new Request(`http://localhost/api/v1/staff/repair-orders/${id}/accept`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: "{}",
  });
  const denied = await acceptRoute(rawCookie, { params: Promise.resolve({ id }) });
  assert.equal(denied.status, 403, "Cookie 写请求缺 Origin 应被拒");
  assert.equal(errorCodeOf((await denied.json()) as Record<string, unknown>), "FORBIDDEN");

  // Web 端带同源 Origin：正常受理。
  const webAccepted = await callRoute(acceptRoute, `http://localhost/api/v1/staff/repair-orders/${id}/accept`, {
    method: "POST",
    headers: { cookie },
    body: {},
    params: { id },
  });
  assert.equal(webAccepted.status, 200, JSON.stringify(webAccepted.json));
  assert.equal(dataOf(webAccepted.json).status, "ACCEPTED");

  // Bearer 但缺 X-Client-Type: native → 403（浏览器无法伪造原生通道）。
  const id2 = await newOrder();
  const staffB = await bearerFor(STAFF_B_ID);
  const noNativeHeader: Record<string, string> = { authorization: staffB.authorization };
  const forged = await callRoute(acceptRoute, `http://localhost/api/v1/staff/repair-orders/${id2}/accept`, {
    method: "POST",
    headers: noNativeHeader,
    body: {},
    params: { id: id2 },
  });
  assert.equal(forged.status, 403);
});

dbTest("客户对工作人员写接口全被拒（受理/推进/取消/建档）", async () => {
  const id = await newOrder();
  const customer = await bearerFor(CUSTOMER_ID);
  assert.equal((await acceptAs(customer, id)).status, 403);
  assert.equal((await progressAs(customer, id, { toStatus: "REPAIRING" })).status, 403);
  assert.equal((await cancelAs(customer, id, { note: "客户尝试取消" })).status, 403);
  const record = await callRoute(
    createRecordRoute,
    `http://localhost/api/v1/staff/repair-orders/${id}/record`,
    { method: "POST", headers: { ...customer, "idempotency-key": "cust-key" }, body: {}, params: { id } },
  );
  assert.equal(record.status, 403);
});

dbTest("列表可见性：全部范围包含已受理单，客户列表接口不泄漏工作人员字段", async () => {
  const id = await newOrder();
  const staffA = await bearerFor(STAFF_A_ID);
  assert.equal((await acceptAs(staffA, id)).status, 200);

  const all = await queueAs(staffA, "?scope=all&pageSize=100");
  const item = listArray(all.json).find((row) => row.id === id);
  assert.ok(item, "全部范围应包含已受理单");
  assert.equal(typeof (item as Record<string, unknown>).assignee, "object");
  assert.equal(
    (item as Record<string, unknown>).actions !== undefined,
    true,
    "队列条目应带服务端计算的允许动作",
  );

  // 客户本人列表：只有客户字段，不含受理人 / 内部动作 / 备案关联。
  const customer = await bearerFor(CUSTOMER_ID);
  const mine = await callRoute(customerListRoute, "http://localhost/api/v1/repair-orders", {
    headers: customer,
  });
  const customerItem = listArray(mine.json).find((row) => row.id === id) as Record<string, unknown>;
  assert.ok(customerItem);
  assert.equal(customerItem.assignee, undefined);
  assert.equal(customerItem.actions, undefined);
  assert.equal(customerItem.repairRecordId, undefined);
});
