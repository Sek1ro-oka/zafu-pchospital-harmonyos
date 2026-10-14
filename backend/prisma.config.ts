import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { defineConfig } from "prisma/config";
import { assertExperimentDatabase } from "./tools/db-target.mjs";

if (existsSync(".env")) loadEnvFile(".env");

if (process.env.DATABASE_URL) assertExperimentDatabase("migrate");

/**
 * `prisma migrate dev` 的影子库连接。
 *
 * 影子库只在 `migrate dev` / `migrate diff` 期间用来检测漂移，`migrate deploy` 与运行时
 * 都不碰它。没有它时本机 `db:migrate:dev` 会直接失败（P1003），因此这里从 `.env` 的
 * `DATABASE_URL` **派生**一个同实例的库名：复用同一份连接信息（不引入任何新凭证、
 * 不把口令写进仓库），只把库名换成 `<dev>_shadow`。
 *
 * 派生而不是写死：每个开发者的库名 / 端口 / 口令都在自己的 `.env` 里，仓库文件
 * 不该知道其中任何一项。显式的 `SHADOW_DATABASE_URL` 仍然优先。
 */
function shadowDatabaseUrl(): string | undefined {
  if (process.env.SHADOW_DATABASE_URL) return process.env.SHADOW_DATABASE_URL;
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "mysql:") return undefined;
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!database || database.includes("/")) return undefined;
    url.pathname = `/${database}_shadow`;
    return url.toString();
  } catch {
    return undefined;
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Generation and static builds do not open a connection. Runtime access validates the real value.
    url: process.env.DATABASE_URL ?? "mysql://build-only:build-only@127.0.0.1:3306/build_only",
    // Shadow database is only used by `prisma migrate dev` / `migrate diff` to detect drift.
    // Never points at a real environment; falls back to a throwaway local name.
    shadowDatabaseUrl: shadowDatabaseUrl(),
  },
});
