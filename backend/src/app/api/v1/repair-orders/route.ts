import { repairOrderListStatus, repairOrderSubmitInput, repairOrderIdempotencyKey } from "@/features/repair-orders/repair-order-http";
import { repairOrderService } from "@/features/repair-orders/repair-order-service";
import { parsePagination } from "@/lib/api/pagination";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 本人报修列表（分页 + 可选状态筛选）。 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const params = new URL(request.url).searchParams;
    const pagination = parsePagination(params);
    const result = await repairOrderService.listMine(
      { status: repairOrderListStatus(params) },
      pagination,
      actor,
    );
    return apiSuccess(result.items, requestId, { pagination: result.pagination });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

/**
 * 客户提交报修。
 *
 * 写请求来源防线按令牌实际来源分流（`assertWriteAccess`，见 `lib/auth/request.ts`）：
 * Cookie 走同源白名单（Web 行为逐字不变），Bearer 要求 `x-client-type: native`
 * 且不能伪造 Origin 绕过同源检查。两通道共用同一套真实会话验证。
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await repairOrderService.submit(
        repairOrderSubmitInput(body),
        { createRequestKey: repairOrderIdempotencyKey(request) },
        actor,
      ),
      requestId,
      { status: 201 },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
