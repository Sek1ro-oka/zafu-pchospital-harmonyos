import { customerFavoriteService } from "@/features/customer-community/customer-favorite-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    await customerFavoriteService.remove((await context.params).id, actor);
    return apiSuccess({ removed: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
