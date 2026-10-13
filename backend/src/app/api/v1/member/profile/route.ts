import { memberProfileService } from "@/features/member-profile/member-profile-service";
import { updateProfileInput } from "@/features/member-profile/member-profile-http";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(await memberProfileService.getSelf(actor), requestId, { headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await memberProfileService.updateProfile(updateProfileInput(body), actor),
      requestId,
      {
        headers: PRIVATE,
      },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

export const POST = PATCH;
