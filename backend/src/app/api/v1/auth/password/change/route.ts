import { authService } from "@/features/auth/auth-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import {
  assertSameOrigin,
  readSessionToken,
  requestContext,
  sessionCookie,
} from "@/lib/auth/request";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as Record<string, unknown>;
    const result = await authService.changePassword(
      readSessionToken(request),
      {
        currentPassword: String(body.currentPassword ?? ""),
        newPassword: String(body.newPassword ?? ""),
        newPasswordConfirmation: String(body.newPasswordConfirmation ?? ""),
        // 省略时沿用当前会话的档位（`changePassword` 自己从库里读），
        // 显式传 true/false 则按用户本次的选择轮换。
        rememberMe: typeof body.rememberMe === "boolean" ? body.rememberMe : undefined,
      },
      requestContext(request, requestId),
    );
    const response = apiSuccess({ changed: true, mustChangePassword: false }, requestId);
    response.cookies.set(sessionCookie(result.token, result.expiresAt));
    return response;
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
