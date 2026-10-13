import { AppError } from "@/lib/api/errors";
import { normalizeNickname } from "@/features/member-profile/member-profile-types";

export type CustomerProfileInput = {
  version: number;
  nickname: string | null;
  phone: string | null;
};

/** 完整期望值；拒绝身份/角色等额外字段，不允许选择他人。 */
export function customerProfileInput(body: unknown): CustomerProfileInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid("请求体必须是对象");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["version", "nickname", "phone"].includes(key))) {
    throw invalid("请求包含不允许的字段");
  }
  if (!Number.isInteger(input.version) || (input.version as number) < 0)
    throw invalid("version 必须是非负整数");
  const nickname = normalizeNickname(input.nickname);
  if (nickname.kind === "UNCHANGED") throw invalid("请提交昵称（可为 null）");
  if (input.phone !== null && typeof input.phone !== "string")
    throw invalid("联系电话必须是字符串或 null");
  const phone = typeof input.phone === "string" ? input.phone.trim() : null;
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) throw invalid("联系电话须为 11 位大陆手机号", "phone");
  return {
    version: input.version as number,
    nickname: nickname.kind === "CLEAR" ? null : nickname.value,
    phone: phone || null,
  };
}

function invalid(message: string, field?: string): AppError {
  return new AppError(
    "VALIDATION_FAILED",
    message,
    field ? { fieldErrors: { [field]: [message] } } : undefined,
  );
}
