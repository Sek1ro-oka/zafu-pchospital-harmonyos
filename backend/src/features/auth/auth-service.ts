import { randomUUID } from "node:crypto";

import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { normalizeQq } from "@/lib/security/normalization";
import { isPasswordLengthValid, passwordLengthMessage } from "@/lib/security/password-policy";
import {
  digestLoginThrottleKey,
  digestSessionToken,
  generateSessionToken,
  hashPassword,
  verifyPassword,
} from "@/lib/security/secrets";
import type {
  AuthSessionResult,
  ChangePasswordInput,
  LoginInput,
  PublicRequestContext,
  RoleCode,
  SessionPrincipal,
} from "@/types/contracts";

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const SESSION_RENEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1_000;
const THROTTLE_WINDOW_MS = 15 * 60 * 1_000;
const THROTTLE_BLOCK_MS = 15 * 60 * 1_000;
const THROTTLE_MAX_FAILURES = 5;
const THROTTLE_PURGE_INTERVAL_MS = 60 * 60 * 1_000;
let lastThrottlePurgeAt = 0;
let placeholderHash: Promise<string> | undefined;

export class AuthService {
  async login(input: LoginInput, context: PublicRequestContext): Promise<AuthSessionResult> {
    const qq = safeNormalizeQq(input.qq);
    const keyDigest = digestLoginThrottleKey(qq ?? input.qq.trim(), context.ipAddress ?? "unknown");
    await assertNotThrottled(keyDigest);

    const identity = qq
      ? await getDb().userIdentity.findUnique({
          where: { type_identifierNormalized: { type: "QQ", identifierNormalized: qq } },
          include: { user: { include: { passwordCredential: true } } },
        })
      : null;
    const credential = identity?.deletedAt ? null : identity?.user.passwordCredential;
    const passwordValid = await verifyPassword(
      input.password,
      credential?.passwordHash ?? (await getPlaceholderHash()),
    );
    if (!identity || !credential || !passwordValid) {
      await recordFailure(keyDigest, context);
      throw new AppError("AUTH_INVALID_CREDENTIALS", "QQ 号或密码错误");
    }
    if (identity.user.deletedAt || identity.user.status !== "ACTIVE") {
      await auditAuth(context, "auth.login.denied", identity.userId, "ACCOUNT_DISABLED");
      throw new AppError("AUTH_INVALID_CREDENTIALS", "QQ 号或密码错误");
    }

    let principal: SessionPrincipal;
    try {
      principal = await this.readPrincipal(identity.userId);
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === "ACCOUNT_DISABLED" || error.code === "MEMBER_PROFILE_INACTIVE")
      ) {
        await auditAuth(context, "auth.login.denied", identity.userId, error.code);
        throw new AppError("AUTH_INVALID_CREDENTIALS", "QQ 号或密码错误");
      }
      throw error;
    }

    await getDb().loginThrottle.deleteMany({ where: { keyDigest } });
    return this.openSession(identity.userId, principal, context, "auth.login.succeeded");
  }

  /**
   * 注册即登录（Issue #60）：为**同一个请求刚创建的账号**直接发放会话，
   * 不重走密码校验与登录节流。
   *
   * 为什么不用 `login()`：注册成功后账号必然存在、口令就是刚写入的那一个，再校验一次没有
   * 安全收益，却会把「同一 QQ + IP 的历史登录失败计数」带进来 —— 注册已经成功、会话却拿到
   * 429，客户端停在没有会话的中间态。身份 / 角色 / 入口仍然只由服务端读库决定。
   */
  async issueSessionForRegisteredAccount(
    userId: string,
    context: PublicRequestContext,
  ): Promise<AuthSessionResult> {
    const principal = await this.readPrincipal(userId);
    return this.openSession(userId, principal, context, "auth.register.succeeded");
  }

  /** 会话落库 + 审计（登录与注册共用；令牌只在这里生成，摘要入库、明文只回客户端）。 */
  private async openSession(
    userId: string,
    principal: SessionPrincipal,
    context: PublicRequestContext,
    auditAction: string,
  ): Promise<AuthSessionResult> {
    const token = generateSessionToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
    const sessionId = randomUUID();
    await inSerializableTransaction(async (tx) => {
      await tx.authSession.create({
        data: {
          id: sessionId,
          userId,
          tokenDigest: digestSessionToken(token),
          createdAt: now,
          lastSeenAt: now,
          expiresAt,
          ipDigest: context.ipAddress
            ? digestLoginThrottleKey(userId, context.ipAddress)
            : undefined,
          userAgentDigest: context.userAgent
            ? digestLoginThrottleKey(userId, context.userAgent)
            : undefined,
        },
      });
      await appendAuditLog(tx, {
        actor: context,
        actorType: "SYSTEM",
        action: auditAction,
        targetType: "User",
        targetId: userId,
        result: "SUCCESS",
      });
    });
    return { ...principal, sessionId, token, expiresAt: expiresAt.toISOString() };
  }

  async authenticate(
    token: string,
  ): Promise<SessionPrincipal & { sessionId: string; expiresAt: string }> {
    if (!token) throw new AppError("AUTH_SESSION_INVALID", "登录状态无效");
    const session = await getDb().authSession.findUnique({
      where: { tokenDigest: digestSessionToken(token) },
    });
    if (!session || session.revokedAt) throw new AppError("AUTH_SESSION_INVALID", "登录状态无效");
    const now = new Date();
    if (session.expiresAt <= now) {
      await getDb().authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now },
      });
      throw new AppError("AUTH_SESSION_EXPIRED", "登录已过期，请重新登录");
    }
    const principal = await this.readPrincipal(session.userId);
    const update: { lastSeenAt?: Date; expiresAt?: Date } = {};
    if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS)
      update.lastSeenAt = now;
    if (session.expiresAt.getTime() - now.getTime() <= SESSION_RENEW_WINDOW_MS) {
      update.expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
    }
    if (Object.keys(update).length)
      await getDb().authSession.update({ where: { id: session.id }, data: update });
    return {
      ...principal,
      sessionId: session.id,
      expiresAt: (update.expiresAt ?? session.expiresAt).toISOString(),
    };
  }

  async logout(token: string, context: PublicRequestContext): Promise<void> {
    const session = await getDb().authSession.findUnique({
      where: { tokenDigest: digestSessionToken(token) },
    });
    if (!session || session.revokedAt) return;
    await inSerializableTransaction(async (tx) => {
      await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      await appendAuditLog(tx, {
        actor: context,
        actorType: "USER",
        actorUserId: session.userId,
        action: "auth.logout",
        targetType: "AuthSession",
        targetId: session.id,
        result: "SUCCESS",
      });
      await appendAuditLog(tx, {
        actor: context,
        actorType: "USER",
        actorUserId: session.userId,
        action: "auth.session.revoked",
        targetType: "AuthSession",
        targetId: session.id,
        result: "SUCCESS",
      });
    });
  }

  async changePassword(
    token: string,
    input: ChangePasswordInput,
    context: PublicRequestContext,
  ): Promise<AuthSessionResult> {
    if (input.newPassword !== input.newPasswordConfirmation)
      throw new AppError("PASSWORD_CONFIRMATION_MISMATCH", "两次输入的新密码不一致");
    if (!isPasswordLengthValid(input.newPassword))
      throw new AppError("VALIDATION_FAILED", passwordLengthMessage());
    const current = await this.authenticate(token);
    const credential = await getDb().passwordCredential.findUniqueOrThrow({
      where: { userId: current.userId },
    });
    if (!(await verifyPassword(input.currentPassword, credential.passwordHash)))
      throw new AppError("PASSWORD_CURRENT_INVALID", "当前密码错误");
    const passwordHash = await hashPassword(input.newPassword);
    const newToken = generateSessionToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
    const sessionId = randomUUID();
    await inSerializableTransaction(async (tx) => {
      await tx.passwordCredential.update({
        where: { userId: current.userId },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: now },
      });
      await tx.authSession.updateMany({
        where: { userId: current.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.authSession.create({
        data: {
          id: sessionId,
          userId: current.userId,
          tokenDigest: digestSessionToken(newToken),
          createdAt: now,
          lastSeenAt: now,
          expiresAt,
        },
      });
      await appendAuditLog(tx, {
        actor: context,
        actorType: "USER",
        actorUserId: current.userId,
        action: "auth.session.revoked",
        targetType: "AuthSession",
        targetId: current.sessionId,
        result: "SUCCESS",
      });
      await appendAuditLog(tx, {
        actor: context,
        actorType: "USER",
        actorUserId: current.userId,
        action: "auth.password.changed",
        targetType: "User",
        targetId: current.userId,
        result: "SUCCESS",
      });
    });
    return {
      ...(await this.readPrincipal(current.userId)),
      sessionId,
      token: newToken,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async readPrincipal(userId: string): Promise<SessionPrincipal> {
    const user = await getDb().user.findUnique({
      where: { id: userId },
      include: {
        passwordCredential: true,
        memberProfile: true,
        roles: { where: { revokedAt: null }, include: { role: true } },
      },
    });
    if (!user || user.deletedAt || user.status !== "ACTIVE")
      throw new AppError("ACCOUNT_DISABLED", "账号当前不可用");
    const roles = user.roles
      .map((entry) => entry.role.code)
      .filter((role): role is RoleCode => role === "MEMBER" || role === "ADMIN");
    const activeMember =
      user.memberProfile &&
      !user.memberProfile.deletedAt &&
      user.memberProfile.status === "ACTIVE" &&
      roles.includes("MEMBER");
    if (
      !roles.includes("ADMIN") &&
      (user.memberProfile ? !activeMember : roles.includes("MEMBER"))
    ) {
      throw new AppError("MEMBER_PROFILE_INACTIVE", "成员身份当前不可用");
    }
    return {
      userId,
      displayName: user.displayName,
      roles,
      permissions: permissionsForRoles(roles),
      memberProfileId: user.memberProfile?.id ?? null,
      memberStatus:
        user.memberProfile?.status === "ACTIVE" || user.memberProfile?.status === "REVOKED"
          ? user.memberProfile.status
          : null,
      mustChangePassword: user.passwordCredential?.mustChangePassword ?? true,
    };
  }
}

function safeNormalizeQq(value: string): string | null {
  try {
    return normalizeQq(value);
  } catch {
    return null;
  }
}

async function getPlaceholderHash(): Promise<string> {
  placeholderHash ??= hashPassword("invalid-login-placeholder-password");
  return placeholderHash;
}

async function assertNotThrottled(keyDigest: Uint8Array<ArrayBuffer>): Promise<void> {
  const throttle = await getDb().loginThrottle.findUnique({ where: { keyDigest } });
  if (throttle?.blockedUntil && throttle.blockedUntil > new Date())
    throw new AppError("AUTH_RATE_LIMITED", "登录尝试过于频繁，请稍后再试");
}

async function recordFailure(
  keyDigest: Uint8Array<ArrayBuffer>,
  context: PublicRequestContext,
): Promise<void> {
  const now = new Date();
  await inSerializableTransaction(async (tx) => {
    await tx.$queryRaw`SELECT key_digest FROM login_throttles WHERE key_digest = ${keyDigest} FOR UPDATE`;
    const current = await tx.loginThrottle.findUnique({ where: { keyDigest } });
    const reset =
      !current || now.getTime() - current.windowStartedAt.getTime() >= THROTTLE_WINDOW_MS;
    const failedCount = reset ? 1 : current.failedCount + 1;
    await tx.loginThrottle.upsert({
      where: { keyDigest },
      create: {
        keyDigest,
        failedCount,
        windowStartedAt: now,
        blockedUntil:
          failedCount >= THROTTLE_MAX_FAILURES ? new Date(now.getTime() + THROTTLE_BLOCK_MS) : null,
        updatedAt: now,
      },
      update: {
        failedCount,
        windowStartedAt: reset ? now : current!.windowStartedAt,
        blockedUntil:
          failedCount >= THROTTLE_MAX_FAILURES ? new Date(now.getTime() + THROTTLE_BLOCK_MS) : null,
        updatedAt: now,
      },
    });
    await appendAuditLog(tx, {
      actor: context,
      actorType: "SYSTEM",
      action: "auth.login.failed",
      targetType: "User",
      targetId: "00000000-0000-0000-0000-000000000000",
      result: "FAILURE",
      errorCode: "AUTH_INVALID_CREDENTIALS",
    });
  });
  await purgeInertThrottles(now);
}

/**
 * 清掉已经失效的节流记录。键是 `(qq, ip)`，被刷时会不断建新行把表撑大（审计 F2）。
 * `blocked_until` 最多是 `updated_at + THROTTLE_BLOCK_MS`，所以早于该时刻的行不再拦截任何请求，
 * 删除是安全的。最多每小时扫一次，避免每次登录失败都在失败路径上做全表比较。
 */
async function purgeInertThrottles(now: Date): Promise<void> {
  if (now.getTime() - lastThrottlePurgeAt < THROTTLE_PURGE_INTERVAL_MS) return;
  lastThrottlePurgeAt = now.getTime();
  try {
    await getDb().loginThrottle.deleteMany({
      where: { updatedAt: { lt: new Date(now.getTime() - THROTTLE_BLOCK_MS) } },
    });
  } catch (error) {
    // 清理失败不能把「密码错误」变成 500；下个小时会再试一次
    console.error("[auth] 清理失效登录节流记录失败", error);
  }
}

async function auditAuth(
  context: PublicRequestContext,
  action: string,
  targetId: string,
  errorCode: string,
): Promise<void> {
  await inSerializableTransaction((tx) =>
    appendAuditLog(tx, {
      actor: context,
      actorType: "SYSTEM",
      action,
      targetType: "User",
      targetId,
      result: "FAILURE",
      errorCode,
    }),
  );
}

export const authService = new AuthService();
