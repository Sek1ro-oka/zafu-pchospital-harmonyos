import { authService } from "@/features/auth/auth-service";
import { AppError } from "@/lib/api/errors";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertNativeClient, readPresentedToken, requestContext } from "@/lib/auth/request";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * 原生客户端退出：吊销请求所携带的令牌（`Authorization: Bearer`）。
 * 令牌已失效时同样返回成功（幂等），客户端只管清掉本地会话即可。
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertNativeClient(request);
    const presented = readPresentedToken(request);
    if (!presented) throw new AppError("UNAUTHENTICATED", "请先登录");
    await authService.logout(presented.token, requestContext(request, requestId));
    return apiSuccess({ loggedOut: true }, requestId, { headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
