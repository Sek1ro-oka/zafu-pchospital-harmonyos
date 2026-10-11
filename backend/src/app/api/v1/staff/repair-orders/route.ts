import { staffQueueInput } from "@/features/repair-orders/repair-order-http";
import { repairOrderStaffService } from "@/features/repair-orders/repair-order-staff-service";
import { parsePagination } from "@/lib/api/pagination";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * 工作人员报修队列（Issue #38）。
 *
 * `scope=unassigned`（公共待受理，默认）/ `mine`（我负责）/ `all`（全部，含管理员管理入口），
 * 可叠加 `status` 筛选；分页沿用 `page`/`pageSize`。与客户接口分离，不复用本人列表。
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const params = new URL(request.url).searchParams;
    const pagination = parsePagination(params);
    const result = await repairOrderStaffService.queue(staffQueueInput(params), pagination, actor);
    return apiSuccess(result.items, requestId, { pagination: result.pagination });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
