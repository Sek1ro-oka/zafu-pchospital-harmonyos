import { staffProgressInput } from "@/features/repair-orders/repair-order-http";
import { repairOrderStaffService } from "@/features/repair-orders/repair-order-staff-service";
import { AppError } from "@/lib/api/errors";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 推进报修单：ACCEPTED → REPAIRING / REPAIRING → COMPLETED。请求体 `{ toStatus, note? }`。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    let raw: Record<string, unknown>;
    try {
      raw = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new AppError("VALIDATION_FAILED", "请求体不是合法 JSON");
    }
    const { id } = await context.params;
    return apiSuccess(await repairOrderStaffService.progress(id, staffProgressInput(raw), actor), requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
