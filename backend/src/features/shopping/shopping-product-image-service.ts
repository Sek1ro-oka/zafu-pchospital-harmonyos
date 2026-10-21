import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api/errors";
import type { AuthorizedActor } from "@/types/contracts";
import { assertCanEditProduct } from "./shopping-policy";
import {
  localProductImageStorage,
  productImageUploadLimits,
  type ProductImageStorage,
} from "./shopping-product-image-storage";
import { shoppingRepository } from "./shopping-repository";
import type { ProductImageView } from "./shopping-view";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

/** 与报修照片相同的魔数校验；独立一份，避免购物功能反向依赖报修模块。 */
function detectImageType(
  bytes: Uint8Array,
): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes
      .slice(0, 8)
      .every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}

export function createShoppingProductImageService(storage: ProductImageStorage) {
  return {
    /**
     * 上传商品图：先校验全部文件（大小/魔数/声明类型一致）再落盘，最后批量建行；
     * 任何一步失败都把已写文件删掉，避免留下无数据库记录的孤儿文件。
     */
    async upload(
      productId: string,
      files: File[],
      actor: AuthorizedActor,
    ): Promise<ProductImageView[]> {
      const product = await shoppingRepository.findProductById(productId);
      if (!product) throw new AppError("PRODUCT_NOT_FOUND", "商品不存在");
      assertCanEditProduct(actor, product);

      const limits = productImageUploadLimits();
      if (!files.length) throw new AppError("VALIDATION_FAILED", "请选择图片");
      const existing = await shoppingRepository.countProductImages(productId);
      if (existing + files.length > limits.maxFiles)
        throw new AppError(
          "PRODUCT_IMAGE_LIMIT_EXCEEDED",
          `每件商品最多上传 ${limits.maxFiles} 张图片`,
        );

      const prepared = await Promise.all(
        files.map(async (file) => {
          if (file.size > limits.maxBytes)
            throw new AppError(
              "PRODUCT_IMAGE_TOO_LARGE",
              `「${file.name}」${formatBytes(file.size)}，超过单张 ${formatBytes(limits.maxBytes)} 的上限`,
            );
          const bytes = new Uint8Array(await file.arrayBuffer());
          const detected = detectImageType(bytes);
          if (!detected || detected !== file.type)
            throw new AppError("PRODUCT_IMAGE_TYPE_UNSUPPORTED", "仅支持真实的 JPEG、PNG 或 WebP 图片");
          return { bytes, mimeType: detected };
        }),
      );

      const stored: Array<{ storageKey: string }> = [];
      try {
        for (const item of prepared) stored.push(await storage.put(item));
        const now = new Date();
        const rows = stored.map((entry, index) => {
          const id = randomUUID();
          return {
            id,
            productId,
            storageKey: entry.storageKey,
            url: `/api/v1/shopping/product-images/${id}/content`,
            mimeType: prepared[index].mimeType,
            sizeBytes: prepared[index].bytes.byteLength,
            now,
          };
        });
        const created = await shoppingRepository.createProductImages(rows);
        return created.map((row) => ({ id: row.id, url: row.url, sortOrder: row.sortOrder }));
      } catch (error) {
        await Promise.allSettled(stored.map((entry) => storage.delete(entry.storageKey)));
        if (error instanceof AppError) throw error;
        throw new AppError("PRODUCT_IMAGE_STORAGE_FAILED", "图片保存失败", { cause: error });
      }
    },

    /**
     * 读取图片字节：**公开**，不做登录校验（游客要能看商品详情）。
     * 已软删的图片仍可按 ID 读取，保证历史订单的 `imageSnapshot` 不失效。
     */
    async open(imageId: string) {
      const image = await shoppingRepository.findProductImageById(imageId);
      if (!image) throw new AppError("RESOURCE_NOT_FOUND", "图片不存在");
      try {
        const bytes = await storage.open(image.storageKey);
        if (bytes.byteLength !== image.sizeBytes) throw new Error("stored image size mismatch");
        return { image, bytes };
      } catch (error) {
        throw new AppError("PRODUCT_IMAGE_STORAGE_FAILED", "图片暂时不可读取", { cause: error });
      }
    },
  };
}

export const shoppingProductImageService = createShoppingProductImageService(
  localProductImageStorage,
);
