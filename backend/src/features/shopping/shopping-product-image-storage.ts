import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api/errors";

export type ProductImageWriteInput = { bytes: Uint8Array; mimeType: string };
export type StoredProductImage = { storageKey: string };

export interface ProductImageStorage {
  put(input: ProductImageWriteInput): Promise<StoredProductImage>;
  open(storageKey: string): Promise<Uint8Array>;
  delete(storageKey: string): Promise<void>;
}

/** 商品图独立配额：环境变量与报修照片分开，避免一个业务的清理影响另一个。 */
export function productImageUploadLimits() {
  return {
    maxBytes: positiveInt("UPLOAD_MAX_BYTES", 10 * 1024 * 1024),
    maxFiles: positiveInt("UPLOAD_MAX_FILES_PER_PRODUCT", 9),
  };
}

export function productImageUploadRoot(): string {
  const root = resolve(process.env.UPLOAD_PATH ?? "./storage/uploads");
  const workspace = resolve(process.cwd());
  const publicDir = resolve(workspace, "public");
  if (root === workspace || root === publicDir || isWithin(publicDir, root))
    throw new AppError("INTERNAL_ERROR", "UPLOAD_PATH 配置不安全");
  return root;
}

/**
 * 商品图存储。目录前缀用 `products/`，与报修照片 `repairs/` 分开；
 * 文件名仍用随机 UUID，客户端无法通过文件名猜测其他图片。
 */
export const localProductImageStorage: ProductImageStorage = {
  async put(input) {
    const id = randomUUID();
    const extension = extensionFor(input.mimeType);
    const storageKey = `products/${id.slice(0, 2)}/${id}${extension}`;
    const target = safePath(storageKey);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, input.bytes, { flag: "wx" });
    return { storageKey };
  },
  async open(storageKey) {
    return readFile(safePath(storageKey));
  },
  async delete(storageKey) {
    try {
      await unlink(safePath(storageKey));
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
        throw error;
    }
  },
};

function safePath(storageKey: string): string {
  if (storageKey.includes("\\") || storageKey.startsWith("/") || isAbsolute(storageKey))
    throw new AppError("PRODUCT_IMAGE_STORAGE_FAILED", "图片存储路径无效");
  const root = productImageUploadRoot();
  const target = resolve(root, storageKey);
  if (!isWithin(root, target))
    throw new AppError("PRODUCT_IMAGE_STORAGE_FAILED", "图片存储路径无效");
  return target;
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new AppError("INTERNAL_ERROR", `${name} 必须是正整数`);
  return value;
}

function extensionFor(mimeType: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return extname(mimeType) || ".bin";
}
