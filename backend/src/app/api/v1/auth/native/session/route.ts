import { nativeSessionPayload } from "@/features/auth/native-auth-http";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertNativeClient, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * 原生客户端身份查询：重启后用它向服务端验证令牌并取回最新身份。
 *
 * `allowForcedPasswordChange = true`：强制改密账号（初始密码未改）仍可读取身份，
 * 由响应里的 `mustChangePassword` 驱动 App 引导到原生改密页（`/auth/native/password/change`）；
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
