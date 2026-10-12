import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/api/errors";
import { hashPassword } from "@/lib/security/secrets";
import type { ProvisionSourceType } from "@/types/contracts";

type IdentityInput = { qq: string; phone: string };

export async function resolveOrCreateUser(
  tx: Prisma.TransactionClient,
  identity: IdentityInput,
  displayName: string,
): Promise<string> {
  const matches = await tx.userIdentity.findMany({
    where: {
      OR: [
        { type: "QQ", identifierNormalized: identity.qq },
        { type: "PHONE", identifierNormalized: identity.phone },
      ],
    },
    select: { userId: true, type: true, identifierNormalized: true, deletedAt: true },
  });
  const userIds = [...new Set(matches.map((match) => match.userId))];
  if (userIds.length > 1 || matches.some((match) => match.deletedAt !== null)) {
    throw new AppError("ACCOUNT_IDENTITY_CONFLICT", "账号身份信息存在冲突，需要管理员处理");
  }

  const now = new Date();
  const userId = userIds[0] ?? randomUUID();
  if (userIds.length === 0) {
    await tx.user.create({
      data: { id: userId, status: "ACTIVE", displayName, createdAt: now, updatedAt: now },
    });
  } else {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || user.status !== "ACTIVE") {
      throw new AppError("ACCOUNT_IDENTITY_CONFLICT", "账号身份信息存在冲突，需要管理员处理");
    }
  }

  const userIdentities =
    userIds.length === 0
      ? []
      : await tx.userIdentity.findMany({
          where: { userId, type: { in: ["QQ", "PHONE"] }, deletedAt: null },
          select: { type: true, identifierNormalized: true },
        });

  const requested = [
    { type: "QQ", value: identity.qq },
    { type: "PHONE", value: identity.phone },
  ] as const;
  for (const item of requested) {
    const existing = userIdentities.find((match) => match.type === item.type);
    if (existing && existing.identifierNormalized !== item.value) {
      throw new AppError("ACCOUNT_IDENTITY_CONFLICT", "账号身份信息存在冲突，需要管理员处理");
    }
    if (!existing) {
      await tx.userIdentity.create({
        data: {
          id: randomUUID(),
          userId,
          type: item.type,
          identifierNormalized: item.value,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
  }
  return userId;
}

/**
 * 客户自主注册（Issue #60）：只建「账号 + QQ 身份 + 自设口令」，
 * **不建成员档案、不授予任何角色** —— 注册只产生客户身份。
 *
 * 与 `resolveOrCreateUser` 的区别：那个是多身份（QQ + 手机）发放流程，命中既有身份时
 * 会复用或抛「需管理员处理」的冲突；注册是**独占**语义 —— QQ 只要已被任何账号占用
 * （包括软删除的身份行），就直接返回 `ACCOUNT_IDENTITY_TAKEN`，
 * 绝不认领、合并或改写既有账号的姓名、档案与口令。
 */
export async function createCustomerAccount(
  tx: Prisma.TransactionClient,
  input: { qq: string; displayName: string; password: string },
): Promise<string> {
  const taken = await tx.userIdentity.findUnique({
    where: { type_identifierNormalized: { type: "QQ", identifierNormalized: input.qq } },
    select: { id: true },
  });
  if (taken) throw identityTaken();

  const now = new Date();
  const userId = randomUUID();
  try {
    await tx.user.create({
      data: {
        id: userId,
        status: "ACTIVE",
        displayName: input.displayName,
        createdAt: now,
        updatedAt: now,
      },
    });
    await tx.userIdentity.create({
      data: {
        id: randomUUID(),
        userId,
        type: "QQ",
        identifierNormalized: input.qq,
        createdAt: now,
        updatedAt: now,
      },
    });
    await setRegistrationPassword(tx, userId, input.password);
  } catch (error) {
    // 并发注册同一个 QQ 会撞 `user_identities_type_identifier_uq`（P2002）；
    // 统一翻译成同一种冲突错误码，客户端不必区分「预检命中」还是「唯一键命中」。
    if (hasPrismaCode(error, "P2002")) throw identityTaken();
    throw error;
  }
  return userId;
}

function identityTaken(): AppError {
  return new AppError("ACCOUNT_IDENTITY_TAKEN", "该 QQ 号已注册，请直接登录");
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export async function ensureMemberProfile(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    realName: string;
    studentId?: string;
    className?: string;
  },
): Promise<string> {
  const existing = await tx.memberProfile.findUnique({ where: { userId: input.userId } });
  const now = new Date();
  if (existing) {
    await tx.memberProfile.update({
      where: { id: existing.id },
      data: {
        realName: input.realName,
        studentId: input.studentId,
        className: input.className,
        status: "ACTIVE",
        deletedAt: null,
      },
    });
    return existing.id;
  }
  const id = randomUUID();
  await tx.memberProfile.create({
    data: {
      id,
      userId: input.userId,
      realName: input.realName,
      studentId: input.studentId,
      className: input.className,
      status: "ACTIVE",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  return id;
}

export async function grantMemberRole(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    sourceType: ProvisionSourceType;
    sourceId: string;
    grantedBy?: string;
  },
): Promise<void> {
  const role = await tx.role.findUnique({ where: { code: "MEMBER" } });
  if (!role) throw new AppError("ACCOUNT_PROVISION_FAILED", "基础角色尚未初始化");
  const activeKey = `${input.userId}:${role.id}`;
  await tx.userRole.upsert({
    where: { activeKey },
    update: {},
    create: {
      id: randomUUID(),
      userId: input.userId,
      roleId: role.id,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      grantedBy: input.grantedBy,
      grantedAt: new Date(),
      activeKey,
    },
  });
}

export async function setInitialPassword(
  tx: Prisma.TransactionClient,
  userId: string,
  plainPassword: string,
): Promise<boolean> {
  const existing = await tx.passwordCredential.findUnique({ where: { userId } });
  if (existing) return false;
  const now = new Date();
  const passwordHash = await hashPassword(plainPassword);
  await tx.passwordCredential.create({
    data: {
      userId,
      passwordHash,
      mustChangePassword: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  return true;
}

export async function setRegistrationPassword(
  tx: Prisma.TransactionClient,
  userId: string,
  plainPassword: string,
): Promise<void> {
  const existing = await tx.passwordCredential.findUnique({ where: { userId } });
  if (existing) {
    throw new AppError("ACCOUNT_IDENTITY_CONFLICT", "该身份已存在账号凭据，需要管理员处理");
  }
  const now = new Date();
  await tx.passwordCredential.create({
    data: {
      userId,
      passwordHash: await hashPassword(plainPassword),
      mustChangePassword: false,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
}
