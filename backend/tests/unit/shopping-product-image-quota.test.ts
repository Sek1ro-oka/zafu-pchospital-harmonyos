import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { AppError } from "../../src/lib/api/errors";
import {
  createShoppingProductImageService,
  type ProductImageRepository,
} from "../../src/features/shopping/shopping-product-image-service";
import type { ProductImageStorage } from "../../src/features/shopping/shopping-product-image-storage";
import type { AuthorizedActor } from "../../src/types/contracts";

/**
 * 图片配额并发回归（Issue #84 第三轮审查 P2）。
 *
 * 审查复现：初始 8 张（上限 9），两个并发请求各传 1 张。事务外 `countProductImages`
 * 让两个请求都读到 8 并通过预检查；若建行时不再复核数量，两次串行建行也会各插 1 张，
 * 最终 8→10，突破每商品配额。
 *
 * 修复后：配额复核与插入同处「建行事务」，事务内重新统计有效行。本测试用内存仓储 +
 * 严格串行化的建行事务复现，断言恰好一个成功、最终 9 张，失败方抛
 * PRODUCT_IMAGE_LIMIT_EXCEEDED 且不留下孤儿文件。
 */

const SELLER_ID = "seller-quota";
const MAX_FILES = 9;
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function actor(): AuthorizedActor {
  return {
    requestId: "quota-test",
    actorType: "USER",
    userId: SELLER_ID,
    userStatus: "ACTIVE",
    permissions: [],
  };
}

function pngFile(name: string): File {
  return new File([PNG_BYTES], name, { type: "image/png" });
}

/** 记录 put/delete 的内存存储：可断言失败方文件被清理，不留孤儿。 */
function createFakeStorage() {
  const live = new Set<string>();
  const storage: ProductImageStorage = {
    async put() {
      const storageKey = `products/${randomUUID()}.png`;
      live.add(storageKey);
      return { storageKey };
    },
    async open() {
      return PNG_BYTES;
    },
    async delete(storageKey) {
      live.delete(storageKey);
    },
  };
  return { storage, live };
}

type StoredImage = { id: string; productId: string; sortOrder: number; deletedAt: null };

/**
 * 内存仓储：`createProductImages` 用一条 promise 链把「建行事务」严格串行化，
 * 并在事务内重新统计有效行做配额复核，行为与真实 Serializable 事务一致。
 * `countProductImages` 是事务外读取，故意保留并发窗口（复现审查场景）。
 */
function createFakeRepository(seedActive: number) {
  const productId = `product-${randomUUID()}`;
  const images: StoredImage[] = [];
  for (let index = 0; index < seedActive; index += 1)
    images.push({ id: `seed-${index}`, productId, sortOrder: index, deletedAt: null });

  let chain: Promise<unknown> = Promise.resolve();

  const activeCount = (id: string) =>
    images.filter((row) => row.productId === id && row.deletedAt === null).length;

  const repository = {
    async findProductById(id: string) {
      return { id, sellerId: SELLER_ID, category: "SECONDHAND", status: "ON_SALE" };
    },
    async countProductImages(id: string) {
      return activeCount(id);
    },
    createProductImages(input: {
      maxFiles: number;
      rows: Array<{ id: string; productId: string }>;
    }) {
      const run = chain.then(() => {
        const id = input.rows[0]?.productId;
        if (!id) return { outcome: "created" as const, images: [] };
        const existing = activeCount(id);
        if (existing + input.rows.length > input.maxFiles)
          return { outcome: "limit-exceeded" as const, existing };
        let sortOrder =
          images.reduce(
            (max, row) => (row.productId === id ? Math.max(max, row.sortOrder) : max),
            -1,
          ) + 1;
        const created: Array<{ id: string; url: string; sortOrder: number }> = [];
        for (const row of input.rows) {
          images.push({ id: row.id, productId: id, sortOrder, deletedAt: null });
          created.push({ id: row.id, url: `/api/v1/shopping/product-images/${row.id}/content`, sortOrder });
          sortOrder += 1;
        }
        return { outcome: "created" as const, images: created };
      });
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    async findProductImageById() {
      return null;
    },
  };

  return {
    productId,
    images,
    repository: repository as unknown as ProductImageRepository,
  };
}

test("图片配额并发：8 张基础上两个并发各传 1 张，只一个成功、最终 9 张，失败方无孤儿文件", async () => {
  const { storage, live } = createFakeStorage();
  const { productId, images, repository } = createFakeRepository(8);
  const service = createShoppingProductImageService(storage, repository);

  assert.equal(
    images.filter((row) => row.deletedAt === null).length,
    8,
    "起始应有 8 张有效图片",
  );

  const results = await Promise.allSettled([
    service.upload(productId, [pngFile("a.png")], actor()),
    service.upload(productId, [pngFile("b.png")], actor()),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  assert.equal(fulfilled.length, 1, `应恰好一个成功，实际 ${fulfilled.length}`);
  assert.equal(rejected.length, 1, `应恰好一个失败，实际 ${rejected.length}`);

  const failure = rejected[0].reason;
  assert.ok(failure instanceof AppError, "失败方应抛 AppError");
  assert.equal(failure.code, "PRODUCT_IMAGE_LIMIT_EXCEEDED");

  const winner = (fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof service.upload>>>).value;
  assert.equal(winner.length, 1);

  // 最终有效图片恰好 9 张，失败方没有插入任何行。
  assert.equal(
    images.filter((row) => row.deletedAt === null).length,
    9,
    "并发后有效图片必须恰好 9 张（不得 8→10）",
  );
  // 只有成功方那 1 个文件仍存活，失败方落盘的文件已被清理。
  assert.equal(live.size, 1, "失败方文件必须删除，不留孤儿文件");
});

test("图片配额预检查：已达上限时事务外快速失败，不落盘任何文件", async () => {
  const { storage, live } = createFakeStorage();
  const { productId, repository } = createFakeRepository(MAX_FILES);
  const service = createShoppingProductImageService(storage, repository);

  await assert.rejects(
    () => service.upload(productId, [pngFile("extra.png")], actor()),
    (error: unknown) =>
      error instanceof AppError && error.code === "PRODUCT_IMAGE_LIMIT_EXCEEDED",
  );
  assert.equal(live.size, 0, "预检查阶段就应拒绝，不得写任何文件");
});
