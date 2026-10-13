import {
  parseCustomerRegistrationInput,
  registrationService,
} from "@/features/auth/registration-service";
import { registrationChannel, registrationSuccess } from "@/features/auth/registration-http";
import { apiFailure } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { requestContext } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * 客户自主注册（Issue #60）：
 * `{ qq, password, passwordConfirmation, rememberMe? }`。
 *
 * 公开入口，无凭证；Web（同源 Origin）与原生（`X-Client-Type: native`）都可用，
 * 两者分别按 `assertPublicWriteAccess` 校验。注册只产生客户身份（无角色、无成员档案），
 * 成功后立即返回会话（Web 下发 Cookie，原生返回令牌）。
 *
 * `rememberMe` 选填：`true` = 保持登录（会话 30 天），`false` / 缺省 = 普通档位（24 小时）。
 * 归一化规则只有一份，在 `parseCustomerRegistrationInput`（唯一入口）：只认布尔值，
 * 非布尔值按缺省处理。这里把整个请求体交给它，**不在路由层再写第二套取值规则** ——
 * 两处各写一份的下场是「路由看起来勾了、库里却没落档位」的分叉。
 * 该字段最终经 `registerCustomer` → `openSessionWith` → `sessionRowData` 显式落库
 * （`auth_sessions.remember_me`，新会话不留 NULL）。
 *
 * 失败：`400 VALIDATION_FAILED` / `400 PASSWORD_CONFIRMATION_MISMATCH` /
 * `409 ACCOUNT_IDENTITY_TAKEN`（QQ 已注册）/ `403 FORBIDDEN`（来源校验不通过）/
 * `429 RATE_LIMITED`（同一 IP 15 分钟 10 次）。
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const channel = registrationChannel(request);
    const context = requestContext(request, requestId);
    enforceRateLimit(`customer-registration:${context.ipAddress ?? "unknown"}`, 10, 15 * 60_000);
    const body = (await request.json()) as Record<string, unknown>;
    const session = await registrationService.registerCustomer(
      parseCustomerRegistrationInput(body),
      context,
    );
    return registrationSuccess(session, channel, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
