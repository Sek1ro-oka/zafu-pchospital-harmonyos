import { shoppingOrderService } from "@/features/shopping/shopping-order-service";
import { getRequestId } from "@/lib/api/request-id";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 订单详情：仅买家/卖家可见；第三人按不存在处理（404），不暴露订单存在性。 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(
      await shoppingOrderService.detail((await params).id, actor),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
