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
    rememberMe: undefined,
  });
  assert.equal("roles" in parsed, false);
  assert.equal("permissions" in parsed, false);
});

test("客户注册入参：rememberMe 只认布尔值，字符串与数字按缺省处理", () => {
  // `"true"` / 1 这类非布尔值一律不猜：宁可落到普通档位（24 小时），
  // 也不能因为客户端多传了一个字符串就把会话升成 30 天。
  for (const value of ["true", 1, {}, null]) {
    assert.equal(
      parseCustomerRegistrationInput({
        qq: "920000001",
        password: "customer-123",
        passwordConfirmation: "customer-123",
        rememberMe: value,
      }).rememberMe,
      undefined,
      `rememberMe=${JSON.stringify(value)} 应按缺省处理`,
    );
  }
  assert.equal(
    parseCustomerRegistrationInput({
      qq: "920000001",
      password: "customer-123",
      passwordConfirmation: "customer-123",
      rememberMe: true,
    }).rememberMe,
    true,
  );
  assert.equal(
    parseCustomerRegistrationInput({
      qq: "920000001",
      password: "customer-123",
      passwordConfirmation: "customer-123",
      rememberMe: false,
    }).rememberMe,
    false,
  );
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

// ---------------------------------------------------------------------------
// Issue #60 第二批：rememberMe 会话档位（普通 24 小时 / 保持登录 30 天）
//
// 档位判定集中在 `session-lifetime.ts`，这里锁住三件事：
//   1) 两个档位的毫秒数真实不同（不是同一个常量换个名字）；
//   2) NULL（存量会话）回退到 30 天，否则一次迁移会把存量用户集体登出；
//   3) `authenticate` 续期与改密轮换**都**按会话自己的档位算，不会静默升降级。
// ---------------------------------------------------------------------------

import {
  SESSION_LIFETIME_KEEP_MS,
  SESSION_LIFETIME_SHORT_MS,
  legacySessionLifetime,
  sessionLifetimeFor,
} from "../../src/features/auth/session-lifetime";

test("rememberMe：普通 24 小时、保持登录 30 天，且两个档位确实不同", () => {
  assert.equal(SESSION_LIFETIME_SHORT_MS, 24 * 60 * 60 * 1000);
  assert.equal(SESSION_LIFETIME_KEEP_MS, 30 * 24 * 60 * 60 * 1000);
  assert.notEqual(SESSION_LIFETIME_SHORT_MS, SESSION_LIFETIME_KEEP_MS);

  assert.equal(sessionLifetimeFor(false), SESSION_LIFETIME_SHORT_MS);
  assert.equal(sessionLifetimeFor(undefined), SESSION_LIFETIME_SHORT_MS, "缺省即普通档位");
  assert.equal(sessionLifetimeFor(true), SESSION_LIFETIME_KEEP_MS);
});

test("rememberMe：存量会话（NULL）回退到原 30 天行为，不因迁移失效", () => {
  // PR #65 之前的会话 `remember_me` 为 NULL，当年一律按 30 天发放。
  // 若按 false 处理，一次迁移就会让所有存量会话变成 24 小时。
  assert.equal(legacySessionLifetime(null), SESSION_LIFETIME_KEEP_MS);
  assert.equal(sessionLifetimeFor(null), SESSION_LIFETIME_SHORT_MS, "新会话的 NULL 不应出现");
  assert.equal(legacySessionLifetime(true), SESSION_LIFETIME_KEEP_MS);
  assert.equal(legacySessionLifetime(false), SESSION_LIFETIME_SHORT_MS);
});

test("rememberMe：续期按会话自己的档位，不把 24 小时账号升成 30 天", () => {
  // 源码守卫：续期路径必须读 `session.rememberMe`，而不是写死一个常量。
  // 写死的后果正是「一次续期就把用户的选择改了」，且没有任何界面提示。
  const source = readSource(join("features", "auth", "auth-service.ts"));
  const authenticate = source.slice(
    source.indexOf("async authenticate("),
    source.indexOf("async logout("),
  );
  assert.match(authenticate, /legacySessionLifetime\(session\.rememberMe\)/);
  assert.doesNotMatch(
    authenticate,
    /SESSION_LIFETIME_MS/,
    "不得再引用已删除的写死 30 天常量",
  );
});

test("rememberMe：改密轮换保留原档位，缺省不升档", () => {
  const source = readSource(join("features", "auth", "auth-service.ts"));
  const changePassword = source.slice(
    source.indexOf("async changePassword("),
    source.indexOf("/**\n   * 读会话身份"),
  );

  // 轮换时长必须经过 `rotationLifetime`：请求体没给 rememberMe 时读当前会话的档位。
  assert.match(changePassword, /rotationLifetime\(input, current\.sessionId\)/);
  // 新会话行必须显式写入 rememberMe（NULL 只属于存量数据）。
  // 按「去掉空白后匹配」：换行等格式化变化不该让这条守卫失效。
  const compact = changePassword.replace(/\s+/g, "");
  assert.match(
    compact,
    /rememberMe:expiresAt\.getTime\(\)-now\.getTime\(\)===SESSION_LIFETIME_KEEP_MS/,
    "轮换出的新会话必须按选定时长显式落库 rememberMe",
  );
  assert.doesNotMatch(changePassword, /SESSION_LIFETIME_MS/);
});

test("rememberMe：登录与注册都只有一处发放会话的入口", () => {
  const source = readSource(join("features", "auth", "auth-service.ts"));
  // 新会话一律经过 `sessionRowData`，而 rememberMe 只在那一个函数里落库：
  // 不存在第二条绕过它、忘记写 rememberMe 的建会话路径。
  assert.equal((source.match(/sessionRowData\(/g) ?? []).length, 3, "定义 + 登录 + 事务内注册");
  assert.match(source, /rememberMe: rememberMe === true/);
  // 注册（邀请码）入口必须把请求体的选择传进来。
  const invite = readSource(join("features", "invitations", "invite-code-service.ts"));
  assert.match(
    invite,
    /authService\.openSessionWith\(\s*tx,\s*registration\.userId,\s*context,\s*"auth\.register\.succeeded",\s*input\.rememberMe,/,
  );
});

test("rememberMe：客户自主注册把请求体的选择一路传到会话行", () => {
  /*
   * 这条守的是**链路完整性**，不是某一行的写法。
   *
   * 客户注册路由自己不解析 rememberMe（整个请求体交给 `parseCustomerRegistrationInput`），
   * 所以它字面上不出现这个字段名 —— 这正是它容易被误判成「漏了」的原因。真正必须成立的
   * 是三段接力：
   *   路由把 body 交给解析器 → 解析器读 body.rememberMe →
   *   registerCustomer 把它传给 openSessionWith → sessionRowData 显式落库。
   * 任何一段断了，「注册时勾了保持登录却拿到 24 小时会话」就会静默发生，
   * 而响应里只看得出 expiresAt，看不出档位标记。
   */
  const route = readSource(
    join("app", "api", "v1", "auth", "register", "customer", "route.ts"),
  );
  assert.match(
    route,
    /registerCustomer\(\s*parseCustomerRegistrationInput\(body\)/,
    "客户注册路由必须把整个请求体交给入参解析器（rememberMe 由它归一化）",
  );

  const registration = readSource(join("features", "auth", "registration-service.ts"));
  const registerCustomer = registration.slice(
    registration.indexOf("async registerCustomer("),
    registration.indexOf("export const registrationService"),
  );
  assert.match(
    registerCustomer,
    /openSessionWith\(tx, created, context, "auth\.register\.succeeded", input\.rememberMe\)/,
    "客户注册必须把请求体的 rememberMe 传给事务内发会话",
  );

  // 解析器必须真的读这个字段，且只认布尔值。
  const parser = registration.slice(
    registration.indexOf("export function parseCustomerRegistrationInput"),
    registration.indexOf("export class RegistrationService"),
  );
  assert.match(parser, /typeof body\.rememberMe === "boolean" \? body\.rememberMe : undefined/);
});

test("rememberMe：四个入口都归一化「只认布尔值」", () => {
  // 登录（Web / 原生）用 `=== true`，注册（客户 / 邀请码）用三目布尔判断：
  // 两者对非布尔值的效果一致（都落到缺省），但写法不同，因此分开断言。
  const webLogin = readSource(join("app", "api", "v1", "auth", "login", "route.ts"));
  const nativeLogin = readSource(
    join("app", "api", "v1", "auth", "native", "login", "route.ts"),
  );
  for (const source of [webLogin, nativeLogin]) {
    assert.match(source, /rememberMe: body\.rememberMe === true/);
  }
  for (const path of [
    join("app", "api", "v1", "auth", "register", "customer", "route.ts"),
    join("app", "api", "v1", "auth", "register", "staff", "route.ts"),
    join("app", "api", "v1", "auth", "native", "password", "change", "route.ts"),
  ]) {
    const source = readSource(path);
    // 路由层要么显式解析（staff / 改密），要么把 body 交给唯一解析器（客户注册）。
    assert.ok(
      /typeof body\.rememberMe === "boolean" \? body\.rememberMe : undefined/.test(source) ||
        /parseCustomerRegistrationInput\(body\)/.test(source),
      `${path} 必须处理 rememberMe`,
    );
  }
});
