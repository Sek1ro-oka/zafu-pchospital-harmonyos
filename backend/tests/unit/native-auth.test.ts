import assert from "node:assert/strict";
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
