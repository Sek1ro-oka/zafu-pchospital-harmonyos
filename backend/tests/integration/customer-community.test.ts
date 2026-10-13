import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Prisma } from "../../src/generated/prisma/client";
import {
  GET as favoritesGet,
  POST as favoritesPost,
} from "../../src/app/api/v1/customer/favorites/route";
import { DELETE as favoriteDelete } from "../../src/app/api/v1/customer/favorites/[id]/route";
import { GET as messagesGet } from "../../src/app/api/v1/customer/notifications/route";
import { POST as messageRead } from "../../src/app/api/v1/customer/notifications/[id]/read/route";
import { DELETE as messageDelete } from "../../src/app/api/v1/customer/notifications/[id]/route";
import { POST as messagesReadAll } from "../../src/app/api/v1/customer/notifications/read-all/route";
import { GET as casesGet } from "../../src/app/api/v1/customer/knowledge-cases/route";
import { GET as caseGet } from "../../src/app/api/v1/customer/knowledge-cases/[id]/route";
import { POST as orderSubmit } from "../../src/app/api/v1/repair-orders/route";
import { POST as orderAccept } from "../../src/app/api/v1/staff/repair-orders/[id]/accept/route";
import { POST as orderProgress } from "../../src/app/api/v1/staff/repair-orders/[id]/progress/route";
import { POST as orderCancel } from "../../src/app/api/v1/staff/repair-orders/[id]/cancel/route";
import { GET as memberNotifications } from "../../src/app/api/v1/member/notifications/route";
import { readPublicGuides } from "../../src/features/knowledge/public-guides";
import { materialHashOf, materialOf } from "../../src/features/knowledge-cases/case-material";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute } from "./http-harness";
import {
  CUSTOMER_ID,
  STAFF_A_ID,
  ADMIN_ID,
  MP_A_ID,
  bearerFor,
  prepareStaffRepairFixtures,
  cleanupStaffRepairFixtures,
} from "./staff-repair-harness";

const enabled = integrationTestsEnabled(),
  dbTest = enabled ? test : test.skip;
const customerB = randomUUID(),
  caseId = randomUUID(),
  recordId = randomUUID();
let a: Record<string, string>,
  b: Record<string, string>,
  staff: Record<string, string>,
  admin: Record<string, string>;
before(async () => {
  if (!enabled) return;
  await cleanupStaffRepairFixtures();
  await prepareStaffRepairFixtures();
  const db = getDb(),
    now = new Date();
  await db.user.create({
    data: {
      id: customerB,
      status: "ACTIVE",
      displayName: "第二客户",
      createdAt: now,
      updatedAt: now,
    },
  });
  a = await bearerFor(CUSTOMER_ID);
  b = await bearerFor(customerB);
  staff = await bearerFor(STAFF_A_ID);
  admin = await bearerFor(ADMIN_ID);
  const record = await db.repairRecord.create({
    data: {
      id: recordId,
      memberProfileId: MP_A_ID,
      status: "APPROVED",
      createRequestKey: randomUUID(),
      isTypical: true,
      deviceModel: "测试机",
      content: "更换松动线缆后恢复",
      result: "COMPLETED",
      createdAt: now,
    },
    include: { category: true },
  });
  await db.knowledgeCase.create({
    data: {
      id: caseId,
      displayText: "合成验证案例：更换线缆恢复。",
      structured: { title: "合成验证案例61", unknowns: [] },
      status: "PUBLISHED",
      visibility: "PUBLIC",
      contentHash: "test-only",
      createdAt: now,
      publishedAt: now,
    },
  });
  await db.knowledgeCaseSource.create({
    data: {
      id: randomUUID(),
      caseId,
      repairRecordId: recordId,
      status: "PUBLISHED",
      contentHash: materialHashOf(materialOf(record)),
      evidence: {
        material: { deviceModel: "测试机" },
        quotes: [{ field: "resolution", quote: "更换松动线缆后恢复" }],
      },
      createdAt: now,
    },
  });
});
after(async () => {
  if (!enabled) return;
  const db = getDb();
  await db.customerFavorite.deleteMany({ where: { userId: { in: [CUSTOMER_ID, customerB] } } });
  await cleanupStaffRepairFixtures();
  await db.authSession.deleteMany({ where: { userId: customerB } });
  await db.passwordCredential.deleteMany({ where: { userId: customerB } });
  await db.user.delete({ where: { id: customerB } });
  await disconnectDb();
});
function route(
  handler: Parameters<typeof callRoute>[0],
  headers: Record<string, string>,
  method = "GET",
  body?: unknown,
  id = "",
  suffix = "",
) {
  return callRoute(handler, "http://localhost/api/v1/fixture" + suffix, {
    headers,
    method,
    body,
    params: { id },
  });
}
async function newOrder() {
  const response = await route(orderSubmit, { ...a, "idempotency-key": randomUUID() }, "POST", {
    deviceModel: "测试机61",
    faultDescription: "风扇异常不转",
    contactPhone: "13800000000",
  });
  assert.equal(response.status, 201);
  return String((response.json.data as { id: string }).id);
}

dbTest("指南收藏使用稳定来源，重复/取消/恢复复用同一行；两客户隔离", async () => {
  const guide = readPublicGuides(null).guides?.[0];
  assert.ok(guide);
  const first = await route(favoritesPost, a, "POST", { kind: "GUIDE", sourceId: guide.id });
  assert.equal(first.status, 200);
  const favorite = first.json.data as { id: string; sourceId: string };
  assert.notEqual(favorite.sourceId, guide.id, "持久化来源路径而非随版本变化的 chunk ID");
  const again = await route(favoritesPost, a, "POST", { kind: "GUIDE", sourceId: guide.id });
  assert.equal((again.json.data as { id: string }).id, favorite.id);
  assert.equal((await route(favoriteDelete, b, "DELETE", undefined, favorite.id)).status, 404);
  assert.deepEqual((await route(favoritesGet, b)).json.data, []);
  assert.equal((await route(favoriteDelete, a, "DELETE", undefined, favorite.id)).status, 200);
  const restored = await route(favoritesPost, a, "POST", {
    kind: "GUIDE",
    sourceId: favorite.sourceId,
  });
  assert.equal((restored.json.data as { id: string }).id, favorite.id);
  assert.equal(
    (
      await route(favoritesPost, b, "POST", {
        kind: "GUIDE",
        sourceId: guide.id,
        userId: CUSTOMER_ID,
      })
    ).status,
    400,
  );
});
dbTest("公开案例/收藏权限变化与来源失效不泄漏旧正文、作者、原备案或照片", async () => {
  const detail = await route(caseGet, a, "GET", undefined, caseId);
  assert.equal(detail.status, 200);
  const json = JSON.stringify(detail.json);
  assert.equal(json.includes(STAFF_A_ID), false);
  assert.equal(json.includes(recordId), false);
  const data = detail.json.data as {
    sources: { authorName: string | null; repairRecordId: string | null; canOpen: boolean }[];
  };
  assert.equal(data.sources[0].authorName, null);
  assert.equal(data.sources[0].repairRecordId, null);
  assert.equal(data.sources[0].canOpen, false);
  const added = await route(favoritesPost, a, "POST", { kind: "CASE", sourceId: caseId });
  assert.equal(added.status, 200);
  for (const update of [
    { visibility: "STAFF" },
    { visibility: "PUBLIC", status: "WITHDRAWN" },
    { status: "REPROCESSING" },
    { status: "FAILED" },
  ]) {
    await getDb().knowledgeCase.update({ where: { id: caseId }, data: update });
    assert.equal((await route(caseGet, a, "GET", undefined, caseId)).status, 404);
    assert.equal(
      (await route(favoritesPost, a, "POST", { kind: "CASE", sourceId: caseId })).status,
      404,
    );
    const list = await route(favoritesGet, a);
    const text = JSON.stringify(list.json);
    assert.equal(text.includes("合成验证案例61"), false);
    assert.equal(text.includes("更换"), false);
    assert.ok(
      (list.json.data as { available: boolean }[]).some((item) => item.available === false),
    );
  }
  await getDb().knowledgeCase.update({
    where: { id: caseId },
    data: { status: "PUBLISHED", visibility: "PUBLIC" },
  });
  await getDb().repairRecord.update({
    where: { id: recordId },
    data: { content: "原材料已经变化" },
  });
  assert.equal((await route(caseGet, a, "GET", undefined, caseId)).status, 404);
  assert.deepEqual((await route(casesGet, a)).json.data, []);
});
dbTest("收藏分页无重复；成员通知仍按 MemberProfile 权限，客户不能读取", async () => {
  const secondPage = await route(favoritesGet, a, "GET", undefined, "", "?page=2&pageSize=1");
  const firstPage = await route(favoritesGet, a, "GET", undefined, "", "?page=1&pageSize=1");
  assert.equal((firstPage.json.data as { id: string }[]).length, 1);
  assert.equal((secondPage.json.data as { id: string }[]).length, 1);
  assert.notEqual(
    (firstPage.json.data as { id: string }[])[0].id,
    (secondPage.json.data as { id: string }[])[0].id,
  );
  assert.equal((await route(memberNotifications, a)).status, 403);
  assert.equal((await route(memberNotifications, staff)).status, 200);
});
dbTest("受理、进度、完成、取消每一实际事件仅一条客户消息；失败状态不发消息", async () => {
  const id = await newOrder(),
    otherId = await newOrder();
  const initialCount = await getDb().customerNotification.count({ where: { userId: CUSTOMER_ID } });
  assert.equal(
    (await route(orderProgress, staff, "POST", { toStatus: "COMPLETED" }, id)).status,
    403,
  );
  assert.equal(
    await getDb().customerNotification.count({ where: { userId: CUSTOMER_ID } }),
    initialCount,
  );
  for (let i = 0; i < 2; i++)
    assert.equal((await route(orderAccept, staff, "POST", {}, id)).status, 200);
  assert.equal(
    (await route(orderProgress, staff, "POST", { toStatus: "COMPLETED" }, id)).status,
    409,
  );
  assert.equal(
    await getDb().customerNotification.count({ where: { userId: CUSTOMER_ID } }),
    initialCount + 1,
  );
  for (const toStatus of ["REPAIRING", "COMPLETED"]) {
    for (let i = 0; i < 2; i++)
      assert.equal((await route(orderProgress, staff, "POST", { toStatus }, id)).status, 200);
  }
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await route(orderCancel, admin, "POST", { note: "合成取消验证" }, otherId)).status,
      200,
    );
  const rows = await getDb().customerNotification.findMany({ where: { userId: CUSTOMER_ID } });
  assert.equal(rows.length - initialCount, 4);
  assert.equal(new Set(rows.map((row) => row.eventId)).size, rows.length);
  assert.deepEqual((await route(messagesGet, b)).json.data, { items: [], unreadCount: 0 });
  const notificationId = rows[0].id;
  assert.equal((await route(messageRead, b, "POST", {}, notificationId)).status, 404);
  assert.equal((await route(messageDelete, b, "DELETE", undefined, notificationId)).status, 404);
  assert.equal((await route(messageRead, a, "POST", {}, notificationId)).status, 200);
  assert.equal((await route(messagesReadAll, a, "POST", {})).status, 200);
  assert.equal(((await route(messagesGet, a)).json.data as { unreadCount: number }).unreadCount, 0);
  assert.equal((await route(messageDelete, a, "DELETE", undefined, notificationId)).status, 200);
});
dbTest("通知写入失败整体回滚，不留下状态、进度或假消息", async () => {
  const id = await newOrder(),
    db = getDb();
  // 事务仍由真实 MySQL 执行；仅通知 create 注入失败，不需要额外数据库权限。
  const transaction = db.$transaction.bind(db);
  db.$transaction = (async (
    operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options: {
      isolationLevel?: Prisma.TransactionIsolationLevel;
      maxWait?: number;
      timeout?: number;
    },
  ) =>
    transaction(
      async (tx) =>
        operation(
          new Proxy(tx, {
            get(target, property) {
              if (property === "customerNotification")
                return new Proxy(target.customerNotification, {
                  get(delegate, method) {
                    if (method === "create")
                      return async () => {
                        throw new Error("fixture notification write failure");
                      };
                    return Reflect.get(delegate, method);
                  },
                });
              return Reflect.get(target, property);
            },
          }),
        ),
      options,
    )) as typeof db.$transaction;
  try {
    const result = await route(orderAccept, staff, "POST", {}, id);
    assert.equal(result.status, 500);
    assert.equal((await db.repairOrder.findUniqueOrThrow({ where: { id } })).status, "SUBMITTED");
    assert.equal(
      await db.repairOrderEvent.count({ where: { repairOrderId: id, toStatus: "ACCEPTED" } }),
      0,
    );
    assert.equal(await db.customerNotification.count({ where: { repairOrderId: id } }), 0);
  } finally {
    db.$transaction = transaction;
  }
});
