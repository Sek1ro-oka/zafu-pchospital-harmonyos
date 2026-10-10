import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { GET as listRoute, POST as submitRoute } from "../../src/app/api/v1/repair-orders/route";
import { GET as detailRoute } from "../../src/app/api/v1/repair-orders/[id]/route";
import { getDb, disconnectDb } from "../../src/lib/db/client";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute, sameOriginHeaders } from "./http-harness";

/**
 * 客户报修单的路由级集成测试（真实 MySQL / MariaDB）。
 *
 * 覆盖上游 Issue #37 的三条验收：
 *   1. 提交一单 → 数据库真实保存 → 重新查询列表与详情仍在；
 *   3. 客户只能访问本人单据，拿别人的 ID 查详情必须 404；
 *   4. 提交与查询的针对性测试（本文件）。
 *
 * **刻意不用 `sessionCookie()` 夹具建账号**：那个助手会顺手授予 ADMIN 角色，
 * 一授角色就绕过了本 Issue 最核心的「无角色即客户」路径 —— 测出来的就不是客户视角了。
 * 这里直接 `user.create` 造**零角色**账号 + 手写会话，让 `permissionsForRoles([])`
 * 真的走到 `customerPermissions` 分支。
 *
 * 数据隔离靠 `before` 里的定点清空（只动本文件造的账号与其单据），
 * 不像 m0 那样全表清空 —— 免得与并行的其他集成文件互相踩。
 */
const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

const CUSTOMER_A_ID = "a1000000-0000-4000-8000-000000000037";
const CUSTOMER_B_ID = "a2000000-0000-4000-8000-000000000037";

before(async () => {
  if (!enabled) return;
  const db = getDb();
  const now = new Date();
  // 先清子表（events → orders），否则 FK RESTRICT 会挡住删单。
  await db.repairOrderEvent.deleteMany({ where: { actorUserId: { in: [CUSTOMER_A_ID, CUSTOMER_B_ID] } } });
  await db.repairOrder.deleteMany({ where: { submittedByUserId: { in: [CUSTOMER_A_ID, CUSTOMER_B_ID] } } });
  await db.authSession.deleteMany({ where: { userId: { in: [CUSTOMER_A_ID, CUSTOMER_B_ID] } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: [CUSTOMER_A_ID, CUSTOMER_B_ID] } } });
  // 两个客户账号：**零角色**，正是「无角色即客户」要覆盖的形态。
  for (const userId of [CUSTOMER_A_ID, CUSTOMER_B_ID]) {
    await db.user.deleteMany({ where: { id: userId } });
    await db.user.create({
      data: { id: userId, status: "ACTIVE", displayName: `客户${userId.slice(1, 2)}`, createdAt: now, updatedAt: now },
    });
  }
});

after(async () => {
  if (!enabled) return;
  const db = getDb();
  await db.repairOrderEvent.deleteMany({ where: { actorUserId: { in: [CUSTOMER_A_ID, CUSTOMER_B_ID] } } });
  await db.repairOrder.deleteMany({ where: { submittedByUserId: { in: [CUSTOMER_A_ID, CUSTOMER_B_ID] } } });
  await db.authSession.deleteMany({ where: { userId: { in: [CUSTOMER_A_ID, CUSTOMER_B_ID] } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: [CUSTOMER_A_ID, CUSTOMER_B_ID] } } });
  await db.user.deleteMany({ where: { id: { in: [CUSTOMER_A_ID, CUSTOMER_B_ID] } } });
  await disconnectDb();
});

/**
 * 造一个可用会话，返回可直接放进请求头的 `Authorization: Bearer`。
 *
 * 两件事必须同时成立，否则测到的是鉴权分支而不是业务分支：
 * 1. 有会话行（`authenticateRequest` 要按 tokenDigest 查到它）；
 * 2. **不是「首次登录必须改密」** —— 这类账号会被 `authenticateRequest` 一律
 *    403 `PASSWORD_CHANGE_REQUIRED`，报修提交因此根本走不到校验/落库。
 *    台账用户如果不显式建口令凭据行，默认就被当作待改密账号，所以这里显式
 *    upsert 一行 `mustChangePassword: false`（与 `sessionCookie()` 同一处理）。
 */
async function bearerFor(userId: string): Promise<Record<string, string>> {
  const db = getDb();
  const now = new Date();
  const raw = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const { digestSessionToken } = await import("../../src/lib/security/secrets");
  await db.passwordCredential.upsert({
    where: { userId },
    update: { mustChangePassword: false, passwordChangedAt: now },
    create: {
      userId,
      passwordHash: "integration-placeholder-hash",
      mustChangePassword: false,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.authSession.create({
    data: {
      id: randomUUID(),
      userId,
      tokenDigest: digestSessionToken(raw),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    },
  });
  // `x-client-type: native`：写接口按令牌来源分流防线，Bearer 通道要求这个头。
  return { authorization: `Bearer ${raw}`, "x-client-type": "native" };
}

function submitBody(overrides: Record<string, unknown> = {}) {
  return {
    deviceModel: "ThinkPad X1 Carbon",
    deviceSerial: "PF2ABCDE",
    faultDescription: "开机后风扇狂转，屏幕无显示",
    contactPhone: "13800138000",
    ...overrides,
  };
}

type Envelope = { success?: boolean; data?: Record<string, unknown>; error?: { code?: string } };

function dataOf(json: Record<string, unknown>): Record<string, unknown> {
  return (json as Envelope).data ?? {};
}

/**
 * 列表接口的 `data` 是**数组本身**（分页在信封 `meta.pagination`），
 * 与 `/api/v1/repairs` 一致 —— 不是 `{ items: [...] }` 那种包装。
 */
function listArray(json: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = (json as Envelope).data;
  assert.ok(Array.isArray(data), "列表 data 应为数组");
  return data as Array<Record<string, unknown>>;
}

/**
 * 提交报修的路由级调用。
 *
 * 本接口的写路径按**令牌来源**分流 CSRF 防线：Cookie 通道查同源白名单，
 * 原生通道要求 `x-client-type: native`。因此这里必须带 Bearer + 原生头，
 * 否则走的是 Cookie 分支而被 `assertSameOrigin` 拦下 —— 那测到的就不是 App 真实路径。
 */
function submitOrder(headers: Record<string, string>, body: Record<string, unknown>) {
  return callRoute(submitRoute, "http://localhost/api/v1/repair-orders", {
    method: "POST",
    headers,
    body,
  });
}

dbTest("客户提交报修：201 落库，状态为 SUBMITTED，并写入首条进度事件", async () => {
  const headers = await bearerFor(CUSTOMER_A_ID);
  const response = await submitOrder(headers, submitBody());
  assert.equal(response.status, 201, `提交应成功，实际 ${response.status}`);
  const data = dataOf(response.json);
  assert.equal(data.status, "SUBMITTED");
  assert.equal(data.deviceModel, "ThinkPad X1 Carbon");
  assert.equal(data.contactPhone, "13800138000");
  const events = data.events as Array<Record<string, unknown>>;
  assert.equal(events.length, 1, "应有且仅有一条「已提交」事件");
  assert.equal(events[0].fromStatus, null);
  assert.equal(events[0].toStatus, "SUBMITTED");

  // 直接查库核对：接口返回成功不等于真的落库。
  const row = await getDb().repairOrder.findUnique({ where: { id: data.id as string } });
  assert.ok(row, "报修单应已写入数据库");
  assert.equal(row.submittedByUserId, CUSTOMER_A_ID);
});

dbTest("提交成功后重新查询：列表与详情都能取回该单（验收项 1）", async () => {
  const headers = await bearerFor(CUSTOMER_A_ID);
  const created = await submitOrder(headers, submitBody({ deviceModel: "重新查询用机型", deviceSerial: undefined }));
  assert.equal(created.status, 201);
  const id = dataOf(created.json).id as string;

  const list = await callRoute(listRoute, "http://localhost/api/v1/repair-orders", { headers });
  assert.equal(list.status, 200);
  // 列表的 `data` 就是数组本身，分页在信封 meta 里（与 /api/v1/repairs 同一形状）。
  const items = listArray(list.json);
  assert.ok((items as Array<Record<string, unknown>>).some((item) => item.id === id), "列表应包含刚提交的单");

  const detail = await callRoute(detailRoute, `http://localhost/api/v1/repair-orders/${id}`, {
    headers,
    params: { id },
  });
  assert.equal(detail.status, 200);
  assert.equal(dataOf(detail.json).id, id);
});

dbTest("无效必填内容被拒绝：400 且不落库（验收项 2）", async () => {
  const headers = await bearerFor(CUSTOMER_A_ID);
  const before = await getDb().repairOrder.count({ where: { submittedByUserId: CUSTOMER_A_ID } });

  const cases: Array<[string, Record<string, unknown>]> = [
    ["缺故障描述", submitBody({ faultDescription: "" })],
    ["缺联系电话", submitBody({ contactPhone: "" })],
    ["缺机型", submitBody({ deviceModel: "" })],
    ["机型超长", submitBody({ deviceModel: "x".repeat(61) })],
    ["电话格式非法", submitBody({ contactPhone: "abc" })],
  ];
  for (const [name, body] of cases) {
    const response = await submitOrder(headers, body);
    assert.equal(response.status, 400, `${name} 应被拒绝，实际 ${response.status}`);
    assert.equal((response.json as Envelope).error?.code, "VALIDATION_FAILED", `${name} 错误码`);
  }

  const after = await getDb().repairOrder.count({ where: { submittedByUserId: CUSTOMER_A_ID } });
  assert.equal(after, before, "被拒绝的提交不得留下任何单据");
});

dbTest("越权隔离：B 拿 A 的单号查详情必须 404（验收项 3）", async () => {
  const headersA = await bearerFor(CUSTOMER_A_ID);
  const headersB = await bearerFor(CUSTOMER_B_ID);
  const created = await submitOrder(headersA, submitBody({ deviceModel: "A 的单据" }));
  const id = dataOf(created.json).id as string;

  const byB = await callRoute(detailRoute, `http://localhost/api/v1/repair-orders/${id}`, {
    headers: headersB,
    params: { id },
  });
  // 必须是 404 而不是 403：403 会暴露「该 ID 存在但不属于你」。
  assert.equal(byB.status, 404, `越权读取应返回 404，实际 ${byB.status}`);
  assert.equal((byB.json as Envelope).error?.code, "REPAIR_ORDER_NOT_FOUND");
});

dbTest("越权隔离：B 的列表看不到 A 的单据（验收项 3）", async () => {
  const headersA = await bearerFor(CUSTOMER_A_ID);
  const headersB = await bearerFor(CUSTOMER_B_ID);
  const created = await submitOrder(headersA, submitBody({ deviceModel: "只在 A 列表里" }));
  const id = dataOf(created.json).id as string;

  const listB = await callRoute(listRoute, "http://localhost/api/v1/repair-orders", { headers: headersB });
  const items = listArray(listB.json);
  assert.equal(items.some((item) => item.id === id), false, "B 的列表不应出现 A 的单据");
});

dbTest("匿名请求被拒：401，两个读接口与写接口一致", async () => {
  const noAuth = sameOriginHeaders();
  const list = await callRoute(listRoute, "http://localhost/api/v1/repair-orders", { headers: noAuth });
  assert.equal(list.status, 401, "匿名列表应 401");
  const detail = await callRoute(detailRoute, `http://localhost/api/v1/repair-orders/${randomUUID()}`, {
    headers: noAuth,
    params: { id: randomUUID() },
  });
  assert.equal(detail.status, 401, "匿名详情应 401");
});

dbTest("幂等：同一 Idempotency-Key 重复提交只建一张单，第二次返回原单", async () => {
  const headers = await bearerFor(CUSTOMER_A_ID);
  const key = `it-${randomUUID()}`;
  const before = await getDb().repairOrder.count({ where: { submittedByUserId: CUSTOMER_A_ID } });

  const idemHeaders = { ...headers, "idempotency-key": key };
  const first = await submitOrder(idemHeaders, submitBody({ deviceModel: "幂等测试" }));
  const second = await submitOrder(idemHeaders, submitBody({ deviceModel: "幂等测试" }));
  assert.equal(first.status, 201);
  assert.equal(second.status, 201, "重复提交仍返回成功（拿回原单），不是 409");
  assert.equal(dataOf(second.json).id, dataOf(first.json).id, "两次应指向同一张单");

  const after = await getDb().repairOrder.count({ where: { submittedByUserId: CUSTOMER_A_ID } });
  assert.equal(after, before + 1, "重复提交只应新增一张单");
});

dbTest("客户权限来自无角色分支：customerPermissions 恰好是本接口所需的最小集", async () => {
  // 这条断言把「无角色即客户」钉死：一旦有人把空角色改回返回 []，这里立刻红。
  const permissions = permissionsForRoles([]);
  assert.deepEqual([...permissions].sort(), ["repair.order:create", "repair.order:read"]);
  assert.equal(permissions.includes("repair:update"), false, "客户不得拿到工作人员备案权限");
  assert.equal(permissions.includes("member:manage"), false, "客户不得拿到管理权限");
});
