import { bodyRegistrationIds } from "@/features/repair-activities/repair-activity-http";
import { validateCheckInIssueTypeUpdates } from "@/features/repair-activities/repair-activity-validation";
import { repairActivityStaffService } from "@/features/repair-activities/repair-activity-staff-service";
import { AppError } from "@/lib/api/errors";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const id = (await params).id;
    if (!id) throw new AppError("VALIDATION_FAILED", "活动 ID 无效");
    const body = (await request.json()) as Record<string, unknown>;
    const ids = bodyRegistrationIds(body);
    return apiSuccess(
      await repairActivityStaffService.checkIn(
        id,
        ids,
        actor,
        validateCheckInIssueTypeUpdates(body.issueTypeUpdates, ids),
      ),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
