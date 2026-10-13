import { AppError } from "@/lib/api/errors";
import { clientIp } from "@/lib/api/client-ip";
import { getServerEnv } from "@/lib/env";
import { authService } from "@/features/auth/auth-service";
import type { AuthorizedActor, PublicRequestContext, SessionPrincipal } from "@/types/contracts";

export const SESSION_COOKIE_NAME = "pc_hospital_session";
export const NATIVE_CLIENT_HEADER = "x-client-type";
export const NATIVE_CLIENT_VALUE = "native";

export type SessionTokenSource = "cookie" | "bearer";

/** 公开写接口实际走通的通道：Web（同源 Origin）或原生（显式客户端标识）。 */
export type PublicChannel = "web" | "native";

export function requestContext(request: Request, requestId: string): PublicRequestContext {
  return {
    requestId,
    ipAddress: clientIp(request),
    userAgent: request.headers.get("user-agent") ?? undefined,
  };
}

export function readSessionToken(request: Request): string {
  const cookie = request.headers.get("cookie") ?? "";
  return (
    cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`))
      ?.slice(SESSION_COOKIE_NAME.length + 1) ?? ""
  );
}

/**
 * 读取请求实际呈现的会话令牌：Cookie 优先（Web 行为逐字保持不变），
 * 其次 `Authorization: Bearer`（原生客户端通道，见 `/api/v1/auth/native/*`）。
 *
 * 接受 Bearer 不放宽 Cookie 场景的 CSRF 防线：浏览器不会自动携带 `Authorization`，
 * 跨站设置该头会触发预检而本站不返回 CORS 头；Cookie 写接口仍逐一执行 `assertSameOrigin()`。
 */
export function readPresentedToken(
  request: Request,
): { token: string; source: SessionTokenSource } | null {
  const cookie = readSessionToken(request);
  if (cookie) return { token: cookie, source: "cookie" };
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  if (match) return { token: match[1].trim(), source: "bearer" };
  return null;
}

/**
 * 原生客户端通道标识（`/api/v1/auth/native/*` 的准入门槛）。
 *
 * 原生通道不使用 Cookie 凭证：登录把令牌放在响应体，后续请求用 `Authorization: Bearer`
 * 携带，因此**不需要** `assertSameOrigin()` —— 那条防线防的是浏览器自动携带 Cookie 的
 * CSRF，这里没有可被自动携带的凭证。取而代之要求显式自定义头：HTML 表单无法设置它，
 * 跨站 fetch 设置它会触发预检而本站不返回 CORS 头，浏览器内无法伪造成原生请求。
 * 这不是让原生客户端伪造 Origin 绕过 Web 防线：两条通道各自独立校验。
 */
export function assertNativeClient(request: Request): void {
  if (request.headers.get(NATIVE_CLIENT_HEADER)?.trim().toLowerCase() !== NATIVE_CLIENT_VALUE)
    throw new AppError("FORBIDDEN", "请求来源无效");
}

/**
 * 写接口的来源防线按**令牌实际来源**分流（Issue #38 起供备案写路由复用）：
 * - Cookie（Web 浏览器）：`assertSameOrigin()` —— 浏览器会自动携带 Cookie，必须确认来源白名单；
 * - Bearer（鸿蒙 App）：要求显式 `x-client-type: native`，浏览器无法伪造该自定义头，
 *   且原生请求本就不带 Origin，硬套同源校验会把合法请求全部 403。
 *
 * Cookie 优先：两凭证同时存在时按 Cookie 处理，带 native 头也不能跳过同源检查。
 */
export function assertWriteAccess(request: Request): void {
  const presented = readPresentedToken(request);
  if (presented?.source === "cookie") {
    assertSameOrigin(request);
  } else {
    // Bearer 或无凭证（之后会 401）：要求显式原生头，杜绝浏览器伪造成原生通道。
    assertNativeClient(request);
  }
}

/**
 * **公开写接口**（注册这类还没有令牌的入口）的来源分流，返回请求实际走通的通道。
 *
 * 与 `assertWriteAccess` 的分工：那个按「令牌实际来源」分流，只适用于已登录请求；
 * 注册时没有令牌可依据，于是按请求真正携带的来源信息分流，两条分支各自独立校验：
 * - 带 `Origin`：一律按 Web 严格校验 `APP_BASE_URL` 白名单 —— 原生客户端伪造 `Origin`
 *   只会撞上这条更严的规则，绕不过去；
 * - 不带 `Origin`：按原生校验显式 `X-Client-Type: native`。浏览器设置该自定义头会触发
 *   预检、而本站不返回 CORS 头，无法伪装成原生请求。
 *
 * 客户端标识只用来**选择校验方式**，不是身份凭证：注册产生的身份与角色一律由服务端决定，
 * 请求体里的 `roles` / `permissions` 等字段不参与任何判断（见 `RegistrationService`）。
 */
export function assertPublicWriteAccess(request: Request): PublicChannel {
  // 用 `has` 而不是真值判断：`Origin: `（空值）同样属于「Web 请求带了 Origin」，
  // 交给 `assertSameOrigin` 明确拒绝，而不是滑进原生分支。
  if (request.headers.has("origin")) {
    assertSameOrigin(request);
    return "web";
  }
  assertNativeClient(request);
  return "native";
}

export async function authenticateRequest(
  request: Request,
  requestId: string,
  allowForcedPasswordChange = false,
): Promise<{
  principal: SessionPrincipal & { sessionId: string; expiresAt: string };
  actor: AuthorizedActor;
  token: string;
  tokenSource: SessionTokenSource;
}> {
  const context = requestContext(request, requestId);
  const presented = readPresentedToken(request);
  if (!presented) throw new AppError("UNAUTHENTICATED", "请先登录");
  const { token, source: tokenSource } = presented;
  const principal = await authService.authenticate(token);
  if (principal.mustChangePassword && !allowForcedPasswordChange)
    throw new AppError("PASSWORD_CHANGE_REQUIRED", "请先修改初始密码");
  return {
    principal,
    token,
    tokenSource,
    actor: {
      ...context,
      actorType: "USER",
      userId: principal.userId,
      userStatus: "ACTIVE",
      permissions: principal.permissions,
      mustChangePassword: principal.mustChangePassword,
    },
  };
}

/** 允许的请求来源：APP_BASE_URL（生产是站点正式域名）及其 www 变体。 */
function allowedOrigins(): Set<string> {
  let base: URL;
  try {
    base = new URL(getServerEnv().APP_BASE_URL);
  } catch {
    throw new AppError("INTERNAL_ERROR", "APP_BASE_URL 配置无效", { status: 500 });
  }
  const host = base.hostname.toLowerCase();
  const alternate = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  const port = base.port ? `:${base.port}` : "";
  return new Set([`${base.protocol}//${host}${port}`, `${base.protocol}//${alternate}${port}`]);
}

/**
 * 写接口的 CSRF 防线：Origin 必须落在允许来源白名单内。
 *
 * 不要拿 Origin 去比请求自身的 Host / X-Forwarded-Host —— 那两个值由请求方控制，
 * 伪造 `Host: evil.com` + `Origin: https://evil.com` 就能通过（2026-09 安全审计 F4 实测），
 * DNS rebinding 下可直接打穿全部写接口。
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new AppError("FORBIDDEN", "请求来源无效");
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new AppError("FORBIDDEN", "请求来源无效");
  }
  const candidate = `${parsed.protocol}//${parsed.hostname.toLowerCase()}${
    parsed.port ? `:${parsed.port}` : ""
  }`;
  if (!allowedOrigins().has(candidate)) throw new AppError("FORBIDDEN", "请求来源无效");
}

export function sessionCookie(token: string, expiresAt: string) {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: new Date(expiresAt),
  };
}
