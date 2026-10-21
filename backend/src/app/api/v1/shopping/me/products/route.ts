import { shoppingProductService } from "@/features/shopping/shopping-product-service";
import { parsePagination } from "@/lib/api/pagination";
import { getRequestId } from "@/lib/api/request-id";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { authenticateRequest } from "@/lib/auth/request";
import { AppError } from "@/lib/api/errors";

export const runtime = "nodejs";

/** 我发布的商品：含已下架，按发布时间倒序；供「我发布的商品」页使用。 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    if (!actor.userId) throw new AppError("UNAUTHENTICATED", "登录状态无效");
    const pagination = parsePagination(new URL(request.url).searchParams);
    const result = await shoppingProductService.listMine(actor.userId, pagination, actor);
    return apiSuccess(result.items, requestId, { pagination: result.pagination });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
