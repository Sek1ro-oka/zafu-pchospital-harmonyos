import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { POST as registerCustomer } from "../../src/app/api/v1/auth/register/customer/route";
import { POST as registerStaff } from "../../src/app/api/v1/auth/register/staff/route";
import { GET as nativeSession } from "../../src/app/api/v1/auth/native/session/route";
import { POST as nativeLogout } from "../../src/app/api/v1/auth/native/logout/route";
import { resetRateLimitsForTests } from "../../src/lib/api/rate-limit";
import { SESSION_COOKIE_NAME } from "../../src/lib/auth/request";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import {
  generateInviteCode,
  digestInviteCode,
  verifyPassword,
} from "../../src/lib/security/secrets";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute, sameOriginHeaders } from "./http-harness";

/*
 * Issue #60 第 3、4 项：客户自主注册 + 邀请码注册工作人员的 HTTP 契约。
 *
 * 用例只增删自己造的数据（QQ 统一以 `9200` 开头，清理由该前缀反查），
 * 不依赖其他文件是否清过库；两个注册入口都是真正的路由函数 + 真实测试库。
 */
const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

const CUSTOMER_URL = "http://localhost/api/v1/auth/register/customer";
const STAFF_URL = "http://localhost/api/v1/auth/register/staff";
const NATIVE = { "x-client-type": "native" };
const QQ_PREFIX = "9200";
const ADMIN_ID = "92000000-0000-4000-8000-000000000001";
const PASSWORD = "register-123";

type Json = Record<string, unknown>;

let sequence = 0;
const inviteCodeIds: string[] = [];

function nextQq(): string {
  sequence += 1;
  return `${QQ_PREFIX}${String(sequence).padStart(6, "0")}`;
}

function nextPhone(): string {
  sequence += 1;
  return `139${String(40_000_000 + sequence).padStart(8, "0")}`;
}

/** 每个用例用独立来源 IP，避免注册限流桶（同一 IP 15 分钟 10 次）互相干扰。 */
function nextIp(): string {
  sequence += 1;
  return `198.51.100.${(sequence % 200) + 10}`;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { ...extra, "x-real-ip": nextIp() };
}

function dataOf(json: Json): Json {
  assert.equal(json.success, true, JSON.stringify(json));
  return json.data as Json;
}

function errorCodeOf(json: Json): string {
  assert.equal(json.success, false, JSON.stringify(json));
  return String((json.error as Json).code);
}

/**
 * 不走 `callRoute`：那个装置默认给每个请求加同源 `Origin`，
 * 而这里的用例恰恰要区分「带 Origin 的 Web 请求」和「不带 Origin 的原生请求」。
 */
async function rawCall(
  handler: (request: Request) => Promise<Response>,
  url: string,
  init: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: Json; headers: Headers }> {
  const response = await handler(
    new Request(url, {
      method: "POST",
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
  return {
    status: response.status,
    json: (await response.json()) as Json,
    headers: response.headers,
  };
}

function customerBody(qq: string, extra: Record<string, unknown> = {}) {
  return { qq, password: PASSWORD, passwordConfirmation: PASSWORD, ...extra };
}

function staffBody(code: string, qq: string, extra: Record<string, unknown> = {}) {
  return {
    code,
    idempotencyKey: randomUUID(),
    realName: "注册工作人员",
    qq,
    phone: nextPhone(),
    password: PASSWORD,
    passwordConfirmation: PASSWORD,
    ...extra,
  };
}

/** 直接落一条可控的邀请码（不经过管理端接口：本文件只验证注册侧行为）。 */
async function createInviteCode(options: {
  maxUses?: number;
  expiresAt?: Date | null;
}): Promise<{ id: string; plainCode: string }> {
  const plainCode = generateInviteCode();
  const id = randomUUID();
  const now = new Date();
  await getDb().inviteCode.create({
    data: {
      id,
      codeDigest: digestInviteCode(plainCode),
      displayPrefix: plainCode.slice(0, 8),
      status: "ACTIVE",
      maxUses: options.maxUses ?? 1,
      usedCount: 0,
      expiresAt: options.expiresAt === undefined ? null : options.expiresAt,
      createdByUserId: ADMIN_ID,
      createdAt: now,
      updatedAt: now,
    },
  });
  inviteCodeIds.push(id);
  return { id, plainCode };
}

async function userIdForQq(qq: string): Promise<string | null> {
  const identity = await getDb().userIdentity.findUnique({
    where: { type_identifierNormalized: { type: "QQ", identifierNormalized: qq } },
  });
  return identity?.userId ?? null;
}

async function cleanup(): Promise<void> {
  const db = getDb();
  const users = await db.user.findMany({
    where: { identities: { some: { identifierNormalized: { startsWith: QQ_PREFIX } } } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  await db.inviteCodeRedemption.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { inviteCodeId: { in: inviteCodeIds } }] },
  });
  await db.accountProvision.deleteMany({ where: { userId: { in: userIds } } });
  await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await db.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await db.userSkill.deleteMany({ where: { memberProfile: { userId: { in: userIds } } } });
  await db.memberProfile.deleteMany({ where: { userId: { in: userIds } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: userIds } } });
  await db.userIdentity.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.inviteCode.deleteMany({ where: { id: { in: inviteCodeIds } } });
  await db.user.deleteMany({ where: { id: ADMIN_ID } });
  inviteCodeIds.length = 0;
}

before(async () => {
  if (!enabled) return;
  resetRateLimitsForTests();
  await cleanup();
  const now = new Date();
  // 邀请码的 `created_by_user_id` 是必填外键（Restrict）：只作夹具，不参与断言。
  await getDb().user.create({
    data: {
      id: ADMIN_ID,
      status: "ACTIVE",
      displayName: "注册用例夹具",
      createdAt: now,
      updatedAt: now,
    },
  });
});

after(async () => {
  if (!enabled) return;
  await cleanup();
  await disconnectDb();
});

dbTest("客户注册（原生）：返回令牌与客户入口，不建角色与成员档案", async () => {
  const qq = nextQq();
  const {
    status,
    json,
    headers: responseHeaders,
  } = await rawCall(registerCustomer, CUSTOMER_URL, {
    headers: headers(NATIVE),
    body: customerBody(qq),
  });
  assert.equal(status, 201, JSON.stringify(json));
  const data = dataOf(json);
  assert.equal(typeof data.token, "string");
  assert.ok(String(data.token).length >= 32);
  assert.match(String(data.expiresAt), /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(data.roles, []);
  assert.deepEqual(data.permissions, ["repair.order:create", "repair.order:read"]);
  assert.equal(data.home, "CUSTOMER");
  assert.equal(data.memberProfileId, null);
  assert.equal(data.mustChangePassword, false);
  assert.equal(responseHeaders.get("set-cookie"), null, "原生通道不下发 Cookie");

  const db = getDb();
  const userId = await userIdForQq(qq);
  assert.ok(userId, "注册后应能按 QQ 反查到身份");
  assert.equal(await db.memberProfile.count({ where: { userId } }), 0);
  assert.equal(await db.userRole.count({ where: { userId } }), 0);
  const credential = await db.passwordCredential.findUniqueOrThrow({ where: { userId } });
  assert.equal(credential.mustChangePassword, false, "自设密码不应要求首次改密");
  assert.equal(await verifyPassword(PASSWORD, credential.passwordHash), true);

  // 令牌立即可用：不是「注册成功但没登录」的中间态。
  const session = await callRoute(nativeSession, "http://localhost/api/v1/auth/native/session", {
    headers: { ...NATIVE, authorization: `Bearer ${String(data.token)}` },
  });
  assert.equal(session.status, 200);
  assert.equal(dataOf(session.json).userId, userId);
});

dbTest("客户注册（Web）：同源下发 Cookie，响应体不含令牌", async () => {
  const qq = nextQq();
  const {
    status,
    json,
    headers: responseHeaders,
  } = await rawCall(registerCustomer, CUSTOMER_URL, {
    headers: headers(sameOriginHeaders()),
    body: customerBody(qq),
  });
  assert.equal(status, 201);
  const data = dataOf(json);
  assert.equal(data.token, undefined);
  assert.equal(typeof data.userId, "string");
  assert.equal(data.mustChangePassword, false);
  assert.match(responseHeaders.get("set-cookie") ?? "", new RegExp(`${SESSION_COOKIE_NAME}=`));
});

dbTest("客户注册：重复 QQ 返回 ACCOUNT_IDENTITY_TAKEN，既有账号与口令不被改写", async () => {
  const qq = nextQq();
  const first = await rawCall(registerCustomer, CUSTOMER_URL, {
    headers: headers(NATIVE),
    body: customerBody(qq),
  });
  assert.equal(first.status, 201);
  const userId = (await userIdForQq(qq))!;
  const before = await getDb().user.findUniqueOrThrow({ where: { id: userId } });
  const beforeCredential = await getDb().passwordCredential.findUniqueOrThrow({
    where: { userId },
  });

  const duplicate = await rawCall(registerCustomer, CUSTOMER_URL, {
    headers: headers(NATIVE),
    body: customerBody(qq, {
      password: "another-password",
      passwordConfirmation: "another-password",
    }),
  });
  assert.equal(duplicate.status, 409);
  assert.equal(errorCodeOf(duplicate.json), "ACCOUNT_IDENTITY_TAKEN");
  assert.equal(duplicate.json.data, undefined, "失败响应不得带会话数据");
  assert.equal(duplicate.headers.get("set-cookie"), null);

  const after = await getDb().user.findUniqueOrThrow({ where: { id: userId } });
  const afterCredential = await getDb().passwordCredential.findUniqueOrThrow({ where: { userId } });
  assert.equal(after.displayName, before.displayName);
  assert.equal(after.deletedAt, null);
  assert.equal(afterCredential.passwordHash, beforeCredential.passwordHash, "不得改写既有口令");
  assert.equal(await verifyPassword("another-password", afterCredential.passwordHash), false);
  assert.equal(await verifyPassword(PASSWORD, afterCredential.passwordHash), true);
  assert.equal(
    await getDb().userIdentity.count({ where: { type: "QQ", identifierNormalized: qq } }),
    1,
  );
  assert.equal(await getDb().authSession.count({ where: { userId } }), 1, "只有第一次注册产生会话");
});

dbTest("客户注册：客户端伪造 roles / permissions / home 完全不生效", async () => {
  const qq = nextQq();
  const { status, json } = await rawCall(registerCustomer, CUSTOMER_URL, {
    headers: headers(NATIVE),
    body: customerBody(qq, {
      roles: ["ADMIN", "MEMBER"],
      permissions: ["member:manage", "invite:create"],
      home: "STAFF",
      memberProfileId: "forged-profile",
      memberStatus: "ACTIVE",
    }),
  });
  assert.equal(status, 201);
  const data = dataOf(json);
  const permissions = data.permissions as string[];
  assert.deepEqual(data.roles, []);
  assert.equal(permissions.includes("member:manage"), false);
  assert.equal(permissions.includes("invite:create"), false);
  assert.equal(data.home, "CUSTOMER");
  assert.equal(data.memberProfileId, null);

  const userId = (await userIdForQq(qq))!;
  assert.equal(await getDb().userRole.count({ where: { userId } }), 0);
  assert.equal(await getDb().memberProfile.count({ where: { userId } }), 0);
});

dbTest("公开写通道：缺 Origin 又缺 X-Client-Type 的注册请求被拒，且不建账号", async () => {
  const qq = nextQq();
  const noChannel = await rawCall(registerCustomer, CUSTOMER_URL, {
    headers: headers(),
    body: customerBody(qq),
  });
  assert.equal(noChannel.status, 403);
  assert.equal(errorCodeOf(noChannel.json), "FORBIDDEN");
  assert.equal(noChannel.headers.get("set-cookie"), null);

  const forgedOrigin = await rawCall(registerCustomer, CUSTOMER_URL, {
    headers: { ...headers(NATIVE), origin: "https://evil.example" },
    body: customerBody(qq),
  });
  assert.equal(forgedOrigin.status, 403, "带原生头也不能绕过来源白名单");
  assert.equal(errorCodeOf(forgedOrigin.json), "FORBIDDEN");

  assert.equal(await userIdForQq(qq), null, "被拒的注册不得留下账号");
});

dbTest("邀请码注册工作人员（原生）：产生 MEMBER 身份、成员档案并扣减一次", async () => {
  const code = await createInviteCode({ maxUses: 1 });
  const qq = nextQq();
  const phone = nextPhone();
  const {
    status,
    json,
    headers: responseHeaders,
  } = await rawCall(registerStaff, STAFF_URL, {
    headers: headers(NATIVE),
    body: staffBody(code.plainCode, qq, { phone }),
  });
  assert.equal(status, 201, JSON.stringify(json));
  const data = dataOf(json);
  assert.equal(typeof data.token, "string");
  const permissions = data.permissions as string[];
  assert.deepEqual(data.roles, ["MEMBER"]);
  assert.equal(permissions.includes("repair:create"), true);
  assert.equal(permissions.includes("invite:create"), false, "工作人员不等于管理员");
  assert.equal(data.home, "STAFF");
  assert.equal(data.memberStatus, "ACTIVE");
  assert.equal(typeof data.memberProfileId, "string");
  assert.equal(data.mustChangePassword, false);
  assert.equal(responseHeaders.get("set-cookie"), null);

  const userId = (await userIdForQq(qq))!;
  const profile = await getDb().memberProfile.findUniqueOrThrow({ where: { userId } });
  assert.equal(profile.id, data.memberProfileId);
  assert.equal(await getDb().userRole.count({ where: { userId, revokedAt: null } }), 1);
  const stored = await getDb().inviteCode.findUniqueOrThrow({ where: { id: code.id } });
  assert.equal(stored.usedCount, 1);
  assert.equal(await getDb().inviteCodeRedemption.count({ where: { inviteCodeId: code.id } }), 1);

  // 自设密码可登录（不改密）。
  const credential = await getDb().passwordCredential.findUniqueOrThrow({ where: { userId } });
  assert.equal(await verifyPassword(PASSWORD, credential.passwordHash), true);
});

dbTest("邀请码注册：无效 / 已到期 / 次数耗尽的邀请码分别失败且不留账号", async () => {
  const invalidQq = nextQq();
  const invalid = await rawCall(registerStaff, STAFF_URL, {
    headers: headers(NATIVE),
    body: staffBody(generateInviteCode(), invalidQq),
  });
  assert.equal(invalid.status, 400);
  assert.equal(errorCodeOf(invalid.json), "INVITE_CODE_INVALID");

  const expiredCode = await createInviteCode({
    maxUses: 1,
    expiresAt: new Date(Date.now() - 60_000),
  });
  const expiredQq = nextQq();
  const expired = await rawCall(registerStaff, STAFF_URL, {
    headers: headers(NATIVE),
    body: staffBody(expiredCode.plainCode, expiredQq),
  });
  assert.equal(expired.status, 409);
  assert.equal(errorCodeOf(expired.json), "INVITE_CODE_EXPIRED");
  assert.equal(
    (await getDb().inviteCode.findUniqueOrThrow({ where: { id: expiredCode.id } })).usedCount,
    0,
  );

  // 次数耗尽：先用掉唯一名额，再用同一码注册第二个账号。
  const exhaustedCode = await createInviteCode({ maxUses: 1 });
  const firstQq = nextQq();
  const first = await rawCall(registerStaff, STAFF_URL, {
    headers: headers(NATIVE),
    body: staffBody(exhaustedCode.plainCode, firstQq),
  });
  assert.equal(first.status, 201);
  const exhaustedQq = nextQq();
  const exhausted = await rawCall(registerStaff, STAFF_URL, {
    headers: headers(NATIVE),
    body: staffBody(exhaustedCode.plainCode, exhaustedQq),
  });
  assert.equal(exhausted.status, 409);
  assert.equal(errorCodeOf(exhausted.json), "INVITE_CODE_EXHAUSTED");
  assert.equal(
    (await getDb().inviteCode.findUniqueOrThrow({ where: { id: exhaustedCode.id } })).usedCount,
    1,
    "失败的注册不得多扣名额",
  );

  for (const qq of [invalidQq, expiredQq, exhaustedQq]) {
    assert.equal(await userIdForQq(qq), null, `失败的邀请码注册不得留下账号（${qq}）`);
  }
});

dbTest("客户自主注册不消耗邀请码", async () => {
  const code = await createInviteCode({ maxUses: 3 });
  const qq = nextQq();
  const { status } = await rawCall(registerCustomer, CUSTOMER_URL, {
    headers: headers(NATIVE),
    body: customerBody(qq),
  });
  assert.equal(status, 201);
  const stored = await getDb().inviteCode.findUniqueOrThrow({ where: { id: code.id } });
  assert.equal(stored.usedCount, 0);
  assert.equal(await getDb().inviteCodeRedemption.count({ where: { inviteCodeId: code.id } }), 0);
});

dbTest("邀请码注册：已有账号的 QQ 不被认领，注册失败也不留半登录状态", async () => {
  // 先有一个客户账号（同一 QQ 已有口令凭据）。
  const qq = nextQq();
  const existing = await rawCall(registerCustomer, CUSTOMER_URL, {
    headers: headers(NATIVE),
    body: customerBody(qq),
  });
  assert.equal(existing.status, 201);
  const userId = (await userIdForQq(qq))!;
  const sessionsBefore = await getDb().authSession.count({ where: { userId } });
  const code = await createInviteCode({ maxUses: 1 });
  const conflictPhone = nextPhone();

  const conflict = await rawCall(registerStaff, STAFF_URL, {
    headers: headers(NATIVE),
    body: staffBody(code.plainCode, qq, { phone: conflictPhone }),
  });
  assert.equal(conflict.status, 409);
  assert.equal(errorCodeOf(conflict.json), "ACCOUNT_IDENTITY_CONFLICT");
  assert.equal(conflict.json.data, undefined);
  assert.equal(conflict.headers.get("set-cookie"), null);
  assert.equal(
    await getDb().authSession.count({ where: { userId } }),
    sessionsBefore,
    "失败的注册不得多发会话",
  );
  assert.equal(await getDb().memberProfile.count({ where: { userId } }), 0, "不得给客户补成员档案");
  assert.equal(await getDb().userRole.count({ where: { userId } }), 0, "不得给客户补角色");
  assert.equal(
    await getDb().userIdentity.count({
      where: { userId, type: "PHONE", identifierNormalized: conflictPhone },
    }),
    0,
    "失败的身份写入必须整体回滚",
  );
  assert.equal(
    (await getDb().inviteCode.findUniqueOrThrow({ where: { id: code.id } })).usedCount,
    0,
    "身份冲突时邀请码应回滚，不扣名额",
  );
});

dbTest("注册失败的响应一律没有令牌 / Cookie / 会话数据", async () => {
  const mismatchQq = nextQq();
  const mismatch = await rawCall(registerCustomer, CUSTOMER_URL, {
    headers: headers(NATIVE),
    body: { qq: mismatchQq, password: PASSWORD, passwordConfirmation: "different-123" },
  });
  assert.equal(mismatch.status, 400);
  assert.equal(errorCodeOf(mismatch.json), "PASSWORD_CONFIRMATION_MISMATCH");
  assert.equal(mismatch.json.data, undefined);
  assert.equal(mismatch.headers.get("set-cookie"), null);
  assert.equal(await userIdForQq(mismatchQq), null);

  const badQq = await rawCall(registerCustomer, CUSTOMER_URL, {
    headers: headers(NATIVE),
    body: { qq: "not-a-qq", password: PASSWORD, passwordConfirmation: PASSWORD },
  });
  assert.equal(badQq.status, 400);
  assert.equal(errorCodeOf(badQq.json), "VALIDATION_FAILED");
  assert.equal(badQq.json.data, undefined);
  assert.equal(badQq.headers.get("set-cookie"), null);

  const staffMismatch = await rawCall(registerStaff, STAFF_URL, {
    headers: headers(NATIVE),
    body: {
      ...staffBody(generateInviteCode(), nextQq()),
      passwordConfirmation: "different-123",
    },
  });
  assert.equal(staffMismatch.status, 400);
  assert.equal(errorCodeOf(staffMismatch.json), "PASSWORD_CONFIRMATION_MISMATCH");
  assert.equal(staffMismatch.headers.get("set-cookie"), null);
});

dbTest("注册即登录：会话在服务端可查，退出后令牌立即失效", async () => {
  const qq = nextQq();
  const registered = await rawCall(registerCustomer, CUSTOMER_URL, {
    headers: headers(NATIVE),
    body: customerBody(qq),
  });
  assert.equal(registered.status, 201);
  const token = String(dataOf(registered.json).token);
  const session = await getDb().authSession.findFirstOrThrow({
    where: { userId: (await userIdForQq(qq))!, revokedAt: null },
  });
  assert.equal(session.revokedAt, null);
  assert.ok(session.expiresAt.getTime() > Date.now());

  const loggedOut = await callRoute(nativeLogout, "http://localhost/api/v1/auth/native/logout", {
    method: "POST",
    headers: { ...NATIVE, authorization: `Bearer ${token}` },
  });
  assert.equal(loggedOut.status, 200);
  const afterLogout = await callRoute(
    nativeSession,
    "http://localhost/api/v1/auth/native/session",
    {
      headers: { ...NATIVE, authorization: `Bearer ${token}` },
    },
  );
  assert.equal(afterLogout.status, 401);
  assert.equal(errorCodeOf(afterLogout.json), "AUTH_SESSION_INVALID");
});
