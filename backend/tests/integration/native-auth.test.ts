import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { POST as nativeLogin } from "../../src/app/api/v1/auth/native/login/route";
import { POST as nativeLogout } from "../../src/app/api/v1/auth/native/logout/route";
import { GET as nativeSession } from "../../src/app/api/v1/auth/native/session/route";
import { POST as webLogin } from "../../src/app/api/v1/auth/login/route";
import { GET as adminMembers } from "../../src/app/api/v1/admin/members/route";
import { GET as memberDashboard } from "../../src/app/api/v1/member/dashboard/route";
import { SESSION_COOKIE_NAME } from "../../src/lib/auth/request";
import { digestSessionToken, hashPassword } from "../../src/lib/security/secrets";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute } from "./http-harness";

const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

/* 原生通道集成用例：走真实路由函数 + 真实测试库会话表。
   夹具是固定 ID 的独立账号，只增删自己的数据，不依赖其他文件的清库顺序。 */
const CUSTOMER_ID = "3e000000-0000-4000-8000-000000000001";
const STAFF_ID = "3e000000-0000-4000-8000-000000000002";
const CUSTOMER_QQ = "900001001";
const STAFF_QQ = "900001002";
const PASSWORD = "native-auth-123";
const NATIVE = { "x-client-type": "native" };
const NATIVE_URL = "http://localhost/api/v1/auth/native/login";

type Json = Record<string, unknown>;

function dataOf(json: Json): Json {
  assert.equal(json.success, true, JSON.stringify(json));
  return json.data as Json;
}

function errorCodeOf(json: Json): string {
  assert.equal(json.success, false, JSON.stringify(json));
  return String((json.error as Json).code);
}

function bearer(token: string): Record<string, string> {
  return { ...NATIVE, authorization: `Bearer ${token}` };
}

async function loginAs(qq: string, password: string) {
  return callRoute(nativeLogin, NATIVE_URL, {
    method: "POST",
    headers: NATIVE,
    body: { qq, password },
  });
}

before(async () => {
  if (!enabled) return;
  const db = getDb();
  const ids = [CUSTOMER_ID, STAFF_ID];
  // 只清理本文件固定账号的旧数据；顺序保证先删子表再删父表（FK RESTRICT）。
  await db.authSession.deleteMany({ where: { userId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await db.userRole.deleteMany({ where: { userId: { in: ids } } });
  await db.memberProfile.deleteMany({ where: { userId: { in: ids } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: ids } } });
  await db.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  // 登录节流是瞬态数据；旧窗口留在库里会让连续多次运行互相干扰。
  await db.loginThrottle.deleteMany();

  const now = new Date();
  const passwordHash = await hashPassword(PASSWORD);
  for (const [userId, qq, displayName] of [
    [CUSTOMER_ID, CUSTOMER_QQ, "原生用例客户"],
    [STAFF_ID, STAFF_QQ, "原生用例工作人员"],
  ] as const) {
    await db.user.create({
      data: { id: userId, status: "ACTIVE", displayName, createdAt: now, updatedAt: now },
    });
    await db.userIdentity.create({
      data: {
        id: randomUUID(),
        userId,
        type: "QQ",
        identifierNormalized: qq,
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    await db.passwordCredential.create({
      data: {
        userId,
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  // 工作人员按 MEMBER（维修队成员）+ 有效成员档案建档；客户没有任何角色与成员档案。
  const memberRole = await db.role.findUnique({ where: { code: "MEMBER" } });
  assert.ok(memberRole, "缺少 MEMBER 角色，先运行 db:seed");
  await db.userRole.create({
    data: {
      id: randomUUID(),
      userId: STAFF_ID,
      roleId: memberRole.id,
      sourceType: "ADMIN_CREATED",
      grantedAt: now,
      activeKey: `${STAFF_ID}:${memberRole.id}`,
    },
  });
  await db.memberProfile.create({
    data: {
      id: randomUUID(),
      userId: STAFF_ID,
      realName: "原生用例工作人员",
      status: "ACTIVE",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
});

after(async () => {
  if (!enabled) return;
  await disconnectDb();
});

dbTest("原生登录：客户账号返回客户入口，令牌在响应体且不下发 Cookie", async () => {
  const { status, json, headers } = await loginAs(CUSTOMER_QQ, PASSWORD);
  assert.equal(status, 200);
  const data = dataOf(json);
  assert.equal(typeof data.token, "string");
  assert.ok(String(data.token).length >= 32);
  assert.deepEqual(data.roles, []);
  assert.equal(data.home, "CUSTOMER");
  assert.equal(data.userId, CUSTOMER_ID);
  assert.equal(typeof data.expiresAt, "string");
  assert.equal(headers.get("set-cookie"), null);
});

dbTest("原生登录：工作人员返回 MEMBER 角色与工作人员入口", async () => {
  const { status, json } = await loginAs(STAFF_QQ, PASSWORD);
  assert.equal(status, 200);
  const data = dataOf(json);
  assert.deepEqual(data.roles, ["MEMBER"]);
  assert.equal(data.home, "STAFF");
  assert.equal(data.memberStatus, "ACTIVE");
});

dbTest("Web 登录保持 Cookie 通道：同源成功下发 Cookie，响应体不含令牌", async () => {
  const { status, json, headers } = await callRoute(webLogin, "http://localhost/api/v1/auth/login", {
    method: "POST",
    body: { qq: CUSTOMER_QQ, password: PASSWORD },
  });
  assert.equal(status, 200);
  const data = dataOf(json);
  assert.equal(data.token, undefined);
  assert.match(headers.get("set-cookie") ?? "", new RegExp(`${SESSION_COOKIE_NAME}=`));
});

dbTest("Web 登录缺少同源 Origin 仍被拒绝", async () => {
  const { status, json } = await callRoute(webLogin, "http://localhost/api/v1/auth/login", {
    method: "POST",
    headers: { origin: "" },
    body: { qq: CUSTOMER_QQ, password: PASSWORD },
  });
  assert.equal(status, 403);
  assert.equal(errorCodeOf(json), "FORBIDDEN");
});

dbTest("客户端伪造角色字段不生效：登录体与请求头都改不了服务器认定", async () => {
  const forged = await callRoute(nativeLogin, NATIVE_URL, {
    method: "POST",
    headers: NATIVE,
    body: {
      qq: CUSTOMER_QQ,
      password: PASSWORD,
      roles: ["ADMIN", "MEMBER"],
      permissions: ["member:manage"],
      home: "STAFF",
    },
  });
  assert.equal(forged.status, 200);
  const data = dataOf(forged.json);
  assert.deepEqual(data.roles, []);
  assert.equal(data.home, "CUSTOMER");

  // 会话查询同样忽略客户端附加的角色类字段。
  const session = await callRoute(nativeSession, "http://localhost/api/v1/auth/native/session", {
    headers: { ...bearer(String(data.token)), "x-roles": "ADMIN", "x-home": "STAFF" },
  });
  assert.equal(session.status, 200);
  const sessionData = dataOf(session.json);
  assert.deepEqual(sessionData.roles, []);
  assert.equal(sessionData.home, "CUSTOMER");
});

dbTest("会话查询：缺少令牌返回 UNAUTHENTICATED", async () => {
  const { status, json } = await callRoute(
    nativeSession,
    "http://localhost/api/v1/auth/native/session",
    { headers: NATIVE },
  );
  assert.equal(status, 401);
  assert.equal(errorCodeOf(json), "UNAUTHENTICATED");
});

dbTest("原生通道：缺少客户端标识的登录/查询/退出都返回 FORBIDDEN", async () => {
  const attempts = [
    await callRoute(nativeLogin, NATIVE_URL, {
      method: "POST",
      headers: { origin: "http://localhost" },
      body: { qq: CUSTOMER_QQ, password: PASSWORD },
    }),
    await callRoute(nativeSession, "http://localhost/api/v1/auth/native/session", {
      headers: { authorization: "Bearer whatever" },
    }),
    await callRoute(nativeLogout, "http://localhost/api/v1/auth/native/logout", {
      method: "POST",
      headers: { authorization: "Bearer whatever" },
    }),
  ];
  for (const { status, json } of attempts) {
    assert.equal(status, 403);
    assert.equal(errorCodeOf(json), "FORBIDDEN");
  }
});

dbTest("会话查询：无效令牌返回 AUTH_SESSION_INVALID", async () => {
  const { status, json } = await callRoute(
    nativeSession,
    "http://localhost/api/v1/auth/native/session",
    { headers: bearer("not-a-real-token") },
  );
  assert.equal(status, 401);
  assert.equal(errorCodeOf(json), "AUTH_SESSION_INVALID");
});

dbTest("会话查询：过期令牌返回 AUTH_SESSION_EXPIRED 并被吊销", async () => {
  const db = getDb();
  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const now = new Date();
  await db.authSession.create({
    data: {
      id: randomUUID(),
      userId: CUSTOMER_ID,
      tokenDigest: digestSessionToken(token),
      createdAt: new Date(now.getTime() - 60_000),
      lastSeenAt: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() - 1_000),
    },
  });
  const url = "http://localhost/api/v1/auth/native/session";
  const expired = await callRoute(nativeSession, url, { headers: bearer(token) });
  assert.equal(expired.status, 401);
  assert.equal(errorCodeOf(expired.json), "AUTH_SESSION_EXPIRED");

  const again = await callRoute(nativeSession, url, { headers: bearer(token) });
  assert.equal(again.status, 401);
  assert.equal(errorCodeOf(again.json), "AUTH_SESSION_INVALID");
});

dbTest("退出：吊销令牌且重复退出幂等", async () => {
  const login = await loginAs(CUSTOMER_QQ, PASSWORD);
  const token = String(dataOf(login.json).token);
  const url = "http://localhost/api/v1/auth/native/logout";

  const logout = await callRoute(nativeLogout, url, { method: "POST", headers: bearer(token) });
  assert.equal(logout.status, 200);
  assert.equal(dataOf(logout.json).loggedOut, true);

  const afterLogout = await callRoute(
    nativeSession,
    "http://localhost/api/v1/auth/native/session",
    { headers: bearer(token) },
  );
  assert.equal(afterLogout.status, 401);
  assert.equal(errorCodeOf(afterLogout.json), "AUTH_SESSION_INVALID");

  const again = await callRoute(nativeLogout, url, { method: "POST", headers: bearer(token) });
  assert.equal(again.status, 200);
});

dbTest("权限：客户令牌访问工作人员接口被拒", async () => {
  const login = await loginAs(CUSTOMER_QQ, PASSWORD);
  const token = String(dataOf(login.json).token);
  const { status, json } = await callRoute(
    memberDashboard,
    "http://localhost/api/v1/member/dashboard",
    { headers: bearer(token) },
  );
  assert.equal(status, 403);
  assert.equal(errorCodeOf(json), "FORBIDDEN");
});

dbTest("权限：工作人员令牌访问管理员接口被拒（工作人员不等于超级管理员）", async () => {
  const login = await loginAs(STAFF_QQ, PASSWORD);
  const token = String(dataOf(login.json).token);
  const { status, json } = await callRoute(
    adminMembers,
    "http://localhost/api/v1/admin/members",
    { headers: bearer(token) },
  );
  assert.equal(status, 403);
  assert.equal(errorCodeOf(json), "FORBIDDEN");
});

dbTest("原生登录：错误密码返回 AUTH_INVALID_CREDENTIALS，未达节流上限时可再登录", async () => {
  const wrong = await loginAs(CUSTOMER_QQ, "definitely-wrong-password");
  assert.equal(wrong.status, 401);
  assert.equal(errorCodeOf(wrong.json), "AUTH_INVALID_CREDENTIALS");

  const correct = await loginAs(CUSTOMER_QQ, PASSWORD);
  assert.equal(correct.status, 200);
  assert.equal(dataOf(correct.json).home, "CUSTOMER");
});
