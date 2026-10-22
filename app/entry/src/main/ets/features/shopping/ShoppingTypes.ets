/**
 * #84 选购交易契约（App 侧）。
 *
 * 字段与服务端 `shopping-view.ts` 一一对应；价格一律是**整数分**，
 * 页面只在展示时转成元，绝不在客户端做浮点金额运算。
 */
export const PRODUCT_CATEGORY_SECONDHAND: string = 'SECONDHAND';
export const PRODUCT_CATEGORY_CONSUMABLE: string = 'CONSUMABLE';
export const PRODUCT_STATUS_ON_SALE: string = 'ON_SALE';
export const PRODUCT_STATUS_DELISTED: string = 'DELISTED';
export const ORDER_STATUS_PENDING: string = 'PENDING_PICKUP';
export const ORDER_STATUS_COMPLETED: string = 'COMPLETED';
export const ORDER_STATUS_CANCELLED: string = 'CANCELLED';

export interface ShoppingSellerView {
  id: string;
  displayName: string;
}

export interface ShoppingImageView {
  id: string;
  url: string;
  sortOrder: number;
}

export interface ShoppingProductActions {
  canBuy: boolean;
  canEdit: boolean;
  canDelist: boolean;
  canUploadImages: boolean;
}

export interface ShoppingProductView {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  category: string;
  condition: string;
  stock: number;
  status: string;
  pickupNote: string | null;
  seller: ShoppingSellerView;
  images: ShoppingImageView[];
  coverUrl: string | null;
  delistReason: string | null;
  delistedAt: string | null;
  createdAt: string;
  updatedAt: string;
  actions: ShoppingProductActions;
}

export interface ShoppingOrderActions {
  canCancel: boolean;
  canComplete: boolean;
}

export interface ShoppingOrderPartyView {
  id: string;
  displayName: string;
}

export interface ShoppingOrderProductView {
  id: string;
  title: string;
  status: string;
}

export interface ShoppingOrderView {
  id: string;
  productId: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  titleSnapshot: string;
  imageSnapshot: string | null;
  status: string;
  cancelReason: string | null;
  cancelledBy: string | null;
  buyer: ShoppingOrderPartyView;
  seller: ShoppingOrderPartyView;
  product: ShoppingOrderProductView;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  actions: ShoppingOrderActions;
}

/** 商品详情 / 编辑页的导航参数；新建时 id 为空串。 */
export interface ShoppingGoodsParam {
  id: string;
}

export interface ShoppingProductDraft {
  title: string;
  description: string;
  priceCents: number;
  category: string;
  condition: string;
  stock: number;
  pickupNote?: string;
}

export interface ShoppingProductPatch {
  title?: string;
  description?: string;
  priceCents?: number;
  condition?: string;
  /**
   * 目标库存；仅在用户实际修改了库存时携带，未改则不传，避免覆盖
   * 编辑期间发生的下单扣减。改动库存时必须同时携带 `stockBase`。
   */
  stock?: number;
  /**
   * 页面加载时读到的库存（乐观锁基线）。服务端发现当前库存已不等于
   * 基线（期间有下单/取消）时返回 409 `STOCK_CONFLICT` / `STOCK_ORDER_LOCKED`，
   * 客户端展示服务端 message 并让用户重新加载后再改。
   */
  stockBase?: number;
  pickupNote?: string | null;
}

export interface ShoppingOrderDraft {
  productId: string;
  quantity: number;
  idempotencyKey: string;
}

export function shoppingCategoryLabel(category: string): string {
  if (category === PRODUCT_CATEGORY_SECONDHAND) return '二手配件';
  if (category === PRODUCT_CATEGORY_CONSUMABLE) return '维修耗材';
  return category;
}

export function shoppingProductStatusLabel(status: string): string {
  if (status === PRODUCT_STATUS_ON_SALE) return '在售';
  if (status === PRODUCT_STATUS_DELISTED) return '已下架';
  return status;
}

export function shoppingOrderStatusLabel(status: string): string {
  if (status === ORDER_STATUS_PENDING) return '待取货';
  if (status === ORDER_STATUS_COMPLETED) return '已完成';
  if (status === ORDER_STATUS_CANCELLED) return '已取消';
  return status;
}

/** 整数分 → `¥12.00`；只在展示层使用，不参与计算。 */
export function shoppingMoney(cents: number): string {
  const safe: number = cents < 0 ? 0 : cents;
  return `¥${(safe / 100).toFixed(2)}`;
}

/** 服务端 ISO 时间 → 本地 `YYYY-MM-DD HH:mm`；空值返回空串。 */
export function shoppingTime(iso: string | null): string {
  if (iso === null || iso === '') return '';
  const date: Date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const month: string = (date.getMonth() + 1).toString().padStart(2, '0');
  const day: string = date.getDate().toString().padStart(2, '0');
  const hour: string = date.getHours().toString().padStart(2, '0');
  const minute: string = date.getMinutes().toString().padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day} ${hour}:${minute}`;
}
