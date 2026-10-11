import { requiredNote, readOptionalJsonBody } from "@/features/repair-orders/repair-order-http";
import { repairOrderStaffService } from "@/features/repair-orders/repair-order-staff-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 取消报修单（仅管理员）：请求体 `{ note }`，说明必填。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = await readOptionalJsonBody(request);
    const { id } = await context.params;
    return apiSuccess(
      await repairOrderStaffService.cancel(id, { note: requiredNote(body, "note") }, actor),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
