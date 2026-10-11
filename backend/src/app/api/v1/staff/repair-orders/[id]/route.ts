import { repairOrderStaffService } from "@/features/repair-orders/repair-order-staff-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 工作人员报修详情：受理信息、时间线、关联备案摘要与允许动作。 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const { id } = await context.params;
    return apiSuccess(await repairOrderStaffService.detail(id, actor), requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
