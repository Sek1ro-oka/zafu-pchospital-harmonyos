import {
  optionalActor,
  productPatchInput,
  readJsonBody,
} from "@/features/shopping/shopping-http";
import { shoppingProductService } from "@/features/shopping/shopping-product-service";
import { AppError } from "@/lib/api/errors";
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

/** PATCH 与 POST 兼容入口共用的更新处理：同一鉴权、同一校验、同一业务。 */
async function handleProductUpdate(
  request: Request,
  params: Promise<{ id: string }>,
  requestId: string,
) {
  assertWriteAccess(request);
  const { actor } = await authenticateRequest(request, requestId);
  const body = await readJsonBody(request);
  return apiSuccess(
    await shoppingProductService.update((await params).id, productPatchInput(body), actor),
    requestId,
  );
}

/** 修改商品：本人、仅在售；`category/status/sellerId` 即使传入也不会生效。 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request.headers);
  try {
    return await handleProductUpdate(request, params, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

/**
 * POST 兼容入口：`http.RequestMethod.PATCH` 是鸿蒙 API 26 才有的枚举，
 * API 24 客户端用 `POST + X-HTTP-Method-Override: PATCH`（头值大小写不敏感）
 * 走同一更新 handler。缺头或头值不是 PATCH 一律 405，不静默当作其它语义。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request.headers);
  try {
    const override = request.headers.get("x-http-method-override")?.trim().toLowerCase();
    if (override !== "patch")
      throw new AppError(
        "METHOD_NOT_ALLOWED",
        "该路径的 POST 仅作为编辑兼容入口，必须携带 X-HTTP-Method-Override: PATCH",
      );
    return await handleProductUpdate(request, params, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
