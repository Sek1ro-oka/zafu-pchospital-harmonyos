import { AppError } from "@/lib/api/errors";
import { RepairOrderStatus } from "@/types/contracts";

/**
 * 幂等键：客户端在重试提交时携带同一个值，服务端据此返回原单而不重复创建。
 * 与备案链路 `repair-http.ts` 的 `idempotencyKey` 同一约定（请求头 `Idempotency-Key`）。
 */
export function repairOrderIdempotencyKey(request: Request): string {
  return request.headers.get("idempotency-key") ?? "";
}

/** 请求体里的必填字符串。缺字段、非字符串、纯空白一律 400。 */
function requiredString(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string" || !value.trim())
    throw new AppError("VALIDATION_FAILED", `${name} 不能为空`);
  return value;
}

/** 请求体里的选填字符串；缺字段与 null 都归一为 undefined。 */
function optionalString(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new AppError("VALIDATION_FAILED", `${name} 必须是字符串`);
  return value;
}

/** 报修提交入参。字段名与客户端契约一致（camelCase）。 */
export function repairOrderSubmitInput(body: Record<string, unknown>) {
  return {
    deviceModel: requiredString(body, "deviceModel"),
    deviceSerial: optionalString(body, "deviceSerial"),
    faultDescription: requiredString(body, "faultDescription"),
    contactPhone: requiredString(body, "contactPhone"),
  };
}

/** 列表筛选：`status` 走白名单，非法值直接 400 而不是静默忽略。 */
export function repairOrderListStatus(params: URLSearchParams): string | undefined {
  const value = params.get("status");
  if (!value) return undefined;
  if (!(RepairOrderStatus as readonly string[]).includes(value))
    throw new AppError("VALIDATION_FAILED", "status 参数无效");
  return value;
}
