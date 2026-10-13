import { createCustomerAccount } from "@/features/accounts/account-repository";
import { authService } from "@/features/auth/auth-service";
import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { normalizeQq } from "@/lib/security/normalization";
import { isPasswordLengthValid, passwordLengthMessage } from "@/lib/security/password-policy";
import type {
  AuthSessionResult,
  CustomerRegistrationInput,
  PublicRequestContext,
} from "@/types/contracts";

/**
 * 客户自主注册入参解析（唯一入口）。
 *
 * 只读 `qq` / `password` / `passwordConfirmation`，其余字段一律丢弃 —— 尤其是客户端可能
 * 塞进来的 `roles` / `permissions` / `memberProfile*`：客户身份由服务端决定，请求体无权赋权。
 * 顺序与既有邀请码注册一致：先比对两次密码，再校验长度，最后规范化 QQ（错误码带字段提示）。
 */
export function parseCustomerRegistrationInput(
  body: Record<string, unknown>,
): CustomerRegistrationInput {
  const password = String(body.password ?? "");
  const passwordConfirmation = String(body.passwordConfirmation ?? "");
  if (password !== passwordConfirmation) {
    throw new AppError("PASSWORD_CONFIRMATION_MISMATCH", "两次输入的密码不一致");
  }
  if (!isPasswordLengthValid(password)) {
    throw new AppError("VALIDATION_FAILED", passwordLengthMessage());
  }
  return { qq: normalizeQq(String(body.qq ?? "")), password, passwordConfirmation };
}

export class RegistrationService {
  /**
   * 客户自主注册：QQ + 自设密码 → 客户身份（无角色、无成员档案）+ 会话。
   *
   * 契约要点（详见 `docs/native-client-api.md`）：
   * - 与邀请码注册是两个独立入口，**不读也不消耗邀请码**；
   * - QQ 已被任何账号占用（含软删除身份）→ `409 ACCOUNT_IDENTITY_TAKEN`，
   *   绝不认领 / 改写既有账号；
   * - 成功后**立即返回会话**（注册即登录）：Web 下发 Cookie、原生返回令牌，
   *   不存在「账号已建但未登录」的中间态；失败的注册请求不会留下任何会话。
   *
   * 原子性（PR #65 审查 P2）：「建账号 + 发会话 + 审计」在**同一个**串行化事务里完成。
   * 旧实现是先提交账号、再在事务外发会话：会话写库一失败就只能返回 500，而账号已经落库，
   * 用户重试只能得到 `409 ACCOUNT_IDENTITY_TAKEN` —— 被自己的失败请求锁在门外。
   * 现在任何一步失败都整体回滚，注册失败不会留下账号，重试是安全的。
   */
  async registerCustomer(
    input: CustomerRegistrationInput,
    context: PublicRequestContext,
  ): Promise<AuthSessionResult> {
    return inSerializableTransaction(async (tx) => {
      const created = await createCustomerAccount(tx, {
        qq: input.qq,
        displayName: `客户${input.qq}`,
        password: input.password,
      });
      await appendAuditLog(tx, {
        actor: context,
        actorType: "SYSTEM",
        action: "auth.register.account_created",
        targetType: "User",
        targetId: created,
        result: "SUCCESS",
        // `qq` 会被审计脱敏（`redactAuditSummary` 的 QQ_KEY）；口令类字段一律不入库。
        after: { qq: input.qq, identityType: "QQ", role: "CUSTOMER" },
      });
      return authService.openSessionWith(tx, created, context, "auth.register.succeeded");
    });
  }
}

export const registrationService = new RegistrationService();
