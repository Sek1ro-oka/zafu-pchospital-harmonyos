import {
  optionalActor,
  productPatchInput,
  readJsonBody,
} from "@/features/shopping/shopping-http";
import { shoppingProductService } from "@/features/shopping/shopping-product-service";
import { getRequestId } from "@/lib/api/request-id";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 公开商品详情：已下架仍可读（客户端展示状态），图片/卖家展示名一并返回。 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request.headers);
  try {
    const actor = await optionalActor(request, requestId);
    return apiSuccess(
      await shoppingProductService.detail((await params).id, actor),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

/** 修改商品：本人、仅在售；`category/status/sellerId` 即使传入也不会生效。 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = await readJsonBody(request);
    return apiSuccess(
      await shoppingProductService.update((await params).id, productPatchInput(body), actor),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
