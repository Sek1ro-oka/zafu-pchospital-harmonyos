import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import { POST as signup } from "../../src/app/api/v1/customer/repair-activities/[id]/registrations/route";
import { GET as mine } from "../../src/app/api/v1/customer/activity-registrations/route";
import {
  GET as ownGet,
  POST as ownEdit,
} from "../../src/app/api/v1/customer/activity-registrations/[regId]/route";
import { POST as anonymous } from "../../src/app/api/v1/repair-activities/[id]/registrations/route";
import { POST as lookup } from "../../src/app/api/v1/repair-activities/[id]/registrations/lookup/route";
import { POST as anonEdit } from "../../src/app/api/v1/repair-activities/[id]/registrations/[regId]/route";
import { GET as detail } from "../../src/app/api/v1/repair-activities/[id]/route";
import {
  POST as attendance,
  DELETE as cancelAttendance,
} from "../../src/app/api/v1/member/repair-activities/[id]/attendance/route";
import { POST as checkIn } from "../../src/app/api/v1/member/repair-activities/[id]/check-in/route";
import { POST as withdraw } from "../../src/app/api/v1/member/repair-activities/[id]/withdraw/route";
import { POST as serve } from "../../src/app/api/v1/member/repair-activities/[id]/serve/route";
import { GET as board } from "../../src/app/api/v1/member/repair-activities/[id]/board/route";
import { GET as phone } from "../../src/app/api/v1/member/repair-activities/[id]/registrations/[registrationId]/phone/route";
import { POST as createActivity } from "../../src/app/api/v1/admin/repair-activities/route";
import {
  POST as editActivity,
  DELETE as deleteActivity,
} from "../../src/app/api/v1/admin/repair-activities/[id]/route";
import { GET as adminRegs } from "../../src/app/api/v1/admin/repair-activities/[id]/registrations/route";
import {
  POST as editReg,
  DELETE as deleteReg,
} from "../../src/app/api/v1/admin/repair-activities/[id]/registrations/[regId]/route";
import { POST as submitRecord } from "../../src/app/api/v1/repairs/[id]/submit/route";
import { POST as editRecord } from "../../src/app/api/v1/repairs/[id]/route";
import { POST as uploadRecordPhoto } from "../../src/app/api/v1/repairs/[id]/photos/route";
import { GET as recordDetail } from "../../src/app/api/v1/repairs/[id]/route";
import { repairActivityConsentVersion } from "../../src/config/repair-activities";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import { resetRateLimitsForTests } from "../../src/lib/api/rate-limit";
import { bearerFor } from "./staff-repair-harness";
import { integrationTestsEnabled } from "./db-guard";

const enabled = integrationTestsEnabled(),
  dbTest = enabled ? test : test.skip;
const ids = [1, 2, 3, 4, 5].map((n) => `f6200000-0000-4000-8000-${n.toString().padStart(12, "0")}`);
const memberIds = [3, 4].map(
  (n) => `f6200000-0000-4000-8000-${(n + 10).toString().padStart(12, "0")}`,
);
let customer: Record<string, string>,
  other: Record<string, string>,
  staff: Record<string, string>,
  staff2: Record<string, string>,
  admin: Record<string, string>;
const activityIds: string[] = [];
type Reply = {
  status: number;
  data: Record<string, unknown>;
  code: string;
  json: Record<string, unknown>;
  headers: Headers;
};
async function call<P extends Record<string, string>>(
  handler: (request: Request, context: { params: Promise<P> }) => Promise<Response>,
  params: P,
  headers: Record<string, string>,
  method = "POST",
  body?: unknown,
  query = "",
): Promise<Reply> {
  const request = new Request("http://localhost:13082/api/v1/test" + query, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handler(request, { params: Promise.resolve(params) });
  const json = (await response.json()) as Record<string, unknown>;
  return {
    status: response.status,
    data: (json.data ?? {}) as Record<string, unknown>,
    json,
    code: (json.error as { code?: string })?.code ?? "",
    headers: response.headers,
  };
}
async function activity(capacity = 10) {
  const now = Date.now(),
    id = randomUUID();
  activityIds.push(id);
  await getDb().repairActivity.create({
    data: {
      id,
      title: "合成 #62 活动",
      location: "合成测试地点",
      capacity,
      activityAt: new Date(now + 86400000),
      signupOpensAt: new Date(now - 3600000),
      signupClosesAt: new Date(now + 3600000),
      createdAt: new Date(),
    },
  });
  return id;
}
function input(phone = "13800620001") {
  return {
    name: "合成机主",
    phone,
    issueType: "OTHER",
    deviceModel: "合成中文机型",
    consentAccepted: true,
    consentVersion: repairActivityConsentVersion,
  };
}
async function register(id: string, who = customer, mobile = "13800620001") {
  const res = await call(signup, { id }, who, "POST", input(mobile));
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.data.id as string;
}
async function close(id: string) {
  await getDb().repairActivity.update({
    where: { id },
    data: { signupClosesAt: new Date(Date.now() - 1000) },
  });
}
async function ready(id: string, regId: string, who = staff) {
  await close(id);
  assert.equal((await call(attendance, { id }, who, "POST", {})).status, 201);
  assert.equal(
    (await call(checkIn, { id }, who, "POST", { registrationIds: [regId] })).status,
    200,
  );
}
async function clearActivities() {
  const db = getDb();
  const regs = await db.repairActivityRegistration.findMany({
    where: { activityId: { in: activityIds } },
    select: { id: true, repairRecordId: true },
  });
  const records = regs.flatMap((r) => (r.repairRecordId ? [r.repairRecordId] : []));
  await db.repairActivityRegistration.deleteMany({ where: { activityId: { in: activityIds } } });
  await db.repairActivityAttendance.deleteMany({ where: { activityId: { in: activityIds } } });
  await db.repairActivity.deleteMany({ where: { id: { in: activityIds } } });
  await db.repairTimelineEvent.deleteMany({ where: { repairRecordId: { in: records } } });
  await db.repairPhoto.deleteMany({ where: { repairRecordId: { in: records } } });
  await db.repairRecord.deleteMany({ where: { id: { in: records } } });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: ids } },
        { targetId: { in: [...activityIds, ...regs.map((r) => r.id)] } },
      ],
    },
  });
  activityIds.length = 0;
}
before(async () => {
  if (!enabled) return;
  const db = getDb(),
    now = new Date();
  for (let i = 0; i < ids.length; i++) {
    await db.user.create({
      data: { id: ids[i], status: "ACTIVE", displayName: `合成 #62 用户${i}`, createdAt: now },
    });
    if (i >= 2) {
      const role = await db.role.findUniqueOrThrow({
        where: { code: i === 4 ? "ADMIN" : "MEMBER" },
      });
      await db.userRole.create({
        data: {
          id: randomUUID(),
          userId: ids[i],
          roleId: role.id,
          sourceType: "ADMIN_CREATED",
          sourceId: ids[i],
          grantedAt: now,
          activeKey: `${ids[i]}:${role.id}`,
        },
      });
    }
  }
  for (let i = 0; i < 2; i++)
    await db.memberProfile.create({
      data: {
        id: memberIds[i],
        userId: ids[i + 2],
        status: "ACTIVE",
        realName: `合成 #62 成员${i}`,
        joinedAt: now,
        createdAt: now,
      },
    });
  [customer, other, staff, staff2, admin] = await Promise.all(ids.map(bearerFor));
});
beforeEach(async () => {
  if (enabled) {
    await clearActivities();
    resetRateLimitsForTests();
  }
});
after(async () => {
  if (!enabled) return;
  await clearActivities();
  const db = getDb();
  await db.authSession.deleteMany({ where: { userId: { in: ids } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: ids } } });
  await db.userRole.deleteMany({ where: { userId: { in: ids } } });
  await db.memberProfile.deleteMany({ where: { id: { in: memberIds } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await disconnectDb();
});

dbTest("账号报名由真实会话归属；分页总数真实；详情不泄漏备案字段", async () => {
  const id = await activity(),
    res = await call(signup, { id }, customer, "POST", {
      ...input(),
      userId: ids[1],
      roles: ["ADMIN"],
      memberProfileId: memberIds[0],
    });
  assert.equal(res.status, 201);
  const reg = res.data.id as string;
  assert.equal(
    (await getDb().repairActivityRegistration.findUniqueOrThrow({ where: { id: reg } })).userId,
    ids[0],
  );
  const list = await call(mine, {}, customer, "GET", undefined, "?page=1&pageSize=1");
  assert.equal((list.json.data as unknown[]).length, 1);
  assert.deepEqual((list.json.meta as { pagination: unknown }).pagination, {
    page: 1,
    pageSize: 1,
    total: 1,
    totalPages: 1,
  });
  const one = await call(ownGet, { regId: reg }, customer, "GET", undefined, `?activityId=${id}`);
  assert.equal(one.status, 200);
  for (const key of ["repairRecordId", "ownerPhone", "content", "photos", "comments"])
    assert.equal(one.data[key], undefined);
  const again = await bearerFor(ids[0]);
  assert.equal((await call(mine, {}, again, "GET")).status, 200);
});
dbTest("另一账号读/改与伪造活动 ID 均 404，不能重写所有权", async () => {
  const id = await activity(),
    reg = await register(id);
  for (const who of [other]) {
    assert.equal(
      (await call(ownGet, { regId: reg }, who, "GET", undefined, `?activityId=${id}`)).status,
      404,
    );
    assert.equal(
      (
        await call(ownEdit, { regId: reg }, who, "POST", {
          activityId: id,
          issueType: "CLEAN_ONLY",
          userId: ids[0],
        })
      ).status,
      404,
    );
  }
  assert.equal(
    (await call(ownGet, { regId: reg }, customer, "GET", undefined, `?activityId=${randomUUID()}`))
      .status,
    404,
  );
  assert.equal(
    (
      await call(lookup, { id }, { origin: "http://localhost:13082" }, "POST", {
        phone: input().phone,
      })
    ).status,
    404,
  );
  const changed = await call(ownEdit, { regId: reg }, customer, "POST", {
    activityId: id,
    issueType: "CLEAN_ONLY",
    userId: ids[1],
  });
  assert.equal(changed.status, 200);
  assert.equal(
    (await getDb().repairActivityRegistration.findUniqueOrThrow({ where: { id: reg } })).userId,
    ids[0],
  );
});
dbTest("匿名与同手机号账号不自动关联，旧查询凭证仍可编辑且校验电话", async () => {
  const id = await activity(),
    web = { origin: "http://localhost:13082" };
  const res = await call(anonymous, { id }, web, "POST", input());
  assert.equal(res.status, 201);
  const reg = res.data.id as string;
  assert.equal(
    (await getDb().repairActivityRegistration.findUniqueOrThrow({ where: { id: reg } })).userId,
    null,
  );
  assert.equal((await call(mine, {}, customer, "GET")).json.data instanceof Array, true);
  assert.equal(((await call(mine, {}, customer, "GET")).json.data as unknown[]).length, 0);
  assert.equal(
    (await call(signup, { id }, customer, "POST", input())).code,
    "ACTIVITY_REGISTRATION_DUPLICATE",
  );
  const found = await call(lookup, { id }, web, "POST", { phone: input().phone });
  assert.equal(found.status, 200);
  const changed = await call(anonEdit, { id, regId: reg }, web, "POST", {
    phone: input().phone,
    editToken: found.data.editToken,
    issueType: "CLEAN_ONLY",
  });
  assert.equal(changed.status, 200);
  resetRateLimitsForTests();
  assert.equal(
    (
      await call(anonEdit, { id, regId: reg }, web, "POST", {
        phone: "13800620002",
        editToken: found.data.editToken,
        issueType: "OTHER",
      })
    ).status,
    404,
  );
});
dbTest("账号入口必须有凭证和 Native 标识，Cookie 优先保留 Origin 保护", async () => {
  const id = await activity();
  assert.equal(
    (await call(signup, { id }, { "x-client-type": "native" }, "POST", input())).status,
    401,
  );
  assert.equal(
    (await call(signup, { id }, { authorization: customer.authorization }, "POST", input())).status,
    403,
  );
  assert.equal(
    (
      await call(
        signup,
        { id },
        { ...customer, cookie: "pc_hospital_session=invalid", origin: "https://evil.example" },
        "POST",
        input(),
      )
    ).status,
    403,
  );
});
dbTest("条款缺同意/旧版本拒绝；旧 Web 省略版本仍兼容", async () => {
  const id = await activity();
  assert.equal(
    (await call(signup, { id }, customer, "POST", { ...input(), consentAccepted: false })).code,
    "ACTIVITY_CONSENT_REQUIRED",
  );
  assert.equal(
    (await call(signup, { id }, customer, "POST", { ...input(), consentVersion: "old" })).code,
    "ACTIVITY_CONSENT_VERSION_CHANGED",
  );
  assert.equal(
    (await call(signup, { id }, customer, "POST", { ...input(), consentVersion: undefined }))
      .status,
    409,
  );
  const res = await call(anonymous, { id }, { origin: "http://localhost:13082" }, "POST", {
    ...input(),
    consentVersion: undefined,
  });
  assert.equal(res.status, 201);
  const row = await getDb().repairActivityRegistration.findUniqueOrThrow({
    where: { id: res.data.id as string },
  });
  assert.equal(row.consentVersion, repairActivityConsentVersion);
  assert.ok(row.consentAcceptedAt);
});
dbTest("详情返回真实地点/条款，历史空地点与条款不伪造", async () => {
  const id = await activity(),
    d = await call(detail, { id }, {}, "GET");
  assert.equal(d.data.location, "合成测试地点");
  assert.equal((d.data.consent as { version: string }).version, repairActivityConsentVersion);
  await getDb().repairActivity.update({
    where: { id },
    data: { location: null, activityAt: new Date(Date.now() - 1000) },
  });
  assert.equal((await call(detail, { id }, {}, "GET")).data.location, null);
  const row = await getDb().repairActivityRegistration.create({
    data: {
      id: randomUUID(),
      activityId: id,
      name: "合成历史匿名",
      phone: "13800629999",
      phoneLast4: "9999",
      issueType: "OTHER",
      status: "REGISTERED",
      createdAt: new Date(),
    },
  });
  assert.equal(row.userId, null);
  assert.equal(row.consentVersion, null);
  assert.equal(row.consentAcceptedAt, null);
});
dbTest("窗口、活动开始边界与最后名额并发不会超报", async () => {
  const id = await activity(1);
  const results = await Promise.all([
    call(signup, { id }, customer, "POST", input()),
    call(signup, { id }, other, "POST", input("13800620002")),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await getDb().repairActivityRegistration.count({ where: { activityId: id } }), 1);
  const next = await activity();
  await getDb().repairActivity.update({
    where: { id: next },
    data: { signupOpensAt: new Date(Date.now() + 10000) },
  });
  assert.equal(
    (await call(signup, { id: next }, customer, "POST", input())).code,
    "ACTIVITY_NOT_OPEN",
  );
  await close(next);
  assert.equal(
    (await call(signup, { id: next }, customer, "POST", input())).code,
    "ACTIVITY_NOT_OPEN",
  );
  await getDb().repairActivity.update({
    where: { id: next },
    data: { activityAt: new Date(Date.now() - 1000) },
  });
  assert.equal(
    (await call(signup, { id: next }, customer, "POST", input())).code,
    "ACTIVITY_ENDED",
  );
});
dbTest("重复手机号并发不产生重复报名；账号可按原规则使用不同联系快照", async () => {
  const id = await activity();
  const results = await Promise.all([
    call(signup, { id }, customer, "POST", input()),
    call(signup, { id }, customer, "POST", input()),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await getDb().repairActivityRegistration.count({ where: { activityId: id } }), 1);
  assert.equal((await call(signup, { id }, customer, "POST", input("13800620002"))).status, 201);
});
dbTest("本人截止后可改类型；签到/已接待后拒绝；撤回排队不释放名额", async () => {
  const id = await activity(),
    reg = await register(id);
  await close(id);
  assert.equal(
    (
      await call(ownEdit, { regId: reg }, customer, "POST", {
        activityId: id,
        issueType: "CLEAN_ONLY",
      })
    ).status,
    200,
  );
  await ready(id, reg);
  assert.equal(
    (await call(ownEdit, { regId: reg }, customer, "POST", { activityId: id, issueType: "OTHER" }))
      .status,
    409,
  );
  assert.equal((await call(withdraw, { id }, staff, "POST", { registrationId: reg })).status, 200);
  assert.equal((await call(detail, { id }, {}, "GET")).data.registeredCount, 1);
  const row = await getDb().repairActivityRegistration.findUniqueOrThrow({ where: { id: reg } });
  assert.equal(row.checkedInAt, null);
  assert.equal(row.status, "REGISTERED");
});
dbTest("出勤截止闸门与纯管理员有效成员检查", async () => {
  const id = await activity(),
    reg = await register(id);
  assert.equal((await call(attendance, { id }, staff, "POST", {})).code, "ACTIVITY_NOT_OPEN");
  await close(id);
  assert.equal(
    (await call(checkIn, { id }, staff, "POST", { registrationIds: [reg] })).code,
    "ACTIVITY_ATTENDANCE_REQUIRED",
  );
  assert.equal((await call(attendance, { id }, admin, "POST", {})).code, "MEMBER_REQUIRED");
  assert.equal((await call(board, { id }, customer, "GET")).status, 403);
});
dbTest("签到时改故障类型有审计；重试不改已入队类型；队列按真实签到时间", async () => {
  const id = await activity(),
    first = await register(id),
    second = await register(id, other, "13800620002");
  await close(id);
  await call(attendance, { id }, staff, "POST", {});
  const res = await call(checkIn, { id }, staff, "POST", {
    registrationIds: [first],
    issueTypeUpdates: [{ registrationId: first, issueType: "CLEAN_ONLY" }],
  });
  assert.equal(res.status, 200);
  assert.equal(
    (await getDb().repairActivityRegistration.findUniqueOrThrow({ where: { id: first } }))
      .issueType,
    "CLEAN_ONLY",
  );
  assert.equal(
    (
      await call(checkIn, { id }, staff, "POST", {
        registrationIds: [first],
        issueTypeUpdates: [{ registrationId: first, issueType: "OTHER" }],
      })
    ).status,
    409,
  );
  assert.equal(
    (await call(checkIn, { id }, staff, "POST", { registrationIds: [second] })).status,
    200,
  );
  const view = await call(board, { id }, staff, "GET");
  assert.deepEqual(
    (view.data.queue as { id: string }[]).map((r) => r.id),
    [first, second],
  );
  assert.ok(
    await getDb().auditLog.count({
      where: { targetId: first, action: "repair_activity.registration_issue_type_updated" },
    }),
  );
});
dbTest("电话读取无出勤前提，有审计且禁止缓存；列表掩码；客户/纯管理员拒绝", async () => {
  const id = await activity(),
    reg = await register(id);
  const response = await call(phone, { id, registrationId: reg }, staff, "GET");
  assert.equal(response.status, 200);
  assert.equal(response.data.phone, input().phone);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await call(phone, { id, registrationId: reg }, customer, "GET")).status, 403);
  assert.equal(
    (await call(phone, { id, registrationId: reg }, admin, "GET")).code,
    "MEMBER_REQUIRED",
  );
  const view = await call(board, { id }, staff, "GET"),
    row = (view.data.eligible as Record<string, unknown>[])[0];
  assert.equal(row.phone, undefined);
  assert.notEqual(row.phoneMasked, input().phone);
  const audit = await getDb().auditLog.findFirstOrThrow({
    where: { targetId: reg, action: "repair_activity.registration_phone.viewed" },
  });
  assert.ok(!JSON.stringify(audit).includes(input().phone));
});
dbTest("两成员竞争接待只生成一份真实草稿，不自动填结果/正文/时长/提交", async () => {
  const id = await activity(),
    reg = await register(id);
  await ready(id, reg);
  await call(attendance, { id }, staff2, "POST", {});
  const results = await Promise.all([
    call(serve, { id }, staff, "POST", { registrationId: reg }),
    call(serve, { id }, staff2, "POST", { registrationId: reg }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const record = await getDb().repairRecord.findUniqueOrThrow({
    where: { createRequestKey: `activity-serve:${reg}` },
  });
  assert.equal(record.status, "DRAFT");
  assert.equal(record.ownerName, input().name);
  assert.equal(record.ownerPhone, input().phone);
  assert.equal(record.deviceModel, input().deviceModel);
  for (const key of ["content", "result", "durationMinutes", "remark", "submittedAt"] as const)
    assert.equal(record[key], null);
  assert.equal(
    await getDb().repairTimelineEvent.count({
      where: { repairRecordId: record.id, eventType: "SUBMITTED" },
    }),
    0,
  );
  assert.equal((await call(withdraw, { id }, staff, "POST", { registrationId: reg })).status, 409);
  const view = await call(board, { id }, staff, "GET");
  assert.equal((view.data.served as unknown[]).length, 1);
  assert.equal((await call(recordDetail, { id: record.id }, customer, "GET")).status, 403);
});
dbTest("同一成员跨活动并发接待最多一个未提交草稿；看板可继续填写", async () => {
  const a = await activity(),
    b = await activity(),
    ra = await register(a),
    rb = await register(b, other, "13800620002");
  await ready(a, ra);
  await ready(b, rb);
  const results = await Promise.all([
    call(serve, { id: a }, staff, "POST", { registrationId: ra }),
    call(serve, { id: b }, staff, "POST", { registrationId: rb }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(results.find((r) => r.status === 409)?.code, "ACTIVITY_SERVE_DRAFT_PENDING");
  const view = await call(board, { id: a }, staff, "GET");
  assert.ok((view.data.pendingServeDraft as { repairRecordId: string }).repairRecordId);
  assert.equal(
    await getDb().repairRecord.count({
      where: { memberProfileId: memberIds[0], status: "DRAFT", deletedAt: null },
    }),
    1,
  );
});
dbTest("真实接待草稿仍保留课设备案提交门槛", async () => {
  const id = await activity(),
    reg = await register(id);
  await ready(id, reg);
  const served = await call(serve, { id }, staff, "POST", { registrationId: reg }),
    recordId = served.data.repairRecordId as string;
  const res = await call(
    submitRecord,
    { id: recordId },
    { ...staff, "idempotency-key": randomUUID() },
    "POST",
    { version: 1 },
  );
  assert.equal(res.status, 400);
  assert.ok(["REPAIR_SUBMISSION_INCOMPLETE", "REPAIR_PHOTO_REQUIRED"].includes(res.code));
  assert.equal(
    (await getDb().repairRecord.findUniqueOrThrow({ where: { id: recordId } })).status,
    "DRAFT",
  );
  const category = await getDb().repairCategory.findFirstOrThrow({
    where: { isActive: true, deletedAt: null },
  });
  let current = await getDb().repairRecord.findUniqueOrThrow({ where: { id: recordId } });
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const saved = await call(editRecord, { id: recordId }, staff, "POST", {
    version: current.version,
    repairDate: date,
    categoryId: category.id,
    content: "合成验证：现场检查风扇并清理积灰后测试温度。",
    result: "COMPLETED",
    durationMinutes: 20,
  });
  assert.equal(saved.status, 200);
  current = await getDb().repairRecord.findUniqueOrThrow({ where: { id: recordId } });
  const noPhoto = await call(
    submitRecord,
    { id: recordId },
    { ...staff, "idempotency-key": randomUUID() },
    "POST",
    { version: current.version },
  );
  assert.equal(noPhoto.code, "REPAIR_SUBMISSION_INCOMPLETE");
  assert.ok((noPhoto.json.error as { fieldErrors: Record<string, unknown> }).fieldErrors.photos);
  const image = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1sAAAAASUVORK5CYII=",
      "base64",
    ),
  ).buffer;
  const form = new FormData();
  form.append("photos", new File([image], "synthetic-activity.png", { type: "image/png" }));
  const upload = await uploadRecordPhoto(
    new Request("http://localhost:13082/api/v1/repairs/" + recordId + "/photos", {
      method: "POST",
      headers: staff,
      body: form,
    }),
    { params: Promise.resolve({ id: recordId }) },
  );
  assert.equal(upload.status, 201);
  current = await getDb().repairRecord.findUniqueOrThrow({ where: { id: recordId } });
  const submitted = await call(
    submitRecord,
    { id: recordId },
    { ...staff, "idempotency-key": randomUUID() },
    "POST",
    { version: current.version },
  );
  assert.equal(submitted.status, 200);
  assert.equal((await cancel(id)).code, "ACTIVITY_ATTENDANCE_CANCEL_BLOCKED");
  assert.equal(
    (await getDb().repairRecord.findUniqueOrThrow({ where: { id: recordId } })).status,
    "PENDING",
  );
});
dbTest("管理员创建/编辑地点、容量与报名管理；成员管理拒绝；软删释放名额", async () => {
  const now = Date.now(),
    body = {
      title: "合成管理活动",
      location: "合成地点",
      capacity: 3,
      activityAt: new Date(now + 86400000).toISOString(),
      signupOpensAt: new Date(now - 3600000).toISOString(),
      signupClosesAt: new Date(now + 3600000).toISOString(),
    };
  assert.equal((await call(createActivity, {}, staff, "POST", body)).status, 403);
  const created = await call(createActivity, {}, admin, "POST", body);
  assert.equal(created.status, 201);
  const id = created.data.id as string;
  activityIds.push(id);
  const reg = await register(id);
  assert.equal(
    (await call(editActivity, { id }, admin, "POST", { location: "合成新地点", capacity: 1 }))
      .status,
    200,
  );
  assert.equal((await call(editActivity, { id }, admin, "POST", { capacity: 0 })).status, 400);
  assert.equal(
    (
      await call(editActivity, { id }, admin, "POST", {
        signupOpensAt: new Date(now + 7200000).toISOString(),
      })
    ).status,
    400,
  );
  assert.equal(
    (await call(editReg, { id, regId: reg }, admin, "POST", { issueType: "CLEAN_ONLY" })).status,
    200,
  );
  const listed = await call(adminRegs, { id }, admin, "GET");
  assert.equal((listed.json.data as Record<string, unknown>[])[0].phone, undefined);
  assert.equal((await call(deleteReg, { id, regId: reg }, admin, "DELETE")).status, 200);
  assert.equal((await call(detail, { id }, {}, "GET")).data.registeredCount, 0);
  assert.equal((await call(deleteActivity, { id }, admin, "DELETE")).status, 200);
  assert.equal((await call(detail, { id }, {}, "GET")).status, 404);
});
dbTest("手机号限流继续生效，拒绝请求不留报名", async () => {
  const id = await activity();
  for (let i = 0; i < 5; i++)
    await call(signup, { id }, customer, "POST", { ...input(), consentAccepted: false });
  const res = await call(signup, { id }, customer, "POST", input());
  assert.equal(res.status, 429);
  assert.equal(await getDb().repairActivityRegistration.count({ where: { activityId: id } }), 0);
});

dbTest("本人默认分页跨页读取真实总数，其他账号仍为空", async () => {
  const id = await activity(30);
  await getDb().repairActivityRegistration.createMany({
    data: Array.from({ length: 21 }, (_, index) => ({
      id: randomUUID(),
      activityId: id,
      userId: ids[0],
      name: "合成分页报名",
      phone: String(13800621000 + index),
      phoneLast4: String(1000 + index),
      issueType: "OTHER",
      status: "REGISTERED",
      createdAt: new Date(Date.now() + index),
    })),
  });
  const first = await call(mine, {}, customer, "GET", undefined, "?page=1");
  const second = await call(mine, {}, customer, "GET", undefined, "?page=2");
  assert.equal((first.json.data as unknown[]).length, 20);
  assert.equal((second.json.data as unknown[]).length, 1);
  assert.deepEqual((second.json.meta as { pagination: unknown }).pagination, {
    page: 2,
    pageSize: 20,
    total: 21,
    totalPages: 2,
  });
  assert.equal(((await call(mine, {}, other, "GET")).json.data as unknown[]).length, 0);
  assert.equal((await call(mine, {}, customer, "GET", undefined, "?page=0")).status, 400);
});

dbTest("停用分类映射时接待仍生成留空分类的草稿，纯管理员不能现场操作", async () => {
  const id = await activity(),
    reg = await register(id);
  await ready(id, reg);
  for (const handler of [checkIn, withdraw, serve]) {
    const body = handler === checkIn ? { registrationIds: [reg] } : { registrationId: reg };
    assert.equal((await call(handler, { id }, admin, "POST", body)).code, "MEMBER_REQUIRED");
  }
  const categories = await getDb().repairCategory.findMany({
    where: { code: "OTHER_FAULT", isActive: true, deletedAt: null },
    select: { id: true },
  });
  await getDb().repairCategory.updateMany({
    where: { id: { in: categories.map((row) => row.id) } },
    data: { isActive: false },
  });
  try {
    const response = await call(serve, { id }, staff, "POST", { registrationId: reg });
    assert.equal(response.status, 201);
    const record = await getDb().repairRecord.findUniqueOrThrow({
      where: { id: response.data.repairRecordId as string },
    });
    assert.equal(record.categoryId, null);
    assert.equal(record.status, "DRAFT");
  } finally {
    await getDb().repairCategory.updateMany({
      where: { id: { in: categories.map((row) => row.id) } },
      data: { isActive: true },
    });
  }
});

async function attendanceRow(id: string, member = memberIds[0]) {
  return getDb().repairActivityAttendance.findUniqueOrThrow({
    where: { activityId_memberProfileId: { activityId: id, memberProfileId: member } },
  });
}
async function cancel(id: string, who = staff) {
  return call(cancelAttendance, { id }, who, "DELETE");
}

dbTest("C01/C02 未处理出勤可取消/重标；重复调用不增加记录或变更审计", async () => {
  const id = await activity();
  await close(id);
  assert.equal((await cancel(id)).status, 200);
  await call(attendance, { id }, staff, "POST", {});
  const original = await attendanceRow(id);
  await call(attendance, { id }, staff, "POST", {});
  assert.equal((await cancel(id)).status, 200);
  assert.equal((await cancel(id)).data.attended, false);
  const cancelled = await attendanceRow(id);
  assert.ok(cancelled.cancelledAt);
  const view = await call(board, { id }, staff, "GET");
  assert.equal(view.data.attended, false);
  assert.equal(view.data.attendanceCheckedInAt, null);
  assert.equal(
    await getDb().auditLog.count({
      where: { targetId: original.id, action: "repair_activity.attendance_cancelled" },
    }),
    1,
  );
  await call(attendance, { id }, staff, "POST", {});
  assert.equal((await attendanceRow(id)).id, original.id);
  assert.equal((await attendanceRow(id)).cancelledAt, null);
  assert.equal((await call(board, { id }, staff, "GET")).data.canCancelAttendance, true);
});

dbTest("C03/C04 签到再撤回、接待及提交都不能清除本场处理事实", async () => {
  const id = await activity(),
    reg = await register(id);
  await ready(id, reg);
  assert.ok((await attendanceRow(id)).businessStartedAt);
  assert.equal((await cancel(id)).code, "ACTIVITY_ATTENDANCE_CANCEL_BLOCKED");
  await call(withdraw, { id }, staff, "POST", { registrationId: reg });
  assert.equal((await cancel(id)).status, 409);
  await call(checkIn, { id }, staff, "POST", { registrationIds: [reg] });
  const res = await call(serve, { id }, staff, "POST", { registrationId: reg });
  assert.equal(res.status, 201);
  assert.equal((await cancel(id)).status, 409);
  assert.equal((await call(board, { id }, staff, "GET")).data.canCancelAttendance, false);
  assert.equal(
    (await getDb().repairActivityRegistration.findUniqueOrThrow({ where: { id: reg } }))
      .repairRecordId,
    res.data.repairRecordId,
  );
});

dbTest("C04 本人仅撤回另一成员签到的队列也会永久阻止取消", async () => {
  const id = await activity(),
    reg = await register(id);
  await ready(id, reg, staff2);
  await call(attendance, { id }, staff, "POST", {});
  assert.equal((await call(withdraw, { id }, staff, "POST", { registrationId: reg })).status, 200);
  assert.equal((await cancel(id)).status, 409);
});

dbTest("C05 另一成员本场处理、本人其它场处理不误伤；电话读取仍可取消", async () => {
  const id = await activity(),
    reg = await register(id),
    otherId = await activity(),
    otherReg = await register(otherId);
  await ready(id, reg, staff2);
  await ready(otherId, otherReg, staff);
  await call(attendance, { id }, staff, "POST", {});
  assert.equal((await call(phone, { id, registrationId: reg }, staff, "GET")).status, 200);
  assert.equal((await cancel(id)).status, 200);
  assert.equal((await attendanceRow(id, memberIds[1])).cancelledAt, null);
  assert.equal((await attendanceRow(otherId)).cancelledAt, null);
  assert.equal((await call(phone, { id, registrationId: reg }, staff, "GET")).status, 200);
  assert.equal(
    (await call(checkIn, { id }, staff, "POST", { registrationIds: [reg] })).code,
    "ACTIVITY_ATTENDANCE_REQUIRED",
  );
});

dbTest("C06 多条签到中后条验证失败会回滚报名/业务标记/审计", async () => {
  const id = await activity(),
    reg = await register(id);
  await close(id);
  await call(attendance, { id }, staff, "POST", {});
  const res = await call(checkIn, { id }, staff, "POST", { registrationIds: [reg, randomUUID()] });
  assert.equal(res.status, 404);
  assert.equal((await attendanceRow(id)).businessStartedAt, null);
  assert.equal(
    (await getDb().repairActivityRegistration.findUniqueOrThrow({ where: { id: reg } })).status,
    "REGISTERED",
  );
  assert.equal((await cancel(id)).status, 200);
});

for (const kind of ["check-in", "serve", "withdraw"])
  dbTest("C07 取消与" + kind + "并发只允许合法一方成功", async () => {
    for (let iteration = 0; iteration < 3; iteration++) {
      const id = await activity(),
        reg = await register(id);
      await close(id);
      if (kind !== "check-in") await ready(id, reg, staff2);
      await call(attendance, { id }, staff, "POST", {});
      const op =
        kind === "check-in"
          ? () => call(checkIn, { id }, staff, "POST", { registrationIds: [reg] })
          : () =>
              call(kind === "serve" ? serve : withdraw, { id }, staff, "POST", {
                registrationId: reg,
              });
      const [c, w] = await Promise.all(
        iteration % 2 ? [op(), cancel(id)].map((p) => p).reverse() : [cancel(id), op()],
      );
      assert.equal(
        [c.status, w.status].filter((x) => x >= 200 && x < 300).length,
        1,
        JSON.stringify([c, w]),
      );
      if (c.status === 200) {
        assert.equal(w.code, "ACTIVITY_ATTENDANCE_REQUIRED");
        assert.ok((await attendanceRow(id)).cancelledAt);
      } else {
        assert.equal(c.code, "ACTIVITY_ATTENDANCE_CANCEL_BLOCKED");
        assert.equal((await attendanceRow(id)).cancelledAt, null);
      }
      // Keep later iterations independent of the legitimate pending-draft guard.
      if (kind === "serve" && w.status === 201)
        await getDb().repairRecord.update({
          where: { id: w.data.repairRecordId as string },
          data: { status: "PENDING" },
        });
    }
  });

dbTest("C08 旧出勤空标记仍识别已软删报名的签到撤回历史", async () => {
  const id = await activity(),
    reg = await register(id);
  await ready(id, reg);
  await call(withdraw, { id }, staff, "POST", { registrationId: reg });
  await getDb().repairActivityAttendance.update({
    where: { id: (await attendanceRow(id)).id },
    data: { businessStartedAt: null },
  });
  await getDb().repairActivityRegistration.update({
    where: { id: reg },
    data: { deletedAt: new Date() },
  });
  assert.equal((await cancel(id)).code, "ACTIVITY_ATTENDANCE_CANCEL_BLOCKED");
  // Legacy withdraw evidence also suffices without the batch check-in event.
  await getDb().auditLog.deleteMany({
    where: { targetId: id, action: "repair_activity.registrations_checked_in" },
  });
  assert.equal((await cancel(id)).status, 409);
});

dbTest("C09/C10 取消只定位本人，鉴权/Origin/native 与活动存在校验保持", async () => {
  const id = await activity();
  await close(id);
  await call(attendance, { id }, staff, "POST", {});
  await call(attendance, { id }, staff2, "POST", {});
  for (const who of [{}, customer, admin]) assert.ok((await cancel(id, who)).status >= 400);
  assert.equal(
    (await call(cancelAttendance, { id }, { Authorization: staff.authorization }, "DELETE")).status,
    403,
  );
  assert.equal(
    (
      await call(
        cancelAttendance,
        { id },
        {
          Cookie: "pc_hospital_session=" + staff.authorization.slice(7),
          Origin: "https://evil.example",
        },
        "DELETE",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(cancelAttendance, { id }, staff, "DELETE", {
        memberProfileId: memberIds[1],
        userId: ids[3],
      })
    ).status,
    200,
  );
  assert.equal((await attendanceRow(id, memberIds[1])).cancelledAt, null);
  assert.equal((await cancel(randomUUID())).status, 404);
  const cookie = {
    Cookie: "pc_hospital_session=" + staff2.authorization.slice(7),
    Origin: "http://localhost:13082",
  };
  assert.equal((await cancel(id, cookie)).status, 200);
});
