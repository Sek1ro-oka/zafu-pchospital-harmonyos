import { authService } from "@/features/auth/auth-service";
import { nativeSessionPayload } from "@/features/auth/native-auth-http";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertNativeClient, requestContext } from "@/lib/auth/request";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * 原生客户端登录：令牌经响应体返回，由客户端用 `Authorization: Bearer` 携带，
 * 不写 Cookie；身份与角色一律取自服务端，请求体里的角色字段会被忽略。
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertNativeClient(request);
    const body = (await request.json()) as Record<string, unknown>;
    const result = await authService.login(
      {
        qq: String(body.qq ?? ""),
        password: String(body.password ?? ""),
        rememberMe: body.rememberMe === true,
      },
      requestContext(request, requestId),
    );
    return apiSuccess(
      { ...nativeSessionPayload(result), token: result.token, expiresAt: result.expiresAt },
      requestId,
      { headers: PRIVATE },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
