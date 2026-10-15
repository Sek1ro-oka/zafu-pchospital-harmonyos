import { bodyString } from "@/features/admin/admin-http";
import {
  bodyRequiredInt,
  bodyRequiredIsoDate,
} from "@/features/repair-activities/repair-activity-http";
import { REPAIR_ACTIVITY_CAPACITY_MIN } from "@/features/repair-activities/repair-activity-validation";
import { repairActivityService } from "@/features/repair-activities/repair-activity-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(await repairActivityService.listAdmin(actor), requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    const result = await repairActivityService.create(
      {
        title: bodyString(body, "title"),
        location: body.location,
        capacity: bodyRequiredInt(body, "capacity", {
          min: REPAIR_ACTIVITY_CAPACITY_MIN,
          max: 10_000,
        }),
        activityAt: bodyRequiredIsoDate(body, "activityAt"),
        signupOpensAt: bodyRequiredIsoDate(body, "signupOpensAt"),
        signupClosesAt: bodyRequiredIsoDate(body, "signupClosesAt"),
      },
      actor,
    );
    return apiSuccess(result, requestId, { status: 201 });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
