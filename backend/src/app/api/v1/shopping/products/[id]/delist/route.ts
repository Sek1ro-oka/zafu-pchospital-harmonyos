import {
  productDelistInput,
  readOptionalJsonBody,
} from "@/features/shopping/shopping-http";
import { shoppingProductService } from "@/features/shopping/shopping-product-service";
import { getRequestId } from "@/lib/api/request-id";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * 下架商品：本人可不填原因；管理员下架他人商品必须填 `reason`（服务层校验）。
 * 重复下架按幂等返回，不重复写 `delistedAt`。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = await readOptionalJsonBody(request);
    return apiSuccess(
      await shoppingProductService.delist((await params).id, productDelistInput(body), actor),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
