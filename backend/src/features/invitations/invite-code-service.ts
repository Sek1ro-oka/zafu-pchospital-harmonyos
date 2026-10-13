import { randomUUID } from "node:crypto";

import {
  ensureMemberProfile,
  grantMemberRole,
  resolveOrCreateUser,
  setRegistrationPassword,
} from "@/features/accounts/account-repository";
import { authService } from "@/features/auth/auth-service";
import type { InviteCode, Prisma } from "@/generated/prisma/client";
import { paginationMeta } from "@/lib/api/pagination";
import { AppError } from "@/lib/api/errors";
import { isPasswordLengthValid, passwordLengthMessage } from "@/lib/security/password-policy";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { maskPhone, maskQq } from "@/lib/audit/redaction";
import { requirePermission } from "@/lib/auth/permissions";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { getDb } from "@/lib/db/client";
import { normalizePhone, normalizeQq } from "@/lib/security/normalization";
import { digestInviteCode, generateInviteCode, verifyPassword } from "@/lib/security/secrets";
import type {
  AuthSessionResult,
  AuthorizedActor,
  CreateInviteCodeInput,
  CreateInviteCodeResult,
  InviteCodeAdminView,
  InviteCodeEffectiveStatus,
  InviteCodeListInput,
  InviteCodeListResult,
  InviteCodeServiceContract,
  InviteCodeView,
  MemberRegistrationResult,
  PublicRequestContext,
  RedeemInviteCodeInput,
  UpdateInviteCodeInput,
} from "@/types/contracts";

export function getInviteCodeEffectiveStatus(
  code: Pick<InviteCode, "status" | "activeFrom" | "expiresAt" | "maxUses" | "usedCount">,
  now = new Date(),
): InviteCodeEffectiveStatus {
  if (code.status === "REVOKED") return "REVOKED";
  if (code.activeFrom && code.activeFrom > now) return "NOT_STARTED";
  if (code.expiresAt && code.expiresAt <= now) return "EXPIRED";
  if (code.usedCount >= code.maxUses) return "EXHAUSTED";
  return "ACTIVE";
}

export class InviteCodeService implements InviteCodeServiceContract {
  /**
   * 管理端列表（M6 批次 2）。
   *
   * 原实现是硬编码 `take: 100` 的裸数组：没有任何分页元数据，第 101 条之后直接消失，
   * 界面上看不出「还有更多」。现在改为标准分页 + 筛选。
   *
   * `status` 过滤的是**生效状态**（`getInviteCodeEffectiveStatus` 的派生结果），
   * 不是存储状态：`EXPIRED` / `EXHAUSTED` / `NOT_STARTED` 在库里都是 `status = 'ACTIVE'`
   * 加时间或计数条件推出来的。因此这里必须把同一套判定**下推到 SQL**，
   * 否则「筛选已失效」会拿到空结果（行都在，只是被内存过滤前的分页切掉了）。
   * `EXPIRED` / `EXHAUSTED` / `ACTIVE` 三者的分支顺序与纯函数逐条对应。
   */
  async list(input: InviteCodeListInput, actor: AuthorizedActor): Promise<InviteCodeListResult> {
    requirePermission(actor, "invite:read");
    const now = new Date();
    const where: Prisma.InviteCodeWhereInput = {
      deletedAt: null,
      ...effectiveStatusWhere(input.status, now),
      OR: buildSearch(input.query),
    };
    const [records, total] = await Promise.all([
      getDb().inviteCode.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      getDb().inviteCode.count({ where }),
    ]);
    return {
      items: records.map((record) => ({ ...toView(record), ...adminFields(record) })),
      pagination: paginationMeta(input, total),
    };
  }
  async create(
    input: CreateInviteCodeInput,
    actor: AuthorizedActor,
  ): Promise<CreateInviteCodeResult> {
    requirePermission(actor, "invite:create");
    validateInvitePolicy(input);
    const plainCode = generateInviteCode();
    const now = new Date();
    const record = await inSerializableTransaction(async (tx) => {
      const created = await tx.inviteCode.create({
        data: {
          id: randomUUID(),
          codeDigest: digestInviteCode(plainCode),
          displayPrefix: plainCode.slice(0, 8),
          status: "ACTIVE",
          activeFrom: parseOptionalDate(input.activeFrom),
          expiresAt: parseOptionalDate(input.expiresAt),
          maxUses: input.maxUses,
          usedCount: 0,
          boundQqNormalized: input.boundQq ? normalizeQq(input.boundQq) : undefined,
          boundPhoneNormalized: input.boundPhone ? normalizePhone(input.boundPhone) : undefined,
          createdByUserId: actor.userId!,
          createdAt: now,
          updatedAt: now,
        },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: actor.actorType,
        actorUserId: actor.userId,
        action: "invite.code.created",
        targetType: "InviteCode",
        targetId: created.id,
        result: "SUCCESS",
        after: {
          displayPrefix: created.displayPrefix,
          activeFrom: created.activeFrom,
          expiresAt: created.expiresAt,
          maxUses: created.maxUses,
          boundQq: created.boundQqNormalized,
          boundPhone: created.boundPhoneNormalized,
        },
      });
      return created;
    });
    return { ...toView(record), plainCode };
  }

  async update(
    inviteCodeId: string,
    input: UpdateInviteCodeInput,
    actor: AuthorizedActor,
  ): Promise<InviteCodeView> {
    requirePermission(actor, "invite:create");
    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM invite_codes WHERE id = ${inviteCodeId} FOR UPDATE`;
      const current = await tx.inviteCode.findUnique({ where: { id: inviteCodeId } });
      if (!current || current.deletedAt) throw new AppError("RESOURCE_NOT_FOUND", "邀请码不存在");
      if (
        input.maxUses !== undefined &&
        (!Number.isInteger(input.maxUses) ||
          input.maxUses < Math.max(1, current.usedCount) ||
          input.maxUses > 1_000_000)
      ) {
        throw new AppError("INVITE_CODE_USAGE_LIMIT_INVALID", "最大使用次数不能小于已使用次数");
      }
      const activeFrom =
        input.activeFrom === undefined ? current.activeFrom : parseOptionalDate(input.activeFrom);
      const expiresAt =
        input.expiresAt === undefined ? current.expiresAt : parseOptionalDate(input.expiresAt);
      validateDateRange(activeFrom, expiresAt);
      const updated = await tx.inviteCode.update({
        where: { id: current.id },
        data: { activeFrom, expiresAt, maxUses: input.maxUses },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: actor.actorType,
        actorUserId: actor.userId,
        action: "invite.code.policy_updated",
        targetType: "InviteCode",
        targetId: current.id,
        result: "SUCCESS",
        before: {
          activeFrom: current.activeFrom,
          expiresAt: current.expiresAt,
          maxUses: current.maxUses,
        },
        after: { activeFrom, expiresAt, maxUses: updated.maxUses },
      });
      return toView(updated);
    });
  }

  async revoke(inviteCodeId: string, actor: AuthorizedActor): Promise<InviteCodeView> {
    requirePermission(actor, "invite:revoke");
    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM invite_codes WHERE id = ${inviteCodeId} FOR UPDATE`;
      const current = await tx.inviteCode.findUnique({ where: { id: inviteCodeId } });
      if (!current || current.deletedAt) throw new AppError("RESOURCE_NOT_FOUND", "邀请码不存在");
      if (current.status === "REVOKED") return toView(current);
      const updated = await tx.inviteCode.update({
        where: { id: current.id },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: actor.actorType,
        actorUserId: actor.userId,
        action: "invite.code.revoked",
        targetType: "InviteCode",
        targetId: current.id,
        result: "SUCCESS",
        before: { status: current.status },
        after: { status: updated.status },
      });
      return toView(updated);
    });
  }

  async redeem(
    input: RedeemInviteCodeInput,
    context: PublicRequestContext,
  ): Promise<MemberRegistrationResult> {
    const normalized = normalizeRedeemInput(input);
    return inSerializableTransaction((tx) => this.redeemWithin(tx, input, context, normalized));
  }

  /**
   * 邀请码注册**并当场发会话**（PR #65 审查 P2：注册与发会话必须原子）。
   *
   * 「建账号 / 发角色 / 建档案 / 扣名额 / 落兑换记录 / 写会话」全部在同一个串行化事务里
   * 完成：任何一步失败（包括会话写库）都整体回滚，不会留下「注册失败但账号已存在」的状态。
   * 旧实现是先提交账号、再在事务外发会话，会话一发失败就只能返回 500，而账号已经落库 ——
   * 用户重试只会拿到 `409 ACCOUNT_IDENTITY_TAKEN`，等于被自己的失败请求锁在门外。
   *
   * 与 `redeem()` 的差别只在返回值（`AuthSessionResult` 而非 `MemberRegistrationResult`）；
   * 校验、并发与幂等规则完全共用 `redeemWithin`，不复制第二套。
   */
  async redeemWithSession(
    input: RedeemInviteCodeInput,
    context: PublicRequestContext,
  ): Promise<AuthSessionResult> {
    const normalized = normalizeRedeemInput(input);
    return inSerializableTransaction(async (tx) => {
      const registration = await this.redeemWithin(tx, input, context, normalized);
      return authService.openSessionWith(
        tx,
        registration.userId,
        context,
        "auth.register.succeeded",
        input.rememberMe,
      );
    });
  }

  /** `redeem` 的事务主体：重放判定、邀请码扣减、账号与档案创建、审计（可被复用）。 */
  private async redeemWithin(
    tx: Prisma.TransactionClient,
    input: RedeemInviteCodeInput,
    context: PublicRequestContext,
    normalized: { qq: string; phone: string; digest: Uint8Array<ArrayBuffer> },
  ): Promise<MemberRegistrationResult> {
    const { qq, phone, digest } = normalized;
    const replay = await tx.inviteCodeRedemption.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: {
        inviteCode: { select: { codeDigest: true } },
        user: {
          select: {
            identities: {
              where: { type: { in: ["QQ", "PHONE"] }, deletedAt: null },
              select: { type: true, identifierNormalized: true },
            },
            passwordCredential: { select: { passwordHash: true } },
          },
        },
      },
    });
    if (replay) {
      const sameCode = Buffer.from(replay.inviteCode.codeDigest).equals(Buffer.from(digest));
      const sameQq = replay.user.identities.some(
        (identity) => identity.type === "QQ" && identity.identifierNormalized === qq,
      );
      const samePhone = replay.user.identities.some(
        (identity) => identity.type === "PHONE" && identity.identifierNormalized === phone,
      );
      if (!sameCode || !sameQq || !samePhone) {
        throw new AppError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一项注册请求");
      }
      /*
       * 重放分支必须校验本次请求的密码与该账号**当前**凭证一致（PR #65 审查 P1）。
       *
       * 只比 code / QQ / 手机号是不够的：这三项都能从原始成功请求里原样抄过来，
       * 而把 `password` 换成任意值 —— 不改任何数据就能拿到一个有效的工作人员令牌，
       * 相当于把「知道邀请码 + 知道幂等键」变成了免密凭证。账号改密之后重放旧请求
       * （密码已经对不上）同样能登录。所以这里按登录链路同一条规则验口令：
       * 先拿 `userId`，再读 `password_credentials.passwordHash`，用 `verifyPassword`
       * 比对本次请求的明文口令。失败一律按认证失败处理（`AUTH_INVALID_CREDENTIALS`，
       * 与 `auth-service.ts` 登录失败同一个错误码），**不发放任何会话**。
       *
       * 这里是串行化事务内的同一份快照，与登录路径的竞态窗口一致；没有凭据行
       * （例如账号被清理过）同样视为认证失败，绝不因为「查不到口令」就放行。
       */
      const passwordHash = replay.user.passwordCredential?.passwordHash;
      const passwordMatches = passwordHash
        ? await verifyPassword(input.password, passwordHash)
        : false;
      if (!passwordMatches) {
        throw new AppError("AUTH_INVALID_CREDENTIALS", "QQ 号或密码错误");
      }
      const provision = await tx.accountProvision.findUniqueOrThrow({
        where: {
          sourceType_sourceId: { sourceType: "INVITE_REDEMPTION", sourceId: replay.id },
        },
      });
      return {
        userId: replay.userId,
        memberProfileId: replay.memberProfileId,
        redemptionId: replay.id,
        provisionId: provision.id,
      };
    }

    await tx.$queryRaw`SELECT id FROM invite_codes WHERE code_digest = ${digest} FOR UPDATE`;
    const code = await tx.inviteCode.findUnique({ where: { codeDigest: digest } });
    if (!code || code.deletedAt) throw new AppError("INVITE_CODE_INVALID", "邀请码无效");
    assertRedeemable(code, qq, phone);

    const userId = await resolveOrCreateUser(tx, { qq, phone }, input.realName.trim());
    const memberProfileId = await ensureMemberProfile(tx, {
      userId,
      realName: input.realName.trim(),
      studentId: input.studentId?.trim(),
      className: input.className?.trim(),
    });
    await grantMemberRole(tx, {
      userId,
      sourceType: "INVITE_REDEMPTION",
      sourceId: code.id,
    });
    await setRegistrationPassword(tx, userId, input.password);

    const consumed = await tx.inviteCode.updateMany({
      where: { id: code.id, status: "ACTIVE", usedCount: { lt: code.maxUses } },
      data: { usedCount: { increment: 1 } },
    });
    if (consumed.count !== 1) throw new AppError("INVITE_CODE_EXHAUSTED", "邀请码已用尽");

    const redemptionId = randomUUID();
    await tx.inviteCodeRedemption.create({
      data: {
        id: redemptionId,
        inviteCodeId: code.id,
        userId,
        memberProfileId,
        idempotencyKey: input.idempotencyKey,
        redeemedAt: new Date(),
      },
    });
    const provision = await tx.accountProvision.create({
      data: {
        id: randomUUID(),
        sourceType: "INVITE_REDEMPTION",
        sourceId: redemptionId,
        idempotencyKey: input.idempotencyKey,
        status: "SUCCEEDED",
        userId,
        memberProfileId,
        attemptCount: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      },
    });
    await appendAuditLog(tx, {
      actor: context,
      actorType: "SYSTEM",
      action: "invite.code.redeemed",
      targetType: "InviteCode",
      targetId: code.id,
      result: "SUCCESS",
      after: { displayPrefix: code.displayPrefix, userId, memberProfileId },
    });
    return { userId, memberProfileId, redemptionId, provisionId: provision.id };
  }
}

/**
 * 兑换入参的公共规范化（`redeem` / `redeemWithSession` 共用，顺序与错误码保持一致）。
 *
 * 必须在事务外先做：密码长度、姓名长度这类错误与并发无关，先挡掉可以少占一个串行化事务；
 * QQ / 手机号规范化与邀请码摘要则要求 `redeem` 与 `redeemWithSession` 得到**完全相同**的
 * 归一化结果，否则同一个请求走两条入口会判定出不同的「同一项注册」。
 */
function normalizeRedeemInput(input: RedeemInviteCodeInput): {
  qq: string;
  phone: string;
  digest: Uint8Array<ArrayBuffer>;
} {
  if (!isPasswordLengthValid(input.password)) {
    throw new AppError("VALIDATION_FAILED", passwordLengthMessage());
  }
  if (input.realName.trim().length < 2 || input.realName.trim().length > 64) {
    throw new AppError("VALIDATION_FAILED", "姓名长度应为 2–64 个字符");
  }
  return {
    qq: normalizeQq(input.qq),
    phone: normalizePhone(input.phone),
    digest: digestInviteCode(input.code),
  };
}

function assertRedeemable(code: InviteCode, qq: string, phone: string): void {
  const effective = getInviteCodeEffectiveStatus(code);
  if (effective === "NOT_STARTED") throw new AppError("INVITE_CODE_NOT_ACTIVE", "邀请码尚未生效");
  if (effective === "REVOKED") throw new AppError("INVITE_CODE_REVOKED", "邀请码已撤销");
  if (effective === "EXPIRED") throw new AppError("INVITE_CODE_EXPIRED", "邀请码已失效");
  if (effective === "EXHAUSTED") throw new AppError("INVITE_CODE_EXHAUSTED", "邀请码已用尽");
  if (
    (code.boundQqNormalized && code.boundQqNormalized !== qq) ||
    (code.boundPhoneNormalized && code.boundPhoneNormalized !== phone)
  ) {
    throw new AppError("INVITE_CODE_BINDING_MISMATCH", "邀请码与登记信息不匹配");
  }
}

function validateInvitePolicy(input: CreateInviteCodeInput): void {
  if (!Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > 1_000_000) {
    throw new AppError("INVITE_CODE_USAGE_LIMIT_INVALID", "最大使用次数必须是正整数");
  }
  validateDateRange(parseOptionalDate(input.activeFrom), parseOptionalDate(input.expiresAt));
}

function parseOptionalDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AppError("VALIDATION_FAILED", "时间格式无效");
  return parsed;
}

function validateDateRange(activeFrom: Date | null, expiresAt: Date | null): void {
  if (activeFrom && expiresAt && expiresAt <= activeFrom) {
    throw new AppError("VALIDATION_FAILED", "失效时间必须晚于生效时间");
  }
}

function toView(record: InviteCode): InviteCodeView {
  return {
    id: record.id,
    displayPrefix: record.displayPrefix,
    status: getInviteCodeEffectiveStatus(record),
    activeFrom: record.activeFrom?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    maxUses: record.maxUses,
    usedCount: record.usedCount,
  };
}

/**
 * 生效状态下推到 SQL。
 *
 * 与 `getInviteCodeEffectiveStatus` 的分支**顺序严格对应**（REVOKED → NOT_STARTED →
 * EXPIRED → EXHAUSTED → ACTIVE），任何一侧改了判定，另一侧必须同步改。
 *
 * ⚠️ 时间条件一律走 `AND: [{ OR: … }, …]`，**不能**把两个 `OR` 平铺进同一个对象：
 * 后写的键会覆盖先写的（后者是同一个 `OR` 键），而且 `list` 还要在最外层挂关键字检索的
 * `OR`，平铺写法会连检索条件一起吃掉。这两个坑都实际踩到过。
 *
 * `used_count` 与 `max_uses` 的比较用 Prisma 的字段引用写成列对列比较：
 * 把 `maxUses` 读出来当常量比较需要 N 次查询，且无法把分页下推到 SQL。
 */
function effectiveStatusWhere(
  status: InviteCodeEffectiveStatus | undefined,
  now: Date,
): Prisma.InviteCodeWhereInput {
  if (!status) return {};
  if (status === "REVOKED") return { status: "REVOKED" };
  const started: Prisma.InviteCodeWhereInput = {
    OR: [{ activeFrom: null }, { activeFrom: { lte: now } }],
  };
  const notExpired: Prisma.InviteCodeWhereInput = {
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
  const fields = getDb().inviteCode.fields;
  switch (status) {
    case "NOT_STARTED":
      return { status: "ACTIVE", activeFrom: { gt: now } };
    case "EXPIRED":
      return { status: "ACTIVE", AND: [started], expiresAt: { lte: now } };
    case "EXHAUSTED":
      return {
        status: "ACTIVE",
        AND: [started, notExpired],
        usedCount: { gte: fields.maxUses },
      };
    default:
      return {
        status: "ACTIVE",
        AND: [started, notExpired],
        usedCount: { lt: fields.maxUses },
      };
  }
}

/**
 * 管理端附加字段。
 *
 * 绑定信息按 PII 规则脱敏：列表页只需要「这条码是否绑定了某个 QQ / 手机号」，
 * 不需要拿到原文；要核对绑定关系时看脱敏值的前后几位就足够。
 */
function adminFields(record: InviteCode): Omit<InviteCodeAdminView, keyof InviteCodeView> {
  return {
    boundQqMasked: record.boundQqNormalized ? maskQq(record.boundQqNormalized) : null,
    boundPhoneMasked: record.boundPhoneNormalized ? maskPhone(record.boundPhoneNormalized) : null,
    createdAt: record.createdAt.toISOString(),
    revokedAt: record.revokedAt?.toISOString() ?? null,
  };
}

/** 关键字：明文前缀（`displayPrefix` 是唯一可检索的码片段）与绑定的 QQ / 手机号。 */
function buildSearch(query: string | undefined): Prisma.InviteCodeWhereInput[] | undefined {
  const value = query?.trim();
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  return [
    { displayPrefix: { contains: value.toUpperCase() } },
    ...(digits ? [{ boundQqNormalized: digits }, { boundPhoneNormalized: digits }] : []),
  ];
}

export const inviteCodeService = new InviteCodeService();
