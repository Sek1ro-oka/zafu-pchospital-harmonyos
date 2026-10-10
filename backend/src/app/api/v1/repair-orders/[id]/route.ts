import { repairOrderService } from "@/features/repair-orders/repair-order-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 报修单详情 + 进度时间线。非本人的单返回 404，不返回 403。 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const { id } = await context.params;
    return apiSuccess(await repairOrderService.detail(id, actor), requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
