import { authService } from "@/features/auth/auth-service";
import { registrationChannel, registrationSuccess } from "@/features/auth/registration-http";
import { inviteCodeService } from "@/features/invitations/invite-code-service";
import { AppError } from "@/lib/api/errors";
import { apiFailure } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { requestContext } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * 邀请码注册工作人员（Issue #60）：入口与客户自主注册（`/auth/register/customer`）
 * 明确分开 —— 本入口**必须**带有效邀请码，成功后产生 `MEMBER` 角色 + 成员档案。
 *
 * 公开入口，无凭证；Web（同源 Origin）与原生（`X-Client-Type: native`）都可用。
 * 使用次数 / 生效时间 / 绑定关系 / 并发与幂等规则全部沿用 `InviteCodeService.redeem`：
 * 校验与扣减在同一串行化事务内（`usedCount` 行锁 + 条件更新），不会超卖，
 * 也不会覆盖既有账号身份（命中既有身份即 `409 ACCOUNT_IDENTITY_CONFLICT` 并回滚）。
 * 成功后立即返回会话（Web 下发 Cookie，原生返回令牌）。
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const channel = registrationChannel(request);
    const context = requestContext(request, requestId);
    enforceRateLimit(`staff-registration:${context.ipAddress ?? "unknown"}`, 10, 15 * 60_000);
    const body = (await request.json()) as Record<string, unknown>;
    const password = String(body.password ?? "");
    if (password !== String(body.passwordConfirmation ?? "")) {
      throw new AppError("PASSWORD_CONFIRMATION_MISMATCH", "两次输入的密码不一致");
    }
    const registration = await inviteCodeService.redeem(
      {
        code: String(body.code ?? ""),
        idempotencyKey: String(body.idempotencyKey ?? ""),
        realName: String(body.realName ?? ""),
        qq: String(body.qq ?? ""),
        phone: String(body.phone ?? ""),
        studentId: optional(body.studentId),
        className: optional(body.className),
        password,
      },
      context,
    );
    const session = await authService.issueSessionForRegisteredAccount(
      registration.userId,
      context,
    );
    return registrationSuccess(session, channel, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

function optional(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
