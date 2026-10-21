import { AppError } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/permissions";
import type { AuthorizedActor } from "@/types/contracts";
import type { ProductCategory } from "./shopping-types";

/** 授权的耗材维护人员（MEMBER/ADMIN 通过 `shopping.consumable:manage` 获得）。 */
export function canManageConsumables(actor: AuthorizedActor): boolean {
  return actor.permissions.includes("shopping.consumable:manage");
}

/** 管理员（商品下架审核）：只有 ADMIN 角色持有该权限码。 */
export function isShoppingModerator(actor: AuthorizedActor): boolean {
  return actor.permissions.includes("shopping.product:moderate");
}

function requireUserId(actor: AuthorizedActor): string {
  if (!actor.userId) throw new AppError("UNAUTHENTICATED", "登录状态无效");
  return actor.userId;
}

/**
 * 发布商品：二手任何登录用户可发布；耗材仅授权工作人员。
 * 这里不检查「工作人员」角色，只检查权限码 —— 与全库权限模型一致。
 */
export function assertCanCreateProduct(actor: AuthorizedActor, category: ProductCategory): void {
  requireUserId(actor);
  if (category === "CONSUMABLE" && !canManageConsumables(actor))
    throw new AppError("FORBIDDEN", "耗材商品仅授权工作人员可发布");
}

/**
 * 修改商品：仅发布者本人，且商品仍在售；耗材还要求当前仍持有耗材维护权限
 * （权限被收回后不能继续维护已有耗材商品）。
 */
export function assertCanEditProduct(
  actor: AuthorizedActor,
  product: { sellerId: string; category: string; status: string },
): void {
  const userId = requireUserId(actor);
  if (product.sellerId !== userId) throw new AppError("FORBIDDEN", "只能修改自己发布的商品");
  if (product.category === "CONSUMABLE") requirePermission(actor, "shopping.consumable:manage");
  if (product.status !== "ON_SALE") throw new AppError("INVALID_STATUS", "商品已下架，不能修改");
}

/**
 * 下架商品：发布者本人，或持有审核权限的管理员。
 *
 * 返回 `owner`/`moderator` 供调用方判断下架原因是否必填；
 * 非本人且无审核权限一律 403（商品详情公开，不存在「隐藏 ID 是否存在」的问题）。
 */
export function assertCanDelistProduct(
  actor: AuthorizedActor,
  product: { sellerId: string },
): { owner: boolean; moderator: boolean } {
  const userId = requireUserId(actor);
  const owner = product.sellerId === userId;
  const moderator = isShoppingModerator(actor);
  if (!owner && !moderator)
    throw new AppError("FORBIDDEN", "只能下架自己发布的商品");
  return { owner, moderator };
}

/**
 * 订单可见性：只有买家和卖家可读。
 * 第三人返回 404（`ORDER_NOT_FOUND`）而不是 403，避免用状态码探测订单是否存在。
 */
export function assertCanReadOrder(
  actor: AuthorizedActor,
  order: { buyerId: string; sellerId: string },
): void {
  const userId = requireUserId(actor);
  if (order.buyerId !== userId && order.sellerId !== userId)
    throw new AppError("ORDER_NOT_FOUND", "订单不存在");
}
