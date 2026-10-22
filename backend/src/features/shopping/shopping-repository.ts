import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { Prisma } from "@/generated/prisma/client";

/** 公开卖家/买家展示信息：只取昵称类字段，绝不带 realName/studentId。 */
const userDisplaySelect = {
  id: true,
  displayName: true,
  customerProfile: { select: { nickname: true } },
  memberProfile: { select: { nickname: true } },
} satisfies Prisma.UserSelect;

export const productInclude = {
  seller: { select: userDisplaySelect },
  images: {
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    select: { id: true, url: true, sortOrder: true },
  },
} satisfies Prisma.ProductInclude;

export type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

export const orderInclude = {
  buyer: { select: userDisplaySelect },
  seller: { select: userDisplaySelect },
  // 商品可能已下架；订单页仍要显示它在库里的当前状态，快照字段才是交易依据。
  product: { select: { id: true, title: true, status: true } },
} satisfies Prisma.ShoppingOrderInclude;

export type ShoppingOrderRow = Prisma.ShoppingOrderGetPayload<{ include: typeof orderInclude }>;

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export const shoppingRepository = {
  // -------------------------------------------------------------------------
  // 商品
  // -------------------------------------------------------------------------

  /** 公开列表：只返回在售商品；`q` 同时匹配标题与描述。 */
  async listPublicProducts(options: {
    category?: string;
    q?: string;
    skip: number;
    take: number;
  }) {
    const where: Prisma.ProductWhereInput = {
      status: "ON_SALE",
      ...(options.category ? { category: options.category } : {}),
      ...(options.q
        ? {
            OR: [
              { title: { contains: options.q } },
              { description: { contains: options.q } },
            ],
          }
        : {}),
    };
    const db = getDb();
    const [items, total] = await Promise.all([
      db.product.findMany({
        where,
        include: productInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: options.skip,
        take: options.take,
      }),
      db.product.count({ where }),
    ]);
    return { items, total };
  },

  /** 公开详情：不过滤状态，已下架商品仍可读（页面会显示「已下架」）。 */
  async findProductById(id: string) {
    return getDb().product.findUnique({ where: { id }, include: productInclude });
  },

  /** 我发布的商品：包含已下架，按发布时间倒序。 */
  async listProductsBySeller(sellerId: string, options: { skip: number; take: number }) {
    const where: Prisma.ProductWhereInput = { sellerId };
    const db = getDb();
    const [items, total] = await Promise.all([
      db.product.findMany({
        where,
        include: productInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: options.skip,
        take: options.take,
      }),
      db.product.count({ where }),
    ]);
    return { items, total };
  },

  async createProduct(input: {
    id: string;
    sellerId: string;
    title: string;
    description: string;
    priceCents: number;
    category: string;
    condition: string;
    stock: number;
    status: string;
    pickupNote: string | null;
    now: Date;
  }) {
    return getDb().product.create({
      data: {
        id: input.id,
        sellerId: input.sellerId,
        title: input.title,
        description: input.description,
        priceCents: input.priceCents,
        category: input.category,
        condition: input.condition,
        stock: input.stock,
        status: input.status,
        pickupNote: input.pickupNote,
        createdAt: input.now,
        updatedAt: input.now,
      },
      include: productInclude,
    });
  },

  /**
   * 修改商品：条件 `id + sellerId + status=ON_SALE` 才写，避免和服务端下架
   * 并发时把修改写到已下架商品；命中 0 行返回 null，由服务层回读判状态。
   */
  async updateProductIfOnSale(input: {
    id: string;
    sellerId: string;
    data: Prisma.ProductUncheckedUpdateInput;
  }) {
    const updated = await getDb().product.updateMany({
      where: { id: input.id, sellerId: input.sellerId, status: "ON_SALE" },
      data: input.data,
    });
    if (updated.count !== 1) return null;
    return getDb().product.findUnique({ where: { id: input.id }, include: productInclude });
  },

  /**
   * 带库存基线的修改：普通字段与 `stock` 在同一 Serializable 事务内提交，
   * 且只有「当前库存 === 客户端加载时看到的 stockBase」才会写入，防止编辑页
   * 旧快照覆盖订单已扣减/回补的库存。
   *
   * `orderLocked=true`（二手且已存在订单）时事务内直接判定锁定，不做任何写入；
   * 订单数在事务内读取，与下单事务串行化，避免「刚下的单还没被看见」的窗口。
   *
   * 返回四种结果，由服务层翻译错误码：
   * - `updated`：命中并写回最新行；
   * - `order-locked`：二手已有订单，库存归订单链路管理；
   * - `stock-conflict`：当前库存与 stockBase 不一致；
   * - `not-updated`：条件更新命中 0 行（并发下架/换人），服务层回读判 404/403/409。
   */
  async updateProductStockWithBase(input: {
    id: string;
    sellerId: string;
    data: Prisma.ProductUncheckedUpdateInput;
    stock: number;
    stockBase: number;
    orderLocked: boolean;
  }): Promise<
    | { outcome: "updated"; product: ProductRow | null }
    | { outcome: "order-locked" }
    | { outcome: "stock-conflict" }
    | { outcome: "not-updated" }
  > {
    return inSerializableTransaction(async (tx) => {
      if (input.orderLocked) {
        const orders = await tx.shoppingOrder.count({ where: { productId: input.id } });
        if (orders > 0) return { outcome: "order-locked" as const };
      }
      const current = await tx.product.findUnique({ where: { id: input.id } });
      if (!current) return { outcome: "not-updated" as const };
      if (current.stock !== input.stockBase) return { outcome: "stock-conflict" as const };
      const updated = await tx.product.updateMany({
        where: {
          id: input.id,
          sellerId: input.sellerId,
          status: "ON_SALE",
          // 双重保险：比较之外再把基线写进条件，串行化重试也不会盖掉并发扣减。
          stock: input.stockBase,
        },
        data: { ...input.data, stock: input.stock },
      });
      if (updated.count !== 1) return { outcome: "not-updated" as const };
      const product = await tx.product.findUnique({
        where: { id: input.id },
        include: productInclude,
      });
      return { outcome: "updated" as const, product };
    });
  },

  /**
   * 下架：条件 `ON_SALE` 才更新。返回受影响行数，调用方据此区分
   * 「本次下架成功」与「并发请求已经下架」，后者按幂等处理。
   */
  async delistProduct(input: {
    id: string;
    delistReason: string | null;
    delistedBy: string;
    now: Date;
  }): Promise<number> {
    const result = await inSerializableTransaction((tx) =>
      tx.product.updateMany({
        where: { id: input.id, status: "ON_SALE" },
        data: {
          status: "DELISTED",
          delistReason: input.delistReason,
          delistedBy: input.delistedBy,
          delistedAt: input.now,
          updatedAt: input.now,
        },
      }),
    );
    return result.count;
  },

  // -------------------------------------------------------------------------
  // 商品图片
  // -------------------------------------------------------------------------

  async countProductImages(productId: string): Promise<number> {
    return getDb().productImage.count({ where: { productId, deletedAt: null } });
  },

  /**
   * 图片行与文件一一对应；调用方先落文件、失败时按 storageKey 回滚。
   *
   * 「有效图片数配额复核」与「建行」在**同一 Serializable 事务**内完成：事务内重新
   * 统计未软删的有效行，`existing + rows.length > maxFiles` 时不写入任何行、直接返回
   * `limit-exceeded`，由服务层清理已落盘文件。这样即便两次并发上传在事务外都读到旧
   * count（如各读到 8），事务内复核也会在第二个事务里看到 9 而拒绝，最终不会突破每
   * 商品图片上限（8→10）。事务外的预检查只作快速失败，不作为唯一防线。
   *
   * `sortOrder` 在同一事务内取 `max+1`，避免并发上传按旧 count 重号。
   */
  async createProductImages(input: {
    maxFiles: number;
    rows: Array<{
      id: string;
      productId: string;
      storageKey: string;
      url: string;
      mimeType: string;
      sizeBytes: number;
      now: Date;
    }>;
  }): Promise<
    | { outcome: "created"; images: Array<{ id: string; url: string; sortOrder: number }> }
    | { outcome: "limit-exceeded"; existing: number }
  > {
    const { rows, maxFiles } = input;
    return inSerializableTransaction(async (tx) => {
      const productId = rows[0]?.productId;
      if (!productId) return { outcome: "created" as const, images: [] };
      // 配额复核放在事务内：只统计未软删的有效行，与并发上传串行化。
      const existing = await tx.productImage.count({
        where: { productId, deletedAt: null },
      });
      if (existing + rows.length > maxFiles) {
        return { outcome: "limit-exceeded" as const, existing };
      }
      const aggregate = await tx.productImage.aggregate({
        where: { productId },
        _max: { sortOrder: true },
      });
      let sortOrder = (aggregate._max.sortOrder ?? -1) + 1;
      const images: Array<{ id: string; url: string; sortOrder: number }> = [];
      for (const row of rows) {
        const created = await tx.productImage.create({
          data: {
            id: row.id,
            productId: row.productId,
            storageKey: row.storageKey,
            url: row.url,
            mimeType: row.mimeType,
            sizeBytes: row.sizeBytes,
            sortOrder,
            createdAt: row.now,
          },
        });
        images.push({ id: created.id, url: created.url, sortOrder: created.sortOrder });
        sortOrder += 1;
      }
      return { outcome: "created" as const, images };
    });
  },

  /** 按图片 ID 取内容；**不过滤 deletedAt**，历史订单快照仍能打开原图。 */
  async findProductImageById(id: string) {
    return getDb().productImage.findUnique({ where: { id } });
  },

  // -------------------------------------------------------------------------
  // 订单
  // -------------------------------------------------------------------------

  async findOrderById(id: string) {
    return getDb().shoppingOrder.findUnique({ where: { id }, include: orderInclude });
  },

  async findOrderByKey(buyerId: string, idempotencyKey: string) {
    return getDb().shoppingOrder.findUnique({
      where: { buyerId_idempotencyKey: { buyerId, idempotencyKey } },
      include: orderInclude,
    });
  },

  async listOrders(options: {
    userId: string;
    role: "buyer" | "seller";
    status?: string;
    skip: number;
    take: number;
  }) {
    const where: Prisma.ShoppingOrderWhereInput = {
      ...(options.role === "buyer"
        ? { buyerId: options.userId }
        : { sellerId: options.userId }),
      ...(options.status ? { status: options.status } : {}),
    };
    const db = getDb();
    const [items, total] = await Promise.all([
      db.shoppingOrder.findMany({
        where,
        include: orderInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: options.skip,
        take: options.take,
      }),
      db.shoppingOrder.count({ where }),
    ]);
    return { items, total };
  },

  /**
   * 创建订单并扣库存，同一 Serializable 事务提交。
   *
   * 顺序很重要：
   * 1. 先按 `(buyerId, idempotencyKey)` 查重，命中返回 `{ order, reserved: false }`，
   *    **不再扣库存**；服务层必须对 `reserved=false` 的结果统一走 `replayOrder`
   *    校验 productId/quantity，防止同键不同参数的并发请求拿到别人的成功单；
   * 2. 再条件扣库存（`status=ON_SALE AND stock>=quantity`），命中 0 行说明
   *    商品下架或库存不足，由服务层读当前商品区分错误码；
   * 3. 最后写订单（含标题/单价/首图快照）。
   *
   * 并发同键由 `(buyer_id, idempotency_key)` 唯一索引兜底：输掉竞争的事务整体回滚，
   * 库存扣减不会残留；服务层捕获 P2002 后回读原单。
   */
  async createOrderWithStock(input: {
    id: string;
    productId: string;
    buyerId: string;
    sellerId: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
    titleSnapshot: string;
    imageSnapshot: string | null;
    idempotencyKey: string;
    now: Date;
  }): Promise<{ order: ShoppingOrderRow | null; reserved: boolean }> {
    return inSerializableTransaction(async (tx) => {
      const existing = await tx.shoppingOrder.findUnique({
        where: {
          buyerId_idempotencyKey: {
            buyerId: input.buyerId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        include: orderInclude,
      });
      if (existing) return { order: existing, reserved: false };

      const stock = await tx.product.updateMany({
        where: {
          id: input.productId,
          status: "ON_SALE",
          stock: { gte: input.quantity },
        },
        data: { stock: { decrement: input.quantity }, updatedAt: input.now },
      });
      if (stock.count !== 1) return { order: null, reserved: false };

      const order = await tx.shoppingOrder.create({
        data: {
          id: input.id,
          productId: input.productId,
          buyerId: input.buyerId,
          sellerId: input.sellerId,
          quantity: input.quantity,
          unitPriceCents: input.unitPriceCents,
          totalCents: input.totalCents,
          titleSnapshot: input.titleSnapshot,
          imageSnapshot: input.imageSnapshot,
          status: "PENDING_PICKUP",
          idempotencyKey: input.idempotencyKey,
          createdAt: input.now,
          updatedAt: input.now,
        },
        include: orderInclude,
      });
      return { order, reserved: true };
    });
  },

  /**
   * 取消订单：条件 `PENDING_PICKUP → CANCELLED` 命中 1 行才回补库存。
   *
   * 回补只改 `stock`，**绝不改商品 status**：商品若已下架，取消订单不能把它
   * 复活成 ON_SALE。重复取消或与完成竞争时条件更新命中 0 行，直接返回 null，
   * 由服务层回读状态决定「幂等返回」还是 409。
   */
  async cancelOrderWithRestock(input: {
    orderId: string;
    productId: string;
    quantity: number;
    cancelledBy: string;
    cancelReason: string | null;
    now: Date;
  }): Promise<ShoppingOrderRow | null> {
    return inSerializableTransaction(async (tx) => {
      const result = await tx.shoppingOrder.updateMany({
        where: { id: input.orderId, status: "PENDING_PICKUP" },
        data: {
          status: "CANCELLED",
          cancelledBy: input.cancelledBy,
          cancelReason: input.cancelReason,
          cancelledAt: input.now,
          updatedAt: input.now,
        },
      });
      if (result.count !== 1) return null;
      await tx.product.updateMany({
        where: { id: input.productId },
        data: { stock: { increment: input.quantity }, updatedAt: input.now },
      });
      return tx.shoppingOrder.findUniqueOrThrow({
        where: { id: input.orderId },
        include: orderInclude,
      });
    });
  },

  /** 完成订单：仅卖家、仅待自提；条件更新命中 0 行由服务层回读判幂等/冲突。 */
  async completeOrder(input: {
    orderId: string;
    sellerId: string;
    now: Date;
  }): Promise<ShoppingOrderRow | null> {
    return inSerializableTransaction(async (tx) => {
      const result = await tx.shoppingOrder.updateMany({
        where: { id: input.orderId, sellerId: input.sellerId, status: "PENDING_PICKUP" },
        data: { status: "COMPLETED", completedAt: input.now, updatedAt: input.now },
      });
      if (result.count !== 1) return null;
      return tx.shoppingOrder.findUniqueOrThrow({
        where: { id: input.orderId },
        include: orderInclude,
      });
    });
  },
};
