import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { POST } from "../../src/app/api/v1/repair-activities/[id]/registrations/route";
import { repairActivityService } from "../../src/features/repair-activities/repair-activity-service";
import { repairActivityStaffService } from "../../src/features/repair-activities/repair-activity-staff-service";
import { REPAIR_ACTIVITY_DEVICE_MODEL_MAX_LENGTH } from "../../src/features/repair-activities/repair-activity-validation";
import { resetRateLimitsForTests } from "../../src/lib/api/rate-limit";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import type { AuthorizedActor } from "../../src/types/contracts";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute } from "./http-harness";

/* 集成测试的统一闸门：指向非测试库时**在加载阶段就抛错**（`db-guard.ts` 里写了两次
   实际事故）。未开启时返回 false，各文件照常走 test.skip。 */
const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

/**
 * 活动报名「选填机型」的集成测试（真实 GreatSQL，issue #68）。
 *
 * 这条链路横跨三个组件，任何一段断开都只有真库能测出来：
 *   公开报名（写 deviceModel）→ 接待台签到排队 → 接待落单（把机型复制进维修记录）。
 * 单测只覆盖 `assertValidDeviceModel` 这个纯函数；「落库列是否真的写进去」
 * 「落单时是否真的带过去」必须打到路由 / Service 才有意义。
 *
 * 独立的 UUID 段 `e6800000-…` 与标题前缀 "REG68 " —— 清理一律按这两者限定，
 * 绝不触碰库里已有的活动与报名（那是开发者/生产同源的开发数据）。
 */
const ACTIVITY_ID = "e6800000-0000-4000-8000-000000000001";
const ACTIVITY_TITLE = "REG68 机型集成测试活动";
const STAFF_USER_ID = "e6800000-0000-4000-8000-000000000002";
const STAFF_PROFILE_ID = "e6800000-0000-4000-8000-000000000003";
/** 兜底分类：seed 里已有 SYSTEM，这里只防「未跑 seed 的空库」把用例误判成失败。 */
const SYSTEM_CATEGORY_ID = "e6800000-0000-4000-8000-000000000004";
const REGISTRATION_PATH = `http://localhost/api/v1/repair-activities/${ACTIVITY_ID}/registrations`;

/** 失败信封里的错误码（`apiFailure` 的 `error.code`）。 */
function errorCodeOf(json: Record<string, unknown>): string | undefined {
  return (json.error as { code?: string } | undefined)?.code;
}

function fieldErrorsOf(json: Record<string, unknown>): Record<string, string[]> | undefined {
  return (json.error as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
}

/**
 * 清理本文件产生的全部行。
 *
 * 顺序由外键决定：审计 / 时间线是 RESTRICT 子表，维修记录与报名是父表；
 * 接待员的用户行还被审计与时间线的 `actorUserId` 引用，必须最后删。
 */
async function cleanupFixtures(): Promise<void> {
  const db = getDb();
  const registrations = await db.repairActivityRegistration.findMany({
    where: { activityId: ACTIVITY_ID },
    select: { id: true, repairRecordId: true },
  });
  const registrationIds = registrations.map((row) => row.id);
  // 落单记录以 `memberProfileId = 接待员` 限定，够窄且不依赖报名上的回链。
  const records = await db.repairRecord.findMany({
    where: {
      memberProfileId: STAFF_PROFILE_ID,
      createRequestKey: { startsWith: "activity-serve:" },
    },
    select: { id: true },
  });
  const recordIds = [
    ...new Set([
      ...records.map((row) => row.id),
      ...registrations.flatMap((row) => (row.repairRecordId ? [row.repairRecordId] : [])),
    ]),
  ];

  if (recordIds.length > 0) {
    await db.repairTimelineEvent.deleteMany({ where: { repairRecordId: { in: recordIds } } });
    await db.auditLog.deleteMany({
      where: { targetType: "RepairRecord", targetId: { in: recordIds } },
    });
  }
  if (registrationIds.length > 0) {
    await db.auditLog.deleteMany({
      where: { targetType: "RepairActivityRegistration", targetId: { in: registrationIds } },
    });
  }
  const attendanceIds = (
    await db.repairActivityAttendance.findMany({
      where: { activityId: ACTIVITY_ID },
      select: { id: true },
    })
  ).map((row) => row.id);
  if (attendanceIds.length > 0) {
    await db.auditLog.deleteMany({
      where: { targetType: "RepairActivityAttendance", targetId: { in: attendanceIds } },
    });
  }
  // 接待台动作的审计以活动为 target，直接按 actor 兜底清一次。
  await db.auditLog.deleteMany({ where: { actorUserId: STAFF_USER_ID } });

  await db.repairActivityRegistration.deleteMany({ where: { activityId: ACTIVITY_ID } });
  await db.repairActivityAttendance.deleteMany({ where: { activityId: ACTIVITY_ID } });
  if (recordIds.length > 0) {
    await db.repairRecord.deleteMany({ where: { id: { in: recordIds } } });
  }
  await db.repairActivity.deleteMany({ where: { id: ACTIVITY_ID } });
  await db.memberProfile.deleteMany({ where: { id: STAFF_PROFILE_ID } });
  await db.user.deleteMany({ where: { id: STAFF_USER_ID } });
}

/**
 * 活动建在「报名窗口内、名额未满」——只有 OPEN 才报得上名。
 * 接待员另建一个 ACTIVE 成员档案：`activity:staff` 的动作都要求「用户 ↔ 成员档案」。
 */
async function prepareFixtures(): Promise<void> {
  await cleanupFixtures();
  const db = getDb();
  const now = new Date();
  const hour = 60 * 60 * 1000;
  await db.user.create({
    data: {
      id: STAFF_USER_ID,
      status: "ACTIVE",
      displayName: "REG68 接待员",
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.memberProfile.create({
    data: {
      id: STAFF_PROFILE_ID,
      userId: STAFF_USER_ID,
      realName: "REG68 接待员",
      status: "ACTIVE",
      joinedAt: now,
      createdAt: now,
    },
  });
  await db.repairActivity.create({
    data: {
      id: ACTIVITY_ID,
      title: ACTIVITY_TITLE,
      activityAt: new Date(now.getTime() + 7 * 24 * hour),
      capacity: 20,
      signupOpensAt: new Date(now.getTime() - hour),
      signupClosesAt: new Date(now.getTime() + 24 * hour),
      createdAt: now,
      updatedAt: now,
    },
  });
  const system = await db.repairCategory.findFirst({ where: { code: "SYSTEM" } });
  if (!system) {
    await db.repairCategory.create({
      data: {
        id: SYSTEM_CATEGORY_ID,
        code: "SYSTEM",
        name: "系统问题",
        sortOrder: 90,
        createdAt: now,
      },
    });
  }
}

const staffActor: AuthorizedActor = {
  actorType: "USER",
  userId: STAFF_USER_ID,
  userStatus: "ACTIVE",
  permissions: permissionsForRoles(["ADMIN"]),
  requestId: "req_reg68_staff",
};

const adminActor: AuthorizedActor = {
  actorType: "USER",
  userId: STAFF_USER_ID,
  userStatus: "ACTIVE",
  permissions: permissionsForRoles(["ADMIN"]),
  requestId: "req_reg68_admin",
};

function signup(body: Record<string, unknown>) {
  return callRoute(POST, REGISTRATION_PATH, { method: "POST", body, params: { id: ACTIVITY_ID } });
}

/** 报名 → 出勤 → 签到 → 接待落单，返回维修记录 id。 */
async function registerCheckInAndServe(input: {
  name: string;
  phone: string;
  deviceModel?: unknown;
}): Promise<{ registrationId: string; repairRecordId: string }> {
  const created = await signup({
    name: input.name,
    phone: input.phone,
    issueType: "SOFTWARE_SYSTEM",
    ...(input.deviceModel === undefined ? {} : { deviceModel: input.deviceModel }),
    consentAccepted: true,
  });
  assert.equal(created.status, 201, `报名应成功：${JSON.stringify(created.json)}`);
  const registrationId = (created.json.data as { id: string }).id;
  // Isolate snapshot cases from the new global pending-draft guard.
  await getDb().repairRecord.updateMany({
    where: {
      createRequestKey: { startsWith: "activity-serve:" },
      memberProfileId: STAFF_PROFILE_ID,
      status: "DRAFT",
    },
    data: { deletedAt: new Date() },
  });
  await getDb().repairActivity.update({
    where: { id: ACTIVITY_ID },
    data: { signupClosesAt: new Date(Date.now() - 1000) },
  });
  await repairActivityStaffService.markAttendance(ACTIVITY_ID, staffActor);
  await repairActivityStaffService.checkIn(ACTIVITY_ID, [registrationId], staffActor);
  const served = await repairActivityStaffService.serve(ACTIVITY_ID, registrationId, staffActor);
  await getDb().repairActivity.update({
    where: { id: ACTIVITY_ID },
    data: { signupClosesAt: new Date(Date.now() + 86400000) },
  });
  return { registrationId, repairRecordId: served.repairRecordId };
}

before(async () => {
  if (!enabled) return;
  // 报名路由按 IP 限流 10 次/分钟：本文件所有请求都来自同一个 "unknown" IP 桶，
  // 文件内累计不能超过 10 次，先清一次避免与其它用例相互挤占。
  resetRateLimitsForTests();
  await prepareFixtures();
});

after(async () => {
  if (!enabled) return;
  await cleanupFixtures();
  await disconnectDb();
});

dbTest("机型随报名落库：公开回执、管理端列表与接待台都能看到", async () => {
  const created = await signup({
    name: "REG68 甲",
    phone: "13900000011",
    issueType: "SOFTWARE_SYSTEM",
    deviceModel: "  拯救者 R7000P  ",
    consentAccepted: true,
  });
  assert.equal(created.status, 201);
  const data = created.json.data as { id: string; deviceModel: string | null };
  assert.equal(data.deviceModel, "拯救者 R7000P", "机型应去掉首尾空白");

  const row = await getDb().repairActivityRegistration.findUniqueOrThrow({
    where: { id: data.id },
  });
  assert.equal(row.deviceModel, "拯救者 R7000P");

  const adminList = await repairActivityService.listRegistrations(ACTIVITY_ID, adminActor);
  assert.equal(adminList.find((item) => item.id === data.id)?.deviceModel, "拯救者 R7000P");

  const board = await repairActivityStaffService.getBoard(ACTIVITY_ID, staffActor);
  const inBoard = [...board.eligible, ...board.queue].find((item) => item.id === data.id);
  assert.equal(inBoard?.deviceModel, "拯救者 R7000P");
});

dbTest("机型选填：缺省与空串都落 null（不是空字符串）", async () => {
  const missing = await signup({
    name: "REG68 乙",
    phone: "13900000012",
    issueType: "CLEAN_ONLY",
    consentAccepted: true,
  });
  assert.equal(missing.status, 201);
  const missingRow = await getDb().repairActivityRegistration.findUniqueOrThrow({
    where: { id: (missing.json.data as { id: string }).id },
  });
  assert.equal(missingRow.deviceModel, null);
  assert.equal((missing.json.data as { deviceModel: string | null }).deviceModel, null);

  const blank = await signup({
    name: "REG68 丙",
    phone: "13900000013",
    issueType: "CLEAN_ONLY",
    deviceModel: "   ",
    consentAccepted: true,
  });
  assert.equal(blank.status, 201);
  const blankRow = await getDb().repairActivityRegistration.findUniqueOrThrow({
    where: { id: (blank.json.data as { id: string }).id },
  });
  assert.equal(blankRow.deviceModel, null);
});

dbTest("机型超长或不是字符串：400 且指向 deviceModel 字段", async () => {
  const tooLong = await signup({
    name: "REG68 丁",
    phone: "13900000014",
    issueType: "CLEAN_ONLY",
    deviceModel: "机".repeat(REPAIR_ACTIVITY_DEVICE_MODEL_MAX_LENGTH + 1),
    consentAccepted: true,
  });
  assert.equal(tooLong.status, 400);
  assert.equal(errorCodeOf(tooLong.json), "VALIDATION_FAILED");
  assert.ok(fieldErrorsOf(tooLong.json)?.deviceModel, "错误应定位到 deviceModel 字段");

  const notString = await signup({
    name: "REG68 戊",
    phone: "13900000015",
    issueType: "CLEAN_ONLY",
    deviceModel: 123,
    consentAccepted: true,
  });
  assert.equal(notString.status, 400);
  assert.equal(errorCodeOf(notString.json), "VALIDATION_FAILED");

  assert.equal(
    await getDb().repairActivityRegistration.count({
      where: { activityId: ACTIVITY_ID, name: { startsWith: "REG68 丁" } },
    }),
    0,
    "被拦下的报名不该留下任何记录",
  );
});

dbTest("接待落单把机型复制进维修记录", async () => {
  const { registrationId, repairRecordId } = await registerCheckInAndServe({
    name: "REG68 己",
    phone: "13900000016",
    deviceModel: "ThinkPad X1 Carbon",
  });

  const record = await getDb().repairRecord.findUniqueOrThrow({ where: { id: repairRecordId } });
  assert.equal(record.deviceModel, "ThinkPad X1 Carbon");
  assert.equal(record.status, "DRAFT");
  assert.equal(record.result, null);
  assert.equal(record.content, null);
  assert.equal(record.submittedAt, null);

  const registration = await getDb().repairActivityRegistration.findUniqueOrThrow({
    where: { id: registrationId },
  });
  assert.equal(registration.status, "SERVED");
  assert.equal(registration.repairRecordId, repairRecordId);
  assert.equal(registration.deviceModel, "ThinkPad X1 Carbon", "落单后报名行仍保留机型");
});

dbTest("报名没填机型时，落单记录里也是 null", async () => {
  const { repairRecordId } = await registerCheckInAndServe({
    name: "REG68 庚",
    phone: "13900000017",
  });

  const record = await getDb().repairRecord.findUniqueOrThrow({ where: { id: repairRecordId } });
  assert.equal(record.deviceModel, null);
});
