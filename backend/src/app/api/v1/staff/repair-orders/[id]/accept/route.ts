import { optionalNote, readOptionalJsonBody } from "@/features/repair-orders/repair-order-http";
import { repairOrderStaffService } from "@/features/repair-orders/repair-order-staff-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * 受理报修单：SUBMITTED → ACCEPTED，受理人 = 当前用户的有效成员档案。
 * 请求体可选 `{ note? }`（受理说明）。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = await readOptionalJsonBody(request);
    const { id } = await context.params;
    return apiSuccess(
      await repairOrderStaffService.accept(id, { note: optionalNote(body, "note") }, actor),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
