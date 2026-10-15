import { repairActivityStaffService } from "@/features/repair-activities/repair-activity-staff-service";
import { AppError } from "@/lib/api/errors";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; registrationId: string }> },
) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const { id, registrationId } = await params;
    if (!id || !registrationId || id.length > 36 || registrationId.length > 36) {
      throw new AppError("VALIDATION_FAILED", "活动或报名 ID 无效");
    }
    return apiSuccess(
      await repairActivityStaffService.getRegistrationPhone(id, registrationId, actor),
      requestId,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
