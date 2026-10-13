import { authService } from "@/features/auth/auth-service";
import { AppError } from "@/lib/api/errors";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import {
  assertWriteAccess,
  readPresentedToken,
  requestContext,
} from "@/lib/auth/request";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * 原生修改密码（Issue #60 第二批）：`{ currentPassword, newPassword, newPasswordConfirmation, rememberMe? }`。
 *
 * 与 Web 端 `/api/v1/auth/password/change` **共用同一个 `AuthService.changePassword`**：
 * 口令校验、scrypt 哈希、会话轮换与旧会话吊销完全同一套逻辑，不另写第二份。
 * 两条通道的差别只在「凭证怎么带、令牌怎么回」：
 *
 * - 来源校验：`assertWriteAccess()` —— Bearer 通道要求 `X-Client-Type: native`
 *   （浏览器设不了这个自定义头，预检又拿不到 CORS 头），不伪造 Origin；
 * - 令牌来源：只认 `Authorization: Bearer`（原生通道不使用 Cookie，与登录一致）；
 * - 令牌回传：**放进响应体**，不下发 Cookie —— 客户端拿到后自行保存并替换本地令牌。
 *
 * 强制改密账号（`mustChangePassword = true`）如何自救：`authenticateRequest()`
 * 默认档位会把这类账号在所有接口上一律 403，若改密入口也走默认档位，账号就永远
 * 改不了初始密码。因此这里**不走** `authenticateRequest`，而是直接用
 * `readPresentedToken()` + `authService.changePassword()`（后者内部 `authenticate()`
 * 只校验会话本身，不看 `mustChangePassword`）。这与 `/auth/native/session` 的
 * `allowForcedPasswordChange = true` 是同一个思路：改密入口必须对强制改密账号放行。
 *
 * 成功后：旧会话全部吊销、下发新令牌；请求体省略 `rememberMe` 时**沿用当前会话的档位**，
 * 不会把 24 小时账号偷偷续成 30 天（见 `AuthService.rotationLifetime`）。
 *
 * 失败：`400 PASSWORD_CURRENT_INVALID`（旧密码错）、`400 PASSWORD_CONFIRMATION_MISMATCH`
 * （两次新密码不一致）、`400 VALIDATION_FAILED`（口令长度 6–128）、
 * `401 UNAUTHENTICATED`（未携带令牌）、`401 AUTH_SESSION_INVALID` / `401 AUTH_SESSION_EXPIRED`
 * （会话无效或已过期）、`403 FORBIDDEN`（缺 `X-Client-Type: native`）。
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const presented = readPresentedToken(request);
    if (!presented) throw new AppError("UNAUTHENTICATED", "请先登录");
    const body = (await request.json()) as Record<string, unknown>;
    const result = await authService.changePassword(
      presented.token,
      {
        currentPassword: String(body.currentPassword ?? ""),
        newPassword: String(body.newPassword ?? ""),
        newPasswordConfirmation: String(body.newPasswordConfirmation ?? ""),
        rememberMe: typeof body.rememberMe === "boolean" ? body.rememberMe : undefined,
      },
      requestContext(request, requestId),
    );
    return apiSuccess(
      {
        changed: true,
        mustChangePassword: false,
        token: result.token,
        expiresAt: result.expiresAt,
      },
      requestId,
      { headers: PRIVATE },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
