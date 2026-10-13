import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/api/errors";
import { paginationMeta } from "@/lib/api/pagination";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { repairCalendarRange } from "@/lib/academic-term";
import { assertCanReadRepair } from "./repair-policy";
import { repairDetailInclude, repairRepository } from "./repair-repository";
import { repairOrderBy } from "./repair-sort";
import { toRepairDetail, toRepairView } from "./repair-view";
import { isFavorited } from "@/features/community/favorite-service";
import type {
  AuthorizedActor,
  MemberRecentActivity,
  MemberRecentRepair,
  MemberRepairSummary,
  MemberWorkQueue,
  MetricValue,
  RepairListInput,
  RepairQueryServiceContract,
} from "@/types/contracts";

export const repairQueryService: RepairQueryServiceContract = {
  async list(input, actor) {
    requirePermission(actor, "repair:read");
    // 只有成员视角才需要「我自己是谁」——`listWhere` 会按 `repair:review` 决定可见范围。
    // 纯管理员账号（有 ADMIN 角色但没有成员档案）必须能进管理端列表，
    // 否则 `GET /api/v1/admin/repairs` 会对它永久返回 403 MEMBER_REQUIRED。
    if (!actor.permissions.includes("repair:review")) {
      await repairRepository.activeMemberForUser(actor.userId);
    }
    const where = listWhere(input, actor);
    const [total, rows] = await Promise.all([
      getDb().repairRecord.count({ where }),
      getDb().repairRecord.findMany({
        where,
        include: repairDetailInclude,
        // 用户点过表头就按用户的选择排（白名单与映射见 `repair-sort.ts`），否则按
        // 维修日期倒序；两条路径都由 `repairOrderBy` 补 `id` 兜底 ——
        // 主排序键重复时没有确定名次，`skip` / `take` 的分页就会重复或漏行。
        orderBy: repairOrderBy(input.sort),
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) =>
        toRepairView(row, {
          canViewOwnerPhone:
            row.memberProfile.userId === actor.userId ||
            actor.permissions.includes("repair:review"),
        }),
      ),
      pagination: paginationMeta(input, total),
    };
  },
  async getById(recordId, actor) {
    const record = await repairRepository.getById(recordId);
    assertCanReadRepair(actor, record);
    let favorited = false;
    if (actor.userId) {
      const member = await getDb().memberProfile.findFirst({
        where: { userId: actor.userId, status: "ACTIVE", deletedAt: null },
        select: { id: true },
      });
      if (member) favorited = await isFavorited(member.id, recordId);
    }
    return toRepairDetail(record, actor, { isFavorited: favorited });
  },
};

/**
 * 正式维修记录的唯一查询谓词。
 *
 * M2 分析入口与 M3 成员摘要都必须从这里组合附加条件，禁止各自重复
 * `APPROVED AND deletedAt IS NULL`，避免 M5 接入前出现统计口径漂移。
 */
export function approvedRepairWhere(
  scope: Omit<Prisma.RepairRecordWhereInput, "status" | "deletedAt"> = {},
): Prisma.RepairRecordWhereInput {
  return { ...scope, status: "APPROVED", deletedAt: null };
}

export async function listApprovedRepairsForAnalytics(input: { from?: Date; to?: Date } = {}) {
  return getDb().repairRecord.findMany({
    where: approvedRepairWhere({ repairDate: { gte: input.from, lte: input.to } }),
    select: {
      id: true,
      memberProfileId: true,
      repairDate: true,
      durationMinutes: true,
      categoryId: true,
      isDifficult: true,
      isTypical: true,
    },
    orderBy: [{ repairDate: "desc" }, { id: "desc" }],
  });
}

export async function listRepairMemberOptions(actor: AuthorizedActor) {
  requirePermission(actor, "repair:read");
  await repairRepository.activeMemberForUser(actor.userId);
  const rows = await getDb().memberProfile.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, realName: true, nickname: true, user: { select: { displayName: true } } },
    orderBy: [{ realName: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.nickname || row.realName || row.user.displayName || "成员",
  }));
}

// ---------------------------------------------------------------------------
// M3 成员维修摘要（任务书 §7）
//
// 这里**不重写**「有效维修记录」的定义：统一复用上面已冻结的
// `APPROVED AND deletedAt IS NULL` 语义，只在其上追加 `memberProfileId` 归属过滤。
// ---------------------------------------------------------------------------

/** 正式摘要只在唯一正式谓词上追加成员归属与可选日期范围。 */
function approvedForMember(
  memberProfileId: string,
  range?: UtcRange,
): Prisma.RepairRecordWhereInput {
  const calendar = range ? repairCalendarRange(range) : undefined;
  return approvedRepairWhere({
    memberProfileId,
    repairDate: calendar ? { gte: calendar.startInclusive, lt: calendar.endExclusive } : undefined,
  });
}

type UtcRange = { startInclusive: Date; endExclusive: Date };

/**
 * 成员维修摘要。`termRange` 为 undefined 表示学期未配置，
 * 此时 `termApprovedCount` 返回 `{ value: null, status: "UNCONFIGURED" }`，
 * **绝不回退为 0**。
 */
export async function listMemberRepairSummary(
  memberProfileId: string,
  options: { monthRange?: UtcRange; termRange?: UtcRange } = {},
): Promise<MemberRepairSummary> {
  const db = getDb();
  const generatedAt = new Date().toISOString();

  const [totalApprovedCount, monthApprovedCount, durationAggregate, termApprovedCount] =
    await Promise.all([
      db.repairRecord.count({ where: approvedForMember(memberProfileId) }),
      options.monthRange
        ? db.repairRecord.count({ where: approvedForMember(memberProfileId, options.monthRange) })
        : Promise.resolve(0),
      db.repairRecord.aggregate({
        where: approvedForMember(memberProfileId),
        _sum: { durationMinutes: true },
      }),
      options.termRange
        ? db.repairRecord.count({ where: approvedForMember(memberProfileId, options.termRange) })
        : Promise.resolve(null),
    ]);

  return {
    totalApprovedCount: available(totalApprovedCount),
    termApprovedCount:
      termApprovedCount === null
        ? { value: null, status: "UNCONFIGURED" }
        : available(termApprovedCount),
    monthApprovedCount: available(monthApprovedCount),
    // 时长为空表示该成员尚无已通过记录；有记录但时长为空则合计为 0 分钟（真实值）。
    totalApprovedDurationMinutes: available(durationAggregate._sum.durationMinutes ?? 0),
    source: "M2_APPROVED_REPAIRS",
    generatedAt,
  };
}

/**
 * 成员最近**已通过**维修记录（个人主页与内部主页使用）。
 * 只返回最小字段集，不带照片二进制、审核备注或内部时间线。
 */
export async function listMemberRecentRepairs(
  memberProfileId: string,
  limit: number,
): Promise<MemberRecentRepair[]> {
  const rows = await getDb().repairRecord.findMany({
    where: approvedForMember(memberProfileId),
    select: {
      id: true,
      repairDate: true,
      durationMinutes: true,
      result: true,
      content: true,
      updatedAt: true,
      category: { select: { name: true } },
    },
    orderBy: [{ repairDate: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    repairDate: row.repairDate ? row.repairDate.toISOString().slice(0, 10) : null,
    durationMinutes: row.durationMinutes,
    categoryName: row.category?.name ?? null,
    result: row.result,
    contentExcerpt: excerpt(row.content),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * 成员工作队列与最近操作。可包含未通过记录，因此与 `listMemberRecentRepairs` 区分开，
 * 返回条目带显式 `status`，禁止冒充「已通过维修」。
 */
export async function listMemberWorkQueue(memberProfileId: string): Promise<MemberWorkQueue> {
  const db = getDb();
  const base = { deletedAt: null, memberProfileId } as const;
  const [draftCount, pendingCount, rejectedCount] = await Promise.all([
    db.repairRecord.count({ where: { ...base, status: "DRAFT" } }),
    db.repairRecord.count({ where: { ...base, status: "PENDING" } }),
    db.repairRecord.count({ where: { ...base, status: "REJECTED" } }),
  ]);
  return { draftCount, pendingCount, rejectedCount };
}

export async function listMemberRecentActivity(
  memberProfileId: string,
  limit: number,
): Promise<MemberRecentActivity[]> {
  const rows = await getDb().repairRecord.findMany({
    where: { deletedAt: null, memberProfileId },
    select: { id: true, status: true, repairDate: true, content: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    status: row.status as MemberRecentActivity["status"],
    repairDate: row.repairDate ? row.repairDate.toISOString().slice(0, 10) : null,
    contentExcerpt: excerpt(row.content),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

function available(value: number): MetricValue {
  return { value, status: "AVAILABLE" };
}

/** 正文摘要：压平换行、截断到 60 个码点，不泄露完整长文本。 */
function excerpt(content: string | null): string {
  const flat = (content ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "未填写维修内容";
  const chars = [...flat];
  return chars.length > 60 ? `${chars.slice(0, 60).join("")}…` : flat;
}

/**
 * 维修列表的筛选谓词（含按 `repair:review` 分派的可见范围）。
 *
 * 导出复用它，保证「筛选后导出」与「界面看到的列表」是同一个结果集 ——
 * 各写一套筛选条件是导出功能最容易出的错。
 */
export function listWhere(
  input: RepairListInput,
  actor: { userId?: string; permissions: readonly string[] },
): Prisma.RepairRecordWhereInput {
  if (input.repairDateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(input.repairDateFrom))
    throw new AppError("VALIDATION_FAILED", "起始日期无效");
  if (input.repairDateTo && !/^\d{4}-\d{2}-\d{2}$/.test(input.repairDateTo))
    throw new AppError("VALIDATION_FAILED", "结束日期无效");
  const visibility: Prisma.RepairRecordWhereInput = actor.permissions.includes("repair:review")
    ? {}
    : { OR: [{ memberProfile: { userId: actor.userId } }, { status: "APPROVED" }] };
  const query = input.query?.trim();
  return {
    deletedAt: null,
    AND: [visibility],
    memberProfileId: input.memberId,
    categoryId: input.categoryId,
    status: input.status,
    result: input.result,
    repairDate: {
      gte: input.repairDateFrom ? new Date(`${input.repairDateFrom}T00:00:00.000Z`) : undefined,
      lte: input.repairDateTo ? new Date(`${input.repairDateTo}T00:00:00.000Z`) : undefined,
    },
    isDifficult: input.isDifficult,
    isTypical: input.isTypical,
    OR: query
      ? [
          { content: { contains: query } },
          { remark: { contains: query } },
          {
            memberProfile: {
              OR: [{ realName: { contains: query } }, { nickname: { contains: query } }],
            },
          },
        ]
      : undefined,
  };
}
