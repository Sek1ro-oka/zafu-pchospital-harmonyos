import assert from "node:assert/strict";
import test from "node:test";

import { clientIp } from "../../src/lib/api/client-ip";
import { AppError } from "../../src/lib/api/errors";
import {
  assertPublicWriteAccess,
  assertSameOrigin,
  assertWriteAccess,
} from "../../src/lib/auth/request";
import { resetServerEnvForTests } from "../../src/lib/env";

const REQUIRED_ENV = {
  AUTH_SECRET: "unit-test-auth-secret-at-least-32-bytes",
  DATABASE_URL: "mysql://unused",
  INVITE_CODE_PEPPER: "unit-test-invite-pepper-at-least-32-bytes",
  PII_AUDIT_PEPPER: "unit-test-audit-pepper-at-least-32-bytes",
};

function withEnv(values: Record<string, string>, run: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries({ ...REQUIRED_ENV, ...values })) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  resetServerEnvForTests();
  try {
    run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    resetServerEnvForTests();
  }
}

function request(headers: Record<string, string>): Request {
  return new Request("https://pczafu.cn/api/v1/auth/login", { method: "POST", headers });
}

test("客户端 IP 只信反代覆写的 X-Real-IP", () => {
  assert.equal(
    clientIp(
      request({
        "x-real-ip": "203.0.113.7",
        "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.7",
      }),
    ),
    "203.0.113.7",
  );
});

test("客户端 IP 不会被 X-Forwarded-For 首段伪造值顶掉", () => {
  // 旧实现取 split(",")[0]，伪造首段即可换个"新 IP"绕过登录节流（审计 F1）
  const spoofed = request({ "x-forwarded-for": "198.51.100.99, 203.0.113.7" });
  assert.equal(clientIp(spoofed), "203.0.113.7");
});

test("没有反代时（本地开发）退回最靠近服务端的一跳，缺失则 unknown", () => {
  assert.equal(clientIp(request({ "x-forwarded-for": "127.0.0.1" })), "127.0.0.1");
  assert.equal(clientIp(request({})), "unknown");
});

test("同源校验只认 APP_BASE_URL 白名单，包含 www 变体", () => {
  withEnv({ APP_BASE_URL: "https://pczafu.cn" }, () => {
    assert.doesNotThrow(() => assertSameOrigin(request({ origin: "https://pczafu.cn" })));
    assert.doesNotThrow(() => assertSameOrigin(request({ origin: "https://www.pczafu.cn" })));
    assert.doesNotThrow(() => assertSameOrigin(request({ origin: "https://PCZAFU.CN" })));
  });
});

test("同源校验拒绝来自非白名单来源的请求", () => {
  withEnv({ APP_BASE_URL: "https://pczafu.cn" }, () => {
    for (const origin of [
      "https://evil.com",
      "http://pczafu.cn", // 协议不同
      "https://pczafu.cn.evil.com",
      "https://evil.com#https://pczafu.cn",
      "not-a-url",
    ]) {
      assert.throws(
        () => assertSameOrigin(request({ origin })),
        (error) => error instanceof AppError && error.code === "FORBIDDEN",
        `应拒绝来源 ${origin}`,
      );
    }
  });
});

test("同源校验不再把请求自带的 Host 当基准", () => {
  withEnv({ APP_BASE_URL: "https://pczafu.cn" }, () => {
    // 审计 F4：伪造 Host 与 Origin 一致时旧实现会放行，DNS rebinding 下可打穿写接口
    assert.throws(
      () => assertSameOrigin(request({ origin: "https://evil.com", host: "evil.com" })),
      (error) => error instanceof AppError && error.code === "FORBIDDEN",
    );
    assert.throws(
      () =>
        assertSameOrigin(request({ origin: "https://evil.com", "x-forwarded-host": "evil.com" })),
      (error) => error instanceof AppError && error.code === "FORBIDDEN",
    );
  });
});

test("缺少 Origin 的写请求一律拒绝", () => {
  withEnv({ APP_BASE_URL: "https://pczafu.cn" }, () => {
    assert.throws(
      () => assertSameOrigin(request({})),
      (error) => error instanceof AppError && error.code === "FORBIDDEN",
    );
  });
});

test("APP_BASE_URL 非法时显式报配置错误，而不是静默放行", () => {
  withEnv({ APP_BASE_URL: "pczafu.cn" }, () => {
    assert.throws(
      () => assertSameOrigin(request({ origin: "https://pczafu.cn" })),
      (error) => error instanceof AppError && error.code === "INTERNAL_ERROR",
    );
  });
});

// ---------------------------------------------------------------------------
// Issue #38：写接口按令牌来源分流（assertWriteAccess）
// ---------------------------------------------------------------------------

test("Bearer + 原生头：无 Origin 的原生写请求放行（App 真实路径）", () => {
  withEnv({ APP_BASE_URL: "https://pczafu.cn" }, () => {
    assert.doesNotThrow(() =>
      assertWriteAccess(request({ authorization: "Bearer token-1", "x-client-type": "native" })),
    );
  });
});

test("Bearer 缺原生头：浏览器伪装的写请求被拒", () => {
  withEnv({ APP_BASE_URL: "https://pczafu.cn" }, () => {
    assert.throws(
      () => assertWriteAccess(request({ authorization: "Bearer token-1" })),
      (error) => error instanceof AppError && error.code === "FORBIDDEN",
    );
  });
});

test("Cookie 优先：同时带 Bearer 与原生头也不能跳过同源检查", () => {
  withEnv({ APP_BASE_URL: "https://pczafu.cn" }, () => {
    const cookieAndNative = request({
      cookie: "pc_hospital_session=cookie-token",
      authorization: "Bearer bearer-token",
      "x-client-type": "native",
    });
    // 令牌来源是 Cookie → 走 assertSameOrigin，缺 Origin 必拒。
    assert.throws(
      () => assertWriteAccess(cookieAndNative),
      (error) => error instanceof AppError && error.code === "FORBIDDEN",
    );
    assert.throws(
      () => assertWriteAccess(request({ cookie: "pc_hospital_session=cookie-token" })),
      (error) => error instanceof AppError && error.code === "FORBIDDEN",
    );
  });
});

test("Cookie 请求带合法同源 Origin 照常放行（Web 行为不变）", () => {
  withEnv({ APP_BASE_URL: "https://pczafu.cn" }, () => {
    assert.doesNotThrow(() =>
      assertWriteAccess(
        request({ cookie: "pc_hospital_session=cookie-token", origin: "https://pczafu.cn" }),
      ),
    );
  });
});

test("无凭证写请求：先按原生通道拒绝，不泄露后续鉴权逻辑", () => {
  withEnv({ APP_BASE_URL: "https://pczafu.cn" }, () => {
    assert.throws(
      () => assertWriteAccess(request({})),
      (error) => error instanceof AppError && error.code === "FORBIDDEN",
    );
  });
});

// ---------------------------------------------------------------------------
// Issue #60：公开写接口（注册，无令牌）按实际携带的来源分流
// ---------------------------------------------------------------------------

test("公开写通道：带合法 Origin 判为 Web，带原生头判为原生", () => {
  withEnv({ APP_BASE_URL: "https://pczafu.cn" }, () => {
    assert.equal(assertPublicWriteAccess(request({ origin: "https://pczafu.cn" })), "web");
    assert.equal(assertPublicWriteAccess(request({ "x-client-type": "native" })), "native");
  });
});

test("公开写通道：既没有 Origin 也没有客户端标识的请求被拒", () => {
  withEnv({ APP_BASE_URL: "https://pczafu.cn" }, () => {
    assert.throws(
      () => assertPublicWriteAccess(request({})),
      (error) => error instanceof AppError && error.code === "FORBIDDEN",
    );
    assert.throws(
      () => assertPublicWriteAccess(request({ "x-client-type": "web" })),
      (error) => error instanceof AppError && error.code === "FORBIDDEN",
    );
  });
});

test("公开写通道：原生头不能顶替 Origin 白名单（伪造 Origin 仍被拒）", () => {
  withEnv({ APP_BASE_URL: "https://pczafu.cn" }, () => {
    for (const origin of ["https://evil.com", "http://pczafu.cn", ""]) {
      assert.throws(
        () => assertPublicWriteAccess(request({ origin, "x-client-type": "native" })),
        (error) => error instanceof AppError && error.code === "FORBIDDEN",
        `Origin=${JSON.stringify(origin)} 不应因为带原生头而放行`,
      );
    }
  });
});
