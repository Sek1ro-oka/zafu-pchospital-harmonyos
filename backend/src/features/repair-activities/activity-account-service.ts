import type { Prisma } from "@/generated/prisma/client";
import { repairActivityService } from "./repair-activity-service";
import { assertValidIssueType, canEditIssueType } from "./repair-activity-validation";
import { maskActivityPhone } from "./phone-mask";
import { AppError } from "@/lib/api/errors";
import { paginationMeta } from "@/lib/api/pagination";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import type { AuthorizedActor, PaginationInput } from "@/types/contracts";

const include = { activity: true } satisfies Prisma.RepairActivityRegistrationInclude;
type Row = Prisma.RepairActivityRegistrationGetPayload<{ include: typeof include }>;
function view(row: Row) {
  return {
    id: row.id,
    activityId: row.activityId,
    name: row.name,
    phoneMasked: maskActivityPhone(row.phone),
    deviceModel: row.deviceModel,
    issueType: assertValidIssueType(row.issueType),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    servedAt: row.servedAt?.toISOString() ?? null,
    canEditIssueType: canEditIssueType({
      registrationStatus: row.status,
      activityStatus: Date.now() >= row.activity.activityAt.getTime() ? "ENDED" : "CLOSED",
    }),
    activity: {
      id: row.activity.id,
      title: row.activity.title,
      location: row.activity.location,
      activityAt: row.activity.activityAt.toISOString(),
      signupClosesAt: row.activity.signupClosesAt.toISOString(),
    },
  };
}
function ownedWhere(actor: AuthorizedActor) {
  if (!actor.userId) throw new AppError("UNAUTHENTICATED", "请先登录");
  return { userId: actor.userId, deletedAt: null, activity: { deletedAt: null } };
}
export const activityAccountService = {
  async register(
    activityId: string,
    input: Parameters<typeof repairActivityService.register>[1],
    actor: AuthorizedActor,
  ) {
    ownedWhere(actor);
    return repairActivityService.register(activityId, input, actor, actor);
  },
  async list(pagination: PaginationInput, actor: AuthorizedActor) {
    const db = getDb(),
      where = ownedWhere(actor);
    const [total, rows] = await Promise.all([
      db.repairActivityRegistration.count({ where }),
      db.repairActivityRegistration.findMany({
        where,
        include,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
    ]);
    return { items: rows.map(view), pagination: paginationMeta(pagination, total) };
  },
  async get(activityId: string, id: string, actor: AuthorizedActor) {
    const row = await getDb().repairActivityRegistration.findFirst({
      where: { ...ownedWhere(actor), id, activityId },
      include,
    });
    if (!row) throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在或不可访问");
    return view(row);
  },
  async update(activityId: string, id: string, issue: unknown, actor: AuthorizedActor) {
    const issueType = assertValidIssueType(issue);
    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const row = await tx.repairActivityRegistration.findFirst({
        where: { ...ownedWhere(actor), id, activityId },
        include,
      });
      if (!row) throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在或不可访问");
      if (!view(row).canEditIssueType)
        throw new AppError("ACTIVITY_REGISTRATION_NOT_EDITABLE", "当前状态不可修改故障类型");
      const updated = await tx.repairActivityRegistration.update({
        where: { id },
        data: { issueType },
        include,
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.account_issue_type_updated",
        targetType: "RepairActivityRegistration",
        targetId: id,
        result: "SUCCESS",
        before: { issueType: row.issueType },
        after: { activityId, issueType },
      });
      return view(updated);
    });
  },
};
