import { repairActivityService } from "@/features/repair-activities/repair-activity-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; regId: string }> },
) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const { id, regId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const result = await repairActivityService.updateRegistration(
      id,
      regId,
      {
        ...("name" in body ? { name: String(body.name ?? "") } : {}),
        ...("phone" in body ? { phone: String(body.phone ?? "") } : {}),
        ...("issueType" in body ? { issueType: body.issueType } : {}),
      },
      actor,
    );
    return apiSuccess(result, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; regId: string }> },
) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const { id, regId } = await params;
    await repairActivityService.softDeleteRegistration(id, regId, actor);
    return apiSuccess({ deleted: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

// ArkTS http has no PATCH; both methods execute the same handler.
export const POST = PATCH;
