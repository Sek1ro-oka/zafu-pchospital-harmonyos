import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "../src/generated/prisma/client";
import { normalizeQq } from "../src/lib/security/normalization";
import { hashPassword } from "../src/lib/security/secrets";
import { assertExperimentDatabase } from "./db-target.mjs";

/**
 * 准备可重复使用的本地测试账号（`pnpm accounts:prepare`）。
 *
 * - 只允许课设实验库（`assertExperimentDatabase`，与 seed 同一道闸门）；
 * - 固定 QQ 与口令，可反复执行：每次把口令重置为已知值，其余状态收敛到目标值；
 * - 只动本脚本自己的两个账号（固定 UUID）。QQ 被其他账号占用时停止，绝不改别人的数据；
 * - 账号设计：客户 = 无任何角色、无成员档案（服务端登录要求：有成员档案就必须有有效
 *   MEMBER 角色）；工作人员 = MEMBER（维修队成员）+ 有效成员档案。工作人员不是 ADMIN。
 */

if (existsSync(".env")) loadEnvFile(".env");
else throw new Error("缺少 backend/.env：先在 backend/ 运行 corepack pnpm setup:local");

const database = assertExperimentDatabase("seed");
console.log(`Verified experiment database: ${database} (accounts:prepare)`);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("缺少环境变量：DATABASE_URL");

const url = new URL(databaseUrl);
const adapter = new PrismaMariaDb({
  host: url.hostname,
  port: url.port ? Number(url.port) : 3306,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ""),
  allowPublicKeyRetrieval: ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname),
  cachingRsaPublicKey: process.env.DATABASE_RSA_PUBLIC_KEY_PATH,
  timezone: "Z",
  charset: "utf8mb4",
});
const prisma = new PrismaClient({ adapter });

type TestAccount = {
  label: string;
  note: string;
  userId: string;
  qq: string;
  password: string;
  displayName: string;
  roleCode: "MEMBER" | null;
};

const ACCOUNTS: readonly TestAccount[] = [
  {
    label: "客户",
    note: "无角色 → 客户端客户服务入口",
    userId: "30000000-0000-4000-8000-000000000001",
    qq: "100001",
    password: "customer123",
    displayName: "测试客户",
    roleCode: null,
  },
  {
    label: "工作人员",
    note: "MEMBER（维修队成员）→ 工作人员入口；不是管理员",
    userId: "30000000-0000-4000-8000-000000000002",
    qq: "100002",
    password: "staff123",
    displayName: "测试工作人员",
    roleCode: "MEMBER",
  },
];

async function prepareAccount(account: TestAccount): Promise<void> {
  const now = new Date();
  const qq = normalizeQq(account.qq);

  const identity = await prisma.userIdentity.findUnique({
    where: { type_identifierNormalized: { type: "QQ", identifierNormalized: qq } },
  });
  if (identity && identity.userId !== account.userId)
    throw new Error(
      `QQ ${qq} 已被其他账号（${identity.userId}）占用：请更换测试 QQ，或先手动处理该账号`,
    );

  await prisma.user.upsert({
    where: { id: account.userId },
    create: {
      id: account.userId,
      status: "ACTIVE",
      displayName: account.displayName,
      createdAt: now,
      updatedAt: now,
    },
    update: { status: "ACTIVE", displayName: account.displayName, deletedAt: null },
  });
  await prisma.userIdentity.upsert({
    where: { type_identifierNormalized: { type: "QQ", identifierNormalized: qq } },
    create: {
      id: randomUUID(),
      userId: account.userId,
      type: "QQ",
      identifierNormalized: qq,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    update: { deletedAt: null, verifiedAt: now },
  });

  const passwordHash = await hashPassword(account.password);
  await prisma.passwordCredential.upsert({
    where: { userId: account.userId },
    create: {
      userId: account.userId,
      passwordHash,
      mustChangePassword: false,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    update: { passwordHash, mustChangePassword: false, passwordChangedAt: now },
  });

  if (account.roleCode === "MEMBER") {
    const role = await prisma.role.findUnique({ where: { code: account.roleCode } });
    if (!role) throw new Error(`角色 ${account.roleCode} 不存在：先运行 corepack pnpm db:seed`);
    const activeKey = `${account.userId}:${role.id}`;
    await prisma.userRole.upsert({
      where: { activeKey },
      create: {
        id: randomUUID(),
        userId: account.userId,
        roleId: role.id,
        sourceType: "ADMIN_CREATED",
        grantedAt: now,
        activeKey,
      },
      update: { revokedAt: null },
    });
    await prisma.memberProfile.upsert({
      where: { userId: account.userId },
      create: {
        id: randomUUID(),
        userId: account.userId,
        realName: account.displayName,
        status: "ACTIVE",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      update: { realName: account.displayName, status: "ACTIVE", deletedAt: null },
    });
    return;
  }

  // 客户账号：有成员档案就必须有有效 MEMBER 角色，否则服务端会拒绝登录；
  // 因此这里要求没有档案（发现残留即停止，不动机构数据），并回收可能存在的角色。
  const profile = await prisma.memberProfile.findUnique({ where: { userId: account.userId } });
  if (profile) throw new Error(`账号 ${qq} 意外存在成员档案，与客户角色不符：请手动检查`);
  await prisma.userRole.updateMany({
    where: { userId: account.userId, revokedAt: null },
    data: { revokedAt: now },
  });
}

async function main(): Promise<void> {
  for (const account of ACCOUNTS) await prepareAccount(account);
  console.log(`\n测试账号已就绪（库 ${database}）：`);
  for (const account of ACCOUNTS) {
    console.log(`  ${account.label.padEnd(4)} QQ ${account.qq}  密码 ${account.password}`);
    console.log(`       ${account.note}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
