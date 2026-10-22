import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { GET as listProductImagesContent } from "../../src/app/api/v1/shopping/product-images/[imageId]/content/route";
import {
  GET as getProduct,
  PATCH as patchProduct,
  POST as postProductOverride,
} from "../../src/app/api/v1/shopping/products/[id]/route";
import { POST as delistProduct } from "../../src/app/api/v1/shopping/products/[id]/delist/route";
import { POST as uploadProductImages } from "../../src/app/api/v1/shopping/products/[id]/images/route";
import {
  GET as listProducts,
  POST as createProduct,
} from "../../src/app/api/v1/shopping/products/route";
import { GET as getOrder } from "../../src/app/api/v1/shopping/orders/[id]/route";
import { POST as cancelOrder } from "../../src/app/api/v1/shopping/orders/[id]/cancel/route";
import { POST as completeOrder } from "../../src/app/api/v1/shopping/orders/[id]/complete/route";
import {
  GET as listOrders,
  POST as createOrder,
} from "../../src/app/api/v1/shopping/orders/route";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import { digestSessionToken } from "../../src/lib/security/secrets";
import type { RoleCode } from "../../src/types/contracts";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute, sameOriginHeaders } from "./http-harness";

/**
 * 选购（Issue #84）后端路由级集成测试，跑真实 MariaDB。
 *
 * 覆盖任务书要求的关键链路：
 * - 游客可读列表/详情/商品图，列表只出 ON_SALE、分页在 meta.pagination；
 * - 二手任何登录用户可发、耗材只允许授权工作人员；
 * - 卖家改/下架、管理员下架他人商品必须填原因、第三人写操作 403/404；
 * - 下单快照 + 条件扣库存、幂等重放不二次扣库存、自购/下架/缺货错误码；
 * - 买家/卖家两种订单视角、完成仅卖家、取消只回补一次、取消/完成竞争 409；
 * - 并发抢最后一件、并发同幂等键只落一单、并发同键不同商品 409；
 * - 编辑与下单/取消交错不覆盖库存、stockBase 冲突与二手订单锁定、POST 兼容入口。
 *
 * 夹具用户用固定 UUID，`before/after` 只清理本文件数据，避免影响其他集成文件。
 */
const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

const SELLER_ID = "b1000000-0000-4000-8000-000000000084";
const BUYER_ID = "b2000000-0000-4000-8000-000000000084";
const THIRD_ID = "b3000000-0000-4000-8000-000000000084";
const STAFF_ID = "b4000000-0000-4000-8000-000000000084";
const ADMIN_ID = "b5000000-0000-4000-8000-000000000084";
const USER_IDS = [SELLER_ID, BUYER_ID, THIRD_ID, STAFF_ID, ADMIN_ID];

type Json = Record<string, unknown>;
type Envelope = {
  success?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]> };
  meta?: { pagination?: { page?: number; pageSize?: number; total?: number; totalPages?: number } };
};

function dataOf(json: Json): Json {
  return ((json as Envelope).data ?? {}) as Json;
}

function listOf(json: Json): Json[] {
  const data = (json as Envelope).data;
  assert.ok(Array.isArray(data), "列表 data 应为数组");
  return data as Json[];
}

function errorCode(json: Json): string | undefined {
  return (json as Envelope).error?.code;
}

async function cleanup(): Promise<void> {
  const db = getDb();
  // 先删子表：订单/图片 → 商品 → 角色/会话 → 用户，满足 FK RESTRICT。
  await db.shoppingOrder.deleteMany({
    where: { OR: [{ buyerId: { in: USER_IDS } }, { sellerId: { in: USER_IDS } }] },
  });
  await db.productImage.deleteMany({ where: { product: { sellerId: { in: USER_IDS } } } });
  await db.product.deleteMany({ where: { sellerId: { in: USER_IDS } } });
  await db.authSession.deleteMany({ where: { userId: { in: USER_IDS } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: USER_IDS } } });
  await db.userRole.deleteMany({ where: { userId: { in: USER_IDS } } });
  await db.memberProfile.deleteMany({ where: { userId: { in: USER_IDS } } });
  await db.user.deleteMany({ where: { id: { in: USER_IDS } } });
}

before(async () => {
  if (!enabled) return;
  await cleanup();
  const db = getDb();
  const now = new Date();
  for (const [id, displayName] of [
    [SELLER_ID, "卖家同学"],
    [BUYER_ID, "买家同学"],
    [THIRD_ID, "路人同学"],
    [STAFF_ID, "工作人员"],
    [ADMIN_ID, "管理员"],
  ] as const) {
    await db.user.create({
      data: { id, status: "ACTIVE", displayName, createdAt: now, updatedAt: now },
    });
  }
  await grantRole(STAFF_ID, "MEMBER");
  await grantRole(ADMIN_ID, "ADMIN");
  // 有 MEMBER 角色的账号必须有 ACTIVE 成员档案，否则鉴权按「成员身份不可用」403。
  // ADMIN 不受这条限制，但一并给出更接近真实账号。
  for (const userId of [STAFF_ID, ADMIN_ID]) {
    await db.memberProfile.create({
      data: {
        id: randomUUID(),
        userId,
        realName: userId === STAFF_ID ? "工作人员" : "管理员",
        nickname: userId === STAFF_ID ? "工作人员" : "管理员",
        status: "ACTIVE",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
});

after(async () => {
  if (!enabled) return;
  await cleanup();
  await disconnectDb();
});

async function grantRole(userId: string, code: RoleCode): Promise<void> {
  const db = getDb();
  const role = await db.role.findUnique({ where: { code } });
  if (!role) throw new Error(`角色 ${code} 不存在，先跑 db:seed:test`);
  const now = new Date();
  await db.userRole.create({
    data: {
      id: randomUUID(),
      userId,
      roleId: role.id,
      sourceType: "ADMIN_CREATED",
      sourceId: userId,
      grantedAt: now,
      activeKey: `${userId}:${role.id}`,
    },
  });
}

/** Bearer 会话（原生通道）：写接口要求 `x-client-type: native`。 */
async function bearerFor(userId: string): Promise<Record<string, string>> {
  const db = getDb();
  const now = new Date();
  const raw = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  await db.passwordCredential.upsert({
    where: { userId },
    update: { mustChangePassword: false, passwordChangedAt: now },
    create: {
      userId,
      passwordHash: "integration-placeholder-hash",
      mustChangePassword: false,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.authSession.create({
    data: {
      id: randomUUID(),
      userId,
      tokenDigest: digestSessionToken(raw),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    },
  });
  return { authorization: `Bearer ${raw}`, "x-client-type": "native" };
}

function productBody(overrides: Json = {}): Json {
  return {
    title: `测试商品-${randomUUID()}`,
    description: "集成测试用商品描述",
    priceCents: 12_345,
    category: "SECONDHAND",
    condition: "九成新",
    stock: 1,
    ...overrides,
  };
}

async function createProductAs(
  headers: Record<string, string>,
  overrides: Json = {},
): Promise<Json> {
  const response = await callRoute(createProduct, "http://localhost/api/v1/shopping/products", {
    method: "POST",
    headers,
    body: productBody(overrides),
  });
  assert.equal(response.status, 201, `发布商品应成功，实际 ${response.status}`);
  return dataOf(response.json);
}

async function uploadImages(
  headers: Record<string, string>,
  productId: string,
  files: Array<{ bytes: Uint8Array; type: string; name: string }>,
): Promise<{ status: number; json: Json }> {
  const form = new FormData();
  for (const file of files)
    form.append("photos", new File([file.bytes], file.name, { type: file.type }));
  const request = new Request(
    `http://localhost/api/v1/shopping/products/${productId}/images`,
    {
      method: "POST",
      headers: { ...sameOriginHeaders(), ...headers },
      body: form,
    },
  );
  const response = await uploadProductImages(request, {
    params: Promise.resolve({ id: productId }),
  });
  return { status: response.status, json: (await response.json()) as Json };
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function orderBody(productId: string, quantity = 1, idempotencyKey = randomUUID()): Json {
  return { productId, quantity, idempotencyKey };
}

async function placeOrder(
  headers: Record<string, string>,
  productId: string,
  quantity = 1,
  idempotencyKey = randomUUID(),
) {
  return callRoute(createOrder, "http://localhost/api/v1/shopping/orders", {
    method: "POST",
    headers,
    body: orderBody(productId, quantity, idempotencyKey),
  });
}

dbTest("游客可读：列表只出在售、分页在 meta；已下架详情仍可读", async () => {
  const seller = await bearerFor(SELLER_ID);
  const q = `公开列表-${randomUUID()}`;
  const onSale = await createProductAs(seller, { title: `${q}-在售` });
  const toDelist = await createProductAs(seller, { title: `${q}-下架` });

  // 下架后，公开列表按 q 搜索只应看到在售那件。
  const delisted = await callRoute(
    delistProduct,
    `http://localhost/api/v1/shopping/products/${toDelist.id}/delist`,
    { method: "POST", headers: seller, params: { id: toDelist.id as string } },
  );
  assert.equal(delisted.status, 200);

  const list = await callRoute(
    listProducts,
    `http://localhost/api/v1/shopping/products?q=${encodeURIComponent(q)}&page=1&pageSize=1`,
  );
  assert.equal(list.status, 200, "游客列表不应要求登录");
  const items = listOf(list.json);
  assert.equal(items.length, 1, "pageSize=1 只返回一条");
  assert.equal(items[0].id, onSale.id);
  assert.equal(items[0].status, "ON_SALE");
  const pagination = (list.json as Envelope).meta?.pagination;
  assert.ok(pagination, "列表必须带 meta.pagination");
  assert.equal(pagination?.page, 1);
  assert.equal(pagination?.pageSize, 1);
  assert.ok((pagination?.total ?? 0) >= 1);
  assert.ok((pagination?.totalPages ?? 0) >= 1);

  const detail = await callRoute(
    getProduct,
    `http://localhost/api/v1/shopping/products/${toDelist.id}`,
    { params: { id: toDelist.id as string } },
  );
  assert.equal(detail.status, 200, "已下架商品详情仍应可读");
  assert.equal(dataOf(detail.json).status, "DELISTED");

  const missing = await callRoute(
    getProduct,
    `http://localhost/api/v1/shopping/products/${randomUUID()}`,
    { params: { id: randomUUID() } },
  );
  assert.equal(missing.status, 404);
  assert.equal(errorCode(missing.json), "PRODUCT_NOT_FOUND");
});

dbTest("发布权限：二手任何登录用户可发；耗材仅工作人员；sellerId 取登录态", async () => {
  const seller = await bearerFor(SELLER_ID);
  const staff = await bearerFor(STAFF_ID);

  const secondhand = await callRoute(
    createProduct,
    "http://localhost/api/v1/shopping/products",
    {
      method: "POST",
      headers: seller,
      // 客户端伪造 sellerId 必须被忽略。
      body: productBody({ category: "SECONDHAND", sellerId: ADMIN_ID }),
    },
  );
  assert.equal(secondhand.status, 201);
  const created = dataOf(secondhand.json);
  assert.equal((created.seller as Json).id, SELLER_ID, "sellerId 必须来自登录态");
  assert.equal(created.actions && (created.actions as Json).canEdit, true);
  assert.equal(created.stock, 1, "二手发布缺省库存固定为 1");

  const secondhandStock = await callRoute(
    createProduct,
    "http://localhost/api/v1/shopping/products",
    {
      method: "POST",
      headers: seller,
      body: productBody({ stock: 5 }),
    },
  );
  assert.equal(secondhandStock.status, 400, "二手商品库存不得大于 1");
  assert.equal(errorCode(secondhandStock.json), "VALIDATION_FAILED");
  const stockFieldErrors = (secondhandStock.json as Envelope).error?.fieldErrors;
  assert.ok(stockFieldErrors?.stock, "应在 stock 字段上返回错误");

  const deniedConsumable = await callRoute(
    createProduct,
    "http://localhost/api/v1/shopping/products",
    {
      method: "POST",
      headers: seller,
      body: productBody({ category: "CONSUMABLE" }),
    },
  );
  assert.equal(deniedConsumable.status, 403, "普通用户不得发布耗材");
  assert.equal(errorCode(deniedConsumable.json), "FORBIDDEN");

  const allowedConsumable = await callRoute(
    createProduct,
    "http://localhost/api/v1/shopping/products",
    {
      method: "POST",
      headers: staff,
      body: productBody({ category: "CONSUMABLE", title: "耗材-硒鼓" }),
    },
  );
  assert.equal(
    allowedConsumable.status,
    201,
    `工作人员可以发布耗材：${JSON.stringify(allowedConsumable.json)}`,
  );

  const anonymous = await callRoute(
    createProduct,
    "http://localhost/api/v1/shopping/products",
    { method: "POST", headers: { ...sameOriginHeaders(), "x-client-type": "native" }, body: productBody() },
  );
  assert.equal(anonymous.status, 401, "游客不能发布商品");
});

dbTest("耗材：成色可空、库存可多件，下单扣减后取消回补", async () => {
  const staff = await bearerFor(STAFF_ID);
  const buyer = await bearerFor(BUYER_ID);
  const product = await createProductAs(staff, {
    category: "CONSUMABLE",
    title: "耗材-打印纸",
    condition: "",
    stock: 5,
  });
  const productId = product.id as string;
  assert.equal(product.stock, 5);
  assert.equal(product.condition, "", "耗材允许不填成色/规格");

  const created = await placeOrder(buyer, productId, 2);
  assert.equal(created.status, 201);
  assert.equal(dataOf(created.json).totalCents, 24_690);
  assert.equal((await getDb().product.findUnique({ where: { id: productId } }))?.stock, 3);

  const orderId = dataOf(created.json).id as string;
  const cancelled = await callRoute(
    cancelOrder,
    `http://localhost/api/v1/shopping/orders/${orderId}/cancel`,
    { method: "POST", headers: buyer, params: { id: orderId } },
  );
  assert.equal(cancelled.status, 200);
  assert.equal((await getDb().product.findUnique({ where: { id: productId } }))?.stock, 5);
});

dbTest("修改与下架：本人 / 管理员边界；已下架不可改；管理员下架需原因", async () => {
  const seller = await bearerFor(SELLER_ID);
  const buyer = await bearerFor(BUYER_ID);
  const admin = await bearerFor(ADMIN_ID);
  const product = await createProductAs(seller, { category: "SECONDHAND" });
  const id = product.id as string;

  const byBuyer = await callRoute(patchProduct, `http://localhost/api/v1/shopping/products/${id}`, {
    method: "PATCH",
    headers: buyer,
    params: { id },
    body: { title: "被别人改掉" },
  });
  assert.equal(byBuyer.status, 403, "非本人不能修改商品");

  const bySeller = await callRoute(patchProduct, `http://localhost/api/v1/shopping/products/${id}`, {
    method: "PATCH",
    headers: seller,
    params: { id },
    body: { title: "卖家改后的标题", priceCents: 999, category: "CONSUMABLE" },
  });
  assert.equal(bySeller.status, 200);
  const updated = dataOf(bySeller.json);
  assert.equal(updated.title, "卖家改后的标题");
  assert.equal(updated.priceCents, 999);
  assert.equal(updated.category, "SECONDHAND", "category 不在可改字段内，应保持原值");

  const buyDelist = await callRoute(
    delistProduct,
    `http://localhost/api/v1/shopping/products/${id}/delist`,
    { method: "POST", headers: buyer, params: { id } },
  );
  assert.equal(buyDelist.status, 403, "非本人且非管理员不能下架");

  const ownerDelist = await callRoute(
    delistProduct,
    `http://localhost/api/v1/shopping/products/${id}/delist`,
    { method: "POST", headers: seller, params: { id } },
  );
  assert.equal(ownerDelist.status, 200, "本人下架可以不填原因");
  assert.equal(dataOf(ownerDelist.json).status, "DELISTED");

  const editAfterDelist = await callRoute(
    patchProduct,
    `http://localhost/api/v1/shopping/products/${id}`,
    { method: "PATCH", headers: seller, params: { id }, body: { title: "下架后还改" } },
  );
  assert.equal(editAfterDelist.status, 409, "已下架商品不可修改");
  assert.equal(errorCode(editAfterDelist.json), "INVALID_STATUS");

  const other = await createProductAs(seller, { title: "管理员要下架的商品" });
  const otherId = other.id as string;
  const noReason = await callRoute(
    delistProduct,
    `http://localhost/api/v1/shopping/products/${otherId}/delist`,
    { method: "POST", headers: admin, params: { id: otherId } },
  );
  assert.equal(noReason.status, 400, "管理员下架他人商品必须填原因");
  assert.equal(errorCode(noReason.json), "VALIDATION_FAILED");

  const withReason = await callRoute(
    delistProduct,
    `http://localhost/api/v1/shopping/products/${otherId}/delist`,
    {
      method: "POST",
      headers: admin,
      params: { id: otherId },
      body: { reason: "信息不实，管理员下架" },
    },
  );
  assert.equal(withReason.status, 200, "管理员带原因可以下架他人商品");
  const delistedView = dataOf(withReason.json);
  assert.equal(delistedView.status, "DELISTED");
  assert.equal(delistedView.delistReason, "信息不实，管理员下架");

  const adminOwn = await createProductAs(admin, { title: "管理员自己的商品" });
  const adminOwnId = adminOwn.id as string;
  const adminOwnNoReason = await callRoute(
    delistProduct,
    `http://localhost/api/v1/shopping/products/${adminOwnId}/delist`,
    { method: "POST", headers: admin, params: { id: adminOwnId } },
  );
  assert.equal(adminOwnNoReason.status, 400, "管理员下架自己的商品也必须填原因");
  assert.equal(errorCode(adminOwnNoReason.json), "VALIDATION_FAILED");

  const adminOwnWithReason = await callRoute(
    delistProduct,
    `http://localhost/api/v1/shopping/products/${adminOwnId}/delist`,
    {
      method: "POST",
      headers: admin,
      params: { id: adminOwnId },
      body: { reason: "管理员本人下架" },
    },
  );
  assert.equal(adminOwnWithReason.status, 200);
});

dbTest("商品图：本人可传、游客可读、类型/张数受限、非本人 403", async () => {
  const seller = await bearerFor(SELLER_ID);
  const buyer = await bearerFor(BUYER_ID);
  const product = await createProductAs(seller, { title: "带图商品" });
  const id = product.id as string;

  const uploaded = await uploadImages(seller, id, [
    { bytes: PNG_BYTES, type: "image/png", name: "cover.png" },
    { bytes: PNG_BYTES, type: "image/png", name: "detail.png" },
  ]);
  assert.equal(uploaded.status, 201, `上传图片应成功，实际 ${uploaded.status}`);
  const images = dataOf(uploaded.json) as unknown as Json[];
  assert.equal(images.length, 2);

  const imageId = images[0].id as string;
  // 直接调用公开内容路由（返回二进制，不能走 callRoute 的 JSON 解析）。
  const contentResponse = await listProductImagesContent(
    new Request(`http://localhost/api/v1/shopping/product-images/${imageId}/content`),
    { params: Promise.resolve({ imageId }) },
  );
  assert.equal(contentResponse.status, 200, "游客应能读取商品图");
  assert.equal(contentResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(contentResponse.headers.get("content-type"), "image/png");
  const bytes = new Uint8Array(await contentResponse.arrayBuffer());
  assert.equal(bytes.byteLength, PNG_BYTES.byteLength);

  const forbidden = await uploadImages(buyer, id, [
    { bytes: PNG_BYTES, type: "image/png", name: "hijack.png" },
  ]);
  assert.equal(forbidden.status, 403, "非本人不能上传商品图");

  const badType = await uploadImages(seller, id, [
    { bytes: new Uint8Array([1, 2, 3, 4]), type: "image/png", name: "fake.png" },
  ]);
  assert.equal(badType.status, 415, "魔数与声明类型不符应拒绝");
  assert.equal(errorCode(badType.json), "PRODUCT_IMAGE_TYPE_UNSUPPORTED");

  const tooMany = await createProductAs(seller, { title: "图片超限商品" });
  const nine = Array.from({ length: 10 }, (_, index) => ({
    bytes: PNG_BYTES,
    type: "image/png",
    name: `${index}.png`,
  }));
  const overLimit = await uploadImages(seller, tooMany.id as string, nine);
  assert.equal(overLimit.status, 400, "超过单商品张数上限应拒绝");
  assert.equal(errorCode(overLimit.json), "PRODUCT_IMAGE_LIMIT_EXCEEDED");
});

dbTest("商品图配额并发：8 张基础上两个并发各传 1 张，只一个成功、最终 9 张、无孤儿行", async () => {
  const seller = await bearerFor(SELLER_ID);
  const product = await createProductAs(seller, { title: "图片配额并发商品" });
  const id = product.id as string;

  // 先铺满到 8 张（上限 9），为并发留出恰好 1 个名额。
  const seed = await uploadImages(
    seller,
    id,
    Array.from({ length: 8 }, (_, index) => ({
      bytes: PNG_BYTES,
      type: "image/png",
      name: `${index}.png`,
    })),
  );
  assert.equal(seed.status, 201, `预铺 8 张应成功，实际 ${seed.status}`);
  assert.equal(
    await getDb().productImage.count({ where: { productId: id, deletedAt: null } }),
    8,
  );

  // 两个并发请求各传 1 张：事务外预检查都会读到 8 并通过，必须由建行事务内复核拦截其一。
  const [first, second] = await Promise.all([
    uploadImages(seller, id, [{ bytes: PNG_BYTES, type: "image/png", name: "a.png" }]),
    uploadImages(seller, id, [{ bytes: PNG_BYTES, type: "image/png", name: "b.png" }]),
  ]);
  const statuses = [first.status, second.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 400], `应一成一超限，实际 ${statuses.join("/")}`);
  const failed = first.status === 400 ? first : second;
  assert.equal(errorCode(failed.json), "PRODUCT_IMAGE_LIMIT_EXCEEDED");

  // 最终有效图片恰好 9 张，失败方不得留下任何数据库行（含软删），配额不被绕过。
  assert.equal(
    await getDb().productImage.count({ where: { productId: id, deletedAt: null } }),
    9,
    "并发后有效图片必须恰好 9 张（不得 8→10）",
  );
  assert.equal(
    await getDb().productImage.count({ where: { productId: id } }),
    9,
    "失败方不得留下孤儿数据库行",
  );
});

dbTest("下单成功：扣库存、写快照；买家/卖家列表与完成链路", async () => {
  const seller = await bearerFor(SELLER_ID);
  const buyer = await bearerFor(BUYER_ID);
  const third = await bearerFor(THIRD_ID);
  const product = await createProductAs(seller, {
    title: "下单主流程商品",
    priceCents: 12_345,
  });
  const productId = product.id as string;

  const created = await placeOrder(buyer, productId, 1);
  assert.equal(created.status, 201, `下单应成功，实际 ${created.status}`);
  const order = dataOf(created.json);
  const orderId = order.id as string;
  assert.equal(order.status, "PENDING_PICKUP");
  assert.equal(order.quantity, 1);
  assert.equal(order.unitPriceCents, 12_345);
  assert.equal(order.totalCents, 12_345);
  assert.equal(order.titleSnapshot, "下单主流程商品");
  assert.equal((order.buyer as Json).id, BUYER_ID);
  assert.equal((order.seller as Json).id, SELLER_ID);
  assert.equal((order.actions as Json).canCancel, true);
  assert.equal((order.actions as Json).canComplete, false);

  const stock = await getDb().product.findUnique({ where: { id: productId } });
  assert.equal(stock?.stock, 0, "二手下单后库存应为 0");

  const buyerList = await callRoute(
    listOrders,
    "http://localhost/api/v1/shopping/orders?role=buyer&pageSize=100",
    { headers: buyer },
  );
  assert.equal(buyerList.status, 200);
  assert.ok(listOf(buyerList.json).some((item) => item.id === orderId), "买家列表应看到订单");

  const sellerList = await callRoute(
    listOrders,
    "http://localhost/api/v1/shopping/orders?role=seller&pageSize=100",
    { headers: seller },
  );
  assert.equal(sellerList.status, 200);
  assert.ok(listOf(sellerList.json).some((item) => item.id === orderId), "卖家列表应看到订单");

  const byThird = await callRoute(
    getOrder,
    `http://localhost/api/v1/shopping/orders/${orderId}`,
    { headers: third, params: { id: orderId } },
  );
  assert.equal(byThird.status, 404, "第三人查订单应 404");
  assert.equal(errorCode(byThird.json), "ORDER_NOT_FOUND");

  const byBuyerComplete = await callRoute(
    completeOrder,
    `http://localhost/api/v1/shopping/orders/${orderId}/complete`,
    { method: "POST", headers: buyer, params: { id: orderId } },
  );
  assert.equal(byBuyerComplete.status, 403, "只有卖家能确认完成");

  const completed = await callRoute(
    completeOrder,
    `http://localhost/api/v1/shopping/orders/${orderId}/complete`,
    { method: "POST", headers: seller, params: { id: orderId } },
  );
  assert.equal(completed.status, 200);
  assert.equal(dataOf(completed.json).status, "COMPLETED");
  assert.ok(dataOf(completed.json).completedAt, "完成时间应写入");
  assert.equal((dataOf(completed.json).actions as Json).canCancel, false);

  const repeat = await callRoute(
    completeOrder,
    `http://localhost/api/v1/shopping/orders/${orderId}/complete`,
    { method: "POST", headers: seller, params: { id: orderId } },
  );
  assert.equal(repeat.status, 200, "重复完成应幂等返回");
  assert.equal(dataOf(repeat.json).status, "COMPLETED");

  const buyerDetail = await callRoute(
    getOrder,
    `http://localhost/api/v1/shopping/orders/${orderId}`,
    { headers: buyer, params: { id: orderId } },
  );
  assert.equal(buyerDetail.status, 200);
  assert.equal(dataOf(buyerDetail.json).status, "COMPLETED");

  const cancelCompleted = await callRoute(
    cancelOrder,
    `http://localhost/api/v1/shopping/orders/${orderId}/cancel`,
    { method: "POST", headers: buyer, params: { id: orderId } },
  );
  assert.equal(cancelCompleted.status, 409, "已完成订单不能取消");
  assert.equal(errorCode(cancelCompleted.json), "INVALID_STATUS");
});

dbTest("幂等：同键重试返回原单且不二次扣库存；同键换参数 409", async () => {
  const seller = await bearerFor(SELLER_ID);
  const buyer = await bearerFor(BUYER_ID);
  const product = await createProductAs(seller, { title: "幂等商品" });
  const productId = product.id as string;
  const key = `idem-${randomUUID()}`;

  const first = await placeOrder(buyer, productId, 1, key);
  assert.equal(first.status, 201);
  const firstId = dataOf(first.json).id;
  const afterFirst = await getDb().product.findUnique({ where: { id: productId } });
  assert.equal(afterFirst?.stock, 0);

  const replay = await placeOrder(buyer, productId, 1, key);
  assert.equal(replay.status, 201, "重试应返回原单而不是冲突");
  assert.equal(dataOf(replay.json).id, firstId);
  const afterReplay = await getDb().product.findUnique({ where: { id: productId } });
  assert.equal(afterReplay?.stock, 0, "重试不得再次扣库存");

  const conflict = await placeOrder(buyer, productId, 2, key);
  assert.equal(conflict.status, 409, "同键换数量应 409");
  assert.equal(errorCode(conflict.json), "IDEMPOTENCY_CONFLICT");
});

dbTest("下单拒绝：自购、缺货、已下架、商品不存在", async () => {
  const seller = await bearerFor(SELLER_ID);
  const buyer = await bearerFor(BUYER_ID);
  const product = await createProductAs(seller, { title: "错误分支商品" });
  const productId = product.id as string;

  const selfBuy = await placeOrder(seller, productId, 1);
  assert.equal(selfBuy.status, 400);
  assert.equal(errorCode(selfBuy.json), "SELF_PURCHASE");

  const outOfStock = await placeOrder(buyer, productId, 99);
  assert.equal(outOfStock.status, 409);
  assert.equal(errorCode(outOfStock.json), "OUT_OF_STOCK");

  const delisted = await callRoute(
    delistProduct,
    `http://localhost/api/v1/shopping/products/${productId}/delist`,
    { method: "POST", headers: seller, params: { id: productId } },
  );
  assert.equal(delisted.status, 200);
  const buyDelisted = await placeOrder(buyer, productId, 1);
  assert.equal(buyDelisted.status, 409);
  assert.equal(errorCode(buyDelisted.json), "PRODUCT_DELISTED");

  const missing = await placeOrder(buyer, randomUUID(), 1);
  assert.equal(missing.status, 404);
  assert.equal(errorCode(missing.json), "PRODUCT_NOT_FOUND");
});

dbTest("取消：买家免原因、只回补一次；卖家必须原因；下架商品不被复活", async () => {
  const seller = await bearerFor(SELLER_ID);
  const buyer = await bearerFor(BUYER_ID);
  const product = await createProductAs(seller, { title: "取消商品" });
  const productId = product.id as string;

  const created = await placeOrder(buyer, productId, 1);
  const orderId = dataOf(created.json).id as string;
  assert.equal((await getDb().product.findUnique({ where: { id: productId } }))?.stock, 0);

  const cancelled = await callRoute(
    cancelOrder,
    `http://localhost/api/v1/shopping/orders/${orderId}/cancel`,
    { method: "POST", headers: buyer, params: { id: orderId } },
  );
  assert.equal(cancelled.status, 200);
  assert.equal(dataOf(cancelled.json).status, "CANCELLED");
  assert.equal(dataOf(cancelled.json).cancelReason, null, "买家取消可以不填原因");
  assert.equal((await getDb().product.findUnique({ where: { id: productId } }))?.stock, 1);

  const repeat = await callRoute(
    cancelOrder,
    `http://localhost/api/v1/shopping/orders/${orderId}/cancel`,
    { method: "POST", headers: buyer, params: { id: orderId } },
  );
  assert.equal(repeat.status, 409, "重复取消应 409，而不是幂等 200");
  assert.equal(errorCode(repeat.json), "INVALID_STATUS");
  assert.equal((await getDb().product.findUnique({ where: { id: productId } }))?.stock, 1);

  // 卖家取消必须说明原因。
  const sellerOrder = await placeOrder(buyer, productId, 1);
  const sellerOrderId = dataOf(sellerOrder.json).id as string;
  const noReason = await callRoute(
    cancelOrder,
    `http://localhost/api/v1/shopping/orders/${sellerOrderId}/cancel`,
    { method: "POST", headers: seller, params: { id: sellerOrderId } },
  );
  assert.equal(noReason.status, 400, "卖家取消必须填原因");
  assert.equal(errorCode(noReason.json), "VALIDATION_FAILED");

  const withReason = await callRoute(
    cancelOrder,
    `http://localhost/api/v1/shopping/orders/${sellerOrderId}/cancel`,
    {
      method: "POST",
      headers: seller,
      params: { id: sellerOrderId },
      body: { reason: "商品临时有瑕疵" },
    },
  );
  assert.equal(withReason.status, 200);
  assert.equal(dataOf(withReason.json).cancelReason, "商品临时有瑕疵");

  // 已下架商品取消订单：库存回补，但 status 不得从 DELISTED 变回 ON_SALE。
  const delistProductRow = await createProductAs(seller, { title: "下架后取消" });
  const delistId = delistProductRow.id as string;
  const orderOnDelisted = await placeOrder(buyer, delistId, 1);
  const orderOnDelistedId = dataOf(orderOnDelisted.json).id as string;
  await callRoute(delistProduct, `http://localhost/api/v1/shopping/products/${delistId}/delist`, {
    method: "POST",
    headers: seller,
    params: { id: delistId },
  });
  const cancelOnDelisted = await callRoute(
    cancelOrder,
    `http://localhost/api/v1/shopping/orders/${orderOnDelistedId}/cancel`,
    { method: "POST", headers: buyer, params: { id: orderOnDelistedId } },
  );
  assert.equal(cancelOnDelisted.status, 200);
  const delistedRow = await getDb().product.findUnique({ where: { id: delistId } });
  assert.equal(delistedRow?.status, "DELISTED", "取消订单不得把下架商品复活");
  assert.equal(delistedRow?.stock, 1, "库存仍应回补到 1");
});

dbTest("取消/完成竞争：同一订单只有一方成功，另一方 409", async () => {
  const seller = await bearerFor(SELLER_ID);
  const buyer = await bearerFor(BUYER_ID);
  const product = await createProductAs(seller, { title: "竞争商品", stock: 1 });
  const productId = product.id as string;
  const created = await placeOrder(buyer, productId, 1);
  const orderId = dataOf(created.json).id as string;

  const [cancelResult, completeResult] = await Promise.all([
    callRoute(cancelOrder, `http://localhost/api/v1/shopping/orders/${orderId}/cancel`, {
      method: "POST",
      headers: buyer,
      params: { id: orderId },
    }),
    callRoute(completeOrder, `http://localhost/api/v1/shopping/orders/${orderId}/complete`, {
      method: "POST",
      headers: seller,
      params: { id: orderId },
    }),
  ]);

  const statuses = [cancelResult.status, completeResult.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409], `应一方成功一方 409，实际 ${statuses.join("/")}`);

  const finalOrder = await getDb().shoppingOrder.findUnique({ where: { id: orderId } });
  const finalProduct = await getDb().product.findUnique({ where: { id: productId } });
  assert.ok(finalOrder);
  if (finalOrder.status === "CANCELLED") {
    assert.equal(finalProduct?.stock, 1, "取消成功后库存回补");
  } else {
    assert.equal(finalOrder.status, "COMPLETED");
    assert.equal(finalProduct?.stock, 0, "完成后库存不恢复");
  }
});

dbTest("并发抢最后一件：只有一个买家成功，另一个 OUT_OF_STOCK", async () => {
  const seller = await bearerFor(SELLER_ID);
  const buyer = await bearerFor(BUYER_ID);
  const third = await bearerFor(THIRD_ID);
  const product = await createProductAs(seller, { title: "最后一件", stock: 1 });
  const productId = product.id as string;

  const [first, second] = await Promise.all([
    placeOrder(buyer, productId, 1),
    placeOrder(third, productId, 1),
  ]);
  const statuses = [first.status, second.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 409], `应一成一败，实际 ${statuses.join("/")}`);
  const failed = first.status === 409 ? first : second;
  assert.equal(errorCode(failed.json), "OUT_OF_STOCK");

  const row = await getDb().product.findUnique({ where: { id: productId } });
  assert.equal(row?.stock, 0, "库存不得为负");
  assert.equal(await getDb().shoppingOrder.count({ where: { productId } }), 1);
});

dbTest("并发同幂等键：两次请求只落一单、只扣一次库存", async () => {
  const seller = await bearerFor(SELLER_ID);
  const buyer = await bearerFor(BUYER_ID);
  const product = await createProductAs(seller, { title: "并发幂等商品" });
  const productId = product.id as string;
  const key = `race-${randomUUID()}`;

  const [first, second] = await Promise.all([
    placeOrder(buyer, productId, 1, key),
    placeOrder(buyer, productId, 1, key),
  ]);
  assert.equal(first.status, 201, `第一次应 201，实际 ${first.status}`);
  assert.equal(second.status, 201, `重复请求应 201，实际 ${second.status}`);
  assert.equal(dataOf(first.json).id, dataOf(second.json).id, "两次应返回同一张单");

  const row = await getDb().product.findUnique({ where: { id: productId } });
  assert.equal(row?.stock, 0, "并发重试只能扣一次库存");
  assert.equal(await getDb().shoppingOrder.count({ where: { productId } }), 1);
});

dbTest("编辑与下单/取消交错：不传 stock 的编辑不覆盖订单扣减，取消不翻倍", async () => {
  const seller = await bearerFor(SELLER_ID);
  const buyer = await bearerFor(BUYER_ID);
  const product = await createProductAs(seller, { title: "交错编辑商品" });
  const productId = product.id as string;

  // 卖家打开编辑页：读取商品，表单快照里 stock=1。
  const loaded = await callRoute(
    getProduct,
    `http://localhost/api/v1/shopping/products/${productId}`,
    { headers: seller, params: { id: productId } },
  );
  assert.equal(loaded.status, 200);
  assert.equal(dataOf(loaded.json).stock, 1);

  // 卖家保存前买家下单：库存 1 → 0。
  const created = await placeOrder(buyer, productId, 1);
  assert.equal(created.status, 201);
  assert.equal((await getDb().product.findUnique({ where: { id: productId } }))?.stock, 0);

  // 卖家只改标题保存（不回传 stock）：旧快照不得把库存覆盖回 1。
  const titleOnly = await callRoute(
    patchProduct,
    `http://localhost/api/v1/shopping/products/${productId}`,
    {
      method: "PATCH",
      headers: seller,
      params: { id: productId },
      body: { title: "只改了标题" },
    },
  );
  assert.equal(titleOnly.status, 200);
  assert.equal(dataOf(titleOnly.json).title, "只改了标题");
  assert.equal(
    (await getDb().product.findUnique({ where: { id: productId } }))?.stock,
    0,
    "不传 stock 时库存必须保持订单扣减后的值",
  );

  // 取消订单：库存回补到扣减前的 1，而不是翻成 2。
  const orderId = dataOf(created.json).id as string;
  const cancelled = await callRoute(
    cancelOrder,
    `http://localhost/api/v1/shopping/orders/${orderId}/cancel`,
    { method: "POST", headers: buyer, params: { id: orderId } },
  );
  assert.equal(cancelled.status, 200);
  assert.equal(
    (await getDb().product.findUnique({ where: { id: productId } }))?.stock,
    1,
    "取消后库存回补到扣减前值，不得翻倍",
  );
});

dbTest("库存编辑防护：二手已下单锁定、过期基线 409、正确基线补货成功", async () => {
  const seller = await bearerFor(SELLER_ID);
  const buyer = await bearerFor(BUYER_ID);
  const staff = await bearerFor(STAFF_ID);

  // SECONDHAND：已存在订单后传 stock 一律 409 STOCK_ORDER_LOCKED（即使基线正确）。
  const secondhand = await createProductAs(seller, { title: "二手锁定商品" });
  const shId = secondhand.id as string;
  const shOrder = await placeOrder(buyer, shId, 1);
  assert.equal(shOrder.status, 201);
  const locked = await callRoute(
    patchProduct,
    `http://localhost/api/v1/shopping/products/${shId}`,
    {
      method: "PATCH",
      headers: seller,
      params: { id: shId },
      body: { stock: 1, stockBase: 0 },
    },
  );
  assert.equal(locked.status, 409, "二手已有订单不得手动改库存");
  assert.equal(errorCode(locked.json), "STOCK_ORDER_LOCKED");
  assert.equal(
    (await getDb().product.findUnique({ where: { id: shId } }))?.stock,
    0,
    "锁定分支不得写库存",
  );

  // 订单取消后（任意状态都算「已存在订单」）仍然锁定。
  const shOrderId = dataOf(shOrder.json).id as string;
  const shCancelled = await callRoute(
    cancelOrder,
    `http://localhost/api/v1/shopping/orders/${shOrderId}/cancel`,
    { method: "POST", headers: buyer, params: { id: shOrderId } },
  );
  assert.equal(shCancelled.status, 200);
  const lockedAfterCancel = await callRoute(
    patchProduct,
    `http://localhost/api/v1/shopping/products/${shId}`,
    {
      method: "PATCH",
      headers: seller,
      params: { id: shId },
      body: { stock: 1, stockBase: 1 },
    },
  );
  assert.equal(lockedAfterCancel.status, 409, "已取消订单也算已预留，仍应锁定");
  assert.equal(errorCode(lockedAfterCancel.json), "STOCK_ORDER_LOCKED");

  // CONSUMABLE：过期 stockBase → 409 STOCK_CONFLICT，且不写库存。
  const consumable = await createProductAs(staff, {
    category: "CONSUMABLE",
    title: "耗材补货商品",
    condition: "",
    stock: 5,
  });
  const cId = consumable.id as string;
  const cOrder = await placeOrder(buyer, cId, 2);
  assert.equal(cOrder.status, 201);
  assert.equal((await getDb().product.findUnique({ where: { id: cId } }))?.stock, 3);

  const stale = await callRoute(
    patchProduct,
    `http://localhost/api/v1/shopping/products/${cId}`,
    {
      method: "PATCH",
      headers: staff,
      params: { id: cId },
      // 编辑页加载时看到的基线是 5，当前库存已被订单扣到 3。
      body: { stock: 5, stockBase: 5 },
    },
  );
  assert.equal(stale.status, 409, "过期基线必须 409 而不是覆盖");
  assert.equal(errorCode(stale.json), "STOCK_CONFLICT");
  assert.equal(
    (await getDb().product.findUnique({ where: { id: cId } }))?.stock,
    3,
    "冲突分支不得写库存",
  );

  // 重新加载后带正确基线补货：成功且库存为所传值。
  const restock = await callRoute(
    patchProduct,
    `http://localhost/api/v1/shopping/products/${cId}`,
    {
      method: "PATCH",
      headers: staff,
      params: { id: cId },
      body: { stock: 8, stockBase: 3 },
    },
  );
  assert.equal(restock.status, 200, `正确基线补货应成功：${JSON.stringify(restock.json)}`);
  assert.equal(dataOf(restock.json).stock, 8);
  assert.equal((await getDb().product.findUnique({ where: { id: cId } }))?.stock, 8);

  // 传 stock 不传 stockBase → 400 VALIDATION_FAILED（fieldErrors.stockBase）。
  const noBase = await callRoute(
    patchProduct,
    `http://localhost/api/v1/shopping/products/${cId}`,
    { method: "PATCH", headers: staff, params: { id: cId }, body: { stock: 6 } },
  );
  assert.equal(noBase.status, 400);
  assert.equal(errorCode(noBase.json), "VALIDATION_FAILED");
  assert.ok((noBase.json as Envelope).error?.fieldErrors?.stockBase, "应报 stockBase 字段错误");
});

dbTest("并发同幂等键不同商品：一单成功、另一单 409，库存只扣成功那笔", async () => {
  const seller = await bearerFor(SELLER_ID);
  const buyer = await bearerFor(BUYER_ID);
  const productA = await createProductAs(seller, { title: "同键商品A" });
  const productB = await createProductAs(seller, { title: "同键商品B" });
  const aId = productA.id as string;
  const bId = productB.id as string;
  const key = `race-product-${randomUUID()}`;

  const [first, second] = await Promise.all([
    placeOrder(buyer, aId, 1, key),
    placeOrder(buyer, bId, 1, key),
  ]);
  const statuses = [first.status, second.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 409], `应一成一败，实际 ${statuses.join("/")}`);
  const succeeded = first.status === 201 ? first : second;
  const failed = first.status === 409 ? first : second;
  assert.equal(
    errorCode(failed.json),
    "IDEMPOTENCY_CONFLICT",
    "同键不同商品不得返回另一单的成功结果",
  );
  const succeededProductId = dataOf(succeeded.json).productId as string;
  assert.ok(
    succeededProductId === aId || succeededProductId === bId,
    "成功单必须属于本次请求的商品",
  );

  const aRow = await getDb().product.findUnique({ where: { id: aId } });
  const bRow = await getDb().product.findUnique({ where: { id: bId } });
  if (succeededProductId === aId) {
    assert.equal(aRow?.stock, 0, "成功那笔正常扣库存");
    assert.equal(bRow?.stock, 1, "冲突请求不得扣另一商品库存");
  } else {
    assert.equal(bRow?.stock, 0, "成功那笔正常扣库存");
    assert.equal(aRow?.stock, 1, "冲突请求不得扣另一商品库存");
  }
  assert.equal(
    await getDb().shoppingOrder.count({ where: { productId: { in: [aId, bId] } } }),
    1,
    "同一幂等键只落一单",
  );
});

dbTest("POST + X-HTTP-Method-Override: PATCH 兼容入口：与 PATCH 同效；缺头/错值 405", async () => {
  const seller = await bearerFor(SELLER_ID);
  const buyer = await bearerFor(BUYER_ID);
  const product = await createProductAs(seller, { title: "override 商品" });
  const id = product.id as string;

  const viaPost = await callRoute(
    postProductOverride,
    `http://localhost/api/v1/shopping/products/${id}`,
    {
      method: "POST",
      headers: { ...seller, "x-http-method-override": "PATCH" },
      params: { id },
      body: { title: "POST 通道改标题", priceCents: 888 },
    },
  );
  assert.equal(viaPost.status, 200, `POST 兼容入口应与 PATCH 同效：${viaPost.status}`);
  assert.equal(dataOf(viaPost.json).title, "POST 通道改标题");
  assert.equal(dataOf(viaPost.json).priceCents, 888);

  // 头值大小写不敏感。
  const lowercase = await callRoute(
    postProductOverride,
    `http://localhost/api/v1/shopping/products/${id}`,
    {
      method: "POST",
      headers: { ...seller, "x-http-method-override": "patch" },
      params: { id },
      body: { title: "小写头值也可以" },
    },
  );
  assert.equal(lowercase.status, 200);
  assert.equal(dataOf(lowercase.json).title, "小写头值也可以");

  const noHeader = await callRoute(
    postProductOverride,
    `http://localhost/api/v1/shopping/products/${id}`,
    { method: "POST", headers: seller, params: { id }, body: { title: "没有头" } },
  );
  assert.equal(noHeader.status, 405, "缺 X-HTTP-Method-Override 应 405");
  assert.equal(errorCode(noHeader.json), "METHOD_NOT_ALLOWED");

  const wrongValue = await callRoute(
    postProductOverride,
    `http://localhost/api/v1/shopping/products/${id}`,
    {
      method: "POST",
      headers: { ...seller, "x-http-method-override": "DELETE" },
      params: { id },
      body: { title: "错误头值" },
    },
  );
  assert.equal(wrongValue.status, 405, "头值不是 PATCH 应 405");
  assert.equal(errorCode(wrongValue.json), "METHOD_NOT_ALLOWED");

  const row = await getDb().product.findUnique({ where: { id } });
  assert.equal(row?.title, "小写头值也可以", "405 分支不得改动商品");

  // 同一鉴权：第三人走 POST 通道同样 403。
  const forbidden = await callRoute(
    postProductOverride,
    `http://localhost/api/v1/shopping/products/${id}`,
    {
      method: "POST",
      headers: { ...buyer, "x-http-method-override": "PATCH" },
      params: { id },
      body: { title: "路人改" },
    },
  );
  assert.equal(forbidden.status, 403, "POST 通道必须复用 PATCH 的鉴权");
});
