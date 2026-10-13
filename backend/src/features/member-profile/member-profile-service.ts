import { randomUUID } from "node:crypto";

import { appendAuditLog } from "@/lib/audit/audit-service";
import { AppError } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { getDb } from "@/lib/db/client";
import {
  memberProfilePolicy,
  resolveDisplayName,
} from "@/features/member-profile/member-profile-policy";
import { normalizeNickname } from "@/features/member-profile/member-profile-types";
import { memberProfileRepository } from "@/features/member-profile/member-profile-repository";
import { resolveMemberRanges } from "@/features/member-dashboard/member-overview-provider";
import { skillRepository } from "@/features/skills/skill-repository";
import { toSkillView } from "@/features/skills/skill-service";
import { listMemberRecentRepairs } from "@/features/repairs/repair-query-service";
import { getMemberSummary } from "@/features/analytics/analytics-repository";
import type {
  AuthorizedActor,
  MemberInternalProfileView,
  MemberSelfProfileView,
  SkillView,
  UpdateMemberProfileInput,
  UpdateMemberProfileResult,
  UpdateMemberSkillsInput,
  UpdateMemberSkillsResult,
} from "@/types/contracts";
import { MEMBER_RECENT_REPAIR_LIMIT, MEMBER_SKILL_LIMIT } from "@/types/contracts";

/**
 * 成员资料与技能服务（M3 任务书 §9、§10.2、§10.3、§14）。
 *
 * 职责：
 * - 权限：self / internal 两套读权限，写入要求 `update_self` / `assign_self`；
 * - 校验：昵称规范化、技能存在性/启用状态/数量上限；
 * - 事务：昵称更新与技能集合替换都在同一事务内完成版本递增与审计；
 * - 乐观锁：`id + version + deletedAt IS NULL`，失败返回 `MEMBER_PROFILE_VERSION_CONFLICT` (409)。
 */

/** 404 统一语义：不存在、软删除、非有效成员、无权访问一律不区分，避免成员枚举。 */
function profileNotFound(): AppError {
  return new AppError("MEMBER_PROFILE_NOT_FOUND", "成员资料不存在或不可访问");
}

export const memberProfileService = {
  /** 原生资料选择器，只返回有效成员的最小摘要，不提供联系方式。 */
  async directory(query: string, page: number, actor: AuthorizedActor) {
    requirePermission(actor, "member.profile.read_internal");
    const rows = await getDb().memberProfile.findMany({
      where: {
        deletedAt: null,
        status: "ACTIVE",
        user: { status: "ACTIVE", deletedAt: null },
        ...(query
          ? { OR: [{ nickname: { contains: query } }, { realName: { contains: query } }] }
          : {}),
      },
      select: { id: true, nickname: true, realName: true },
      orderBy: { id: "asc" },
      skip: (page - 1) * 20,
      take: 21,
    });
    return {
      items: rows
        .slice(0, 20)
        .map((row) => ({
          memberProfileId: row.id,
          displayName: row.nickname?.trim() || row.realName || "成员",
        })),
      hasMore: rows.length > 20,
      page,
    };
  },
  /** `GET /api/v1/member/profile` —— 本人完整资料 + 已通过摘要 + 最近已通过记录。 */
  async getSelf(actor: AuthorizedActor): Promise<MemberSelfProfileView> {
    requirePermission(actor, "member.profile.read_self");
    const row = await memberProfileRepository.activeForUser(actor.userId);
    // 「本月 / 本学期」是日期相对口径，必须显式传入区间；
    // 缺省调用会让 monthApprovedCount 恒为 0、termApprovedCount 恒为 UNCONFIGURED。
    // 这里复用工作台的 `resolveMemberRanges`，保证个人主页与工作台口径完全一致。
    const { monthRange, termRange } = resolveMemberRanges(new Date());
    const [skills, repairSummary, recentRepairs] = await Promise.all([
      readSkills(row.id),
      // M5 起正式摘要统一由 Analytics 入口产出（source = M5_ANALYTICS）；
      // 内部仍复用 M2 的正式谓词与同一套聚合，不产生第二个统计口径。
      getMemberSummary(row.id, { monthRange, termRange }),
      listMemberRecentRepairs(row.id, MEMBER_RECENT_REPAIR_LIMIT),
    ]);
    return {
      profile: memberProfilePolicy.toSelf(row, skills),
      repairSummary,
      recentRepairs,
    };
  },

  /** `GET /api/v1/members/:memberProfileId/profile` —— 他人内部主页（裁剪后）。 */
  async getInternal(
    memberProfileId: string,
    actor: AuthorizedActor,
  ): Promise<MemberInternalProfileView> {
    requirePermission(actor, "member.profile.read_internal");
    const row = await memberProfileRepository.findById(memberProfileId);
    // 目标必须存在、未软删除，且账号与档案均处于有效状态；否则统一 404。
    if (!row || row.status !== "ACTIVE" || row.user.status !== "ACTIVE") {
      throw profileNotFound();
    }
    const { monthRange, termRange } = resolveMemberRanges(new Date());
    const [skills, repairSummary, recentRepairs] = await Promise.all([
      readSkills(row.id),
      // 同 getSelf：内部主页也走 M5 Analytics 入口，避免出现两套摘要来源。
      getMemberSummary(row.id, { monthRange, termRange }),
      listMemberRecentRepairs(row.id, MEMBER_RECENT_REPAIR_LIMIT),
    ]);
    return {
      profile: memberProfilePolicy.toInternal(row, skills),
      repairSummary,
      recentRepairs,
    };
  },

  /** `PATCH /api/v1/member/profile` —— 仅昵称可自助修改，走乐观锁。 */
  async updateProfile(
    input: UpdateMemberProfileInput,
    actor: AuthorizedActor,
  ): Promise<UpdateMemberProfileResult> {
    requirePermission(actor, "member.profile.update_self");
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new AppError("VALIDATION_FAILED", "version 必须是正整数", {
        fieldErrors: { version: ["version 必须是正整数"] },
      });
    }
    const nickname = normalizeNickname(input.nickname);
    if (nickname.kind === "UNCHANGED") {
      throw new AppError("VALIDATION_FAILED", "没有需要更新的字段", {
        fieldErrors: { nickname: ["没有需要更新的字段"] },
      });
    }

    const current = await memberProfileRepository.activeForUser(actor.userId);
    const nextNickname = nickname.kind === "CLEAR" ? null : nickname.value;

    await inSerializableTransaction(async (tx) => {
      // 乐观锁：条件含 id + version + deletedAt，任一项不匹配即视为冲突。
      const updated = await tx.memberProfile.updateMany({
        where: { id: current.id, version: input.version, deletedAt: null },
        data: { nickname: nextNickname, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new AppError("MEMBER_PROFILE_VERSION_CONFLICT", "资料已被更新，请刷新后重试");
      }
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "MEMBER_PROFILE_UPDATED",
        targetType: "MemberProfile",
        targetId: current.id,
        result: "SUCCESS",
        // 昵称可记录规范化后的前后值；其余受控字段不进入摘要。
        before: { nickname: current.nickname },
        after: { nickname: nextNickname },
      });
    });

    const refreshed = await memberProfileRepository.findById(current.id);
    if (!refreshed) throw profileNotFound();
    const skills = await readSkills(refreshed.id);
    return { profile: memberProfilePolicy.toSelf(refreshed, skills), version: refreshed.version };
  },

  /**
   * `PUT /api/v1/member/profile/skills` —— 完整期望集合，幂等保存。
   *
   * 语义：
   * - 去重后最多 12 项；
   * - 新增项必须存在、未软删除且启用；
   * - 已关联但现已停用的技能**保留**（除非成员显式移除），不静默删除；
   * - 取消 = 软删除关联；再次选择 = 复用同一行并清空 `deletedAt`（不新建、不物理删除）；
   * - 成功递增 `MemberProfile.version` 并写审计。
   */
  async updateSkills(
    input: UpdateMemberSkillsInput,
    actor: AuthorizedActor,
  ): Promise<UpdateMemberSkillsResult> {
    requirePermission(actor, "member.skill.assign_self");
    const current = await memberProfileRepository.activeForUser(actor.userId);
    return saveMemberSkills(current, input, actor, "MEMBER_SKILLS_UPDATED");
  },
};

/**
 * 技能集合保存的**唯一实现** —— 成员自助（`updateSkills`）与 M6 管理员代设
 * （`MemberService.setSkills`）共用，校验、上限、软删除复用、乐观锁与审计只有一份。
 *
 * 语义：
 * - 去重后最多 12 项；
 * - 新增项必须存在、未软删除且启用；
 * - 已关联但现已停用的技能**保留**（除非显式移除），不静默删除；
 * - 取消 = 软删除关联；再次选择 = 复用同一行并清空 `deletedAt`（不新建、不物理删除）；
 * - 成功递增 `MemberProfile.version` 并写审计。
 *
 * `current` 只用到 `id`，因此调用方可以先按自己的权限与身份解析出目标成员档案
 * （自助走 `activeForUser`，管理员走 `MemberService` 里带 `member:manage` 的解析）。
 */
export async function saveMemberSkills(
  current: { id: string },
  input: UpdateMemberSkillsInput,
  actor: AuthorizedActor,
  action: string,
): Promise<UpdateMemberSkillsResult> {
  if (!Number.isInteger(input.profileVersion) || input.profileVersion < 1) {
    throw new AppError("VALIDATION_FAILED", "profileVersion 必须是正整数", {
      fieldErrors: { profileVersion: ["profileVersion 必须是正整数"] },
    });
  }
  if (!Array.isArray(input.skillIds)) {
    throw new AppError("SKILL_SELECTION_INVALID", "skillIds 必须是数组", {
      fieldErrors: { skillIds: ["skillIds 必须是数组"] },
    });
  }
  if (input.skillIds.some((id) => typeof id !== "string" || id.trim() === "")) {
    throw new AppError("SKILL_SELECTION_INVALID", "skillIds 只能包含非空字符串");
  }

  const desired = [...new Set(input.skillIds.map((id) => id.trim()))];
  if (desired.length > MEMBER_SKILL_LIMIT) {
    throw new AppError("SKILL_LIMIT_EXCEEDED", `最多只能选择 ${MEMBER_SKILL_LIMIT} 个技能标签`, {
      fieldErrors: { skillIds: [`最多只能选择 ${MEMBER_SKILL_LIMIT} 个技能标签`] },
    });
  }

  await inSerializableTransaction(async (tx) => {
    // 1) 先校验版本 + 成员状态（事务内重新确认，避免并发窗口）
    const locked = await tx.memberProfile.updateMany({
      where: { id: current.id, version: input.profileVersion, deletedAt: null },
      data: { version: { increment: 1 } },
    });
    if (locked.count !== 1) {
      throw new AppError("MEMBER_PROFILE_VERSION_CONFLICT", "资料已被更新，请刷新后重试");
    }

    // 2) 校验技能：全部必须存在且未软删除
    const skillRows = await tx.skill.findMany({
      where: { id: { in: desired }, deletedAt: null },
      select: { id: true, code: true, isActive: true },
    });
    if (skillRows.length !== desired.length) {
      const found = new Set(skillRows.map((row) => row.id));
      const missing = desired.filter((id) => !found.has(id));
      throw new AppError("SKILL_NOT_FOUND", "存在无法识别的技能标签", {
        fieldErrors: { skillIds: missing },
      });
    }

    // 3) 校验启用状态：只有全新关联才要求启用；历史已停用关联的保留由第 4 步处理
    const existing = await tx.userSkill.findMany({
      where: { memberProfileId: current.id },
      select: { id: true, skillId: true, deletedAt: true },
    });
    const existingBySkill = new Map(existing.map((row) => [row.skillId, row]));
    const activeById = new Map(skillRows.map((row) => [row.id, row.isActive]));
    // code 查表：`skillRows` 覆盖 desired；被移除的旧技能不在其中，
    // 需要补读一次历史关联涉及的技能行（含已软删除）才能还原 before 集合。
    const removedSkillIds = existing
      .filter((row) => row.deletedAt === null && !desired.includes(row.skillId))
      .map((row) => row.skillId);
    const removedRows =
      removedSkillIds.length > 0
        ? await tx.skill.findMany({
            where: { id: { in: removedSkillIds } },
            select: { id: true, code: true },
          })
        : [];
    const codeById = new Map<string, string>([
      ...skillRows.map((row) => [row.id, row.code] as const),
      ...removedRows.map((row) => [row.id, row.code] as const),
    ]);
    const codeOf = (skillId: string): string | undefined => codeById.get(skillId);
    const inactiveNewlySelected = desired.filter((id) => {
      const previous = existingBySkill.get(id);
      const wasActive = previous && previous.deletedAt === null;
      return activeById.get(id) === false && !wasActive;
    });
    if (inactiveNewlySelected.length > 0) {
      throw new AppError("SKILL_INACTIVE", "存在已停用的技能标签，无法新增关联", {
        fieldErrors: { skillIds: inactiveNewlySelected },
      });
    }

    // 4) 差异落地
    const desiredSet = new Set(desired);
    // 「变更前集合」= 该成员**当前有效**关联（deletedAt IS NULL）对应的技能 code。
    // 注意不能从 `skillRows` 推导：它只包含本次 desired 涉及的技能，
    // 从它过滤永远得不出「被移除的旧技能」，会让 before 恒为空数组。
    // `existing` 是该成员的全部关联行（含已软删除），需先按 deletedAt 过滤。
    // 其中的 skill 可能已被软删除（`skillRows` 只查未删除的），
    // 因此这里补一次内存查表，避免把历史 code 记成 undefined。
    const beforeCodes = existing
      .filter((row) => row.deletedAt === null)
      .map((row) => codeOf(row.skillId))
      .filter((code): code is string => Boolean(code))
      .sort();

    // 4a) 取消：软删除（保留历史行与审计，绝不物理删除）
    const toRemove = existing.filter(
      (row) => row.deletedAt === null && !desiredSet.has(row.skillId),
    );
    if (toRemove.length > 0) {
      await tx.userSkill.updateMany({
        where: { id: { in: toRemove.map((row) => row.id) } },
        data: { deletedAt: new Date() },
      });
    }

    // 4b) 新增：复用软删除行（清空 deletedAt）或创建新行
    for (const skillId of desired) {
      const previous = existingBySkill.get(skillId);
      if (!previous) {
        await tx.userSkill.create({
          data: { id: randomUUID(), memberProfileId: current.id, skillId, createdAt: new Date() },
        });
      } else if (previous.deletedAt !== null) {
        await tx.userSkill.update({
          where: { id: previous.id },
          data: { deletedAt: null },
        });
      }
    }

    // 5) 审计：只记录 skill code 集合变化，不记录 QQ / 姓名等。
    // before / after 都用同一套 code 查表并排序，保证同一集合在不同提交里可比对。
    const afterCodes = desired
      .map((id) => codeOf(id))
      .filter((code): code is string => Boolean(code))
      .sort();
    await appendAuditLog(tx, {
      actor,
      actorType: "USER",
      actorUserId: actor.userId,
      action,
      targetType: "MemberProfile",
      targetId: current.id,
      result: "SUCCESS",
      before: { skillCodes: beforeCodes },
      after: { skillCodes: afterCodes },
    });
  });

  const refreshed = await memberProfileRepository.findById(current.id);
  if (!refreshed) throw profileNotFound();
  const skills = await readSkills(refreshed.id);
  return { skills, version: refreshed.version };
}

/** 读取成员当前技能（未软删除），转为公共视图。 */
async function readSkills(memberProfileId: string): Promise<SkillView[]> {
  const rows = await skillRepository.listMemberSkills(memberProfileId);
  return rows.map(toSkillView);
}

export { resolveDisplayName };
