import { customerNotificationService } from "@/features/customer-community/customer-notification-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    await customerNotificationService.read((await context.params).id, actor);
    return apiSuccess({ read: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
