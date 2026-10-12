import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { AppError } from "../../src/lib/api/errors";
import { assertNativeClient, readPresentedToken } from "../../src/lib/auth/request";
import { sessionHomeForRoles } from "../../src/lib/auth/session-home";
import { parseCustomerRegistrationInput } from "../../src/features/auth/registration-service";

/* 角色 → 入口映射：工作人员 (MEMBER) 与超级管理员 (ADMIN) 进工作人员入口；
   其余普通账号是客户。客户端身份由服务端返回，这里只验证纯映射。 */
test("角色映射：无角色账号是客户入口", () => {
  assert.equal(sessionHomeForRoles([]), "CUSTOMER");
});

test("角色映射：MEMBER 是工作人员入口", () => {
  assert.equal(sessionHomeForRoles(["MEMBER"]), "STAFF");
});

test("角色映射：ADMIN 也进工作人员入口，但映射本身不代表管理权限", () => {
  assert.equal(sessionHomeForRoles(["ADMIN"]), "STAFF");
  assert.equal(sessionHomeForRoles(["MEMBER", "ADMIN"]), "STAFF");
});

test("原生通道：携带 x-client-type=native 通过", () => {
  const request = new Request("http://localhost/api/v1/auth/native/session", {
    headers: { "x-client-type": "native" },
  });
  assert.doesNotThrow(() => assertNativeClient(request));
});

test("原生通道：大小写与空白不敏感", () => {
  const request = new Request("http://localhost/api/v1/auth/native/session", {
    headers: { "x-client-type": " Native " },
  });
  assert.doesNotThrow(() => assertNativeClient(request));
});

test("原生通道：缺失或错误的客户端标识被拒绝", () => {
  for (const headers of [{}, { "x-client-type": "web" }, { origin: "http://localhost" }]) {
    const request = new Request("http://localhost/api/v1/auth/native/session", { headers });
    assert.throws(
      () => assertNativeClient(request),
      (error: unknown) => error instanceof AppError && error.code === "FORBIDDEN",
    );
  }
});

test("令牌读取：Cookie 优先，其次 Bearer", () => {
  const both = new Request("http://localhost/api/v1/me", {
    headers: {
      cookie: "pc_hospital_session=cookie-token",
      authorization: "Bearer bearer-token",
    },
  });
  assert.deepEqual(readPresentedToken(both), { token: "cookie-token", source: "cookie" });

  const bearerOnly = new Request("http://localhost/api/v1/me", {
    headers: { authorization: "Bearer bearer-token" },
  });
  assert.deepEqual(readPresentedToken(bearerOnly), { token: "bearer-token", source: "bearer" });
});

test("令牌读取：无任何凭证与空 Bearer 都视为未登录", () => {
  const none = new Request("http://localhost/api/v1/me");
  assert.equal(readPresentedToken(none), null);

  const empty = new Request("http://localhost/api/v1/me", {
    headers: { authorization: "Bearer " },
  });
  assert.equal(readPresentedToken(empty), null);
});

test("令牌读取：非 Bearer 方案不生效", () => {
  const basic = new Request("http://localhost/api/v1/me", {
    headers: { authorization: "Basic dXNlcjpwYXNz" },
  });
  assert.equal(readPresentedToken(basic), null);
});

// ---------------------------------------------------------------------------
// Issue #60：客户自主注册入参解析（只认 QQ / 密码 / 确认密码）
// ---------------------------------------------------------------------------

test("客户注册入参：规范化 QQ，丢弃客户端塞进来的角色与权限字段", () => {
  const parsed = parseCustomerRegistrationInput({
    qq: " 920 000 001 ",
    password: "customer-123",
    passwordConfirmation: "customer-123",
    roles: ["ADMIN", "MEMBER"],
    permissions: ["member:manage"],
    home: "STAFF",
    memberProfileId: "forged-profile",
  });
  assert.deepEqual(parsed, {
    qq: "920000001",
    password: "customer-123",
    passwordConfirmation: "customer-123",
  });
  assert.equal("roles" in parsed, false);
  assert.equal("permissions" in parsed, false);
});

test("客户注册入参：两次密码不一致返回 PASSWORD_CONFIRMATION_MISMATCH", () => {
  assert.throws(
    () =>
      parseCustomerRegistrationInput({
        qq: "920000001",
        password: "customer-123",
        passwordConfirmation: "customer-124",
      }),
    (error) => error instanceof AppError && error.code === "PASSWORD_CONFIRMATION_MISMATCH",
  );
});

test("客户注册入参：密码长度不合规返回 VALIDATION_FAILED", () => {
  assert.throws(
    () =>
      parseCustomerRegistrationInput({
        qq: "920000001",
        password: "12345",
        passwordConfirmation: "12345",
      }),
    (error) => error instanceof AppError && error.code === "VALIDATION_FAILED",
  );
});

test("客户注册入参：QQ 格式非法返回带字段提示的 VALIDATION_FAILED", () => {
  assert.throws(
    () =>
      parseCustomerRegistrationInput({
        qq: "not-a-qq",
        password: "customer-123",
        passwordConfirmation: "customer-123",
      }),
    (error) =>
      error instanceof AppError &&
      error.code === "VALIDATION_FAILED" &&
      Boolean(error.fieldErrors?.qq),
  );
});

// ---------------------------------------------------------------------------
// PR #65 审查 P1 / P2：注册链路的两处安全与原子性回归
//
// 这两条是**源码守卫**：P1 的口令校验和 P2 的同事务发会话都在 `redeem` / `registerCustomer`
// 的事务主体里，行为回归由 `tests/integration/auth-registration.test.ts` 的真实测试库覆盖；
// 这里守住的是「那条校验确实在重放分支里、且用的是 verifyPassword」这类结构性事实，
// 避免以后有人重构时把它挪出分支或换成「两次密码一致性」。
// ---------------------------------------------------------------------------

const readSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), "src", relativePath), "utf8");

/** 取 `redeemWithin` 里「幂等重放分支」这一段（从 `if (replay)` 到正式兑换逻辑之前）。 */
function replayBranchOf(source: string): string {
  const start = source.indexOf("if (replay) {");
  assert.ok(start >= 0, "找不到 redeem 的重放分支");
  const tail = source.slice(start);
  const end = tail.indexOf("await tx.$queryRaw`SELECT id FROM invite_codes");
  assert.ok(end > 0, "找不到重放分支的结束位置");
  return tail.slice(0, end);
}

test("P1：邀请码重放分支校验本次请求的密码，失败按认证失败处理", () => {
  const replay = replayBranchOf(readSource(join("features", "invitations", "invite-code-service.ts")));

  assert.match(replay, /verifyPassword\(input\.password, passwordHash\)/);
  assert.match(replay, /AUTH_INVALID_CREDENTIALS/);
  // 只比 code / qq / phone 的重放分支是这次的漏洞本身：三项之外必须有口令校验。
  assert.ok(
    replay.indexOf("verifyPassword") < replay.indexOf("return {"),
    "口令校验必须发生在返回重放结果之前",
  );
});

test("P1：口令比对读的是账号当前凭证，不是请求体自带的确认密码", () => {
  const replay = replayBranchOf(readSource(join("features", "invitations", "invite-code-service.ts")));

  // 读的是 `password_credentials.passwordHash`（账号当前凭证）。
  assert.match(replay, /passwordCredential/);
  assert.match(replay, /passwordHash/);
  assert.doesNotMatch(
    replay,
    /input\.passwordConfirmation/,
    "重放分支不得用「两次密码一致性」替代口令校验",
  );
});

test("P2：注册与会话创建在同一个事务边界内（不再事务外补发会话）", () => {
  const registration = readSource(join("features", "auth", "registration-service.ts"));
  const registerCustomer = registration.slice(
    registration.indexOf("async registerCustomer("),
    registration.indexOf("export const registrationService"),
  );

  assert.match(
    registerCustomer,
    /return inSerializableTransaction\(async \(tx\) => \{[\s\S]*createCustomerAccount\(tx[\s\S]*openSessionWith\(tx/,
    "客户注册必须在同一个串行化事务里建账号并发会话",
  );
  assert.doesNotMatch(
    registerCustomer,
    /issueSessionForRegisteredAccount/,
    "不得再从事务外补发会话（那正是「注册失败但账号已存在」的成因）",
  );

  const invite = readSource(join("features", "invitations", "invite-code-service.ts"));
  assert.match(
    invite,
    /this\.redeemWithin\(tx, input, context, normalized\)\);[\s\S]*?authService\.openSessionWith\(/,
    "邀请码注册的发会话必须与账号创建共用同一个事务客户端",
  );
});

test("P2：AuthService 提供事务内发会话能力，登录路径保持自建事务", () => {
  const source = readSource(join("features", "auth", "auth-service.ts"));
  assert.match(source, /async openSessionWith\(/);
  assert.match(source, /readPrincipal\(userId, tx\)/, "事务内读身份必须走同一个 tx");
  // `login()` 逐字未改：仍然走自己的 `openSession`（自建串行化事务），不依赖调用方传入 tx。
  const login = source.slice(source.indexOf("async login("), source.indexOf("async openSessionWith("));
  assert.match(login, /return this\.openSession\(/);
  assert.doesNotMatch(login, /openSessionWith/, "登录路径不得改成事务内发会话");
});
