import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest, sessionCookie } from "@/lib/auth/request";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { principal, token, tokenSource } = await authenticateRequest(request, requestId, true);
    const response = apiSuccess(principal, requestId);
    // 只有 Cookie 通道需要续期会话 Cookie；Bearer 通道（原生客户端）由客户端自行保管令牌。
    if (tokenSource === "cookie") response.cookies.set(sessionCookie(token, principal.expiresAt));
    return response;
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
