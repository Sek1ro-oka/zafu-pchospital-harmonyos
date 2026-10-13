import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { POST as customerSubmitRoute } from "../../src/app/api/v1/repair-orders/route";
import { GET as staffDetailRoute } from "../../src/app/api/v1/staff/repair-orders/[id]/route";
import { POST as acceptRoute } from "../../src/app/api/v1/staff/repair-orders/[id]/accept/route";
import { POST as progressRoute } from "../../src/app/api/v1/staff/repair-orders/[id]/progress/route";
import { POST as createRecordRoute } from "../../src/app/api/v1/staff/repair-orders/[id]/record/route";
import { PATCH as patchRecordRoute, POST as postEditRecordRoute } from "../../src/app/api/v1/repairs/[id]/route";
import { POST as submitRecordRoute } from "../../src/app/api/v1/repairs/[id]/submit/route";
import { POST as uploadPhotosRoute } from "../../src/app/api/v1/repairs/[id]/photos/route";
import { DELETE as deletePhotoRoute } from "../../src/app/api/v1/repairs/[id]/photos/[photoId]/route";
import { GET as photoContentRoute } from "../../src/app/api/v1/repair-photos/[photoId]/content/route";
import { POST as adminReviewRoute } from "../../src/app/api/v1/admin/repairs/[id]/reviews/route";
import { getDb, disconnectDb } from "../../src/lib/db/client";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute } from "./http-harness";
import {
  ADMIN_ID,
  CUSTOMER_ID,
  STAFF_A_ID,
  STAFF_B_ID,
  bearerFor,
  cleanupStaffRepairFixtures,
  dataOf,
  errorCodeOf,
  prepareStaffRepairFixtures,
  tinyPng,
} from "./staff-repair-harness";

/**
 * 报修 → 备案 → 照片 → 提交 → 退回 → 重提 → 通过 的完整跨角色链路（Issue #38，真实 MySQL）。
 *
 * 重点验证：建档归属与原子关联、幂等与并发不产生多份/孤立记录、版本冲突、
 * 真实照片的上传/读取/删除、原 Web 编辑规则（仅本人、仅 DRAFT/REJECTED）、
 * 审核权限与幂等，以及「报修状态与备案状态相互独立」。
 */
const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

const CATEGORY_CODE = "ISSUE38_TEST";
let uploadRoot = "";

before(async () => {
  if (!enabled) return;
  uploadRoot = await mkdtemp(join(tmpdir(), "pc-hospital-issue38-"));
  process.env.UPLOAD_PATH = uploadRoot;
  await cleanupStaffRepairFixtures();
  await prepareStaffRepairFixtures();
  await ensureCategory();
});

beforeEach(async () => {
  if (!enabled) return;
  await prepareStaffRepairFixtures();
});

after(async () => {
  if (!enabled) return;
  await cleanupStaffRepairFixtures();
  await getDb().repairCategory.deleteMany({ where: { code: CATEGORY_CODE } });
  await disconnectDb();
  if (uploadRoot) await rm(uploadRoot, { recursive: true, force: true });
});

async function ensureCategory(): Promise<string> {
  const db = getDb();
  const existing = await db.repairCategory.findFirst({ where: { code: CATEGORY_CODE } });
  if (existing) return existing.id;
  const created = await db.repairCategory.create({
    data: {
      id: "b3800000-0000-4000-8000-0000000000c1",
      code: CATEGORY_CODE,
      name: "Issue38 测试分类",
      sortOrder: 900,
      isActive: true,
      createdAt: new Date(),
    },
  });
  return created.id;
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function newOrder(): Promise<string> {
  const headers = await bearerFor(CUSTOMER_ID);
  const response = await callRoute(customerSubmitRoute, "http://localhost/api/v1/repair-orders", {
    method: "POST",
    headers,
    body: {
      deviceModel: "荣耀 MagicBook 14（Issue38）",
      faultDescription: "开机后屏幕闪烁，疑似排线接触不良",
      contactPhone: "13700137000",
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  return dataOf(response.json).id as string;
}

async function newAcceptedOrder(): Promise<string> {
  const id = await newOrder();
  const staffA = await bearerFor(STAFF_A_ID);
  const response = await callRoute(acceptRoute, `http://localhost/api/v1/staff/repair-orders/${id}/accept`, {
    method: "POST",
    headers: staffA,
    body: {},
    params: { id },
  });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  return id;
}

function createRecordAs(headers: Record<string, string>, orderId: string, key: string) {
  return callRoute(createRecordRoute, `http://localhost/api/v1/staff/repair-orders/${orderId}/record`, {
    method: "POST",
    headers: { ...headers, "idempotency-key": key },
    body: {},
    params: { id: orderId },
  });
}

function patchAs(headers: Record<string, string>, recordId: string, body: Record<string, unknown>) {
  return callRoute(patchRecordRoute, `http://localhost/api/v1/repairs/${recordId}`, {
    method: "PATCH",
    headers,
    body,
    params: { id: recordId },
  });
}

function submitAs(headers: Record<string, string>, recordId: string, body: Record<string, unknown>, key: string) {
  return callRoute(submitRecordRoute, `http://localhost/api/v1/repairs/${recordId}/submit`, {
    method: "POST",
    headers: { ...headers, "idempotency-key": key },
    body,
    params: { id: recordId },
  });
}

function reviewAs(headers: Record<string, string>, recordId: string, body: Record<string, unknown>) {
  return callRoute(adminReviewRoute, `http://localhost/api/v1/admin/repairs/${recordId}/reviews`, {
    method: "POST",
    headers,
    body,
    params: { id: recordId },
  });
}

/** 走真实路由上传一张 PNG（multipart + 原生通道头），返回照片 id。 */
async function uploadPhoto(headers: Record<string, string>, recordId: string): Promise<string> {
  const form = new FormData();
  form.append("photos", new File([tinyPng()], "issue38-photo.png", { type: "image/png" }));
  const request = new Request(`http://localhost/api/v1/repairs/${recordId}/photos`, {
    method: "POST",
    headers: { authorization: headers.authorization ?? "", "x-client-type": "native" },
    body: form,
  });
  const response = await uploadPhotosRoute(request, { params: Promise.resolve({ id: recordId }) });
  const json = (await response.json()) as Record<string, unknown>;
  assert.equal(response.status, 201, JSON.stringify(json));
  const photos = dataOf(json) as unknown;
  assert.ok(Array.isArray(photos) && photos.length === 1);
  return (photos as Array<Record<string, unknown>>)[0].id as string;
}

/** 把草稿填成可提交状态，返回最新 version。 */
async function fillDraft(headers: Record<string, string>, recordId: string, version: number, overrides: Record<string, unknown> = {}) {
  const categoryId = await ensureCategory();
  const response = await patchAs(headers, recordId, {
    version,
    repairDate: shanghaiToday(),
    durationMinutes: 45,
    categoryId,
    content: "拆机检查排线并重新压接，点亮测试通过。",
    result: "COMPLETED",
    remark: "客户在场确认",
    ...overrides,
  });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  return dataOf(response.json).version as number;
}

dbTest("建档：仅受理人可建、机型预填、结果不预置、关联原子完成", async () => {
  // 未受理的单：任何工作人员都不能建档。
  const fresh = await newOrder();
  const staffA = await bearerFor(STAFF_A_ID);
  const staffB = await bearerFor(STAFF_B_ID);
  const notAccepted = await createRecordAs(staffA, fresh, randomUUID());
  assert.equal(notAccepted.status, 403, "未受理的单不能建档");

  const orderId = await newAcceptedOrder();
  // 非受理人（B）不能建档。
  const byB = await createRecordAs(staffB, orderId, randomUUID());
  assert.equal(byB.status, 403);
  assert.equal(errorCodeOf(byB.json), "REPAIR_FORBIDDEN");

  // 受理人（A）建档：201 DRAFT，机型预填，维修结果留空等待人工填写。
  const key = `it-${randomUUID()}`;
  const created = await createRecordAs(staffA, orderId, key);
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const record = dataOf(created.json);
  assert.equal(record.status, "DRAFT");
  assert.equal(record.deviceModel, "荣耀 MagicBook 14（Issue38）");
  assert.equal(record.ownerName, null, "未知机主姓名不猜测为客户昵称");
  assert.equal(record.ownerPhone, "13700137000", "复制原报修联系快照");
  assert.equal(record.result, null, "不预置成功结果，由工作人员如实填写");
  assert.equal(record.content, null);
  assert.equal(record.repairDate, null);

  const row = await getDb().repairRecord.findUniqueOrThrow({ where: { id: record.id as string } });
  assert.equal(row.memberProfileId, "b3800000-0000-4000-8000-0000000000a1");
  const orderRow = await getDb().repairOrder.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(orderRow.repairRecordId, row.id, "建档与关联必须原子完成");
  const timelineRows = await getDb().repairTimelineEvent.findMany({
    where: { repairRecordId: row.id, eventType: "CREATED" },
  });
  assert.equal(timelineRows.length, 1);

  // 重复点击（同幂等键）→ 同一份；已关联后用新键再建 → 仍返回原备案，不产生第二份。
  const before = await getDb().repairRecord.count({
    where: { memberProfileId: "b3800000-0000-4000-8000-0000000000a1" },
  });
  const replay = await createRecordAs(staffA, orderId, key);
  assert.equal(replay.status, 201);
  assert.equal(dataOf(replay.json).id, record.id);
  const newKey = await createRecordAs(staffA, orderId, `it-${randomUUID()}`);
  assert.equal(newKey.status, 201);
  assert.equal(dataOf(newKey.json).id, record.id);
  const after = await getDb().repairRecord.count({
    where: { memberProfileId: "b3800000-0000-4000-8000-0000000000a1" },
  });
  assert.equal(after, before, "重复/换键建档都不得产生新的记录");
  assert.equal(
    await getDb().repairRecord.count({ where: { repairOrder: { id: orderId } } }),
    1,
    "该报修单只能关联一份备案",
  );
});

dbTest("并发建档：并发请求只落一份备案且没有孤立记录", async () => {
  const orderId = await newAcceptedOrder();
  const staffA = await bearerFor(STAFF_A_ID);
  const baseline = await getDb().repairRecord.count({
    where: { memberProfileId: "b3800000-0000-4000-8000-0000000000a1" },
  });
  const [first, second] = await Promise.all([
    createRecordAs(staffA, orderId, `it-${randomUUID()}`),
    createRecordAs(staffA, orderId, `it-${randomUUID()}`),
  ]);
  const successes = [first, second].filter((response) => response.status === 201);
  assert.ok(successes.length >= 1, "至少一方成功");
  const ids = successes.map((response) => dataOf(response.json).id);
  assert.equal(new Set(ids).size, 1, "成功的响应必须指向同一份备案");

  const orderRow = await getDb().repairOrder.findUniqueOrThrow({ where: { id: orderId } });
  assert.ok(orderRow.repairRecordId, "备案必须已关联，不能是孤立记录");
  for (const id of ids) assert.equal(id, orderRow.repairRecordId);
  const after = await getDb().repairRecord.count({
    where: { memberProfileId: "b3800000-0000-4000-8000-0000000000a1" },
  });
  assert.equal(after, baseline + 1, "并发建档只允许新增一份记录");
  assert.equal(
    await getDb().repairRecord.count({ where: { repairOrder: { id: orderId } } }),
    1,
  );
});

dbTest("幂等键跨报修隔离：复用其他报修单的键返回冲突且不建立关联", async () => {
  const staffA = await bearerFor(STAFF_A_ID);
  const orderA = await newAcceptedOrder();
  const key = `it-${randomUUID()}`;
  const createdA = await createRecordAs(staffA, orderA, key);
  assert.equal(createdA.status, 201, JSON.stringify(createdA.json));
  const recordAId = dataOf(createdA.json).id as string;

  // 同一受理人对另一台机器复用 A 的键：不能把 A 的备案当成 B 的结果返回。
  const orderB = await newAcceptedOrder();
  const reused = await createRecordAs(staffA, orderB, key);
  assert.equal(reused.status, 409, JSON.stringify(reused.json));
  assert.equal(errorCodeOf(reused.json), "IDEMPOTENCY_CONFLICT");

  const orderBRow = await getDb().repairOrder.findUniqueOrThrow({ where: { id: orderB } });
  assert.equal(orderBRow.repairRecordId, null, "冲突返回后 B 不能留下关联");
  assert.equal(
    await getDb().repairRecord.count({ where: { createRequestKey: key } }),
    1,
    "键仍只对应 A 的那一份备案",
  );
  const orderARow = await getDb().repairOrder.findUniqueOrThrow({ where: { id: orderA } });
  assert.equal(orderARow.repairRecordId, recordAId, "A 的关联原样保留");

  // 换新键后 B 正常建档。
  const fresh = await createRecordAs(staffA, orderB, `it-${randomUUID()}`);
  assert.equal(fresh.status, 201, JSON.stringify(fresh.json));
  const orderBAfter = await getDb().repairOrder.findUniqueOrThrow({ where: { id: orderB } });
  assert.equal(orderBAfter.repairRecordId, dataOf(fresh.json).id);
});

dbTest("取消与建档并发：取消先提交时建档被拒且不留关联与孤立记录", async () => {
  const orderId = await newAcceptedOrder();
  const staffA = await bearerFor(STAFF_A_ID);
  const key = `it-${randomUUID()}`;
  const db = getDb();

  // 用独立连接锁住订单行，让建档请求完成外层检查后阻塞在事务内读取上；
  // 期间把订单改成 CANCELLED 并提交——精确复现「检查之后管理员先取消」的时序。
  let releaseLock: () => void = () => {};
  const lockReleased = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  let notifyLocked: () => void = () => {};
  const lockAcquired = new Promise<void>((resolve) => {
    notifyLocked = resolve;
  });
  const holder = db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_orders WHERE id = ${orderId} FOR UPDATE`;
      notifyLocked();
      await lockReleased;
      await tx.repairOrder.update({
        where: { id: orderId },
        data: { status: "CANCELLED", updatedAt: new Date() },
      });
    },
    { timeout: 10_000 },
  );

  await lockAcquired;
  const createPromise = createRecordAs(staffA, orderId, key);
  await new Promise((resolve) => setTimeout(resolve, 150));
  releaseLock();
  await holder;

  const response = await createPromise;
  assert.equal(response.status, 409, JSON.stringify(response.json));
  assert.equal(errorCodeOf(response.json), "REPAIR_ORDER_STATE_INVALID");
  const orderRow = await getDb().repairOrder.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(orderRow.status, "CANCELLED");
  assert.equal(orderRow.repairRecordId, null, "取消后的单不能留下备案关联");
  assert.equal(
    await getDb().repairRecord.count({ where: { createRequestKey: key } }),
    0,
    "事务回滚后不能留下孤立记录",
  );
});

dbTest("编辑规则：版本冲突 409；仅本人可编辑，管理员不能改别人的草稿", async () => {
  const orderId = await newAcceptedOrder();
  const staffA = await bearerFor(STAFF_A_ID);
  const staffB = await bearerFor(STAFF_B_ID);
  const admin = await bearerFor(ADMIN_ID);
  const created = await createRecordAs(staffA, orderId, `it-${randomUUID()}`);
  const recordId = dataOf(created.json).id as string;
  const version = dataOf(created.json).version as number;

  const byB = await patchAs(staffB, recordId, { version, content: "B 试图修改" });
  assert.equal(byB.status, 403);
  assert.equal(errorCodeOf(byB.json), "REPAIR_FORBIDDEN");

  const byAdmin = await patchAs(admin, recordId, { version, content: "管理员代改" });
  assert.equal(byAdmin.status, 403, "管理员审核权限不豁免本人编辑限制");
  assert.equal(errorCodeOf(byAdmin.json), "REPAIR_FORBIDDEN");

  const updatedVersion = await fillDraft(staffA, recordId, version);
  assert.equal(updatedVersion, version + 1);

  // 用旧版本再改 → 409 版本冲突，客户端据此提示刷新。
  const stale = await patchAs(staffA, recordId, { version, content: "基于旧版本修改" });
  assert.equal(stale.status, 409);
  assert.equal(errorCodeOf(stale.json), "REPAIR_VERSION_CONFLICT");

  // POST 编辑别名（App 因平台网络层没有 PATCH 而使用）：与 PATCH 同语义、同权限。
  const viaPost = await callRoute(postEditRecordRoute, `http://localhost/api/v1/repairs/${recordId}`, {
    method: "POST",
    headers: staffA,
    body: { version: updatedVersion, content: "通过 POST 别名保存的草稿内容。" },
    params: { id: recordId },
  });
  assert.equal(viaPost.status, 200, JSON.stringify(viaPost.json));
  assert.equal(dataOf(viaPost.json).version, updatedVersion + 1);
  const byOtherViaPost = await callRoute(postEditRecordRoute, `http://localhost/api/v1/repairs/${recordId}`, {
    method: "POST",
    headers: staffB,
    body: { version: updatedVersion + 1, content: "B 通过别名试图修改" },
    params: { id: recordId },
  });
  assert.equal(byOtherViaPost.status, 403, "POST 别名不放宽本人编辑限制");
});

dbTest("照片链路：multipart 上传 → 鉴权读取 → 删除；提交前后规则不变", async () => {
  const orderId = await newAcceptedOrder();
  const staffA = await bearerFor(STAFF_A_ID);
  const created = await createRecordAs(staffA, orderId, `it-${randomUUID()}`);
  const recordId = dataOf(created.json).id as string;
  const version = dataOf(created.json).version as number;
  const filledVersion = await fillDraft(staffA, recordId, version);

  // 没有照片不能提交。
  const noPhoto = await submitAs(staffA, recordId, { version: filledVersion }, `it-${randomUUID()}`);
  assert.equal(noPhoto.status, 400);
  assert.equal(errorCodeOf(noPhoto.json), "REPAIR_SUBMISSION_INCOMPLETE");

  const photoId = await uploadPhoto(staffA, recordId);
  // 受保护照片读取：带 Bearer 能拿到真实内容，不带凭证 401。
  const content = await photoContentRoute(
    new Request(`http://localhost/api/v1/repair-photos/${photoId}/content`, { headers: staffA }),
    { params: Promise.resolve({ photoId }) },
  );
  assert.equal(content.status, 200);
  assert.equal(content.headers.get("content-type"), "image/png");
  const bytes = new Uint8Array(await content.arrayBuffer());
  assert.deepEqual([...bytes], [...tinyPng()], "读取到的必须是上传的真实文件内容");
  const anonymous = await photoContentRoute(
    new Request(`http://localhost/api/v1/repair-photos/${photoId}/content`),
    { params: Promise.resolve({ photoId }) },
  );
  assert.equal(anonymous.status, 401);

  // 传错再删：删除后列表里不再有它。
  const second = await uploadPhoto(staffA, recordId);
  const removed = await callRoute(deletePhotoRoute, `http://localhost/api/v1/repairs/${recordId}/photos/${second}`, {
    method: "DELETE",
    headers: { ...staffA, "content-type": "application/json" },
    body: {},
    params: { id: recordId, photoId: second },
  });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));

  // 提交（幂等键在请求头），重复提交同键返回同一状态且不重复写事件。
  const key = `it-${randomUUID()}`;
  const submitted = await submitAs(staffA, recordId, { version: filledVersion }, key);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.json));
  assert.equal(dataOf(submitted.json).status, "PENDING");
  const replay = await submitAs(staffA, recordId, { version: filledVersion }, key);
  assert.equal(replay.status, 200);
  assert.equal(dataOf(replay.json).status, "PENDING");
  const submittedEvents = await getDb().repairTimelineEvent.count({
    where: { repairRecordId: recordId, eventType: { in: ["SUBMITTED", "RESUBMITTED"] } },
  });
  assert.equal(submittedEvents, 1, "重复提交不得重复写事件");
});

dbTest("审核：普通工作人员被拒；退回必填原因；退回→修改→重提→通过全链路", async () => {
  const orderId = await newAcceptedOrder();
  const staffA = await bearerFor(STAFF_A_ID);
  const admin = await bearerFor(ADMIN_ID);
  const created = await createRecordAs(staffA, orderId, `it-${randomUUID()}`);
  const recordId = dataOf(created.json).id as string;
  const version = dataOf(created.json).version as number;
  const filledVersion = await fillDraft(staffA, recordId, version);
  await uploadPhoto(staffA, recordId);
  const submitted = await submitAs(staffA, recordId, { version: filledVersion }, `it-${randomUUID()}`);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.json));

  // 普通工作人员不能调用审核接口。
  const staffReview = await reviewAs(staffA, recordId, {
    decision: "APPROVED",
    idempotencyKey: randomUUID(),
  });
  assert.equal(staffReview.status, 403);

  // 退回必须理由；带理由成功退回。
  const noNote = await reviewAs(admin, recordId, {
    decision: "REJECTED",
    idempotencyKey: randomUUID(),
  });
  assert.equal(noNote.status, 400);
  assert.equal(errorCodeOf(noNote.json), "REPAIR_REJECTION_NOTE_REQUIRED");
  const rejectKey = randomUUID();
  const rejected = await reviewAs(admin, recordId, {
    decision: "REJECTED",
    note: "维修内容缺少更换排线的说明，请补充",
    idempotencyKey: rejectKey,
  });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.json));
  assert.equal(dataOf(rejected.json).status, "REJECTED");
  // 审核幂等：同键重放返回同一结果。
  const rejectReplay = await reviewAs(admin, recordId, {
    decision: "REJECTED",
    note: "维修内容缺少更换排线的说明，请补充",
    idempotencyKey: rejectKey,
  });
  assert.equal(rejectReplay.status, 200);
  assert.equal(dataOf(rejectReplay.json).status, "REJECTED");

  // 退回后本人可再次编辑并重提。
  const current = dataOf(rejected.json);
  const editedVersion = await fillDraft(staffA, recordId, current.version as number, {
    content: "拆机检查排线并重新压接，更换一根新排线后点亮测试通过。",
  });
  const resubmitted = await submitAs(staffA, recordId, { version: editedVersion }, `it-${randomUUID()}`);
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.json));
  assert.equal(dataOf(resubmitted.json).status, "PENDING");

  // 管理员通过；通过后不可再编辑，也不能再次审核（并发/重复处理给冲突）。
  const approved = await reviewAs(admin, recordId, {
    decision: "APPROVED",
    idempotencyKey: randomUUID(),
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  assert.equal(dataOf(approved.json).status, "APPROVED");
  const editApproved = await patchAs(staffA, recordId, {
    version: dataOf(approved.json).version,
    content: "通过后再编辑",
  });
  assert.equal(editApproved.status, 409);
  assert.equal(errorCodeOf(editApproved.json), "REPAIR_STATE_INVALID");
  const reviewAgain = await reviewAs(admin, recordId, {
    decision: "REJECTED",
    note: "另一个人先处理",
    idempotencyKey: randomUUID(),
  });
  assert.equal(reviewAgain.status, 409);
  assert.equal(errorCodeOf(reviewAgain.json), "REPAIR_STATE_CONFLICT");

  // 两套状态独立：备案通过不改报修单处理状态；报修单完成也不要求备案已通过。
  const orderRow = await getDb().repairOrder.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(orderRow.status, "ACCEPTED", "审核不自动改变报修处理状态");
  const detail = await callRoute(staffDetailRoute, `http://localhost/api/v1/staff/repair-orders/${orderId}`, {
    headers: staffA,
    params: { id: orderId },
  });
  const recordSummary = dataOf(detail.json).record as Record<string, unknown>;
  assert.equal(recordSummary.status, "APPROVED", "工作人员详情能看到关联备案状态");
});

dbTest("先完成再补备案：报修 COMPLETED 后仍可建档并提交审核", async () => {
  const orderId = await newAcceptedOrder();
  const staffA = await bearerFor(STAFF_A_ID);
  // 受理 → 维修中 → 完成，全程没有任何备案。
  for (const toStatus of ["REPAIRING", "COMPLETED"]) {
    const response = await callRoute(progressRoute, `http://localhost/api/v1/staff/repair-orders/${orderId}/progress`, {
      method: "POST",
      headers: staffA,
      body: { toStatus },
      params: { id: orderId },
    });
    assert.equal(response.status, 200, JSON.stringify(response.json));
  }
  const detailAfterComplete = await callRoute(staffDetailRoute, `http://localhost/api/v1/staff/repair-orders/${orderId}`, {
    headers: staffA,
    params: { id: orderId },
  });
  const actions = dataOf(detailAfterComplete.json).actions as Record<string, unknown>;
  assert.equal(actions.canCreateRecord, true, "完成后允许补备案");

  const created = await createRecordAs(staffA, orderId, `it-${randomUUID()}`);
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const recordId = dataOf(created.json).id as string;
  const filledVersion = await fillDraft(staffA, recordId, dataOf(created.json).version as number);
  await uploadPhoto(staffA, recordId);
  const submitted = await submitAs(staffA, recordId, { version: filledVersion }, `it-${randomUUID()}`);
  assert.equal(submitted.status, 200);
  assert.equal(dataOf(submitted.json).status, "PENDING");
  const orderRow = await getDb().repairOrder.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(orderRow.status, "COMPLETED", "提交备案不影响已完成的报修处理状态");
});
