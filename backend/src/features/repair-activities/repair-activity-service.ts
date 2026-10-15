import { randomUUID } from "node:crypto";

import { repairActivitiesPage, repairActivityConsentVersion } from "@/config/repair-activities";
import {
  issueRegistrationEditToken,
  verifyRegistrationEditToken,
} from "@/features/repair-activities/edit-token";
import { maskActivityPhone } from "@/features/repair-activities/phone-mask";
import {
  assertActivityTimeRules,
  assertValidCapacity,
  assertValidDeviceModel,
  assertValidIssueType,
  assertValidRegistrantName,
  assertValidTitle,
  assertValidLocation,
  canAcceptNewRegistration,
  canEditIssueType,
  deriveRepairActivityStatus,
  EFFECTIVE_REGISTRATION_STATUSES,
  remainingCapacity,
  type RepairActivityIssueType,
  type RepairActivityStatus,
} from "@/features/repair-activities/repair-activity-validation";
import { sortRepairActivitiesForPublicList } from "@/features/repair-activities/repair-activity-sort";
import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { normalizePhone } from "@/lib/security/normalization";
import type { AuthorizedActor, PublicRequestContext } from "@/types/contracts";

export type RepairActivityPublicView = {
  id: string;
  title: string;
  activityAt: string;
  capacity: number;
  signupOpensAt: string;
  signupClosesAt: string;
  status: RepairActivityStatus;
  registeredCount: number;
  remaining: number;
};

export type RepairActivityDetailView = RepairActivityPublicView & {
  location: string | null;
  consent: { version: string; title: string; clauses: readonly string[] };
};

export type RepairActivityAdminView = RepairActivityPublicView & {
  location: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
};

export type CreateRepairActivityInput = {
  location?: unknown;
  title: string;
  activityAt: Date;
  capacity: number;
  signupOpensAt: Date;
  signupClosesAt: Date;
};

export type UpdateRepairActivityInput = {
  location?: unknown;
  title?: string;
  activityAt?: Date;
  capacity?: number;
  signupOpensAt?: Date;
  signupClosesAt?: Date;
};

export type RegistrationPublicView = {
  id: string;
  activityId: string;
  name: string;
  phoneMasked: string;
  issueType: RepairActivityIssueType;
  /** 机型，选填（issue #68）。 */
  deviceModel: string | null;
  status: string;
  createdAt: string;
};

export type RegistrationLookupView = RegistrationPublicView & {
  editToken: string;
  editTokenExpiresAt: string;
};

export type RegistrationAdminView = {
  id: string;
  activityId: string;
  name: string;
  phoneMasked: string;
  issueType: RepairActivityIssueType;
  /** 机型，选填（issue #68）。 */
  deviceModel: string | null;
  status: string;
  createdAt: string;
  deletedAt: string | null;
};

export type UpdateRegistrationInput = {
  name?: string;
  phone?: string;
  issueType?: unknown;
};

type ActivityRow = {
  location: string | null;
  id: string;
  title: string;
  activityAt: Date;
  capacity: number;
  signupOpensAt: Date;
  signupClosesAt: Date;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

const effectiveStatusFilter = {
  deletedAt: null as null,
  status: { in: [...EFFECTIVE_REGISTRATION_STATUSES] },
};

async function countEffectiveRegistrations(activityId: string): Promise<number> {
  return getDb().repairActivityRegistration.count({
    where: { activityId, ...effectiveStatusFilter },
  });
}

function toPublicView(
  row: ActivityRow,
  registeredCount: number,
  now: Date,
): RepairActivityPublicView {
  const status = deriveRepairActivityStatus({
    now,
    activityAt: row.activityAt,
    signupOpensAt: row.signupOpensAt,
    signupClosesAt: row.signupClosesAt,
    effectiveRegistrationCount: registeredCount,
    capacity: row.capacity,
  });
  return {
    id: row.id,
    title: row.title,
    activityAt: row.activityAt.toISOString(),
    capacity: row.capacity,
    signupOpensAt: row.signupOpensAt.toISOString(),
    signupClosesAt: row.signupClosesAt.toISOString(),
    status,
    registeredCount,
    remaining: remainingCapacity(row.capacity, registeredCount),
  };
}

function toAdminView(
  row: ActivityRow,
  registeredCount: number,
  now: Date,
): RepairActivityAdminView {
  return {
    ...toPublicView(row, registeredCount, now),
    location: row.location,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdBy,
  };
}

function toRegistrationAdminView(row: {
  id: string;
  activityId: string;
  name: string;
  phone: string;
  issueType: string;
  deviceModel: string | null;
  status: string;
  createdAt: Date;
  deletedAt: Date | null;
}): RegistrationAdminView {
  return {
    id: row.id,
    activityId: row.activityId,
    name: row.name,
    phoneMasked: maskActivityPhone(row.phone),
    issueType: assertValidIssueType(row.issueType),
    deviceModel: row.deviceModel,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

async function loadCounts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const groups = await getDb().repairActivityRegistration.groupBy({
    by: ["activityId"],
    where: { activityId: { in: ids }, ...effectiveStatusFilter },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.activityId, g._count._all]));
}

export const repairActivityService = {
  // ---------- Admin ----------
  async listAdmin(actor: AuthorizedActor): Promise<RepairActivityAdminView[]> {
    requirePermission(actor, "activity:admin");
    const now = new Date();
    const rows = await getDb().repairActivity.findMany({
      where: { deletedAt: null },
      orderBy: [{ activityAt: "asc" }, { createdAt: "asc" }],
    });
    const counts = await loadCounts(rows.map((r) => r.id));
    return rows.map((row) => toAdminView(row, counts.get(row.id) ?? 0, now));
  },

  async listRegistrations(
    activityId: string,
    actor: AuthorizedActor,
  ): Promise<RegistrationAdminView[]> {
    requirePermission(actor, "activity:admin");
    const activity = await getDb().repairActivity.findFirst({
      where: { id: activityId, deletedAt: null },
    });
    if (!activity) throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
    const rows = await getDb().repairActivityRegistration.findMany({
      where: { activityId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toRegistrationAdminView);
  },

  async updateRegistration(
    activityId: string,
    registrationId: string,
    input: UpdateRegistrationInput,
    actor: AuthorizedActor,
  ): Promise<RegistrationAdminView> {
    requirePermission(actor, "activity:admin");
    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const activity = await tx.repairActivity.findUnique({ where: { id: activityId } });
      if (!activity || activity.deletedAt) {
        throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
      }
      if (new Date().getTime() >= activity.activityAt.getTime()) {
        throw new AppError("ACTIVITY_ENDED", "活动已结束");
      }
      const before = await tx.repairActivityRegistration.findFirst({
        where: { id: registrationId, activityId },
      });
      if (!before || before.deletedAt) {
        throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在或已删除");
      }
      const name = input.name !== undefined ? assertValidRegistrantName(input.name) : before.name;
      const phone = input.phone !== undefined ? normalizePhone(input.phone) : before.phone;
      const issueType =
        input.issueType !== undefined
          ? assertValidIssueType(input.issueType)
          : assertValidIssueType(before.issueType);
      if (phone !== before.phone) {
        const duplicate = await tx.repairActivityRegistration.findFirst({
          where: { activityId, phone, deletedAt: null, id: { not: registrationId } },
        });
        if (duplicate)
          throw new AppError("ACTIVITY_REGISTRATION_DUPLICATE", "该手机号已报名本场活动");
      }
      const updated = await tx.repairActivityRegistration.update({
        where: { id: registrationId },
        data: { name, phone, phoneLast4: phone.slice(-4), issueType },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.registration_updated",
        targetType: "RepairActivityRegistration",
        targetId: registrationId,
        result: "SUCCESS",
        before: {
          activityId,
          name: before.name,
          phoneMasked: maskActivityPhone(before.phone),
          issueType: before.issueType,
        },
        after: { activityId, name, phoneMasked: maskActivityPhone(phone), issueType },
      });
      return toRegistrationAdminView(updated);
    });
  },

  async softDeleteRegistration(
    activityId: string,
    registrationId: string,
    actor: AuthorizedActor,
  ): Promise<void> {
    requirePermission(actor, "activity:admin");
    await inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const activity = await tx.repairActivity.findUnique({ where: { id: activityId } });
      if (!activity || activity.deletedAt) {
        throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
      }
      const current = await tx.repairActivityRegistration.findFirst({
        where: { id: registrationId, activityId },
      });
      if (!current || current.deletedAt) {
        throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在或已删除");
      }
      const now = new Date();
      await tx.repairActivityRegistration.update({
        where: { id: registrationId },
        data: { deletedAt: now },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.registration_deleted",
        targetType: "RepairActivityRegistration",
        targetId: registrationId,
        result: "SUCCESS",
        before: {
          activityId,
          name: current.name,
          phoneMasked: maskActivityPhone(current.phone),
          issueType: current.issueType,
          status: current.status,
        },
        after: { deletedAt: now.toISOString() },
      });
    });
  },

  async create(
    input: CreateRepairActivityInput,
    actor: AuthorizedActor,
  ): Promise<RepairActivityAdminView> {
    requirePermission(actor, "activity:admin");
    const title = assertValidTitle(input.title);
    const location = assertValidLocation(input.location);
    assertValidCapacity(input.capacity);
    assertActivityTimeRules({
      activityAt: input.activityAt,
      signupOpensAt: input.signupOpensAt,
      signupClosesAt: input.signupClosesAt,
    });
    const now = new Date();
    return inSerializableTransaction(async (tx) => {
      const created = await tx.repairActivity.create({
        data: {
          id: randomUUID(),
          title,
          location,
          activityAt: input.activityAt,
          capacity: input.capacity,
          signupOpensAt: input.signupOpensAt,
          signupClosesAt: input.signupClosesAt,
          createdBy: actor.userId,
          createdAt: now,
        },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.created",
        targetType: "RepairActivity",
        targetId: created.id,
        result: "SUCCESS",
        after: {
          title,
          location,
          capacity: input.capacity,
          activityAt: input.activityAt.toISOString(),
          signupOpensAt: input.signupOpensAt.toISOString(),
          signupClosesAt: input.signupClosesAt.toISOString(),
        },
      });
      return toAdminView(created, 0, now);
    });
  },

  async update(
    activityId: string,
    input: UpdateRepairActivityInput,
    actor: AuthorizedActor,
  ): Promise<RepairActivityAdminView> {
    requirePermission(actor, "activity:admin");
    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const before = await tx.repairActivity.findUnique({ where: { id: activityId } });
      if (!before || before.deletedAt) {
        throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
      }
      const title = input.title !== undefined ? assertValidTitle(input.title) : before.title;
      const location =
        input.location !== undefined ? assertValidLocation(input.location) : before.location;
      const capacity = input.capacity !== undefined ? input.capacity : before.capacity;
      assertValidCapacity(capacity);
      const activityAt = input.activityAt ?? before.activityAt;
      const signupOpensAt = input.signupOpensAt ?? before.signupOpensAt;
      const signupClosesAt = input.signupClosesAt ?? before.signupClosesAt;
      assertActivityTimeRules({ activityAt, signupOpensAt, signupClosesAt });

      const effectiveCount = await tx.repairActivityRegistration.count({
        where: { activityId, ...effectiveStatusFilter },
      });
      if (capacity < effectiveCount) {
        throw new AppError(
          "ACTIVITY_CAPACITY_TOO_LOW",
          `人数上限不能低于当前有效报名数（${effectiveCount}）`,
        );
      }

      const updated = await tx.repairActivity.update({
        where: { id: activityId },
        data: { title, location, capacity, activityAt, signupOpensAt, signupClosesAt },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.updated",
        targetType: "RepairActivity",
        targetId: activityId,
        result: "SUCCESS",
        before: {
          title: before.title,
          location: before.location,
          capacity: before.capacity,
          activityAt: before.activityAt.toISOString(),
          signupOpensAt: before.signupOpensAt.toISOString(),
          signupClosesAt: before.signupClosesAt.toISOString(),
        },
        after: {
          title: updated.title,
          location: updated.location,
          capacity: updated.capacity,
          activityAt: updated.activityAt.toISOString(),
          signupOpensAt: updated.signupOpensAt.toISOString(),
          signupClosesAt: updated.signupClosesAt.toISOString(),
        },
      });
      return toAdminView(updated, effectiveCount, new Date());
    });
  },

  async softDelete(activityId: string, actor: AuthorizedActor): Promise<void> {
    requirePermission(actor, "activity:admin");
    await inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const current = await tx.repairActivity.findUnique({ where: { id: activityId } });
      if (!current || current.deletedAt) {
        throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
      }
      const now = new Date();
      await tx.repairActivity.update({
        where: { id: activityId },
        data: { deletedAt: now },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.deleted",
        targetType: "RepairActivity",
        targetId: activityId,
        result: "SUCCESS",
        before: { title: current.title },
      });
    });
  },

  // ---------- Public ----------
  async listPublic(): Promise<RepairActivityPublicView[]> {
    const now = new Date();
    const rows = await getDb().repairActivity.findMany({
      where: { deletedAt: null },
      orderBy: [{ activityAt: "asc" }, { createdAt: "asc" }],
    });
    const counts = await loadCounts(rows.map((r) => r.id));
    // DB orderBy 仅粗排；方案 B 最终顺序由内存纯函数决定（已结束整段后置且组内降序）。
    const views = rows.map((row) => ({
      ...toPublicView(row, counts.get(row.id) ?? 0, now),
      createdAt: row.createdAt.toISOString(),
    }));
    return sortRepairActivitiesForPublicList(views).map((item) => ({
      id: item.id,
      title: item.title,
      activityAt: item.activityAt,
      capacity: item.capacity,
      signupOpensAt: item.signupOpensAt,
      signupClosesAt: item.signupClosesAt,
      status: item.status,
      registeredCount: item.registeredCount,
      remaining: item.remaining,
    }));
  },

  async getPublic(activityId: string): Promise<RepairActivityDetailView> {
    const now = new Date();
    const row = await getDb().repairActivity.findFirst({
      where: { id: activityId, deletedAt: null },
    });
    if (!row) throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
    const count = await countEffectiveRegistrations(activityId);
    const view = toPublicView(row, count, now);
    return {
      ...view,
      location: row.location,
      consent: {
        version: repairActivityConsentVersion,
        title: repairActivitiesPage.detail.consent.title,
        clauses: repairActivitiesPage.detail.consent.clauses,
      },
    };
  },

  async register(
    activityId: string,
    input: {
      name: string;
      phone: string;
      issueType: unknown;
      deviceModel?: unknown;
      consentAccepted?: boolean;
      consentVersion?: unknown;
    },
    context: PublicRequestContext,
    account?: AuthorizedActor,
  ): Promise<RegistrationPublicView> {
    const name = assertValidRegistrantName(input.name);
    const phone = normalizePhone(input.phone);
    const issueType = assertValidIssueType(input.issueType);
    const deviceModel = assertValidDeviceModel(input.deviceModel);
    // 免责声明必须由报名者本人点过（issue #62 前端3）。
    // 前端弹层只是「把这件事问清楚」，真正拦住绕过弹层直接打接口的是这一句 ——
    // 报名接口是公开的，只在界面上拦等于没拦。
    // 顺序：先报字段问题、再报缺同意，否则一个手机号填错的人会先看到「请先同意免责声明」。
    if (input.consentAccepted !== true) {
      throw new AppError("ACTIVITY_CONSENT_REQUIRED", "请先阅读并同意报名须知与免责声明");
    }
    // Legacy Web may omit the version; account requests must echo the displayed version.
    if (
      (account || input.consentVersion !== undefined) &&
      input.consentVersion !== repairActivityConsentVersion
    ) {
      throw new AppError("ACTIVITY_CONSENT_VERSION_CHANGED", "报名须知已更新，请重新阅读并同意");
    }

    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const activity = await tx.repairActivity.findUnique({ where: { id: activityId } });
      if (!activity || activity.deletedAt) {
        throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
      }
      const now = new Date();
      const effectiveCount = await tx.repairActivityRegistration.count({
        where: { activityId, ...effectiveStatusFilter },
      });
      const status = deriveRepairActivityStatus({
        now,
        activityAt: activity.activityAt,
        signupOpensAt: activity.signupOpensAt,
        signupClosesAt: activity.signupClosesAt,
        effectiveRegistrationCount: effectiveCount,
        capacity: activity.capacity,
      });
      if (status === "ENDED") throw new AppError("ACTIVITY_ENDED", "活动已结束");
      if (!canAcceptNewRegistration(status)) {
        if (status === "FULL") throw new AppError("ACTIVITY_FULL", "活动名额已满");
        if (status === "UPCOMING") throw new AppError("ACTIVITY_NOT_OPEN", "报名尚未开始");
        throw new AppError("ACTIVITY_NOT_OPEN", "报名已截止");
      }

      const duplicate = await tx.repairActivityRegistration.findFirst({
        where: { activityId, phone, deletedAt: null },
      });
      if (duplicate) {
        throw new AppError("ACTIVITY_REGISTRATION_DUPLICATE", "该手机号已报名本场活动");
      }

      const created = await tx.repairActivityRegistration.create({
        data: {
          id: randomUUID(),
          activityId,
          userId: account?.userId ?? null,
          name,
          phone,
          phoneLast4: phone.slice(-4),
          issueType,
          deviceModel,
          status: "REGISTERED",
          consentVersion: repairActivityConsentVersion,
          consentAcceptedAt: now,
          createdAt: now,
        },
      });
      await appendAuditLog(tx, {
        actor: account ?? context,
        actorType: account ? "USER" : "SYSTEM",
        actorUserId: account?.userId,
        action: "repair_activity.registration_created",
        targetType: "RepairActivityRegistration",
        targetId: created.id,
        result: "SUCCESS",
        after: {
          activityId,
          issueType,
          deviceModel,
          phoneMasked: maskActivityPhone(phone),
          consentVersion: repairActivityConsentVersion,
        },
      });
      return {
        id: created.id,
        activityId,
        name: created.name,
        phoneMasked: maskActivityPhone(phone),
        issueType,
        deviceModel,
        status: created.status,
        createdAt: created.createdAt.toISOString(),
      };
    });
  },

  async lookup(
    activityId: string,
    phoneRaw: string,
    context: PublicRequestContext,
  ): Promise<RegistrationLookupView> {
    const phone = normalizePhone(phoneRaw);
    const activity = await getDb().repairActivity.findFirst({
      where: { id: activityId, deletedAt: null },
    });
    if (!activity) throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
    const now = new Date();
    if (now.getTime() >= activity.activityAt.getTime()) {
      throw new AppError("ACTIVITY_ENDED", "活动已结束");
    }
    const reg = await getDb().repairActivityRegistration.findFirst({
      where: { activityId, phone, userId: null, deletedAt: null },
    });
    if (!reg) {
      throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "未找到该手机号的报名记录");
    }
    const token = issueRegistrationEditToken(reg.id, activityId, now);
    await inSerializableTransaction(async (tx) => {
      await appendAuditLog(tx, {
        actor: context,
        actorType: "SYSTEM",
        action: "repair_activity.registration_lookup",
        targetType: "RepairActivityRegistration",
        targetId: reg.id,
        result: "SUCCESS",
        after: { activityId, phoneMasked: maskActivityPhone(phone) },
      });
    });
    return {
      id: reg.id,
      activityId,
      name: reg.name,
      phoneMasked: maskActivityPhone(phone),
      issueType: assertValidIssueType(reg.issueType),
      deviceModel: reg.deviceModel,
      status: reg.status,
      createdAt: reg.createdAt.toISOString(),
      editToken: token.editToken,
      editTokenExpiresAt: token.expiresAt,
    };
  },

  async updateIssueType(
    activityId: string,
    registrationId: string,
    input: { issueType: unknown; phone: string; editToken: string },
    context: PublicRequestContext,
  ): Promise<RegistrationPublicView> {
    const issueType = assertValidIssueType(input.issueType);
    const phone = normalizePhone(input.phone);
    if (typeof input.editToken !== "string" || !input.editToken.trim()) {
      throw new AppError("ACTIVITY_EDIT_TOKEN_INVALID", "改类型凭证无效或已过期");
    }
    verifyRegistrationEditToken(input.editToken.trim(), { registrationId, activityId });

    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const activity = await tx.repairActivity.findUnique({ where: { id: activityId } });
      if (!activity || activity.deletedAt) {
        throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
      }
      const now = new Date();
      const effectiveCount = await tx.repairActivityRegistration.count({
        where: { activityId, ...effectiveStatusFilter },
      });
      const activityStatus = deriveRepairActivityStatus({
        now,
        activityAt: activity.activityAt,
        signupOpensAt: activity.signupOpensAt,
        signupClosesAt: activity.signupClosesAt,
        effectiveRegistrationCount: effectiveCount,
        capacity: activity.capacity,
      });
      if (activityStatus === "ENDED") {
        throw new AppError("ACTIVITY_ENDED", "活动已结束");
      }

      const reg = await tx.repairActivityRegistration.findFirst({
        where: { id: registrationId, activityId, phone, userId: null, deletedAt: null },
      });
      if (!reg) {
        throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在");
      }
      if (!canEditIssueType({ registrationStatus: reg.status, activityStatus })) {
        throw new AppError("ACTIVITY_REGISTRATION_NOT_EDITABLE", "当前状态不可修改故障类型");
      }

      const updated = await tx.repairActivityRegistration.update({
        where: { id: registrationId },
        data: { issueType },
      });
      await appendAuditLog(tx, {
        actor: context,
        actorType: "SYSTEM",
        action: "repair_activity.registration_issue_type_updated",
        targetType: "RepairActivityRegistration",
        targetId: registrationId,
        result: "SUCCESS",
        before: { issueType: reg.issueType },
        after: { issueType },
      });
      return {
        id: updated.id,
        activityId,
        name: updated.name,
        phoneMasked: maskActivityPhone(updated.phone),
        issueType,
        deviceModel: updated.deviceModel,
        status: updated.status,
        createdAt: updated.createdAt.toISOString(),
      };
    });
  },
};
