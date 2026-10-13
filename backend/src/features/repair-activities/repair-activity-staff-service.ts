import { randomUUID } from "node:crypto";

import { maskActivityPhone } from "@/features/repair-activities/phone-mask";
import {
  ACTIVITY_SERVE_DURATION_MINUTES,
  ACTIVITY_SERVE_REMARK,
  buildActivityServeContent,
  canCheckInRegistration,
  canServeRegistration,
  canWithdrawRegistration,
  deriveRepairActivityStatus,
  EFFECTIVE_REGISTRATION_STATUSES,
  mapIssueTypeToCategoryCode,
  remainingCapacity,
  repairActivityIssueTypeLabels,
  shanghaiCalendarDay,
  sortQueueByCheckedInAt,
  type RepairActivityIssueType,
  type RepairActivityStatus,
  assertValidIssueType,
} from "@/features/repair-activities/repair-activity-validation";
import { createSubmittedForActivity } from "@/features/repairs/repair-service";
import { repairRepository } from "@/features/repairs/repair-repository";
import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import type { AuthorizedActor } from "@/types/contracts";

export type StaffActivityListItem = {
  id: string;
  title: string;
  activityAt: string;
  capacity: number;
  signupOpensAt: string;
  signupClosesAt: string;
  status: RepairActivityStatus;
  registeredCount: number;
  remaining: number;
  attended: boolean;
};

export type StaffRegistrationView = {
  id: string;
  activityId: string;
  name: string;
  phoneMasked: string;
  issueType: RepairActivityIssueType;
  issueTypeLabel: string;
  /** 机型，选填（issue #68）：接待落单时随维修记录一起带过去。 */
  deviceModel: string | null;
  status: string;
  checkedInAt: string | null;
  servedAt: string | null;
  repairRecordId: string | null;
  createdAt: string;
};

export type StaffBoardView = {
  activity: StaffActivityListItem;
  attended: boolean;
  attendanceCheckedInAt: string | null;
  /** 左侧：可签到（REGISTERED） */
  eligible: StaffRegistrationView[];
  /** 右侧：排队（CHECKED_IN，按 checkedInAt ASC） */
  queue: StaffRegistrationView[];
};

export type ServeResultView = {
  registration: StaffRegistrationView;
  repairRecordId: string;
};

const effectiveStatusFilter = {
  deletedAt: null as null,
  status: { in: [...EFFECTIVE_REGISTRATION_STATUSES] },
};

function toStaffReg(row: {
  id: string;
  activityId: string;
  name: string;
  phone: string;
  issueType: string;
  deviceModel: string | null;
  status: string;
  checkedInAt: Date | null;
  servedAt: Date | null;
  repairRecordId: string | null;
  createdAt: Date;
}): StaffRegistrationView {
  const issueType = assertValidIssueType(row.issueType);
  return {
    id: row.id,
    activityId: row.activityId,
    name: row.name,
    phoneMasked: maskActivityPhone(row.phone),
    issueType,
    issueTypeLabel: repairActivityIssueTypeLabels[issueType],
    deviceModel: row.deviceModel,
    status: row.status,
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    servedAt: row.servedAt?.toISOString() ?? null,
    repairRecordId: row.repairRecordId,
    createdAt: row.createdAt.toISOString(),
  };
}

async function requireStaffMember(actor: AuthorizedActor) {
  requirePermission(actor, "activity:staff");
  return repairRepository.activeMemberForUser(actor.userId);
}

async function loadActivityOrThrow(activityId: string) {
  const activity = await getDb().repairActivity.findFirst({
    where: { id: activityId, deletedAt: null },
  });
  if (!activity) throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
  return activity;
}

async function requireAttendance(
  activityId: string,
  memberProfileId: string,
): Promise<{ id: string; checkedInAt: Date }> {
  const attendance = await getDb().repairActivityAttendance.findUnique({
    where: {
      activityId_memberProfileId: { activityId, memberProfileId },
    },
  });
  if (!attendance) {
    throw new AppError("ACTIVITY_ATTENDANCE_REQUIRED", "请先完成本场出勤后再操作");
  }
  return attendance;
}

async function countEffective(activityId: string): Promise<number> {
  return getDb().repairActivityRegistration.count({
    where: { activityId, ...effectiveStatusFilter },
  });
}

function toListItem(
  row: {
    id: string;
    title: string;
    activityAt: Date;
    capacity: number;
    signupOpensAt: Date;
    signupClosesAt: Date;
  },
  registeredCount: number,
  attended: boolean,
  now: Date,
): StaffActivityListItem {
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
    attended,
  };
}

export const repairActivityStaffService = {
  async listForStaff(actor: AuthorizedActor): Promise<StaffActivityListItem[]> {
    const member = await requireStaffMember(actor);
    const now = new Date();
    const rows = await getDb().repairActivity.findMany({
      where: { deletedAt: null },
      orderBy: [{ activityAt: "asc" }, { createdAt: "asc" }],
    });
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const [countGroups, attendances] = await Promise.all([
      getDb().repairActivityRegistration.groupBy({
        by: ["activityId"],
        where: { activityId: { in: ids }, ...effectiveStatusFilter },
        _count: { _all: true },
      }),
      getDb().repairActivityAttendance.findMany({
        where: { activityId: { in: ids }, memberProfileId: member.id },
        select: { activityId: true },
      }),
    ]);
    const counts = new Map(countGroups.map((g) => [g.activityId, g._count._all]));
    const attendedSet = new Set(attendances.map((a) => a.activityId));
    return rows.map((row) =>
      toListItem(row, counts.get(row.id) ?? 0, attendedSet.has(row.id), now),
    );
  },

  async markAttendance(
    activityId: string,
    actor: AuthorizedActor,
  ): Promise<{ attended: boolean; checkedInAt: string }> {
    const member = await requireStaffMember(actor);
    await loadActivityOrThrow(activityId);

    return inSerializableTransaction(async (tx) => {
      const existing = await tx.repairActivityAttendance.findUnique({
        where: {
          activityId_memberProfileId: { activityId, memberProfileId: member.id },
        },
      });
      if (existing) {
        return { attended: true, checkedInAt: existing.checkedInAt.toISOString() };
      }
      const now = new Date();
      const created = await tx.repairActivityAttendance.create({
        data: {
          id: randomUUID(),
          activityId,
          memberProfileId: member.id,
          checkedInAt: now,
        },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.attendance_marked",
        targetType: "RepairActivityAttendance",
        targetId: created.id,
        result: "SUCCESS",
        after: { activityId, memberProfileId: member.id },
      });
      return { attended: true, checkedInAt: created.checkedInAt.toISOString() };
    });
  },

  async getBoard(activityId: string, actor: AuthorizedActor): Promise<StaffBoardView> {
    const member = await requireStaffMember(actor);
    const activity = await loadActivityOrThrow(activityId);
    const now = new Date();
    const [registeredCount, attendance, registrations] = await Promise.all([
      countEffective(activityId),
      getDb().repairActivityAttendance.findUnique({
        where: {
          activityId_memberProfileId: { activityId, memberProfileId: member.id },
        },
      }),
      getDb().repairActivityRegistration.findMany({
        where: {
          activityId,
          deletedAt: null,
          status: { in: ["REGISTERED", "CHECKED_IN"] },
        },
      }),
    ]);

    const eligible = registrations
      .filter((r) => r.status === "REGISTERED")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(toStaffReg);

    const queue = sortQueueByCheckedInAt(
      registrations.filter((r) => r.status === "CHECKED_IN"),
    ).map(toStaffReg);

    return {
      activity: toListItem(activity, registeredCount, Boolean(attendance), now),
      attended: Boolean(attendance),
      attendanceCheckedInAt: attendance?.checkedInAt.toISOString() ?? null,
      eligible,
      queue,
    };
  },

  async checkIn(
    activityId: string,
    registrationIds: string[],
    actor: AuthorizedActor,
  ): Promise<{ checkedIn: StaffRegistrationView[] }> {
    const member = await requireStaffMember(actor);
    await loadActivityOrThrow(activityId);
    await requireAttendance(activityId, member.id);

    const uniqueIds = [...new Set(registrationIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) {
      throw new AppError("VALIDATION_FAILED", "请至少选择一条报名记录", {
        fieldErrors: { registrationIds: ["请至少选择一条"] },
      });
    }
    if (uniqueIds.length > 100) {
      throw new AppError("VALIDATION_FAILED", "单次最多签到 100 条");
    }

    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const now = new Date();
      const checkedIn: StaffRegistrationView[] = [];

      for (const registrationId of uniqueIds) {
        const reg = await tx.repairActivityRegistration.findFirst({
          where: { id: registrationId, activityId, deletedAt: null },
        });
        if (!reg) {
          throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在");
        }
        if (reg.status === "CHECKED_IN") {
          checkedIn.push(toStaffReg(reg));
          continue;
        }
        if (!canCheckInRegistration(reg.status)) {
          throw new AppError(
            "ACTIVITY_REGISTRATION_STATE_INVALID",
            `报名「${reg.name}」当前状态不可签到`,
          );
        }
        const updated = await tx.repairActivityRegistration.update({
          where: { id: registrationId },
          data: { status: "CHECKED_IN", checkedInAt: now },
        });
        checkedIn.push(toStaffReg(updated));
      }

      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.registrations_checked_in",
        targetType: "RepairActivity",
        targetId: activityId,
        result: "SUCCESS",
        after: {
          registrationIds: checkedIn.map((r) => r.id),
          memberProfileId: member.id,
        },
      });
      return { checkedIn };
    });
  },

  async withdraw(
    activityId: string,
    registrationId: string,
    actor: AuthorizedActor,
  ): Promise<StaffRegistrationView> {
    const member = await requireStaffMember(actor);
    await loadActivityOrThrow(activityId);
    await requireAttendance(activityId, member.id);
    if (!registrationId.trim()) {
      throw new AppError("VALIDATION_FAILED", "报名 ID 无效");
    }

    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const reg = await tx.repairActivityRegistration.findFirst({
        where: { id: registrationId, activityId, deletedAt: null },
      });
      if (!reg) {
        throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在");
      }
      if (reg.status === "SERVED") {
        throw new AppError("ACTIVITY_REGISTRATION_STATE_INVALID", "已接待的报名不可撤回");
      }
      if (!canWithdrawRegistration(reg.status)) {
        throw new AppError("ACTIVITY_REGISTRATION_STATE_INVALID", "当前状态不可撤回排队");
      }
      const updated = await tx.repairActivityRegistration.update({
        where: { id: registrationId },
        data: { status: "REGISTERED", checkedInAt: null },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.registration_withdrawn",
        targetType: "RepairActivityRegistration",
        targetId: registrationId,
        result: "SUCCESS",
        before: { status: "CHECKED_IN" },
        after: { status: "REGISTERED", memberProfileId: member.id },
      });
      return toStaffReg(updated);
    });
  },

  async serve(
    activityId: string,
    registrationId: string,
    actor: AuthorizedActor,
  ): Promise<ServeResultView> {
    const member = await requireStaffMember(actor);
    const activity = await loadActivityOrThrow(activityId);
    await requireAttendance(activityId, member.id);
    if (!registrationId.trim()) {
      throw new AppError("VALIDATION_FAILED", "报名 ID 无效");
    }

    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const reg = await tx.repairActivityRegistration.findFirst({
        where: { id: registrationId, activityId, deletedAt: null },
      });
      if (!reg) {
        throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在");
      }
      if (!canServeRegistration(reg.status)) {
        throw new AppError("ACTIVITY_REGISTRATION_STATE_INVALID", "仅排队中的报名可接待落单");
      }

      const issueType = assertValidIssueType(reg.issueType);
      const categoryCode = mapIssueTypeToCategoryCode(issueType);
      const category = await tx.repairCategory.findFirst({
        where: { code: categoryCode, deletedAt: null, isActive: true },
      });
      if (!category) {
        throw new AppError("ACTIVITY_CATEGORY_MISSING", `故障分类 ${categoryCode} 未配置或已停用`);
      }

      const now = new Date();
      const phoneMasked = maskActivityPhone(reg.phone);
      const content = buildActivityServeContent({
        activityTitle: activity.title,
        customerName: reg.name,
        phoneMasked,
        issueTypeLabel: repairActivityIssueTypeLabels[issueType],
      });
      const repairDate = shanghaiCalendarDay(activity.activityAt);
      const createRequestKey = `activity-serve:${registrationId}`;

      const { repairRecordId } = await createSubmittedForActivity(
        tx,
        {
          memberProfileId: member.id,
          categoryId: category.id,
          repairDate,
          content,
          remark: ACTIVITY_SERVE_REMARK,
          durationMinutes: ACTIVITY_SERVE_DURATION_MINUTES,
          // 报名时填的机型随记录带过去（issue #68）；没填就是 null。
          deviceModel: reg.deviceModel,
          ownerName: reg.name,
          ownerPhone: reg.phone,
          createRequestKey,
          registrationId,
          activityId,
        },
        actor,
        now,
      );

      const updated = await tx.repairActivityRegistration.update({
        where: { id: registrationId },
        data: {
          status: "SERVED",
          servedAt: now,
          servedByMemberProfileId: member.id,
          repairRecordId,
        },
      });

      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.registration_served",
        targetType: "RepairActivityRegistration",
        targetId: registrationId,
        result: "SUCCESS",
        after: {
          status: "SERVED",
          repairRecordId,
          categoryCode,
          memberProfileId: member.id,
        },
      });

      return {
        registration: toStaffReg(updated),
        repairRecordId,
      };
    });
  },
};
