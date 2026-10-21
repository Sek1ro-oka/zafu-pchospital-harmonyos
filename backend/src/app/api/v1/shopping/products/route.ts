import {
  optionalActor,
  productCreateInput,
  productListQuery,
  readJsonBody,
} from "@/features/shopping/shopping-http";
import { shoppingProductService } from "@/features/shopping/shopping-product-service";
import { parsePagination } from "@/lib/api/pagination";
import { getRequestId } from "@/lib/api/request-id";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * 公开商品列表：游客可读，登录用户额外拿到 `canBuy/canEdit` 等动作。
 * 只返回 `ON_SALE`，分页在 `meta.pagination`。
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const params = new URL(request.url).searchParams;
    const pagination = parsePagination(params);
    const actor = await optionalActor(request, requestId);
    const result = await shoppingProductService.listPublic(
      productListQuery(params),
      pagination,
      actor,
    );
    return apiSuccess(result.items, requestId, { pagination: result.pagination });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

/** 发布商品：`sellerId` 由登录态决定；耗材分类另受权限约束。 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = await readJsonBody(request);
    return apiSuccess(
      await shoppingProductService.create(productCreateInput(body), actor),
      requestId,
      { status: 201 },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
