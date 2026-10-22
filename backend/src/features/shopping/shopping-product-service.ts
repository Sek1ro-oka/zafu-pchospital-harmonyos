import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api/errors";
import { paginationMeta } from "@/lib/api/pagination";
import { Prisma } from "@/generated/prisma/client";
import type { AuthorizedActor, PaginationInput } from "@/types/contracts";
import { shoppingRepository } from "./shopping-repository";
import { assertCanCreateProduct, assertCanDelistProduct, assertCanEditProduct } from "./shopping-policy";
import {
  normalizeProductDraft,
  normalizeProductPatch,
  normalizeReason,
  validateProductDraft,
  validateProductPatch,
  validateReason,
  shoppingLimits,
  type ProductDraft,
  type ProductPatch,
} from "./shopping-validation";
import { toProductView } from "./shopping-view";
import type { ProductCategory } from "./shopping-types";

export const shoppingProductService = {
  /** 公开列表（游客可读）：只列在售，`q` 匹配标题/描述。 */
  async listPublic(
    query: { category?: string; q?: string },
    pagination: PaginationInput,
    actor: AuthorizedActor | null,
  ) {
    const { items, total } = await shoppingRepository.listPublicProducts({
      category: query.category,
      q: query.q,
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    });
    return {
      items: items.map((item) => toProductView(item, actor)),
      pagination: paginationMeta(pagination, total),
    };
  },

  /** 公开详情（游客可读）：已下架商品仍返回，`status` 让客户端显示「已下架」。 */
  async detail(id: string, actor: AuthorizedActor | null) {
    const product = await shoppingRepository.findProductById(id);
    if (!product) throw new AppError("PRODUCT_NOT_FOUND", "商品不存在");
    return toProductView(product, actor);
  },

  /** 发布商品：`sellerId` 取自登录态，二手任何登录用户、耗材仅授权工作人员。 */
  async create(input: ProductDraft, actor: AuthorizedActor) {
    const draft = normalizeProductDraft(input);
    validateProductDraft(draft);
    const category = draft.category as ProductCategory;
    assertCanCreateProduct(actor, category);
    if (!actor.userId) throw new AppError("UNAUTHENTICATED", "登录状态无效");

    const created = await shoppingRepository.createProduct({
      id: randomUUID(),
      sellerId: actor.userId,
      title: draft.title,
      description: draft.description,
      priceCents: draft.priceCents,
      category,
      condition: draft.condition,
      stock: draft.stock,
      status: "ON_SALE",
      pickupNote: draft.pickupNote ?? null,
      now: new Date(),
    });
    return toProductView(created, actor);
  },

  /**
   * 修改商品：本人且仅在售可改；分类/状态不开放修改。
   * 商品不存在 → 404；非本人 → 403（商品详情公开，不隐藏存在性）。
   *
   * 库存与普通字段解耦（PR #89 审查 P1）：
   * - 不传 `stock`：只改其它字段，库存完全不动 —— 编辑与下单/取消交错时，
   *   表单里的旧库存快照不会覆盖订单已扣减/回补的值；
   * - 传 `stock`：必须带 `stockBase`（客户端加载时看到的库存，校验层强制），
   *   事务内比对不一致 → 409 `STOCK_CONFLICT`；
   * - SECONDHAND 且已存在订单（任意状态）：库存归订单链路管理，
   *   传 `stock` → 409 `STOCK_ORDER_LOCKED`。
   */
  async update(id: string, input: ProductPatch, actor: AuthorizedActor) {
    if (!actor.userId) throw new AppError("UNAUTHENTICATED", "登录状态无效");
    const product = await shoppingRepository.findProductById(id);
    if (!product) throw new AppError("PRODUCT_NOT_FOUND", "商品不存在");
    assertCanEditProduct(actor, product);

    const patch = normalizeProductPatch(input);
    validateProductPatch(patch, product.category);
    const data: Prisma.ProductUncheckedUpdateInput = { updatedAt: new Date() };
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.priceCents !== undefined) data.priceCents = patch.priceCents;
    if (patch.condition !== undefined) data.condition = patch.condition;
    if (patch.pickupNote !== undefined) data.pickupNote = patch.pickupNote;

    if (patch.stock !== undefined && patch.stockBase !== undefined) {
      // 带库存的修改走基线事务：条件里含 `stock=stockBase`，串行化隔离下
      // 与下单/取消事务互斥，旧快照不可能盖掉并发扣减。
      const result = await shoppingRepository.updateProductStockWithBase({
        id,
        sellerId: actor.userId,
        data,
        stock: patch.stock,
        stockBase: patch.stockBase,
        orderLocked: product.category === "SECONDHAND",
      });
      if (result.outcome === "order-locked")
        throw new AppError(
          "STOCK_ORDER_LOCKED",
          "二手商品已产生订单，库存由订单管理，不能手动修改",
        );
      if (result.outcome === "stock-conflict")
        throw new AppError(
          "STOCK_CONFLICT",
          "库存已被订单调整，与提交时的基线不一致，请重新加载商品后再保存",
        );
      if (result.outcome === "updated" && result.product)
        return toProductView(result.product, actor);
      // not-updated（并发下架/换人）走下面的回读分支统一判 404/403/409。
    } else {
      // 条件更新与下架互斥：读取之后商品可能已被并发下架，不能把修改写到
      // DELISTED 商品上。命中 0 行时回读状态，统一返回 409。
      const updated = await shoppingRepository.updateProductIfOnSale({
        id,
        sellerId: actor.userId,
        data,
      });
      if (updated) return toProductView(updated, actor);
    }

    const fresh = await shoppingRepository.findProductById(id);
    if (!fresh) throw new AppError("PRODUCT_NOT_FOUND", "商品不存在");
    if (fresh.status !== "ON_SALE")
      throw new AppError("INVALID_STATUS", "商品已下架，不能修改");
    throw new AppError("FORBIDDEN", "只有发布者可以修改商品");
  },

  /**
   * 下架：本人或管理员。管理员下架必须填原因（含管理员自己的商品）；
   * 已下架重复调用按幂等返回当前视图，不重复写审计字段。
   */
  async delist(id: string, input: { reason?: string }, actor: AuthorizedActor) {
    const product = await shoppingRepository.findProductById(id);
    if (!product) throw new AppError("PRODUCT_NOT_FOUND", "商品不存在");
    const { owner, moderator } = assertCanDelistProduct(actor, product);
    const reason = normalizeReason(input.reason);
    if ((!owner || moderator) && !reason)
      throw new AppError("VALIDATION_FAILED", "管理员下架必须填写原因", {
        fieldErrors: { reason: ["请填写下架原因"] },
      });
    validateReason(reason, "reason", shoppingLimits.delistReasonMaxLength);

    if (product.status === "DELISTED") return toProductView(product, actor);

    const now = new Date();
    const count = await shoppingRepository.delistProduct({
      id,
      delistReason: reason ?? null,
      delistedBy: actor.userId!,
      now,
    });
    const fresh = await shoppingRepository.findProductById(id);
    if (!fresh) throw new AppError("PRODUCT_NOT_FOUND", "商品不存在");
    // count 为 0 说明另一个请求已经下架；仍返回最新状态即可。
    if (count === 0 && fresh.status === "ON_SALE")
      throw new AppError("INVALID_STATUS", "商品状态已变化，请重试");
    return toProductView(fresh, actor);
  },

  /** 我发布的商品：含已下架，本人可见全部状态。 */
  async listMine(sellerId: string, pagination: PaginationInput, actor: AuthorizedActor) {
    const { items, total } = await shoppingRepository.listProductsBySeller(sellerId, {
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    });
    return {
      items: items.map((item) => toProductView(item, actor)),
      pagination: paginationMeta(pagination, total),
    };
  },
};
