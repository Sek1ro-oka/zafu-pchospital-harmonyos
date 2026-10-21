/**
 * 选购交易（Issue #84）的领域常量。
 *
 * 状态/分类全部用字符串 + TS 联合类型，**不用 Prisma enum**（全库没有 enum 先例，
 * 迁移与查询都按 VARCHAR 处理）。合法值与状态机集中在这里，路由、服务、视图共用，
 * 避免「接口能写进一个数据库里不存在的值」。
 */

/** 商品分类：二手闲置 / 维修队耗材。 */
export const ProductCategory = ["SECONDHAND", "CONSUMABLE"] as const;
export type ProductCategory = (typeof ProductCategory)[number];

/** 商品状态：在售 / 已下架。下架只阻止新订单，不影响已存在的订单。 */
export const ProductStatus = ["ON_SALE", "DELISTED"] as const;
export type ProductStatus = (typeof ProductStatus)[number];

/** 订单状态：待自提 / 已完成 / 已取消。 */
export const ShoppingOrderStatus = ["PENDING_PICKUP", "COMPLETED", "CANCELLED"] as const;
export type ShoppingOrderStatus = (typeof ShoppingOrderStatus)[number];

export const productCategoryLabels: Readonly<Record<ProductCategory, string>> = {
  SECONDHAND: "二手闲置",
  CONSUMABLE: "耗材",
};

export const productStatusLabels: Readonly<Record<ProductStatus, string>> = {
  ON_SALE: "在售",
  DELISTED: "已下架",
};

export const shoppingOrderStatusLabels: Readonly<Record<ShoppingOrderStatus, string>> = {
  PENDING_PICKUP: "待自提",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

export function isProductCategory(value: string): value is ProductCategory {
  return (ProductCategory as readonly string[]).includes(value);
}

export function isProductStatus(value: string): value is ProductStatus {
  return (ProductStatus as readonly string[]).includes(value);
}

export function isShoppingOrderStatus(value: string): value is ShoppingOrderStatus {
  return (ShoppingOrderStatus as readonly string[]).includes(value);
}
