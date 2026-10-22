import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../src/lib/api/errors";
import {
  assertCanCreateProduct,
  assertCanEditProduct,
  assertCanReadOrder,
  canManageConsumables,
} from "../../src/features/shopping/shopping-policy";
import {
  normalizeAndValidateOrderDraft,
  normalizeProductDraft,
  normalizeProductPatch,
  shoppingLimits,
  validateProductDraft,
  validateProductPatch,
} from "../../src/features/shopping/shopping-validation";
import { productListQuery } from "../../src/features/shopping/shopping-http";
import { orderActions, shoppingDisplayName } from "../../src/features/shopping/shopping-view";
import type { AuthorizedActor, Permission } from "../../src/types/contracts";

function actor(permissions: Permission[] = [], userId = "user-1"): AuthorizedActor {
  return {
    requestId: "test-request",
    actorType: "USER",
    userId,
    userStatus: "ACTIVE",
    permissions,
  };
}

function fieldErrors(error: unknown): Record<string, string[]> | undefined {
  return error instanceof AppError
    ? (error.fieldErrors as Record<string, string[]> | undefined)
    : undefined;
}

const validDraft = {
  title: "  二手自行车  ",
  description: " 骑了一年，车况良好 ",
  priceCents: 20_000,
  category: "secondhand",
  condition: " 九成新 ",
  stock: 1,
  pickupNote: "  东湖校区南门  ",
};

test("商品创建：归一化折叠空白、分类转大写", () => {
  const normalized = normalizeProductDraft(validDraft);
  assert.equal(normalized.title, "二手自行车");
  assert.equal(normalized.category, "SECONDHAND");
  assert.equal(normalized.condition, "九成新");
  assert.equal(normalized.pickupNote, "东湖校区南门");
  assert.doesNotThrow(() => validateProductDraft(normalized));
});

test("商品创建：缺字段时一次性收集全部 fieldErrors", () => {
  try {
    validateProductDraft(
      normalizeProductDraft({
        title: "",
        description: "",
        priceCents: -1,
        category: "BOGUS",
        condition: "",
        stock: 0,
      }),
    );
    assert.fail("应当抛出校验错误");
  } catch (error) {
    const errors = fieldErrors(error);
    assert.ok(errors);
    for (const field of ["title", "description", "priceCents", "category", "condition", "stock"])
      assert.ok(errors?.[field], `应报 ${field}`);
  }
});

test("商品创建：价格 0 表示赠送可接受，超过上限被拒", () => {
  assert.doesNotThrow(() =>
    validateProductDraft(normalizeProductDraft({ ...validDraft, priceCents: 0 })),
  );
  assert.throws(() =>
    validateProductDraft(
      normalizeProductDraft({ ...validDraft, priceCents: shoppingLimits.maxPriceCents + 1 }),
    ),
  );
});

test("商品创建：二手库存固定 1，耗材库存 0..999", () => {
  assert.doesNotThrow(() => validateProductDraft(normalizeProductDraft(validDraft)));
  assert.throws(
    () => validateProductDraft(normalizeProductDraft({ ...validDraft, stock: 0 })),
    (error: unknown) =>
      error instanceof AppError && Boolean(fieldErrors(error)?.stock),
  );
  assert.throws(
    () => validateProductDraft(normalizeProductDraft({ ...validDraft, stock: 2 })),
    (error: unknown) =>
      error instanceof AppError && Boolean(fieldErrors(error)?.stock),
  );
  const consumable = normalizeProductDraft({
    ...validDraft,
    category: "CONSUMABLE",
    condition: "",
    stock: 5,
  });
  assert.doesNotThrow(() => validateProductDraft(consumable), "耗材允许空成色和多件库存");
  assert.doesNotThrow(() =>
    validateProductDraft(normalizeProductDraft({ ...consumable, stock: 0 })),
  );
  assert.throws(() =>
    validateProductDraft(normalizeProductDraft({ ...consumable, stock: 1000 })),
  );
});

test("商品更新：二手库存只能是 0 或 1，耗材成色可清空", () => {
  assert.throws(() => validateProductPatch({ title: "" }, "SECONDHAND"));
  assert.throws(() =>
    validateProductPatch(
      { pickupNote: "x".repeat(shoppingLimits.pickupNoteMaxLength + 1) },
      "SECONDHAND",
    ),
  );
  assert.doesNotThrow(() =>
    validateProductPatch(normalizeProductPatch({ pickupNote: null }), "SECONDHAND"),
  );
  assert.doesNotThrow(() =>
    validateProductPatch(normalizeProductPatch({ stock: 0, stockBase: 1 }), "SECONDHAND"),
  );
  assert.doesNotThrow(() =>
    validateProductPatch(normalizeProductPatch({ stock: 1, stockBase: 0 }), "SECONDHAND"),
  );
  assert.throws(() =>
    validateProductPatch(normalizeProductPatch({ stock: 2, stockBase: 1 }), "SECONDHAND"),
  );
  assert.doesNotThrow(() =>
    validateProductPatch(normalizeProductPatch({ stock: 5, stockBase: 3 }), "CONSUMABLE"),
  );
  assert.doesNotThrow(() =>
    validateProductPatch(normalizeProductPatch({ condition: "" }), "CONSUMABLE"),
  );
  assert.deepEqual(normalizeProductPatch({ pickupNote: "   " }), { pickupNote: null });
});

test("商品更新：stock 可缺省（不动库存）；传 stock 必须带合法 stockBase", () => {
  // 不传 stock：其它字段照常校验，库存完全不动。
  assert.doesNotThrow(() =>
    validateProductPatch(normalizeProductPatch({ title: "只改标题" }), "SECONDHAND"),
  );
  assert.equal(normalizeProductPatch({ title: "只改标题" }).stock, undefined);

  // 传 stock 但缺 stockBase：报 stockBase 字段错误。
  assert.throws(
    () => validateProductPatch(normalizeProductPatch({ stock: 5 }), "CONSUMABLE"),
    (error: unknown) =>
      error instanceof AppError && Boolean(fieldErrors(error)?.stockBase),
  );
  // stockBase 非法：负数或非安全整数都被拒。
  assert.throws(
    () => validateProductPatch({ stock: 5, stockBase: -1 }, "CONSUMABLE"),
    (error: unknown) =>
      error instanceof AppError && Boolean(fieldErrors(error)?.stockBase),
  );
  assert.throws(
    () => validateProductPatch({ stock: 5, stockBase: 1.5 }, "CONSUMABLE"),
    (error: unknown) =>
      error instanceof AppError && Boolean(fieldErrors(error)?.stockBase),
  );
  // 合法组合通过，且归一化保留 stockBase。
  const normalized = normalizeProductPatch({ stock: 5, stockBase: 0 });
  assert.deepEqual(normalized, { stock: 5, stockBase: 0 });
  assert.doesNotThrow(() => validateProductPatch(normalized, "CONSUMABLE"));
  // 只传 stockBase 不传 stock：基线被忽略，不报错也不改库存。
  assert.doesNotThrow(() =>
    validateProductPatch(normalizeProductPatch({ title: "改标题", stockBase: 3 }), "CONSUMABLE"),
  );
});

test("下单校验：数量 1..99、幂等键必填且不超过 80 字", () => {
  assert.throws(() =>
    normalizeAndValidateOrderDraft({ productId: "p", quantity: 0, idempotencyKey: "k" }),
  );
  assert.throws(() =>
    normalizeAndValidateOrderDraft({ productId: "p", quantity: 100, idempotencyKey: "k" }),
  );
  assert.throws(() =>
    normalizeAndValidateOrderDraft({ productId: "p", quantity: 1, idempotencyKey: " " }),
  );
  assert.throws(() =>
    normalizeAndValidateOrderDraft({
      productId: "p",
      quantity: 1,
      idempotencyKey: "x".repeat(shoppingLimits.idempotencyKeyMaxLength + 1),
    }),
  );
  const parsed = normalizeAndValidateOrderDraft({
    productId: " p ",
    quantity: 2,
    idempotencyKey: " key ",
  });
  assert.deepEqual(parsed, { productId: "p", quantity: 2, idempotencyKey: "key" });
});

test("公开列表查询：非法分类/超长 q 被拒，合法分类转大写", () => {
  assert.throws(() =>
    productListQuery(new URLSearchParams({ category: "BOGUS" })),
  );
  assert.throws(() =>
    productListQuery(
      new URLSearchParams({ q: "x".repeat(shoppingLimits.maxQueryLength + 1) }),
    ),
  );
  const parsed = productListQuery(new URLSearchParams({ category: "consumable", q: "  硒鼓  " }));
  assert.deepEqual(parsed, { category: "CONSUMABLE", q: "硒鼓" });
});

test("卖家展示名：昵称优先，绝不回退到 realName", () => {
  assert.equal(
    shoppingDisplayName({
      id: "u1",
      displayName: "账号名",
      customerProfile: { nickname: "客户昵称" },
      memberProfile: { nickname: "成员昵称" },
      realName: "真实姓名",
    } as never),
    "客户昵称",
  );
  assert.equal(
    shoppingDisplayName({
      id: "u2",
      displayName: "账号名",
      customerProfile: null,
      memberProfile: { nickname: "成员昵称" },
      realName: "真实姓名",
    } as never),
    "成员昵称",
  );
  assert.equal(
    shoppingDisplayName({
      id: "u3",
      displayName: "账号名",
      customerProfile: null,
      memberProfile: null,
      realName: "真实姓名",
    } as never),
    "账号名",
  );
  assert.equal(
    shoppingDisplayName({
      id: "u4",
      displayName: null,
      customerProfile: null,
      memberProfile: { nickname: "  " },
      realName: "真实姓名",
    } as never),
    "校园用户",
  );
});

test("订单动作：待自提买卖双方可取消、仅卖家可完成；终态全不可用", () => {
  const buyer = actor([], "buyer-1");
  const seller = actor([], "seller-1");
  const pending = { buyerId: "buyer-1", sellerId: "seller-1", status: "PENDING_PICKUP" };
  assert.deepEqual(orderActions(buyer, pending), { canCancel: true, canComplete: false });
  assert.deepEqual(orderActions(seller, pending), { canCancel: true, canComplete: true });
  assert.deepEqual(orderActions(buyer, { ...pending, status: "COMPLETED" }), {
    canCancel: false,
    canComplete: false,
  });
  assert.deepEqual(orderActions(seller, { ...pending, status: "CANCELLED" }), {
    canCancel: false,
    canComplete: false,
  });
});

test("权限策略：耗材维护看权限码，非本人 403，下架商品 409，第三人订单 404", () => {
  assert.equal(canManageConsumables(actor()), false);
  assert.equal(canManageConsumables(actor(["shopping.consumable:manage"])), true);

  const consumer = actor();
  assert.throws(
    () => assertCanCreateProduct(consumer, "CONSUMABLE"),
    (error: unknown) => error instanceof AppError && error.code === "FORBIDDEN",
  );
  assert.doesNotThrow(() => assertCanCreateProduct(consumer, "SECONDHAND"));

  const product = { sellerId: "seller-1", category: "SECONDHAND", status: "ON_SALE" };
  assert.throws(
    () => assertCanEditProduct(actor([], "other"), product),
    (error: unknown) => error instanceof AppError && error.code === "FORBIDDEN",
  );
  assert.throws(
    () => assertCanEditProduct(actor([], "seller-1"), { ...product, status: "DELISTED" }),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_STATUS",
  );

  assert.throws(
    () => assertCanReadOrder(actor([], "third"), { buyerId: "b", sellerId: "s" }),
    (error: unknown) => error instanceof AppError && error.code === "ORDER_NOT_FOUND",
  );
  assert.doesNotThrow(() =>
    assertCanReadOrder(actor([], "buyer-1"), { buyerId: "buyer-1", sellerId: "seller-1" }),
  );
});
