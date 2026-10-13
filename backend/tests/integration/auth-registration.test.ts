import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { authService } from "../../src/features/auth/auth-service";
import { POST as registerCustomer } from "../../src/app/api/v1/auth/register/customer/route";
import { POST as registerStaff } from "../../src/app/api/v1/auth/register/staff/route";
import { GET as nativeSession } from "../../src/app/api/v1/auth/native/session/route";
import { POST as nativeLogout } from "../../src/app/api/v1/auth/native/logout/route";
import { AppError } from "../../src/lib/api/errors";
import { resetRateLimitsForTests } from "../../src/lib/api/rate-limit";
import { SESSION_COOKIE_NAME } from "../../src/lib/auth/request";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import {
  digestInviteCode,
  digestSessionToken,
  generateInviteCode,
  hashPassword,
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

dbTest("邀请码注册：幂等重放必须校验本次密码，错密码被拒且不发令牌", async () => {
  /*
   * PR #65 审查 P1（安全，必修）的针对性回归。
   *
   * 原实现的重放分支只比 `code / qq / phone` 三项：这三项都能从原始成功请求里原样抄过来，
   * 只把 `password` 换成任意值，就能拿到一个有效的工作人员令牌 —— 「知道邀请码 + 知道幂等键」
   * 于是变成了免密凭证；账号改密之后重放旧请求同样能登录。这里固定三处断言：
   *   1) 错密码重放 → 401 AUTH_INVALID_CREDENTIALS，响应里没有任何令牌 / Cookie / 会话数据；
   *   2) 错密码重放不会新开会话（复用重放分支不该产生第二条会话）；
   *   3) 正确密码重放 → 仍然成功，幂等行为不回退。
   */
  const code = await createInviteCode({ maxUses: 3 });
  const qq = nextQq();
  const phone = nextPhone();
  const idempotencyKey = randomUUID();
  const first = await rawCall(registerStaff, STAFF_URL, {
    headers: headers(NATIVE),
    body: staffBody(code.plainCode, qq, { phone, idempotencyKey }),
  });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const firstData = dataOf(first.json);
  assert.equal(typeof firstData.token, "string");
  const userId = (await userIdForQq(qq))!;
  const sessionsBefore = await getDb().authSession.count({ where: { userId } });
  const credentialBefore = await getDb().passwordCredential.findUniqueOrThrow({
    where: { userId },
  });

  // 1) 同一幂等键 + 同 code / qq / phone，只把密码改错。
  const wrongPassword = await rawCall(registerStaff, STAFF_URL, {
    headers: headers(NATIVE),
    body: staffBody(code.plainCode, qq, {
      phone,
      idempotencyKey,
      password: "wrong-password-1",
      passwordConfirmation: "wrong-password-1",
    }),
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(errorCodeOf(wrongPassword.json), "AUTH_INVALID_CREDENTIALS");
  assert.equal(wrongPassword.json.data, undefined, "认证失败不得带会话数据");
  assert.equal(wrongPassword.headers.get("set-cookie"), null, "认证失败不得下发 Cookie");

  // 2) 错密码重放不得新开会话，也不得改写既有凭证。
  assert.equal(
    await getDb().authSession.count({ where: { userId } }),
    sessionsBefore,
    "被拒的重放不得产生会话",
  );
  const credentialAfter = await getDb().passwordCredential.findUniqueOrThrow({ where: { userId } });
  assert.equal(credentialAfter.passwordHash, credentialBefore.passwordHash, "不得改写既有口令");
  assert.equal(
    await getDb().inviteCodeRedemption.count({ where: { idempotencyKey } }),
    1,
    "被拒的重放不得新增兑换记录",
  );

  // 3) 正确密码重放仍然成功（幂等行为不回退）。
  const replayed = await rawCall(registerStaff, STAFF_URL, {
    headers: headers(NATIVE),
    body: staffBody(code.plainCode, qq, { phone, idempotencyKey }),
  });
  assert.equal(replayed.status, 201, JSON.stringify(replayed.json));
  const replayData = dataOf(replayed.json);
  assert.equal(typeof replayData.token, "string");
  assert.equal(replayData.userId, userId, "幂等重放必须回到同一个账号");
  assert.deepEqual(replayData.roles, ["MEMBER"]);
  // 每次重放都会发一个新会话（发会话本身不幂等），但不得多于「首次 + 本次重放」。
  assert.equal(await getDb().authSession.count({ where: { userId } }), sessionsBefore + 1);
  // 重放不得再扣一次名额。
  assert.equal(
    (await getDb().inviteCode.findUniqueOrThrow({ where: { id: code.id } })).usedCount,
    1,
    "幂等重放不得重复扣名额",
  );
});

dbTest("邀请码注册：账号改密后重放旧请求同样被拒", async () => {
  /* P1 的另一半场景：原始请求的密码在账号改密之后已经失效，重放必须跟着失效。 */
  const code = await createInviteCode({ maxUses: 3 });
  const qq = nextQq();
  const phone = nextPhone();
  const idempotencyKey = randomUUID();
  const first = await rawCall(registerStaff, STAFF_URL, {
    headers: headers(NATIVE),
    body: staffBody(code.plainCode, qq, { phone, idempotencyKey }),
  });
  assert.equal(first.status, 201);
  const userId = (await userIdForQq(qq))!;
  const originalToken = String(dataOf(first.json).token);

  // 改密（会轮换会话并吊销旧令牌），之后原密码已经不对了。
  await getDb().passwordCredential.update({
    where: { userId },
    data: {
      passwordHash: await hashPassword("changed-password-9"),
      passwordChangedAt: new Date(),
    },
  });
  await getDb().authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const replayed = await rawCall(registerStaff, STAFF_URL, {
    headers: headers(NATIVE),
    body: staffBody(code.plainCode, qq, { phone, idempotencyKey }),
  });
  assert.equal(replayed.status, 401);
  assert.equal(errorCodeOf(replayed.json), "AUTH_INVALID_CREDENTIALS");
  assert.equal(replayed.json.data, undefined);
  assert.equal(replayed.headers.get("set-cookie"), null);
  // 旧令牌已失效，新令牌一个都没发出来。
  assert.equal(await getDb().authSession.count({ where: { userId, revokedAt: null } }), 0);
  assert.equal(
    await getDb().authSession.count({ where: { tokenDigest: digestSessionToken(originalToken) } }),
    1,
    "首次注册的会话记录仍在（已被吊销），重放没有新增",
  );
});

dbTest("注册失败不留下账号：会话写库失败时整体回滚，重试可以成功", async () => {
  /*
   * PR #65 审查 P2（健壮性，必修）的针对性回归。
   *
   * 原实现先提交账号、再在事务外发会话：会话写库一失败就返回 500，而账号已经落库，
   * 用户重试只能拿到 `409 ACCOUNT_IDENTITY_TAKEN`，被自己的失败请求锁在门外。
   * 现在把「建账号 + 发会话」放进同一个串行化事务：会话一发失败，账号创建也跟着回滚，
   * 同一个 QQ 重试注册应当成功而不是 409。
   *
   * 注入方式：把 `authService.openSessionWith` 换成必定抛错的实现（只对接下来一次调用生效），
   * 模拟「会话写库失败」，然后原样重试同一个 QQ。
   */
  const qq = nextQq();
  assert.equal(await userIdForQq(qq), null, "前置：该 QQ 尚未注册");

  const original = authService.openSessionWith;
  authService.openSessionWith = async () => {
    throw new AppError("INTERNAL_ERROR", "模拟会话写库失败（测试注入）", { status: 500 });
  };
  let failed: Awaited<ReturnType<typeof rawCall>>;
  try {
    failed = await rawCall(registerCustomer, CUSTOMER_URL, {
      headers: headers(NATIVE),
      body: customerBody(qq),
    });
  } finally {
    authService.openSessionWith = original;
  }

  assert.equal(failed.status, 500);
  assert.equal(errorCodeOf(failed.json), "INTERNAL_ERROR");
  assert.equal(failed.json.data, undefined);
  assert.equal(failed.headers.get("set-cookie"), null);
  assert.equal(await userIdForQq(qq), null, "注册失败不得留下账号（P2 原子性）");
  assert.equal(
    await getDb().user.count({ where: { displayName: `客户${qq}` } }),
    0,
    "回滚不得留下半成品用户行",
  );

  // 恢复后重试同一个 QQ：应当成功，而不是 409 ACCOUNT_IDENTITY_TAKEN。
  const retried = await rawCall(registerCustomer, CUSTOMER_URL, {
    headers: headers(NATIVE),
    body: customerBody(qq),
  });
  assert.equal(retried.status, 201, JSON.stringify(retried.json));
  const retryData = dataOf(retried.json);
  assert.equal(typeof retryData.token, "string");
  assert.equal(retryData.home, "CUSTOMER");
  const userId = (await userIdForQq(qq))!;
  assert.equal(retryData.userId, userId);
  const session = await callRoute(nativeSession, "http://localhost/api/v1/auth/native/session", {
    headers: { ...NATIVE, authorization: `Bearer ${String(retryData.token)}` },
  });
  assert.equal(session.status, 200);
  assert.equal(dataOf(session.json).userId, userId);
});

dbTest("邀请码注册：会话写库失败时账号与名额一起回滚，重试可以成功", async () => {
  /* P2 的邀请码侧：同一事务里还要多回滚「邀请码扣减」与「兑换记录」。 */
  const code = await createInviteCode({ maxUses: 1 });
  const qq = nextQq();
  const phone = nextPhone();

  const original = authService.openSessionWith;
  authService.openSessionWith = async () => {
    throw new AppError("INTERNAL_ERROR", "模拟会话写库失败（测试注入）", { status: 500 });
  };
  let failed: Awaited<ReturnType<typeof rawCall>>;
  try {
    failed = await rawCall(registerStaff, STAFF_URL, {
      headers: headers(NATIVE),
      body: staffBody(code.plainCode, qq, { phone }),
    });
  } finally {
    authService.openSessionWith = original;
  }

  assert.equal(failed.status, 500);
  assert.equal(errorCodeOf(failed.json), "INTERNAL_ERROR");
  assert.equal(await userIdForQq(qq), null, "邀请码注册失败同样不得留下账号");
  assert.equal(
    (await getDb().inviteCode.findUniqueOrThrow({ where: { id: code.id } })).usedCount,
    0,
    "失败不得扣减名额",
  );
  assert.equal(
    await getDb().inviteCodeRedemption.count({ where: { inviteCodeId: code.id } }),
    0,
    "失败不得留下兑换记录（provision 与它在同一事务里，一并回滚）",
  );

  const retried = await rawCall(registerStaff, STAFF_URL, {
    headers: headers(NATIVE),
    body: staffBody(code.plainCode, qq, { phone }),
  });
  assert.equal(retried.status, 201, JSON.stringify(retried.json));
  assert.deepEqual(dataOf(retried.json).roles, ["MEMBER"]);
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
