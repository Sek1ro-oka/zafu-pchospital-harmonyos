import {
  orderCancelInput,
  readOptionalJsonBody,
} from "@/features/shopping/shopping-http";
import { shoppingOrderService } from "@/features/shopping/shopping-order-service";
import { getRequestId } from "@/lib/api/request-id";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * 取消待自提订单：买家可不填原因，卖家必须填 `reason`（服务层按角色校验）。
 * 库存只在条件更新真正从 PENDING_PICKUP 改为 CANCELLED 时回补一次。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = await readOptionalJsonBody(request);
    return apiSuccess(
      await shoppingOrderService.cancel((await params).id, orderCancelInput(body), actor),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
