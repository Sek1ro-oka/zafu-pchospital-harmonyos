import { AppError } from "@/lib/api/errors";

import { CASE_VISIBILITIES, type CaseVisibility } from "./case-types";

/** 管理动作请求体的字段校验（HTTP 层）。 */
export function parseCaseVisibilityInput(body: Record<string, unknown>): CaseVisibility {
  const value = body.visibility;
  if (typeof value !== "string" || !(CASE_VISIBILITIES as readonly string[]).includes(value)) {
    throw new AppError("VALIDATION_FAILED", "visibility 仅支持 STAFF 或 PUBLIC");
  }
  return value as CaseVisibility;
}
