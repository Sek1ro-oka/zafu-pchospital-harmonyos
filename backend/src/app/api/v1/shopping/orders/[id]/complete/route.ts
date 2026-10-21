import { shoppingOrderService } from "@/features/shopping/shopping-order-service";
import { getRequestId } from "@/lib/api/request-id";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 确认完成：仅卖家；重复完成幂等返回，已取消/并发冲突 409。 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(
      await shoppingOrderService.complete((await params).id, actor),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
