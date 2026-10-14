import { authService } from "@/features/auth/auth-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, requestContext, sessionCookie } from "@/lib/auth/request";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as Record<string, unknown>;
    const result = await authService.login(
      {
        qq: String(body.qq ?? ""),
        password: String(body.password ?? ""),
        rememberMe: body.rememberMe === true,
      },
      requestContext(request, requestId),
    );
    const response = apiSuccess(
      {
        userId: result.userId,
        displayName: result.displayName,
        roles: result.roles,
        permissions: result.permissions,
        mustChangePassword: result.mustChangePassword,
        expiresAt: result.expiresAt,
      },
      requestId,
    );
    response.cookies.set(sessionCookie(result.token, result.expiresAt));
    return response;
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
