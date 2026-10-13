import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { authService } from "../../src/features/auth/auth-service";
import {
  SESSION_LIFETIME_KEEP_MS,
  SESSION_LIFETIME_SHORT_MS,
} from "../../src/features/auth/session-lifetime";
import { POST as nativeChangePassword } from "../../src/app/api/v1/auth/native/password/change/route";
import { POST as webChangePassword } from "../../src/app/api/v1/auth/password/change/route";
import { GET as nativeSession } from "../../src/app/api/v1/auth/native/session/route";
import { POST as nativeLogout } from "../../src/app/api/v1/auth/native/logout/route";
import { POST as nativeLogin } from "../../src/app/api/v1/auth/native/login/route";
import { POST as webLogin } from "../../src/app/api/v1/auth/login/route";
import { GET as customerProfile } from "../../src/app/api/v1/customer/profile/route";
import { AppError } from "../../src/lib/api/errors";
import { SESSION_COOKIE_NAME } from "../../src/lib/auth/request";
import { digestSessionToken, hashPassword } from "../../src/lib/security/secrets";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute } from "./http-harness";

/*
 * Issue #60 第二批：原生改密 + rememberMe 会话档位。
 *
 * 用例只增删自己造的数据（固定 UUID 账号），不依赖其他文件的清库顺序；
 * 全部走真实路由函数 + 真实测试库。
 *
 * 两种到期时间用**确定时间**验证，不真的等一天：
 *   - 发放时直接算 `expiresAt` 的偏移量（24h / 30d 各自命中）；
 *   - 到期后把 `expiresAt` 改到过去（`db.authSession.update`），
 *     再断言 `authenticate` 被拒且旧令牌按契约失效。
 */
const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

const CUSTOMER_ID = "3e000000-0000-4000-8000-000000000011";
const FORCED_ID = "3e000000-0000-4000-8000-000000000012";
const CUSTOMER_QQ = "900002001";
const FORCED_QQ = "900002002";
const PASSWORD = "native-change-123";
const NEW_PASSWORD = "changed-password-456";
const NATIVE = { "x-client-type": "native" };
const NATIVE_CHANGE_URL = "http://localhost/api/v1/auth/native/password/change";

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** 原生通道的请求（不带同源 Origin）：这正是 `assertWriteAccess` 的 Bearer 分支。 */
async function nativeCall(
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

async function loginAs(qq: string, password: string, rememberMe?: boolean) {
  // 带固定来源 IP：登录节流键是 `(QQ, IP)`，不给 IP 时全部请求共用 "unknown"，
  // 多个用例连续失败会互相触发 15 分钟锁定。
  return nativeCall(nativeLogin, "http://localhost/api/v1/auth/native/login", {
    headers: { ...NATIVE, "x-real-ip": "203.0.113.77" },
    body: { qq, password, rememberMe },
  });
}

async function sessionRowFor(token: string) {
  return getDb().authSession.findUniqueOrThrow({
    where: { tokenDigest: digestSessionToken(token) },
  });
}

before(async () => {
  if (!enabled) return;
  const db = getDb();
  const ids = [CUSTOMER_ID, FORCED_ID];
  await db.authSession.deleteMany({ where: { userId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await db.userRole.deleteMany({ where: { userId: { in: ids } } });
  await db.memberProfile.deleteMany({ where: { userId: { in: ids } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: ids } } });
  await db.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.loginThrottle.deleteMany();

  const now = new Date();
  const passwordHash = await hashPassword(PASSWORD);
  for (const [userId, qq, displayName, mustChange] of [
    [CUSTOMER_ID, CUSTOMER_QQ, "改密用例客户", false],
    [FORCED_ID, FORCED_QQ, "改密用例强制改密账号", true],
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
        mustChangePassword: mustChange,
        passwordChangedAt: mustChange ? null : now,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
});

after(async () => {
  if (!enabled) return;
  await disconnectDb();
});

/**
 * 把夹具账号复位到「初始口令 + 无节流」。
 *
 * 每个用例都先调用它：本文件多个用例会连续改同一个账号的口令（24h/30d 轮换、
 * 显式改档都写 `password_credentials`），若共享一份口令，后面的用例就会拿旧口令
 * 去登录而失败。节流也要清：登录节流键是 `(QQ, IP)`，同一 QQ + 同一来源 IP
 * 连续失败 5 次会锁 15 分钟，而本文件的请求都走同一个默认 IP。
 */
async function resetCustomerPassword(): Promise<void> {
  const db = getDb();
  await db.passwordCredential.update({
    where: { userId: CUSTOMER_ID },
    data: { passwordHash: await hashPassword(PASSWORD), passwordChangedAt: new Date() },
  });
  await db.loginThrottle.deleteMany();
}

async function resetForcedPassword(): Promise<void> {
  const db = getDb();
  await db.passwordCredential.update({
    where: { userId: FORCED_ID },
    data: {
      passwordHash: await hashPassword(PASSWORD),
      mustChangePassword: true,
      passwordChangedAt: null,
    },
  });
  await db.loginThrottle.deleteMany();
}

// ---------------------------------------------------------------------------
// 1. 原生改密：成功 → 新令牌、新令牌可用、旧令牌失效
// ---------------------------------------------------------------------------

dbTest("原生改密成功：返回新令牌、新令牌可用、旧令牌失效、不下发 Cookie", async () => {
  await resetCustomerPassword();
  const login = await loginAs(CUSTOMER_QQ, PASSWORD);
  assert.equal(login.status, 200, JSON.stringify(login.json));
  const oldToken = String(dataOf(login.json).token);

  const changed = await nativeCall(nativeChangePassword, NATIVE_CHANGE_URL, {
    headers: bearer(oldToken),
    body: {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      newPasswordConfirmation: NEW_PASSWORD,
    },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  const data = dataOf(changed.json);
  const newToken = String(data.token);
  assert.ok(newToken.length >= 32);
  assert.notEqual(newToken, oldToken, "必须轮换出新令牌，不能把旧令牌再发一次");
  assert.equal(data.mustChangePassword, false);
  assert.equal(typeof data.expiresAt, "string");
  assert.equal(changed.headers.get("set-cookie"), null, "原生通道不下发 Cookie");

  // 新令牌立即可用（真实业务接口放行）。
  const session = await callRoute(nativeSession, "http://localhost/api/v1/auth/native/session", {
    headers: bearer(newToken),
  });
  assert.equal(session.status, 200);
  assert.equal(dataOf(session.json).userId, CUSTOMER_ID);

  // 旧令牌按契约失效：不是过期，是「无效」。
  const oldAgain = await callRoute(nativeSession, "http://localhost/api/v1/auth/native/session", {
    headers: bearer(oldToken),
  });
  assert.equal(oldAgain.status, 401);
  assert.equal(errorCodeOf(oldAgain.json), "AUTH_SESSION_INVALID");

  // 轮换出的新会话必须显式记录档位（NULL 只属于存量数据）。
  const rotated = await sessionRowFor(newToken);
  assert.notEqual(rotated.rememberMe, null, "新会话必须显式写入 rememberMe");
  assert.equal(rotated.rememberMe, false, "登录未勾选保持登录 → 普通档位（24 小时）");
});

dbTest("原生改密：缺少 X-Client-Type 或缺少令牌都被拒，且不改口令", async () => {
  await resetCustomerPassword();
  const login = await loginAs(CUSTOMER_QQ, PASSWORD);
  assert.equal(login.status, 200);
  const token = String(dataOf(login.json).token);
  const before = await getDb().passwordCredential.findUniqueOrThrow({ where: { userId: CUSTOMER_ID } });
  // 相对计数：其他用例可能给同一账号留下未吊销的会话，这里只关心「本次失败有没有新增」。
  const liveSessionsBefore = await getDb().authSession.count({
    where: { userId: CUSTOMER_ID, revokedAt: null },
  });

  const noClientType = await nativeCall(nativeChangePassword, NATIVE_CHANGE_URL, {
    headers: { authorization: `Bearer ${token}` },
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, newPasswordConfirmation: NEW_PASSWORD },
  });
  assert.equal(noClientType.status, 403);
  assert.equal(errorCodeOf(noClientType.json), "FORBIDDEN");

  const noToken = await nativeCall(nativeChangePassword, NATIVE_CHANGE_URL, {
    headers: NATIVE,
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, newPasswordConfirmation: NEW_PASSWORD },
  });
  assert.equal(noToken.status, 401);
  assert.equal(errorCodeOf(noToken.json), "UNAUTHENTICATED");

  const invalidToken = await nativeCall(nativeChangePassword, NATIVE_CHANGE_URL, {
    headers: bearer("not-a-real-token"),
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, newPasswordConfirmation: NEW_PASSWORD },
  });
  assert.equal(invalidToken.status, 401);
  assert.equal(errorCodeOf(invalidToken.json), "AUTH_SESSION_INVALID");

  // 失败路径不得改口令、不得发新会话。
  const after = await getDb().passwordCredential.findUniqueOrThrow({ where: { userId: CUSTOMER_ID } });
  assert.equal(after.passwordHash, before.passwordHash, "失败的改密不得改写口令");
  assert.equal(
    await getDb().authSession.count({ where: { userId: CUSTOMER_ID, revokedAt: null } }),
    liveSessionsBefore,
    "失败的改密不得新开会话",
  );
});

// ---------------------------------------------------------------------------
// 2. 失败路径：错误旧密码 / 新旧相同 / 口令不达标
// ---------------------------------------------------------------------------

dbTest("原生改密：错误旧密码返回 PASSWORD_CURRENT_INVALID，旧密码仍可登录", async () => {
  await resetCustomerPassword();
  const login = await loginAs(CUSTOMER_QQ, PASSWORD);
  const token = String(dataOf(login.json).token);
  const before = await getDb().passwordCredential.findUniqueOrThrow({ where: { userId: CUSTOMER_ID } });

  const wrong = await nativeCall(nativeChangePassword, NATIVE_CHANGE_URL, {
    headers: bearer(token),
    body: { currentPassword: "definitely-not-the-password", newPassword: NEW_PASSWORD, newPasswordConfirmation: NEW_PASSWORD },
  });
  assert.equal(wrong.status, 400);
  assert.equal(errorCodeOf(wrong.json), "PASSWORD_CURRENT_INVALID");
  assert.equal(wrong.json.data, undefined, "失败响应不得带令牌");

  const after = await getDb().passwordCredential.findUniqueOrThrow({ where: { userId: CUSTOMER_ID } });
  assert.equal(after.passwordHash, before.passwordHash);

  // 令牌没有被这次失败请求轮换掉：旧密码依然能登录。
  const relogin = await loginAs(CUSTOMER_QQ, PASSWORD);
  assert.equal(relogin.status, 200);
});

dbTest("原生改密：新旧密码相同时与 Web 行为一致（不发明新错误码）", async () => {
  /*
   * 这里锁住的是「原生入口不自己加规则」：`AuthService.changePassword`（Web 与原生共用）
   * **没有**「新口令不得与当前口令相同」这条校验 —— 两次确认一致、长度合规、
   * 当前口令正确即成功。原生入口不得比 Web 更严（否则同一个表单两条通道行为不同），
   * 也不得为此发明新的错误码。
   */
  await resetCustomerPassword();
  const login = await loginAs(CUSTOMER_QQ, PASSWORD);
  assert.equal(login.status, 200, JSON.stringify(login.json));
  const token = String(dataOf(login.json).token);

  const same = await nativeCall(nativeChangePassword, NATIVE_CHANGE_URL, {
    headers: bearer(token),
    body: { currentPassword: PASSWORD, newPassword: PASSWORD, newPasswordConfirmation: PASSWORD },
  });
  assert.equal(same.status, 200, JSON.stringify(same.json));
  assert.equal(dataOf(same.json).mustChangePassword, false);
});

dbTest("原生改密：两次新密码不一致返回 PASSWORD_CONFIRMATION_MISMATCH", async () => {
  await resetCustomerPassword();
  const login = await loginAs(CUSTOMER_QQ, PASSWORD);
  const token = String(dataOf(login.json).token);

  const mismatch = await nativeCall(nativeChangePassword, NATIVE_CHANGE_URL, {
    headers: bearer(token),
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, newPasswordConfirmation: "different-password" },
  });
  assert.equal(mismatch.status, 400);
  assert.equal(errorCodeOf(mismatch.json), "PASSWORD_CONFIRMATION_MISMATCH");
});

dbTest("原生改密：口令长度不达标返回 VALIDATION_FAILED", async () => {
  await resetCustomerPassword();
  const login = await loginAs(CUSTOMER_QQ, PASSWORD);
  const token = String(dataOf(login.json).token);

  const tooShort = await nativeCall(nativeChangePassword, NATIVE_CHANGE_URL, {
    headers: bearer(token),
    body: { currentPassword: PASSWORD, newPassword: "12345", newPasswordConfirmation: "12345" },
  });
  assert.equal(tooShort.status, 400);
  assert.equal(errorCodeOf(tooShort.json), "VALIDATION_FAILED");

  const tooLong = await nativeCall(nativeChangePassword, NATIVE_CHANGE_URL, {
    headers: bearer(token),
    body: {
      currentPassword: PASSWORD,
      newPassword: "x".repeat(129),
      newPasswordConfirmation: "x".repeat(129),
    },
  });
  assert.equal(tooLong.status, 400);
  assert.equal(errorCodeOf(tooLong.json), "VALIDATION_FAILED");
});

// ---------------------------------------------------------------------------
// 3. 强制改密账号：业务接口 403，改密入口可用，改密后放行
// ---------------------------------------------------------------------------

dbTest("强制改密账号：业务接口 403 PASSWORD_CHANGE_REQUIRED，改密入口可用", async () => {
  await resetForcedPassword();
  // 用初始口令登录（`mustChangePassword = true` 的夹具账号）。
  const login = await loginAs(FORCED_QQ, PASSWORD);
  assert.equal(login.status, 200, JSON.stringify(login.json));
  const token = String(dataOf(login.json).token);
  assert.equal(dataOf(login.json).mustChangePassword, true);

  // 业务接口按默认档位一律拒绝。
  const business = await callRoute(customerProfile, "http://localhost/api/v1/customer/profile", {
    headers: bearer(token),
  });
  assert.equal(business.status, 403);
  assert.equal(errorCodeOf(business.json), "PASSWORD_CHANGE_REQUIRED");

  // 改密入口对强制改密账号是可用的（否则账号永远无法自救）。
  const changed = await nativeCall(nativeChangePassword, NATIVE_CHANGE_URL, {
    headers: bearer(token),
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, newPasswordConfirmation: NEW_PASSWORD },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  const newToken = String(dataOf(changed.json).token);
  assert.equal(dataOf(changed.json).mustChangePassword, false);

  const credential = await getDb().passwordCredential.findUniqueOrThrow({ where: { userId: FORCED_ID } });
  assert.equal(credential.mustChangePassword, false, "改密后必须清掉强制改密标记");

  // 改密后同一个业务接口放行。
  const allowed = await callRoute(customerProfile, "http://localhost/api/v1/customer/profile", {
    headers: bearer(newToken),
  });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.json));
  assert.equal(dataOf(allowed.json).displayName, "改密用例强制改密账号");

  // 旧令牌（改密前的会话）已失效。
  const oldAgain = await callRoute(nativeSession, "http://localhost/api/v1/auth/native/session", {
    headers: bearer(token),
  });
  assert.equal(oldAgain.status, 401);
  assert.equal(errorCodeOf(oldAgain.json), "AUTH_SESSION_INVALID");
});

dbTest("强制改密账号：会话查询与退出不受限制（自救三入口）", async () => {
  await resetForcedPassword();
  const login = await loginAs(FORCED_QQ, PASSWORD);
  assert.equal(login.status, 200, JSON.stringify(login.json));
  assert.equal(dataOf(login.json).mustChangePassword, true, "夹具账号初始口令未改");
  const forcedToken = String(dataOf(login.json).token);

  const session = await callRoute(nativeSession, "http://localhost/api/v1/auth/native/session", {
    headers: bearer(forcedToken),
  });
  assert.equal(session.status, 200, "会话查询必须对强制改密账号放行（allowForcedPasswordChange）");
  assert.equal(dataOf(session.json).mustChangePassword, true);

  const logout = await nativeCall(nativeLogout, "http://localhost/api/v1/auth/native/logout", {
    headers: bearer(forcedToken),
  });
  assert.equal(logout.status, 200);

  const afterLogout = await callRoute(nativeSession, "http://localhost/api/v1/auth/native/session", {
    headers: bearer(forcedToken),
  });
  assert.equal(afterLogout.status, 401);
  assert.equal(errorCodeOf(afterLogout.json), "AUTH_SESSION_INVALID");
});

// ---------------------------------------------------------------------------
// 4. rememberMe：30 天 / 24 小时 / 改密轮换保留选择
// ---------------------------------------------------------------------------

dbTest("rememberMe=true：会话按 30 天发放，档位落库", async () => {
  await resetCustomerPassword();
  const login = await loginAs(CUSTOMER_QQ, PASSWORD, true);
  assert.equal(login.status, 200, JSON.stringify(login.json));
  const token = String(dataOf(login.json).token);

  const row = await sessionRowFor(token);
  assert.equal(row.rememberMe, true, "保持登录档位必须落库");

  const actual = row.expiresAt.getTime() - row.createdAt.getTime();
  assert.ok(
    Math.abs(actual - SESSION_LIFETIME_KEEP_MS) < 2_000,
    `期望约 ${SESSION_LIFETIME_KEEP_MS}ms（30 天），实际 ${actual}ms`,
  );
  assert.equal(dataOf(login.json).expiresAt, row.expiresAt.toISOString());
});

dbTest("rememberMe 缺省与 false：会话按 24 小时发放，档位落库", async () => {
  await resetCustomerPassword();
  for (const rememberMe of [undefined, false] as const) {
    const login = await loginAs(CUSTOMER_QQ, PASSWORD, rememberMe);
    assert.equal(login.status, 200, JSON.stringify(login.json));
    const token = String(dataOf(login.json).token);

    const row = await sessionRowFor(token);
    assert.equal(row.rememberMe, false, `rememberMe=${rememberMe} 应按普通档位落库`);

    const actual = row.expiresAt.getTime() - row.createdAt.getTime();
    assert.ok(
      Math.abs(actual - SESSION_LIFETIME_SHORT_MS) < 2_000,
      `期望约 ${SESSION_LIFETIME_SHORT_MS}ms（24 小时），实际 ${actual}ms`,
    );
  }
});

dbTest("rememberMe：24 小时档位到期后 authenticate 被拒且旧令牌失效", async () => {
  await resetCustomerPassword();
  const login = await loginAs(CUSTOMER_QQ, PASSWORD);
  const token = String(dataOf(login.json).token);
  const row = await sessionRowFor(token);
  assert.equal(row.rememberMe, false);

  // 确定时间：不真等一天，直接把到期时刻改到过去。
  await getDb().authSession.update({
    where: { id: row.id },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  });
  await assert.rejects(
    () => authService.authenticate(token),
    (error) => error instanceof AppError && error.code === "AUTH_SESSION_EXPIRED",
  );

  const after = await getDb().authSession.findUniqueOrThrow({ where: { id: row.id } });
  assert.ok(after.revokedAt, "过期的会话必须被服务端吊销（旧令牌按契约失效）");
});

dbTest("rememberMe：30 天档位在 24 小时处仍然有效（两档确实不同）", async () => {
  await resetCustomerPassword();
  const login = await loginAs(CUSTOMER_QQ, PASSWORD, true);
  const token = String(dataOf(login.json).token);
  const row = await sessionRowFor(token);
  assert.equal(row.rememberMe, true);

  // 把到期时刻压到「刚过 24 小时」：普通档位此时早已失效，保持登录档位必须仍然有效。
  await getDb().authSession.update({
    where: { id: row.id },
    data: { expiresAt: new Date(Date.now() + DAY_MS) },
  });
  const principal = await authService.authenticate(token);
  assert.equal(principal.userId, CUSTOMER_ID, "30 天会话在 24 小时之后仍应可用");

  // 同一个账号的 24 小时档位会话走到同一时刻则必须失效。
  const shortLogin = await loginAs(CUSTOMER_QQ, PASSWORD);
  const shortRow = await sessionRowFor(String(dataOf(shortLogin.json).token));
  await getDb().authSession.update({
    where: { id: shortRow.id },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  });
  await assert.rejects(
    () => authService.authenticate(String(dataOf(shortLogin.json).token)),
    (error) => error instanceof AppError && error.code === "AUTH_SESSION_EXPIRED",
  );
});

dbTest("改密轮换保留选择：保持登录账号改密后仍是 30 天", async () => {
  await resetCustomerPassword();
  const login = await loginAs(CUSTOMER_QQ, PASSWORD, true);
  const token = String(dataOf(login.json).token);

  const changed = await nativeCall(nativeChangePassword, NATIVE_CHANGE_URL, {
    headers: bearer(token),
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, newPasswordConfirmation: NEW_PASSWORD },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  const newToken = String(dataOf(changed.json).token);

  const row = await sessionRowFor(newToken);
  assert.equal(row.rememberMe, true, "改密轮换不得丢掉保持登录选择");
  const actual = row.expiresAt.getTime() - row.createdAt.getTime();
  assert.ok(
    Math.abs(actual - SESSION_LIFETIME_KEEP_MS) < 2_000,
    `期望约 ${SESSION_LIFETIME_KEEP_MS}ms（30 天），实际 ${actual}ms`,
  );
});

dbTest("改密轮换保留选择：普通账号改密后仍是 24 小时，不会被偷偷升成 30 天", async () => {
  await resetCustomerPassword();
  const login = await loginAs(CUSTOMER_QQ, PASSWORD);
  const token = String(dataOf(login.json).token);
  const before = await sessionRowFor(token);
  assert.equal(before.rememberMe, false);

  // 请求体**不带** rememberMe：必须沿用当前会话的档位。
  const changed = await nativeCall(nativeChangePassword, NATIVE_CHANGE_URL, {
    headers: bearer(token),
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, newPasswordConfirmation: NEW_PASSWORD },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  const newToken = String(dataOf(changed.json).token);

  const row = await sessionRowFor(newToken);
  assert.equal(row.rememberMe, false, "缺省时不得升档");
  const actual = row.expiresAt.getTime() - row.createdAt.getTime();
  assert.ok(
    Math.abs(actual - SESSION_LIFETIME_SHORT_MS) < 2_000,
    `期望约 ${SESSION_LIFETIME_SHORT_MS}ms（24 小时），实际 ${actual}ms`,
  );
});

dbTest("改密轮换可显式改档：请求体 rememberMe 生效", async () => {
  await resetCustomerPassword();
  const login = await loginAs(CUSTOMER_QQ, PASSWORD);
  const token = String(dataOf(login.json).token);
  assert.equal((await sessionRowFor(token)).rememberMe, false);

  const changed = await nativeCall(nativeChangePassword, NATIVE_CHANGE_URL, {
    headers: bearer(token),
    body: {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      newPasswordConfirmation: NEW_PASSWORD,
      rememberMe: true,
    },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  const row = await sessionRowFor(String(dataOf(changed.json).token));
  assert.equal(row.rememberMe, true, "显式勾选保持登录必须生效");
});

// ---------------------------------------------------------------------------
// 5. 存量会话兼容：remember_me 为 NULL → 原 30 天行为，不失效
// ---------------------------------------------------------------------------

dbTest("存量会话（remember_me 为 NULL）回退到 30 天，不因迁移失效", async () => {
  const db = getDb();
  const now = new Date();
  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  // 直接造一条 PR #65 之前形态的会话：rememberMe 为 NULL，expiresAt 按旧规则 = now + 30 天。
  await db.authSession.create({
    data: {
      id: randomUUID(),
      userId: CUSTOMER_ID,
      tokenDigest: digestSessionToken(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_KEEP_MS),
      rememberMe: null,
    },
  });

  const principal = await authService.authenticate(token);
  assert.equal(principal.userId, CUSTOMER_ID, "存量会话必须仍然可用");

  // 压到「刚过 24 小时」：若把 NULL 当普通档位，这条会话此刻已经失效。
  await db.authSession.update({
    where: { tokenDigest: digestSessionToken(token) },
    data: { expiresAt: new Date(Date.now() + DAY_MS) },
  });
  const stillValid = await authService.authenticate(token);
  assert.equal(stillValid.userId, CUSTOMER_ID, "存量会话在 24 小时之后仍须可用（回退 30 天）");

  // 续期沿用 30 天：把 expiresAt 压到续期窗口内，验证续期后的偏移量。
  await db.authSession.update({
    where: { tokenDigest: digestSessionToken(token) },
    data: { expiresAt: new Date(Date.now() + 60_000) },
  });
  const renewed = await authService.authenticate(token);
  const renewedRow = await sessionRowFor(token);
  const actual = renewedRow.expiresAt.getTime() - Date.now();
  assert.ok(
    Math.abs(actual - SESSION_LIFETIME_KEEP_MS) < 5_000,
    `续期期望约 30 天，实际 ${actual}ms`,
  );
  assert.equal(renewed.sessionId, renewedRow.id);
});

// ---------------------------------------------------------------------------
// 6. Web 通道回归：Cookie 改密行为不变
// ---------------------------------------------------------------------------

dbTest("Web 改密回归：同源下发 Cookie、轮换令牌、响应体不含令牌", async () => {
  await resetCustomerPassword();
  const login = await callRoute(webLogin, "http://localhost/api/v1/auth/login", {
    method: "POST",
    body: { qq: CUSTOMER_QQ, password: PASSWORD },
  });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE_NAME}=`));
  const webToken = cookie.slice(SESSION_COOKIE_NAME.length + 1);

  const changed = await callRoute(webChangePassword, "http://localhost/api/v1/auth/password/change", {
    method: "POST",
    headers: { cookie },
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, newPasswordConfirmation: NEW_PASSWORD },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  const data = dataOf(changed.json);
  assert.equal("token" in data, false, "Web 通道不得把令牌放进响应体");
  assert.equal(data.changed, true);
  assert.equal(data.mustChangePassword, false);
  assert.match(changed.headers.get("set-cookie") ?? "", new RegExp(`${SESSION_COOKIE_NAME}=`));

  // 新 Cookie 可用、旧 Cookie 失效。
  const newCookie = (changed.headers.get("set-cookie") ?? "").split(";")[0];
  const session = await callRoute(nativeSession, "http://localhost/api/v1/auth/native/session", {
    headers: { ...NATIVE, authorization: `Bearer ${newCookie.slice(SESSION_COOKIE_NAME.length + 1)}` },
  });
  assert.equal(session.status, 200);

  await assert.rejects(
    () => authService.authenticate(webToken),
    (error) => error instanceof AppError && error.code === "AUTH_SESSION_INVALID",
  );
});

dbTest("Web 改密：非同源请求被拒（Cookie 通道的 CSRF 防线不回退）", async () => {
  await resetCustomerPassword();
  const login = await callRoute(webLogin, "http://localhost/api/v1/auth/login", {
    method: "POST",
    body: { qq: CUSTOMER_QQ, password: PASSWORD },
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

  const forged = await nativeCall(webChangePassword, "http://localhost/api/v1/auth/password/change", {
    headers: { cookie, origin: "https://evil.example" },
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, newPasswordConfirmation: NEW_PASSWORD },
  });
  assert.equal(forged.status, 403);
  assert.equal(errorCodeOf(forged.json), "FORBIDDEN");
});
