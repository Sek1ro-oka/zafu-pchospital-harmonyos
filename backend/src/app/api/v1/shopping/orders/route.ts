import {
  orderCreateInput,
  orderListQuery,
  readJsonBody,
} from "@/features/shopping/shopping-http";
import { shoppingOrderService } from "@/features/shopping/shopping-order-service";
import { parsePagination } from "@/lib/api/pagination";
import { getRequestId } from "@/lib/api/request-id";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * 我的订单：`role=buyer`（我买到的）/ `role=seller`（我卖出的），
 * 可选 `status`，分页在 `meta.pagination`。
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const params = new URL(request.url).searchParams;
    const pagination = parsePagination(params);
    const result = await shoppingOrderService.list(actor, orderListQuery(params), pagination);
    return apiSuccess(result.items, requestId, { pagination: result.pagination });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

/**
 * 下单：`idempotencyKey` 必填，同键同商品同数量重试返回原单且不二次扣库存；
 * 同键换参数 409。库存扣减与订单写入在同一 Serializable 事务。
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = await readJsonBody(request);
    return apiSuccess(
      await shoppingOrderService.create(orderCreateInput(body), actor),
      requestId,
      { status: 201 },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
