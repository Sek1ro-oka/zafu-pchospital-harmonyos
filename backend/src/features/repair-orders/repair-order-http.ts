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

// ---------------------------------------------------------------------------
// Issue #38：工作人员入参解析
// ---------------------------------------------------------------------------

/** 队列范围：待受理（公共抢单池）/ 我负责 / 全部。非法值 400，缺省为待受理。 */
export const staffQueueScopes = ["unassigned", "mine", "all"] as const;
export type StaffQueueScope = (typeof staffQueueScopes)[number];

export function staffQueueInput(params: URLSearchParams): {
  scope: StaffQueueScope;
  status?: string;
} {
  const scope = params.get("scope") ?? "unassigned";
  if (!(staffQueueScopes as readonly string[]).includes(scope))
    throw new AppError("VALIDATION_FAILED", "scope 参数无效");
  return { scope: scope as StaffQueueScope, status: repairOrderListStatus(params) };
}

/** 工作人员推进的目标状态白名单：取消走独立接口（必须填说明），受理走 accept 接口。 */
export const staffProgressTargets = ["REPAIRING", "COMPLETED"] as const;
export type StaffProgressTarget = (typeof staffProgressTargets)[number];

export function staffProgressInput(body: Record<string, unknown>): {
  toStatus: StaffProgressTarget;
  note?: string;
} {
  const toStatus = body.toStatus;
  if (
    typeof toStatus !== "string" ||
    !(staffProgressTargets as readonly string[]).includes(toStatus)
  )
    throw new AppError("VALIDATION_FAILED", "toStatus 参数无效");
  return { toStatus: toStatus as StaffProgressTarget, note: optionalNote(body, "note") };
}

/** 取消说明必填（#38：取消必须填说明）；长度上限与事件列的 VarChar(500) 对齐。 */
export const REPAIR_ORDER_NOTE_MAX_LENGTH = 500;

export function requiredNote(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string" || !value.trim())
    throw new AppError("VALIDATION_FAILED", `${name} 不能为空`);
  if (value.trim().length > REPAIR_ORDER_NOTE_MAX_LENGTH)
    throw new AppError("VALIDATION_FAILED", `${name} 不能超过 ${REPAIR_ORDER_NOTE_MAX_LENGTH} 字`);
  return value.trim();
}

/** 选填说明：缺省与空串归一为 undefined；超长直接 400，不静默截断。 */
export function optionalNote(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new AppError("VALIDATION_FAILED", `${name} 必须是字符串`);
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (trimmed.length > REPAIR_ORDER_NOTE_MAX_LENGTH)
    throw new AppError("VALIDATION_FAILED", `${name} 不能超过 ${REPAIR_ORDER_NOTE_MAX_LENGTH} 字`);
  return trimmed;
}

/**
 * 可选 JSON 请求体：受理/建档这类「可以不传内容」的写接口用。
 * 空体按 `{}` 处理；给了体但不是合法 JSON 对象则 400，不静默吞掉客户端错误。
 */
export async function readOptionalJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_FAILED", "请求体不是合法 JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new AppError("VALIDATION_FAILED", "请求体必须是 JSON 对象");
  return parsed as Record<string, unknown>;
}
