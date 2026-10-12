import { nativeSessionPayload } from "@/features/auth/native-auth-http";
import { apiSuccess } from "@/lib/api/response";
import { assertPublicWriteAccess, sessionCookie, type PublicChannel } from "@/lib/auth/request";
import type { AuthSessionResult } from "@/types/contracts";

/**
 * 公开注册路由的公共 HTTP 片段（Web + 原生两个入口共用）。
 *
 * 通道判定见 `assertPublicWriteAccess`：带 `Origin` 走 Web 白名单，否则要求
 * `X-Client-Type: native`。身份、角色、入口全部来自服务端，客户端字段不参与。
 */
export type RegistrationChannel = PublicChannel;

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

export function registrationChannel(request: Request): RegistrationChannel {
  return assertPublicWriteAccess(request);
}

/**
 * 注册成功的响应（201）：两种通道返回同一份身份信息，只有**凭证承载方式**不同 ——
 * Web 下发 HttpOnly Cookie（响应体不含令牌），原生把令牌放进响应体（不下发 Cookie）。
 * 载荷字段与对应通道的登录接口一致（Web 对齐 `/auth/login`，原生对齐 `/auth/native/login`）。
 */
export function registrationSuccess(
  session: AuthSessionResult,
  channel: RegistrationChannel,
  requestId: string,
) {
  if (channel === "native") {
    return apiSuccess(
      { ...nativeSessionPayload(session), token: session.token, expiresAt: session.expiresAt },
      requestId,
      { status: 201, headers: PRIVATE },
    );
  }
  const response = apiSuccess(
    {
      userId: session.userId,
      displayName: session.displayName,
      roles: session.roles,
      permissions: session.permissions,
      mustChangePassword: session.mustChangePassword,
      expiresAt: session.expiresAt,
    },
    requestId,
    { status: 201, headers: PRIVATE },
  );
  response.cookies.set(sessionCookie(session.token, session.expiresAt));
  return response;
}
