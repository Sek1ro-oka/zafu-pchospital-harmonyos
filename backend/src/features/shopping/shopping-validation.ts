import { AppError } from "@/lib/api/errors";
import { isProductCategory } from "./shopping-types";

/** 字段上限，与 `prisma/schema.prisma` 的列长度和任务书约束对齐。 */
export const shoppingLimits = {
  titleMaxLength: 120,
  descriptionMaxLength: 5000,
  conditionMaxLength: 32,
  pickupNoteMaxLength: 255,
  delistReasonMaxLength: 255,
  cancelReasonMaxLength: 255,
  idempotencyKeyMaxLength: 80,
  maxPriceCents: 10_000_000,
  maxStock: 999,
  maxQuantity: 99,
  maxQueryLength: 60,
} as const;

export type ProductDraft = {
  title: string;
  description: string;
  priceCents: number;
  category: string;
  condition: string;
  stock: number;
  pickupNote?: string;
};

export type ProductPatch = Partial<Omit<ProductDraft, "pickupNote">> & {
  /** null 表示清空自提说明；undefined 表示本次不改。 */
  pickupNote?: string | null;
  /**
   * 库存基线：客户端加载商品时看到的 `stock`。只有本次传了 `stock` 才必填，
   * 服务端在事务内比较当前库存与该基线，不一致返回 409 `STOCK_CONFLICT`，
   * 防止编辑页的旧快照覆盖订单已经扣减/回补的库存。
   */
  stockBase?: number;
};

export type ShoppingOrderDraft = {
  productId: string;
  quantity: number;
  idempotencyKey: string;
};

function clean(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** 商品创建输入归一化：折叠多余空白；空的自提说明视为未填写。 */
export function normalizeProductDraft(input: ProductDraft): ProductDraft {
  const pickupNote = clean(input.pickupNote);
  return {
    title: clean(input.title),
    description: (input.description ?? "").trim(),
    priceCents: input.priceCents,
    category: input.category.trim().toUpperCase(),
    condition: clean(input.condition),
    stock: input.stock,
    pickupNote: pickupNote === "" ? undefined : pickupNote,
  };
}

function validatePrice(priceCents: number, errors: Record<string, string[]>): void {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0)
    errors.priceCents = ["价格必须是非负整数（单位：分）"];
  else if (priceCents > shoppingLimits.maxPriceCents)
    errors.priceCents = [`价格不能超过 ${shoppingLimits.maxPriceCents} 分`];
}

function validateStock(
  stock: number,
  category: string,
  errors: Record<string, string[]>,
  min = 0,
): void {
  if (category === "SECONDHAND") {
    // 二手是单件交易：库存固定 1，下单后归 0，取消回补到 1；
    // 编辑时允许保留 0（已售罄）或改回 1，但不允许大于 1。
    if (!Number.isSafeInteger(stock) || stock < min || stock > 1)
      errors.stock = [
        min === 1 ? "二手商品库存只能为 1（发布时固定单件）" : "二手商品库存只能是 0 或 1",
      ];
    return;
  }
  if (!Number.isSafeInteger(stock) || stock < min || stock > shoppingLimits.maxStock)
    errors.stock = [`库存必须是 ${min} 到 ${shoppingLimits.maxStock} 之间的整数`];
}

function validateCondition(
  condition: string,
  category: string,
  errors: Record<string, string[]>,
): void {
  // 耗材允许不填成色/规格（例如整箱打印纸只有型号）；二手必须描述成色。
  if (category !== "CONSUMABLE" && condition === "") {
    errors.condition = ["请填写成色或规格"];
    return;
  }
  if (condition.length > shoppingLimits.conditionMaxLength)
    errors.condition = [`成色/规格不能超过 ${shoppingLimits.conditionMaxLength} 字`];
}

function validateCategory(category: string, errors: Record<string, string[]>): void {
  if (!isProductCategory(category)) errors.category = ["category 必须是 SECONDHAND 或 CONSUMABLE"];
}

/**
 * 创建商品的完整校验。一次性收集全部字段错误，行为与报修单校验一致：
 * 客户端一次就能标出所有问题，而不是修一个报一个。
 */
export function validateProductDraft(input: ProductDraft): void {
  const errors: Record<string, string[]> = {};
  const limits = shoppingLimits;

  if (input.title === "") errors.title = ["请填写商品标题"];
  else if (input.title.length > limits.titleMaxLength)
    errors.title = [`标题不能超过 ${limits.titleMaxLength} 字`];

  if (input.description === "") errors.description = ["请填写商品描述"];
  else if (input.description.length > limits.descriptionMaxLength)
    errors.description = [`描述不能超过 ${limits.descriptionMaxLength} 字`];

  validatePrice(input.priceCents, errors);
  validateCategory(input.category, errors);

  validateCondition(input.condition, input.category, errors);
  validateStock(input.stock, input.category, errors, input.category === "CONSUMABLE" ? 0 : 1);

  if (input.pickupNote !== undefined && input.pickupNote.length > limits.pickupNoteMaxLength)
    errors.pickupNote = [`自提说明不能超过 ${limits.pickupNoteMaxLength} 字`];

  if (Object.keys(errors).length)
    throw new AppError("VALIDATION_FAILED", "商品信息填写不完整", { fieldErrors: errors });
}

/**
 * 更新输入归一化：只处理实际传入的字段；`pickupNote: null` 保留为 null（清空）。
 */
export function normalizeProductPatch(input: ProductPatch): ProductPatch {
  const patch: ProductPatch = {};
  if (input.title !== undefined) patch.title = clean(input.title);
  if (input.description !== undefined) patch.description = input.description.trim();
  if (input.priceCents !== undefined) patch.priceCents = input.priceCents;
  if (input.condition !== undefined) patch.condition = clean(input.condition);
  if (input.stock !== undefined) patch.stock = input.stock;
  if (input.stockBase !== undefined) patch.stockBase = input.stockBase;
  if (input.pickupNote !== undefined)
    patch.pickupNote =
      input.pickupNote === null ? null : clean(input.pickupNote) || null;
  return patch;
}

/**
 * 更新商品：只校验实际传入的字段。`category` 与 `status` 不在可改集合里
 * （分类决定权限链路，状态走独立的下架接口）。
 */
export function validateProductPatch(input: ProductPatch, category: string): void {
  const errors: Record<string, string[]> = {};
  const limits = shoppingLimits;

  if (input.title !== undefined) {
    if (input.title === "") errors.title = ["标题不能为空"];
    else if (input.title.length > limits.titleMaxLength)
      errors.title = [`标题不能超过 ${limits.titleMaxLength} 字`];
  }
  if (input.description !== undefined) {
    if (input.description === "") errors.description = ["描述不能为空"];
    else if (input.description.length > limits.descriptionMaxLength)
      errors.description = [`描述不能超过 ${limits.descriptionMaxLength} 字`];
  }
  if (input.priceCents !== undefined) validatePrice(input.priceCents, errors);
  if (input.condition !== undefined) validateCondition(input.condition, category, errors);
  // `stock` 缺省表示本次完全不动库存（编辑与订单扣减解耦，防旧快照覆盖）；
  // 传了 `stock` 就必须带客户端加载时看到的基线 `stockBase`，服务端在事务内比对。
  // 只传 `stockBase` 不传 `stock` 时忽略基线，库存不变。
  if (input.stock !== undefined) {
    validateStock(input.stock, category, errors);
    if (input.stockBase === undefined)
      errors.stockBase = ["修改库存必须同时提交 stockBase（加载时看到的库存）"];
    else if (!Number.isSafeInteger(input.stockBase) || input.stockBase < 0)
      errors.stockBase = ["stockBase 必须是不小于 0 的整数"];
  }
  if (typeof input.pickupNote === "string" && input.pickupNote.length > limits.pickupNoteMaxLength)
    errors.pickupNote = [`自提说明不能超过 ${limits.pickupNoteMaxLength} 字`];

  if (Object.keys(errors).length)
    throw new AppError("VALIDATION_FAILED", "商品信息填写不正确", { fieldErrors: errors });
}

/** 下单校验：数量为 1..99 的整数，幂等键必填且不超过 80 字。 */
export function normalizeAndValidateOrderDraft(input: ShoppingOrderDraft): ShoppingOrderDraft {
  const draft = {
    productId: input.productId.trim(),
    quantity: input.quantity,
    idempotencyKey: input.idempotencyKey.trim(),
  };
  const errors: Record<string, string[]> = {};
  if (draft.productId === "") errors.productId = ["请选择商品"];
  if (
    !Number.isSafeInteger(draft.quantity) ||
    draft.quantity < 1 ||
    draft.quantity > shoppingLimits.maxQuantity
  )
    errors.quantity = [`购买数量必须是 1 到 ${shoppingLimits.maxQuantity} 之间的整数`];
  if (draft.idempotencyKey === "") errors.idempotencyKey = ["缺少幂等键"];
  else if (draft.idempotencyKey.length > shoppingLimits.idempotencyKeyMaxLength)
    errors.idempotencyKey = [`幂等键不能超过 ${shoppingLimits.idempotencyKeyMaxLength} 字`];
  if (Object.keys(errors).length)
    throw new AppError("VALIDATION_FAILED", "下单信息填写不正确", { fieldErrors: errors });
  return draft;
}

/** 取消原因/下架原因：折叠空白，上限 255；空串归一为 undefined。 */
export function normalizeReason(value: string | undefined): string | undefined {
  const cleaned = clean(value);
  return cleaned === "" ? undefined : cleaned;
}

export function validateReason(
  reason: string | undefined,
  field: "cancelReason" | "reason",
  maxLength: number,
): void {
  if (reason !== undefined && reason.length > maxLength)
    throw new AppError("VALIDATION_FAILED", "原因过长", {
      fieldErrors: { [field]: [`不能超过 ${maxLength} 字`] },
    });
}
