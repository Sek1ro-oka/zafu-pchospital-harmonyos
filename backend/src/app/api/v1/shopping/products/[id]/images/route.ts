import { shoppingProductImageService } from "@/features/shopping/shopping-product-image-service";
import { getRequestId } from "@/lib/api/request-id";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * 商品图上传（multipart，字段名 `photos`）：仅商品本人在售时可传，耗材另需权限。
 * 存储与报修照片独立（`products/` 前缀、独立张数配额），失败会回滚已写文件。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const form = await request.formData();
    const files = form.getAll("photos").filter((item): item is File => item instanceof File);
    return apiSuccess(
      await shoppingProductImageService.upload((await params).id, files, actor),
      requestId,
      { status: 201 },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
