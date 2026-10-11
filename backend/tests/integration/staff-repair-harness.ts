import { randomUUID } from "node:crypto";

import { SESSION_COOKIE_NAME } from "../../src/lib/auth/request";
import { getDb } from "../../src/lib/db/client";
import { digestSessionToken } from "../../src/lib/security/secrets";

/**
 * Issue #38 集成用例的共享夹具。
 *
 * 固定 ID 的四个账号（客户 / 工作人员 A、B / 纯管理员）：
 * - 只增删自己造的数据，不与并行文件互相踩；
 * - `bearerFor` 走原生通道（Bearer + X-Client-Type），`cookieFor` 走 Web 通道；
 * - 管理员**没有成员档案**，用来验证「ADMIN 不能凭空成为受理人」。
 */

export const CUSTOMER_ID = "b3800000-0000-4000-8000-000000000001";
export const STAFF_A_ID = "b3800000-0000-4000-8000-000000000002";
export const STAFF_B_ID = "b3800000-0000-4000-8000-000000000003";
export const ADMIN_ID = "b3800000-0000-4000-8000-000000000004";
export const MP_A_ID = "b3800000-0000-4000-8000-0000000000a1";
export const MP_B_ID = "b3800000-0000-4000-8000-0000000000b1";

const ALL_USER_IDS = [CUSTOMER_ID, STAFF_A_ID, STAFF_B_ID, ADMIN_ID];
const ALL_PROFILE_IDS = [MP_A_ID, MP_B_ID];

/** 原生通道请求头（写接口要求 X-Client-Type: native）。 */
export function bearerHeaders(rawToken: string): Record<string, string> {
  return { authorization: `Bearer ${rawToken}`, "x-client-type": "native" };
}

async function sessionTokenFor(userId: string): Promise<string> {
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
  return raw;
}

/** 造一个原生通道会话，返回可直接放进请求头的对象。 */
export async function bearerFor(userId: string): Promise<Record<string, string>> {
  return bearerHeaders(await sessionTokenFor(userId));
}

/** 造一个 Web Cookie 会话，返回 cookie 头值。 */
export async function cookieFor(userId: string): Promise<string> {
  return `${SESSION_COOKIE_NAME}=${await sessionTokenFor(userId)}`;
}

async function ensureUser(userId: string, displayName: string): Promise<void> {
  const db = getDb();
  const now = new Date();
  if (await db.user.findUnique({ where: { id: userId } })) return;
  await db.user.create({ data: { id: userId, status: "ACTIVE", displayName, createdAt: now, updatedAt: now } });
}

async function ensureRole(userId: string, roleCode: "MEMBER" | "ADMIN"): Promise<void> {
  const db = getDb();
  const role = await db.role.findUnique({ where: { code: roleCode } });
  if (!role) throw new Error(`角色 ${roleCode} 不存在，先跑一次 pnpm db:seed:test`);
  const activeKey = `${userId}:${role.id}`;
  const existing = await db.userRole.findFirst({ where: { userId, roleId: role.id } });
  if (existing) return;
  await db.userRole.create({
    data: {
      id: randomUUID(),
      userId,
      roleId: role.id,
      sourceType: "ADMIN_CREATED",
      sourceId: userId,
      grantedAt: new Date(),
      activeKey,
    },
  });
}

async function ensureProfile(profileId: string, userId: string, realName: string): Promise<void> {
  const db = getDb();
  if (await db.memberProfile.findUnique({ where: { id: profileId } })) return;
  const now = new Date();
  await db.memberProfile.create({
    data: {
      id: profileId,
      userId,
      realName,
      status: "ACTIVE",
      joinedAt: now,
      createdAt: now,
    },
  });
}

/** 清理本文件造出的全部数据（先子表后父表，FK 都是 Restrict）。 */
export async function cleanupStaffRepairFixtures(): Promise<void> {
  const db = getDb();
  const orderIds = (
    await db.repairOrder.findMany({
      where: { submittedByUserId: { in: ALL_USER_IDS } },
      select: { id: true },
    })
  ).map((row) => row.id);
  const recordIds = (
    await db.repairRecord.findMany({
      where: { memberProfileId: { in: ALL_PROFILE_IDS } },
      select: { id: true },
    })
  ).map((row) => row.id);
  if (orderIds.length > 0) {
    await db.repairOrderEvent.deleteMany({ where: { repairOrderId: { in: orderIds } } });
    await db.repairOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (recordIds.length > 0) {
    await db.notification.deleteMany({
      where: {
        OR: [
          { repairRecordId: { in: recordIds } },
          { recipientMemberProfileId: { in: ALL_PROFILE_IDS } },
          { actorMemberProfileId: { in: ALL_PROFILE_IDS } },
        ],
      },
    });
    await db.repairReview.deleteMany({ where: { repairRecordId: { in: recordIds } } });
    await db.repairTimelineEvent.deleteMany({ where: { repairRecordId: { in: recordIds } } });
    await db.repairPhoto.deleteMany({ where: { repairRecordId: { in: recordIds } } });
    await db.repairFavorite.deleteMany({ where: { memberProfileId: { in: ALL_PROFILE_IDS } } });
    await db.repairRecord.deleteMany({ where: { memberProfileId: { in: ALL_PROFILE_IDS } } });
  }
  await db.auditLog.deleteMany({ where: { actorUserId: { in: ALL_USER_IDS } } });
  await db.authSession.deleteMany({ where: { userId: { in: ALL_USER_IDS } } });
  await db.userRole.deleteMany({ where: { userId: { in: ALL_USER_IDS } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: ALL_USER_IDS } } });
  await db.memberProfile.deleteMany({ where: { userId: { in: ALL_USER_IDS } } });
  await db.userIdentity.deleteMany({ where: { userId: { in: ALL_USER_IDS } } });
  await db.user.deleteMany({ where: { id: { in: ALL_USER_IDS } } });
}

/** 建固定账号与档案（可重复执行；其他文件清库后由 beforeEach 重新对齐）。 */
export async function prepareStaffRepairFixtures(): Promise<void> {
  await ensureUser(CUSTOMER_ID, "Issue38 客户");
  await ensureUser(STAFF_A_ID, "Issue38 工作人员A");
  await ensureUser(STAFF_B_ID, "Issue38 工作人员B");
  await ensureUser(ADMIN_ID, "Issue38 管理员");
  await ensureRole(STAFF_A_ID, "MEMBER");
  await ensureRole(STAFF_B_ID, "MEMBER");
  await ensureRole(ADMIN_ID, "ADMIN");
  await ensureProfile(MP_A_ID, STAFF_A_ID, "Issue38 成员A");
  await ensureProfile(MP_B_ID, STAFF_B_ID, "Issue38 成员B");
}

export type Envelope = { success?: boolean; data?: unknown; error?: { code?: string; message?: string } };

export function dataOf(json: Record<string, unknown>): Record<string, unknown> {
  return ((json as Envelope).data ?? {}) as Record<string, unknown>;
}

export function errorCodeOf(json: Record<string, unknown>): string {
  return ((json as Envelope).error?.code ?? "") as string;
}

export function listArray(json: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = (json as Envelope).data;
  if (!Array.isArray(data)) throw new Error("列表 data 应为数组");
  return data as Array<Record<string, unknown>>;
}

/** 最小合法 PNG（内容仅魔数，服务端按真实文件头检测类型）。 */
export function tinyPng(): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
}
