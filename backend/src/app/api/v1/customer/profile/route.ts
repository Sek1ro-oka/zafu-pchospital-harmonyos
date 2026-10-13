import { customerProfileInput } from "@/features/customer-profile/customer-profile-input";
import { customerProfileService } from "@/features/customer-profile/customer-profile-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(await customerProfileService.getSelf(actor), requestId, { headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(
      await customerProfileService.updateSelf(customerProfileInput(await request.json()), actor),
      requestId,
      { headers: PRIVATE },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

/** ArkTS HTTP 枚举无 PATCH，原生 POST 别名共享同一实现。 */
export const POST = PATCH;
