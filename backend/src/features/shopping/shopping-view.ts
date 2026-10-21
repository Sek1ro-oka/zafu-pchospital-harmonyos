import type { AuthorizedActor } from "@/types/contracts";
import { canManageConsumables, isShoppingModerator } from "./shopping-policy";
import type { ProductRow, ShoppingOrderRow } from "./shopping-repository";
import type { ProductCategory, ProductStatus, ShoppingOrderStatus } from "./shopping-types";

/** 商品图对外形状：客户端只需要能渲染的字段。 */
export type ProductImageView = {
  id: string;
  url: string;
  sortOrder: number;
};

/**
 * 服务端计算的商品动作。客户端据此渲染按钮，但**不作为授权依据** ——
 * 每个写接口都会重新校验（与 `repairOrderStaffActions` 同一口径）。
 */
export type ProductActions = {
  canBuy: boolean;
  canEdit: boolean;
  canDelist: boolean;
  canUploadImages: boolean;
};

/** 订单动作：待自提时买卖双方可取消，仅卖家可确认完成。 */
export type ShoppingOrderActions = {
  canCancel: boolean;
  canComplete: boolean;
};

export type ProductSellerView = {
  id: string;
  displayName: string;
};

export type ProductView = {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  category: ProductCategory;
  condition: string;
  stock: number;
  status: ProductStatus;
  pickupNote: string | null;
  seller: ProductSellerView;
  images: ProductImageView[];
  coverUrl: string | null;
  delistReason: string | null;
  delistedAt: string | null;
  createdAt: string;
  updatedAt: string;
  actions: ProductActions;
};

export type ProductPartyView = {
  id: string;
  displayName: string;
};

export type ShoppingOrderView = {
  id: string;
  productId: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  titleSnapshot: string;
  imageSnapshot: string | null;
  status: ShoppingOrderStatus;
  cancelReason: string | null;
  cancelledBy: string | null;
  buyer: ProductPartyView;
  seller: ProductPartyView;
  product: { id: string; title: string; status: ProductStatus };
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  actions: ShoppingOrderActions;
};

type DisplayableUser = {
  id: string;
  displayName: string | null;
  customerProfile: { nickname: string | null } | null;
  memberProfile: { nickname: string | null } | null;
};

/**
 * 公开展示名：客户昵称 → 成员昵称 → 账号显示名 → 匿名兜底。
 * **不取 realName/studentId**，避免选购列表把实名或学号带出去。
 */
export function shoppingDisplayName(user: DisplayableUser): string {
  const nickname =
    user.customerProfile?.nickname?.trim() || user.memberProfile?.nickname?.trim();
  return nickname || user.displayName?.trim() || "校园用户";
}

function productActions(actor: AuthorizedActor | null, row: ProductRow): ProductActions {
  if (!actor?.userId) {
    return { canBuy: false, canEdit: false, canDelist: false, canUploadImages: false };
  }
  const owner = row.sellerId === actor.userId;
  const onSale = row.status === "ON_SALE";
  const canEdit =
    onSale && owner && (row.category !== "CONSUMABLE" || canManageConsumables(actor));
  return {
    // 游客/未登录不可下单；自己的商品也不可购买（服务端另抛 SELF_PURCHASE）。
    canBuy: onSale && row.stock > 0 && !owner,
    canEdit,
    canDelist: onSale && (owner || isShoppingModerator(actor)),
    canUploadImages: canEdit,
  };
}

export function toProductView(row: ProductRow, actor: AuthorizedActor | null = null): ProductView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priceCents: row.priceCents,
    category: row.category as ProductCategory,
    condition: row.condition,
    stock: row.stock,
    status: row.status as ProductStatus,
    pickupNote: row.pickupNote,
    seller: { id: row.seller.id, displayName: shoppingDisplayName(row.seller) },
    images: row.images.map((image) => ({
      id: image.id,
      url: image.url,
      sortOrder: image.sortOrder,
    })),
    coverUrl: row.images[0]?.url ?? null,
    // 下架原因只对已下架商品有意义；未下架时字段本身应为 null。
    delistReason: row.delistReason,
    delistedAt: row.delistedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    actions: productActions(actor, row),
  };
}

export function orderActions(
  actor: AuthorizedActor,
  row: Pick<ShoppingOrderRow, "buyerId" | "sellerId" | "status">,
): ShoppingOrderActions {
  const pending = row.status === "PENDING_PICKUP";
  const participant = row.buyerId === actor.userId || row.sellerId === actor.userId;
  return {
    canCancel: pending && participant,
    canComplete: pending && row.sellerId === actor.userId,
  };
}

export function toShoppingOrderView(row: ShoppingOrderRow, actor: AuthorizedActor): ShoppingOrderView {
  return {
    id: row.id,
    productId: row.productId,
    quantity: row.quantity,
    unitPriceCents: row.unitPriceCents,
    totalCents: row.totalCents,
    titleSnapshot: row.titleSnapshot,
    imageSnapshot: row.imageSnapshot,
    status: row.status as ShoppingOrderStatus,
    cancelReason: row.cancelReason,
    cancelledBy: row.cancelledBy,
    buyer: { id: row.buyer.id, displayName: shoppingDisplayName(row.buyer) },
    seller: { id: row.seller.id, displayName: shoppingDisplayName(row.seller) },
    product: {
      id: row.product.id,
      title: row.product.title,
      status: row.product.status as ProductStatus,
    },
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    actions: orderActions(actor, row),
  };
}
