import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { POST as create } from "../../src/app/api/v1/repairs/route";
import { GET as detail, POST as edit } from "../../src/app/api/v1/repairs/[id]/route";
import { GET as mine } from "../../src/app/api/v1/member/repairs/route";
import { POST as submit } from "../../src/app/api/v1/repairs/[id]/submit/route";
import { GET as list } from "../../src/app/api/v1/repairs/route";
import { GET as comments, POST as comment } from "../../src/app/api/v1/repairs/[id]/comments/route";
import { DELETE as deleteComment } from "../../src/app/api/v1/repairs/[id]/comments/[commentId]/route";
import { GET as dashboard } from "../../src/app/api/v1/member/dashboard/route";
import { POST as orderCreate } from "../../src/app/api/v1/repair-orders/route";
import { POST as orderAccept } from "../../src/app/api/v1/staff/repair-orders/[id]/accept/route";
import { POST as linkedCreate } from "../../src/app/api/v1/staff/repair-orders/[id]/record/route";
import { PATCH as adminEdit } from "../../src/app/api/v1/admin/repairs/[id]/route";
import { repairService } from "../../src/features/repairs/repair-service";
import { createServeDraftForActivity } from "../../src/features/repairs/repair-service";
import { getDb, disconnectDb } from "../../src/lib/db/client";
import { authenticateRequest } from "../../src/lib/auth/request";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute } from "./http-harness";
import {
  bearerFor,
  cookieFor,
  STAFF_A_ID,
  STAFF_B_ID,
  CUSTOMER_ID,
  ADMIN_ID,
  MP_A_ID,
  MP_B_ID,
  prepareStaffRepairFixtures,
  cleanupStaffRepairFixtures,
  dataOf,
} from "./staff-repair-harness";

const enabled = integrationTestsEnabled(),
  dbTest = enabled ? test : test.skip;
let a: Record<string, string>,
  b: Record<string, string>,
  customer: Record<string, string>,
  admin: Record<string, string>;
async function cleanup() {
  const db = getDb();
  const rows = await db.repairComment.findMany({
    where: { authorMemberProfileId: { in: [MP_A_ID, MP_B_ID] } },
    select: { id: true },
  });
  await db.commentMention.deleteMany({ where: { commentId: { in: rows.map((row) => row.id) } } });
  await db.notification.deleteMany({ where: { commentId: { in: rows.map((row) => row.id) } } });
  await db.repairComment.deleteMany({
    where: { parentCommentId: { not: null }, authorMemberProfileId: { in: [MP_A_ID, MP_B_ID] } },
  });
  await db.repairComment.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
  await cleanupStaffRepairFixtures();
}
before(async () => {
  if (!enabled) return;
  await cleanup();
  await prepareStaffRepairFixtures();
  a = await bearerFor(STAFF_A_ID);
  b = await bearerFor(STAFF_B_ID);
  customer = await bearerFor(CUSTOMER_ID);
  admin = await bearerFor(ADMIN_ID);
});
after(async () => {
  if (enabled) {
    try {
      await cleanup();
    } finally {
      await disconnectDb();
    }
  }
});
function route(
  handler: Parameters<typeof callRoute>[0],
  headers: Record<string, string>,
  method = "GET",
  body?: unknown,
  id = "",
  query = "",
) {
  return callRoute(handler, "http://localhost/api/v1/fixture" + query, {
    headers: { ...headers, origin: "" },
    method,
    body,
    params: { id },
  });
}
async function draft(headers = a, body: Record<string, unknown> = {}) {
  const response = await route(
    create,
    { ...headers, "idempotency-key": randomUUID() },
    "POST",
    body,
  );
  assert.equal(response.status, 201, JSON.stringify(response.json));
  return dataOf(response.json);
}
async function actor(headers: Record<string, string>) {
  return (await authenticateRequest(new Request("http://localhost", { headers }), randomUUID()))
    .actor;
}

async function linkedDraft(key: string) {
  const made = await route(orderCreate, { ...customer, "idempotency-key": randomUUID() }, "POST", {
    deviceModel: "关联机型61",
    faultDescription: "合成测试故障",
    contactPhone: "13800138000",
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const orderId = dataOf(made.json).id as string;
  assert.equal((await route(orderAccept, a, "POST", {}, orderId)).status, 200);
  const linked = await route(linkedCreate, { ...a, "idempotency-key": key }, "POST", {}, orderId);
  assert.equal(linked.status, 201, JSON.stringify(linked.json));
  return { orderId, record: dataOf(linked.json) };
}

dbTest("关联备案机型只读：服务端拒绝改机型，仍允许机主字段编辑；独立备案可编辑机型", async () => {
  const { record, orderId } = await linkedDraft(randomUUID());
  const id = record.id as string;
  const view = dataOf((await route(detail, a, "GET", undefined, id)).json);
  assert.equal(view.canEditDeviceModel, false);
  const changed = await route(
    edit,
    a,
    "POST",
    { version: record.version, deviceModel: "串改机型" },
    id,
  );
  assert.equal(changed.status, 400);
  assert.equal(dataOf(changed.json).ownerPhone, undefined);
  assert.equal(
    (await getDb().repairRecord.findUniqueOrThrow({ where: { id } })).deviceModel,
    "关联机型61",
  );
  assert.equal(
    (await getDb().repairOrder.findUniqueOrThrow({ where: { id: orderId } })).deviceModel,
    "关联机型61",
  );
  const saved = await route(
    edit,
    a,
    "POST",
    { version: record.version, ownerName: "实际填写机主", ownerPhone: "0571-12345678" },
    id,
  );
  assert.equal(saved.status, 200);
  const privileged = await callRoute(adminEdit, "http://localhost/api/v1/fixture", {
    headers: { cookie: await cookieFor(ADMIN_ID) },
    method: "PATCH",
    body: { version: dataOf(saved.json).version, deviceModel: "管理员串改", reason: "合成验证" },
    params: { id },
  });
  assert.equal(privileged.status, 400);
  const independent = await draft(a, { deviceModel: "独立旧机型" });
  const independentId = independent.id as string;
  assert.equal(
    dataOf((await route(detail, a, "GET", undefined, independentId)).json).canEditDeviceModel,
    true,
  );
  assert.equal(
    (
      await route(
        edit,
        a,
        "POST",
        { version: independent.version, deviceModel: "独立新机型" },
        independentId,
      )
    ).status,
    200,
  );
});

dbTest("独立建档拒绝同作者报修/活动来源键；包括关联尚未建立的活动创建事件", async () => {
  const key = randomUUID();
  await linkedDraft(key);
  const count = await getDb().repairRecord.count({ where: { memberProfileId: MP_A_ID } });
  const replay = await route(create, { ...a, "idempotency-key": key }, "POST", {});
  assert.equal(replay.status, 409);
  assert.equal((replay.json.error as { code: string }).code, "IDEMPOTENCY_CONFLICT");
  assert.equal(await getDb().repairRecord.count({ where: { memberProfileId: MP_A_ID } }), count);
  const category = await getDb().repairCategory.findFirstOrThrow({
    where: { deletedAt: null, isActive: true },
  });
  const activityKey = `activity-serve:${randomUUID()}`,
    member = await actor(a);
  await getDb().$transaction((tx) =>
    createServeDraftForActivity(
      tx,
      {
        memberProfileId: MP_A_ID,
        categoryId: category.id,
        repairDate: "2026-10-13",
        ownerName: "合成活动机主",
        ownerPhone: "13800138000",
        deviceModel: null,
        createRequestKey: activityKey,
        registrationId: activityKey.slice("activity-serve:".length),
        activityId: randomUUID(),
      },
      member,
      new Date(),
    ),
  );
  const activityReplay = await route(create, { ...a, "idempotency-key": activityKey }, "POST", {});
  assert.equal(activityReplay.status, 409);
  assert.equal(activityReplay.json.data, undefined);
  const legitimate = await draft();
  const ownReplay = await route(
    create,
    {
      ...a,
      "idempotency-key": (
        await getDb().repairRecord.findUniqueOrThrow({ where: { id: legitimate.id as string } })
      ).createRequestKey,
    },
    "POST",
    {},
  );
  assert.equal(ownReplay.status, 201);
  assert.equal(dataOf(ownReplay.json).id, legitimate.id);
});

dbTest("独立备案：结果留空、作者固定、字段验证、版本冲突与编辑权限", async () => {
  const record = await draft(a, {
    deviceModel: "实验电脑61",
    ownerName: "合成机主",
    ownerPhone: "0571-12345678",
  });
  const id = record.id as string;
  assert.equal(record.result, null);
  assert.equal((record.member as { id: string }).id, MP_A_ID);
  assert.equal(record.ownerPhone, "0571-12345678");
  const edited = await route(
    edit,
    a,
    "POST",
    { version: record.version, ownerName: "另一机主", deviceModel: "另一机型" },
    id,
  );
  assert.equal(edited.status, 200);
  assert.equal(dataOf(edited.json).ownerName, "另一机主");
  assert.equal((dataOf(edited.json).member as { id: string }).id, MP_A_ID);
  assert.equal(
    (await route(edit, a, "POST", { version: record.version, content: "过期覆盖" }, id)).status,
    409,
  );
  assert.equal(
    (await route(edit, b, "POST", { version: dataOf(edited.json).version, ownerName: "越权" }, id))
      .status,
    403,
  );
  assert.equal((await route(detail, b, "GET", undefined, id)).status, 404);
  assert.equal((await route(detail, customer, "GET", undefined, id)).status, 403);
  assert.equal(
    (await route(create, { ...customer, "idempotency-key": randomUUID() }, "POST", {})).status,
    403,
  );
  assert.equal(
    (
      await route(
        edit,
        a,
        "POST",
        { version: dataOf(edited.json).version, ownerPhone: "invalid" },
        id,
      )
    ).status,
    400,
  );
  const row = await getDb().repairRecord.findUniqueOrThrow({ where: { id } });
  assert.equal(row.ownerPhone, "0571-12345678");
  assert.equal(row.content, null);
});

dbTest("独立建档并发幂等与键归属：只落一份，外国作者不能回放电话", async () => {
  const key = randomUUID();
  const responses = await Promise.all(
    Array.from({ length: 3 }, () =>
      route(create, { ...a, "idempotency-key": key }, "POST", { ownerPhone: "0571-12345678" }),
    ),
  );
  for (const response of responses)
    assert.equal(response.status, 201, JSON.stringify(response.json));
  const id = dataOf(responses[0].json).id as string;
  assert.equal(new Set(responses.map((response) => dataOf(response.json).id)).size, 1);
  assert.equal(
    await getDb().repairTimelineEvent.count({
      where: { repairRecordId: id, eventType: "CREATED" },
    }),
    1,
  );
  const replay = await route(create, { ...b, "idempotency-key": key }, "POST", {});
  assert.equal(replay.status, 409);
  assert.equal(replay.json.data, undefined);
});

dbTest("电话只给作者/审核人员；已审核库、本人列表和分页筛选不扩大范围", async () => {
  const record = await draft(a, {
    ownerName: "合成机主可见",
    ownerPhone: "13800138000",
    content: "分页61独特正文",
  });
  const id = record.id as string;
  await getDb().repairRecord.update({
    where: { id },
    data: {
      status: "APPROVED",
      repairDate: new Date("2026-10-13"),
      result: "COMPLETED",
      durationMinutes: 12,
    },
  });
  const other = dataOf((await route(detail, b, "GET", undefined, id)).json);
  assert.equal(other.ownerName, "合成机主可见");
  assert.equal(other.ownerPhone, null);
  assert.equal(other.canEdit, false);
  assert.equal(
    dataOf((await route(detail, a, "GET", undefined, id)).json).ownerPhone,
    "13800138000",
  );
  assert.equal(
    dataOf((await route(detail, admin, "GET", undefined, id)).json).ownerPhone,
    "13800138000",
  );
  const rows = (
    await route(
      list,
      b,
      "GET",
      undefined,
      "",
      "?status=APPROVED&query=分页61&result=COMPLETED&pageSize=1",
    )
  ).json.data as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ownerPhone, null);
  const mineB = (await route(mine, b, "GET", undefined, "", `?memberId=${MP_A_ID}&query=分页61`))
    .json.data as unknown[];
  assert.equal(mineB.length, 0, "服务端覆盖伪造作者筛选");
  await draft(a, { content: "分页61另一条" });
  const page1 = await route(mine, a, "GET", undefined, "", "?query=分页61&pageSize=1&page=1");
  const page2 = await route(mine, a, "GET", undefined, "", "?query=分页61&pageSize=1&page=2");
  assert.notEqual(
    (page1.json.data as Array<{ id: string }>)[0].id,
    (page2.json.data as Array<{ id: string }>)[0].id,
  );
  assert.equal((await route(mine, customer)).status, 403);
  const summary = dataOf((await route(dashboard, a)).json);
  assert.equal(
    (summary.repairSummary as { totalApprovedCount: { value: number } }).totalApprovedCount.value,
    1,
  );
  assert.ok((summary.recentActivity as Array<{ id: string }>).some((item) => item.id === id));
});

dbTest("提交幂等回放仍验证作者，不能凭已知键读取待审备案电话", async () => {
  const record = await draft(a, { ownerPhone: "0571-12345678" });
  const id = record.id as string,
    key = randomUUID();
  await getDb().repairRecord.update({ where: { id }, data: { status: "PENDING" } });
  await getDb().repairTimelineEvent.create({
    data: {
      id: randomUUID(),
      repairRecordId: id,
      actorUserId: STAFF_A_ID,
      eventType: "SUBMITTED",
      summary: { idempotencyKey: key },
      createdAt: new Date(),
    },
  });
  const response = await route(
    submit,
    { ...b, "idempotency-key": key },
    "POST",
    { version: record.version },
    id,
  );
  assert.equal(response.status, 403);
  assert.equal(response.json.data, undefined);
  const own = await route(
    submit,
    { ...a, "idempotency-key": key },
    "POST",
    { version: record.version },
    id,
  );
  assert.equal(own.status, 200);
  assert.equal(dataOf(own.json).ownerPhone, "0571-12345678");
});

dbTest("原生评论、回复归根、@去重与原有通知/删除权限；Web同源保留", async () => {
  const record = await draft();
  const id = record.id as string;
  await getDb().repairRecord.update({ where: { id }, data: { status: "APPROVED" } });
  const before = await getDb().notification.count({
    where: { recipientMemberProfileId: MP_A_ID, repairRecordId: id },
  });
  const root = await route(
    comment,
    b,
    "POST",
    { body: "另一成员实际评论", mentionedMemberProfileIds: [MP_A_ID, MP_A_ID] },
    id,
  );
  assert.equal(root.status, 201, JSON.stringify(root.json));
  const rootId = dataOf(root.json).id as string;
  assert.equal(
    await getDb().notification.count({
      where: { recipientMemberProfileId: MP_A_ID, repairRecordId: id },
    }),
    before + 1,
    "被@的作者只收到一次",
  );
  const reply = await route(
    comment,
    a,
    "POST",
    { body: "作者回复", parentCommentId: rootId, mentionedMemberProfileIds: [MP_B_ID] },
    id,
  );
  assert.equal(reply.status, 201);
  const nested = await route(
    comment,
    b,
    "POST",
    { body: "回复下的回复", parentCommentId: dataOf(reply.json).id },
    id,
  );
  assert.equal(nested.status, 201);
  assert.equal(dataOf(nested.json).parentCommentId, rootId);
  const listed = (await route(comments, a, "GET", undefined, id)).json.data as Array<{
    replies: unknown[];
  }>;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].replies.length, 2);
  const del = (headers: Record<string, string>) =>
    callRoute(deleteComment, "http://localhost/api/v1/fixture", {
      method: "DELETE",
      headers: { ...headers, origin: "" },
      params: { id, commentId: rootId },
    });
  assert.equal((await del(a)).status, 403);
  assert.equal((await del(b)).status, 200);
  assert.equal((await route(comment, customer, "POST", { body: "越权客户" }, id)).status, 403);
  assert.equal(
    (await route(comment, { authorization: b.authorization }, "POST", { body: "缺标识" }, id))
      .status,
    403,
  );
  const cookie = await cookieFor(STAFF_A_ID);
  assert.equal((await route(comment, { cookie }, "POST", { body: "无来源" }, id)).status, 403);
  const web = await callRoute(comment, "http://localhost/api/v1/fixture", {
    method: "POST",
    headers: { cookie },
    body: { body: "Web同源评论" },
    params: { id },
  });
  assert.equal(web.status, 201);
});

dbTest("草稿实质修改使旧典型来源失效；活动仅复制联系快照且作者不变", async () => {
  const record = await draft(a, { content: "旧材料61" });
  const id = record.id as string;
  const caseId = randomUUID(),
    sourceId = randomUUID(),
    now = new Date();
  await getDb().knowledgeCase.create({
    data: {
      id: caseId,
      status: "PUBLISHED",
      visibility: "PUBLIC",
      displayText: "合成旧正文",
      contentHash: "test",
      structured: {},
      createdAt: now,
    },
  });
  await getDb().knowledgeCaseSource.create({
    data: {
      id: sourceId,
      caseId,
      repairRecordId: id,
      status: "PUBLISHED",
      contentHash: "test",
      evidence: {},
      createdAt: now,
    },
  });
  const updated = await route(
    edit,
    a,
    "POST",
    { version: record.version, content: "新材料61" },
    id,
  );
  assert.equal(updated.status, 200);
  assert.notEqual(
    (await getDb().knowledgeCaseSource.findUniqueOrThrow({ where: { id: sourceId } })).status,
    "PUBLISHED",
  );
  assert.notEqual(
    (await getDb().knowledgeCase.findUniqueOrThrow({ where: { id: caseId } })).status,
    "PUBLISHED",
  );
  const category = await getDb().repairCategory.findFirstOrThrow({
    where: { deletedAt: null, isActive: true },
  });
  const aActor = await actor(a);
  const activityRegistrationId = randomUUID();
  const made = await getDb().$transaction((tx) =>
    createServeDraftForActivity(
      tx,
      {
        ownerName: "合成报名机主",
        ownerPhone: "13800138001",
        memberProfileId: MP_A_ID,
        categoryId: category.id,
        repairDate: "2026-10-13",

        deviceModel: "活动机型",
        createRequestKey: `activity-serve:${activityRegistrationId}`,
        registrationId: activityRegistrationId,
        activityId: randomUUID(),
      },
      aActor,
      now,
    ),
  );
  const row = await getDb().repairRecord.findUniqueOrThrow({ where: { id: made.repairRecordId } });
  assert.equal(row.ownerName, "合成报名机主");
  assert.equal(row.ownerPhone, "13800138001");
  assert.equal(row.memberProfileId, MP_A_ID);
  // 撤回/删除守卫继续走公共服务，而非绕过 #40。
  await repairService.softDelete(id, "合成验证删除", await actor(admin));
  assert.equal((await route(detail, a, "GET", undefined, id)).status, 404);
});
