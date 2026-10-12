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
 * - 只动本脚本自己的三个账号（固定 UUID）。QQ 被其他账号占用时停止，绝不改别人的数据；
 * - 账号设计：客户 = 无任何角色、无成员档案（服务端登录要求：有成员档案就必须有有效
 *   MEMBER 角色）；工作人员 = MEMBER（维修队成员）+ 有效成员档案，不是 ADMIN；
 *   管理员 = ADMIN（`repair:review` / `repair:flag` 等管理权限）+ **刻意不建成员档案**，
 *   因此它只能审核 / 标记，不能受理报修单（受理要求有效成员档案，会得到 `MEMBER_REQUIRED`），
 *   正好用于课程演示「权限失败」场景。三个账号与 `docs/native-client-api.md` 的表一致。
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
  roleCode: "MEMBER" | "ADMIN" | null;
  /**
   * 是否创建（并收敛）有效成员档案。
   *
   * 只有 MEMBER 需要档案：受理报修单要求「有效成员档案」，服务端不允许凭空指定受理人。
   * 客户与纯管理员刻意不带档案 —— 纯管理员带了档案就变成「管理员 + 维修队成员」，
   * 演示不出「有审核权限但没有成员身份，不能受理报修单」这一权限失败场景。
   */
  hasMemberProfile: boolean;
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
    hasMemberProfile: false,
  },
  {
    label: "工作人员",
    note: "MEMBER（维修队成员）+ 有效成员档案 → 工作人员入口；不是管理员",
    userId: "30000000-0000-4000-8000-000000000002",
    qq: "100002",
    password: "staff123",
    displayName: "测试工作人员",
    roleCode: "MEMBER",
    hasMemberProfile: true,
  },
  {
    label: "管理员",
    note: "ADMIN（repair:review / repair:flag）→ 管理端审核、标记典型案例；无成员档案，不能受理报修单",
    userId: "30000000-0000-4000-8000-000000000003",
    qq: "100003",
    password: "admin123",
    displayName: "测试管理员",
    roleCode: "ADMIN",
    hasMemberProfile: false,
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

  // 角色收敛到目标值：这三个固定账号可能残留历史角色（例如管理员账号曾被按工作人员
  // 发过 MEMBER）。与目标不符的有效角色一律回收，角色集合才是可重复的确定值。
  // 只改本账号自己的 user_roles 行，不动任何机构/他人数据。
  if (account.roleCode === null) {
    await prisma.userRole.updateMany({
      where: { userId: account.userId, revokedAt: null },
      data: { revokedAt: now },
    });
  } else {
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
    await prisma.userRole.updateMany({
      where: { userId: account.userId, revokedAt: null, roleId: { not: role.id } },
      data: { revokedAt: now },
    });
  }

  if (account.hasMemberProfile) {
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

  // 无成员档案的账号（客户 / 纯管理员）：服务端要求「有成员档案就必须有有效 MEMBER 角色」，
  // 纯管理员刻意不带档案；客户本来就该没有档案。发现残留即停止（不动机构数据）——
  // 残留档案即使已软删除，也会让纯管理员登录时抛 MEMBER_PROFILE_INACTIVE。
  const profile = await prisma.memberProfile.findUnique({ where: { userId: account.userId } });
  if (profile)
    throw new Error(`账号 ${qq} 意外存在成员档案，与「${account.label}」不符：请手动检查`);
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
