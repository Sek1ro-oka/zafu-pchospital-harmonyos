import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api/errors";
import { paginationMeta } from "@/lib/api/pagination";
import type { AuthorizedActor, PaginationInput } from "@/types/contracts";
import { assertCanReadOrder } from "./shopping-policy";
import { isUniqueViolation, shoppingRepository, type ShoppingOrderRow } from "./shopping-repository";
import {
  normalizeAndValidateOrderDraft,
  normalizeReason,
  shoppingLimits,
  validateReason,
  type ShoppingOrderDraft,
} from "./shopping-validation";
import { toShoppingOrderView } from "./shopping-view";

/**
 * 幂等重放：同键同商品同数量返回原单；同键换了参数属于客户端复用了幂等键，
 * 必须 409 而不是悄悄返回另一单。
 */
function replayOrder(
  existing: ShoppingOrderRow,
  input: { productId: string; quantity: number },
  actor: AuthorizedActor,
) {
  if (existing.productId !== input.productId || existing.quantity !== input.quantity)
    throw new AppError("IDEMPOTENCY_CONFLICT", "该幂等键已用于其他下单请求");
  return toShoppingOrderView(existing, actor);
}

export const shoppingOrderService = {
  /**
   * 下单：服务端快照标题/单价/首图，事务内条件扣库存。
   *
   * 先做一次幂等查询是为了让常见重试不进入事务；真正的并发同键由唯一索引兜底，
   * 捕获 P2002 后回读原单（输掉的事务整体回滚，库存不会残留）。
   */
  async create(input: ShoppingOrderDraft, actor: AuthorizedActor) {
    if (!actor.userId) throw new AppError("UNAUTHENTICATED", "登录状态无效");
    const draft = normalizeAndValidateOrderDraft(input);

    const existing = await shoppingRepository.findOrderByKey(actor.userId, draft.idempotencyKey);
    if (existing) return replayOrder(existing, draft, actor);

    const product = await shoppingRepository.findProductById(draft.productId);
    if (!product) throw new AppError("PRODUCT_NOT_FOUND", "商品不存在");
    if (product.sellerId === actor.userId)
      throw new AppError("SELF_PURCHASE", "不能购买自己发布的商品");
    if (product.status !== "ON_SALE")
      throw new AppError("PRODUCT_DELISTED", "商品已下架");
    if (product.stock < draft.quantity) throw new AppError("OUT_OF_STOCK", "库存不足");

    const now = new Date();
    let created: Awaited<ReturnType<typeof shoppingRepository.createOrderWithStock>>;
    try {
      created = await shoppingRepository.createOrderWithStock({
        id: randomUUID(),
        productId: product.id,
        buyerId: actor.userId,
        sellerId: product.sellerId,
        quantity: draft.quantity,
        unitPriceCents: product.priceCents,
        totalCents: product.priceCents * draft.quantity,
        titleSnapshot: product.title,
        imageSnapshot: product.images[0]?.url ?? null,
        idempotencyKey: draft.idempotencyKey,
        now,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const concurrent = await shoppingRepository.findOrderByKey(
          actor.userId,
          draft.idempotencyKey,
        );
        if (concurrent) return replayOrder(concurrent, draft, actor);
      }
      throw error;
    }

    // `reserved=true` 是本次事务新落的单，直接返回；`reserved=false` 且带 order
    // 是事务内命中了同键既有单（并发窗口里另一个请求先提交）。这条分支必须和
    // 事务外查重一样走 `replayOrder` 校验 productId/quantity —— 否则同键不同
    // 参数的并发请求会拿到商品 A 的成功订单而不是 IDEMPOTENCY_CONFLICT
    // （PR #89 审查 P2；buyerId 由 `(buyerId, idempotencyKey)` 查询键天然一致）。
    if (created.order && created.reserved) return toShoppingOrderView(created.order, actor);
    if (created.order) return replayOrder(created.order, draft, actor);

    // 条件扣减命中 0 行：回读商品区分「已下架」与「库存不足」，避免笼统报错。
    const current = await shoppingRepository.findProductById(draft.productId);
    if (!current) throw new AppError("PRODUCT_NOT_FOUND", "商品不存在");
    if (current.status !== "ON_SALE")
      throw new AppError("PRODUCT_DELISTED", "商品已下架");
    throw new AppError("OUT_OF_STOCK", "库存不足");
  },

  /** 订单列表：`role=buyer` 看买到的东西，`role=seller` 看收到的订单。 */
  async list(
    actor: AuthorizedActor,
    query: { role: "buyer" | "seller"; status?: string },
    pagination: PaginationInput,
  ) {
    if (!actor.userId) throw new AppError("UNAUTHENTICATED", "登录状态无效");
    const { items, total } = await shoppingRepository.listOrders({
      userId: actor.userId,
      role: query.role,
      status: query.status,
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    });
    return {
      items: items.map((item) => toShoppingOrderView(item, actor)),
      pagination: paginationMeta(pagination, total),
    };
  },

  /** 订单详情：只有买家/卖家可见；第三人按不存在处理，避免探测订单。 */
  async detail(id: string, actor: AuthorizedActor) {
    const order = await shoppingRepository.findOrderById(id);
    if (!order) throw new AppError("ORDER_NOT_FOUND", "订单不存在");
    assertCanReadOrder(actor, order);
    return toShoppingOrderView(order, actor);
  },

  /**
   * 取消：买卖双方都可取消待自提订单；卖家必须说明原因，买家可不填。
   *
   * 回补库存只发生在条件更新命中 1 行时（仓储层保证）；重复取消不幂等，
   * 已取消/已完成再取消一律 409，也不得二次回补库存。仓储只改 stock、
   * 不改商品 status，已下架商品不会被复活。
   */
  async cancel(id: string, input: { reason?: string }, actor: AuthorizedActor) {
    if (!actor.userId) throw new AppError("UNAUTHENTICATED", "登录状态无效");
    const order = await shoppingRepository.findOrderById(id);
    if (!order) throw new AppError("ORDER_NOT_FOUND", "订单不存在");
    assertCanReadOrder(actor, order);

    const reason = normalizeReason(input.reason);
    if (order.sellerId === actor.userId && !reason)
      throw new AppError("VALIDATION_FAILED", "卖家取消订单必须填写原因", {
        fieldErrors: { reason: ["请填写取消原因"] },
      });
    validateReason(reason, "reason", shoppingLimits.cancelReasonMaxLength);

    if (order.status === "CANCELLED")
      throw new AppError("INVALID_STATUS", "订单已取消，不能重复取消");
    if (order.status === "COMPLETED")
      throw new AppError("INVALID_STATUS", "已完成的订单不能取消");

    const updated = await shoppingRepository.cancelOrderWithRestock({
      orderId: id,
      productId: order.productId,
      quantity: order.quantity,
      cancelledBy: actor.userId,
      cancelReason: reason ?? null,
      now: new Date(),
    });
    if (updated) return toShoppingOrderView(updated, actor);

    const fresh = await shoppingRepository.findOrderById(id);
    if (!fresh) throw new AppError("ORDER_NOT_FOUND", "订单不存在");
    if (fresh.status === "CANCELLED")
      throw new AppError("INVALID_STATUS", "订单已取消，不能重复取消");
    throw new AppError(
      "INVALID_STATUS",
      fresh.status === "COMPLETED" ? "订单已完成，不能取消" : "订单状态已变化，请刷新后重试",
    );
  },

  /** 完成：仅卖家。重复完成幂等返回；已取消或并发失败一律 409。 */
  async complete(id: string, actor: AuthorizedActor) {
    if (!actor.userId) throw new AppError("UNAUTHENTICATED", "登录状态无效");
    const order = await shoppingRepository.findOrderById(id);
    if (!order) throw new AppError("ORDER_NOT_FOUND", "订单不存在");
    assertCanReadOrder(actor, order);

    if (order.sellerId !== actor.userId)
      throw new AppError("FORBIDDEN", "只有卖家可以确认完成");

    if (order.status === "COMPLETED") return toShoppingOrderView(order, actor);
    if (order.status === "CANCELLED")
      throw new AppError("INVALID_STATUS", "已取消的订单不能完成");

    const updated = await shoppingRepository.completeOrder({
      orderId: id,
      sellerId: actor.userId,
      now: new Date(),
    });
    if (updated) return toShoppingOrderView(updated, actor);

    const fresh = await shoppingRepository.findOrderById(id);
    if (!fresh) throw new AppError("ORDER_NOT_FOUND", "订单不存在");
    if (fresh.status === "COMPLETED") return toShoppingOrderView(fresh, actor);
    throw new AppError(
      "INVALID_STATUS",
      fresh.status === "CANCELLED" ? "订单已取消，不能完成" : "订单状态已变化，请刷新后重试",
    );
  },
};
