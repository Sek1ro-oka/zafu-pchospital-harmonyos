import { repairPhotoService } from "@/features/repairs/repair-photo-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, assertWriteAccess, authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; photoId: string }> };
export async function DELETE(request: Request, { params }: Context) {
  const requestId = getRequestId(request.headers);
  try {
    // 删除误传照片双通道；排序（PATCH）仍是 Web 专属功能，仅同源。
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const p = await params;
    await repairPhotoService.remove(p.id, p.photoId, actor);
    return apiSuccess({ deleted: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
export async function PATCH(request: Request, { params }: Context) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const p = await params;
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await repairPhotoService.reorder(p.id, p.photoId, Number(body.sortOrder), actor),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
