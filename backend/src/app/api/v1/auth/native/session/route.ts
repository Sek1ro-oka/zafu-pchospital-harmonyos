import { nativeSessionPayload } from "@/features/auth/native-auth-http";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertNativeClient, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * 原生客户端身份查询：重启后用它向服务端验证令牌并取回最新身份。
 *
 * `allowForcedPasswordChange = true`：App 本轮只展示身份、不提供改密页，
 * 初始密码未改的账号仍可进入，由响应里的 `mustChangePassword` 提示去 Web 端改密；
 * 其余接口（含后续业务接口）仍在 `authenticateRequest` 默认档位下拒绝这类账号。
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertNativeClient(request);
    const { principal } = await authenticateRequest(request, requestId, true);
    return apiSuccess(nativeSessionPayload(principal), requestId, { headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
