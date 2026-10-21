import { shoppingProductImageService } from "@/features/shopping/shopping-product-image-service";
import { getRequestId } from "@/lib/api/request-id";
import { apiFailure } from "@/lib/api/response";

export const runtime = "nodejs";

/**
 * 公开商品图：游客浏览详情时必须能加载，所以**不做登录校验**。
 * 已软删图片仍按 ID 可读，保证历史订单的图片快照不失效。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ imageId: string }> },
) {
  const requestId = getRequestId(request.headers);
  try {
    const { image, bytes } = await shoppingProductImageService.open((await params).imageId);
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Content-Type": image.mimeType,
        "Content-Length": String(image.sizeBytes),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
