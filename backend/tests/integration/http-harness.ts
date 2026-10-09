import { randomUUID } from "node:crypto";

import { SESSION_COOKIE_NAME } from "../../src/lib/auth/request";
import { getDb } from "../../src/lib/db/client";
import { getServerEnv } from "../../src/lib/env";
import { digestSessionToken } from "../../src/lib/security/secrets";
import type { RoleCode } from "../../src/types/contracts";

/**
 * 路由级集成测试的极小装置。
 *
 * 本仓库没有 HTTP 测试基础设施，也不需要为它起一个 next server：路由处理函数就是普通
 * 函数，传一个 `Request` 进去即可（M3 起就这么做，这里抽出来给后续用例复用，
 * 免得每个文件各抄一份）。
 */

/**
 * 写接口的同源头：`assertSameOrigin()` 只认 `APP_BASE_URL` 白名单，**不再**拿请求自带的
 * Host / X-Forwarded-Host 当基准（2026-09 安全审计 F4：那两个值由请求方控制）。
 *
 * 所以这里给的是「应用自己配置的来源」，而不是按 `url` 推导 —— 用例里的
 * `http://localhost/...` 只是路径占位，和浏览器真实发出的 Origin 无关。
 */
export function sameOriginHeaders(): Record<string, string> {
  return { origin: new URL(getServerEnv().APP_BASE_URL).origin };
}

/**
 * 直接调用路由处理函数。
 *
 * 写接口会走 `assertSameOrigin()`，见 `sameOriginHeaders()`。`host` / `x-forwarded-host`
 * 保留只为贴近真实请求，校验本身已经不看它们。
 *
 * `Params` 从 `handler` 的第二个参数反推：`/api/v1/repairs/[id]/...` 这类动态段路由把
 * `params` 声明为**必填**，若这里写成可选，传入的处理器会因参数逆变而不满足签名。
 * 无参数路由只声明一个形参，`Params` 取默认值即可，多传一个实参不影响运行。
 */
export async function callRoute<Params extends Record<string, string> = Record<string, string>>(
  handler: (request: Request, context: { params: Promise<Params> }) => Promise<Response>,
  url: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    params?: Params;
  } = {},
): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
  const parsed = new URL(url);
  const request = new Request(url, {
    method: init.method ?? "GET",
    headers: {
      ...sameOriginHeaders(),
      "x-forwarded-host": parsed.host,
      host: parsed.host,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const response = await handler(request, {
    params: Promise.resolve(init.params ?? ({} as Params)),
  });
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
    headers: response.headers,
  };
}

/**
 * 给某个用户造一个能通过 `authenticateRequest` 的会话，返回可直接放进 `cookie` 头的值。
 *
 * 两件事必须同时成立，否则测到的是鉴权分支而不是业务分支：
 *
 * 1. **有角色**（管理员接口要求 ADMIN）；
 * 2. **不是「首次登录必须改密」** —— 这种账号 `authenticateRequest` 一律 403
 *    （`PASSWORD_CHANGE_REQUIRED`），`memberService.create` 造出来的账号正好是这种。
 */
export async function sessionCookie(userId: string, roleCode: RoleCode = "ADMIN"): Promise<string> {
  const db = getDb();
  const now = new Date();
  const role = await db.role.findUnique({ where: { code: roleCode } });
  if (!role) throw new Error(`角色 ${roleCode} 不存在，先跑一次 pnpm db:seed`);
  await db.userRole.create({
    data: {
      id: randomUUID(),
      userId,
      roleId: role.id,
      sourceType: "ADMIN_CREATED",
      sourceId: userId,
      grantedAt: now,
      activeKey: `${userId}:${role.id}`,
    },
  });
  await db.passwordCredential.upsert({
    where: { userId },
    // 集成夹具里的管理员常常是 `db.user.create` 直接建的，**没有**口令凭据那一行；
    // 用 updateMany 关掉「必须改密」对不存在的行等于什么都没做，路由会返回
    // `PASSWORD_CHANGE_REQUIRED`，测到的就不是业务分支。
    update: { mustChangePassword: false, passwordChangedAt: now },
    create: {
      userId,
      passwordHash: "integration-placeholder-hash",
      mustChangePassword: false,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  await db.authSession.create({
    data: {
      id: randomUUID(),
      userId,
      tokenDigest: digestSessionToken(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    },
  });
  return `${SESSION_COOKIE_NAME}=${token}`;
}
