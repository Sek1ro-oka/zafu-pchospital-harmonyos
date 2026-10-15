import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../../prisma/migrations/20260915120000_p2_m0_foundation/migration.sql",
  import.meta.url,
);
const m1MigrationPath = new URL(
  "../../prisma/migrations/20260916010000_p2_m1_auth_membership/migration.sql",
  import.meta.url,
);
const m2MigrationPath = new URL(
  "../../prisma/migrations/20260916140000_p2_m2_repairs/migration.sql",
  import.meta.url,
);
const m4MigrationPath = new URL(
  "../../prisma/migrations/20260918120000_p2_m4_community/migration.sql",
  import.meta.url,
);
const m6SettingsMigrationPath = new URL(
  "../../prisma/migrations/20260923100000_p2_m6_public_content_settings/migration.sql",
  import.meta.url,
);
const rememberMeMigrationPath = new URL(
  "../../prisma/migrations/20261013150000_issue60_remember_me/migration.sql",
  import.meta.url,
);

test("初始 Migration 固定 GreatSQL 字符集、引擎与邀请码计数约束", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const createTables = sql.match(/CREATE TABLE/g) ?? [];
  const collations = sql.match(/DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/g) ?? [];
  assert.equal(collations.length, createTables.length);
  assert.match(sql, /SET SESSION default_storage_engine = InnoDB/);
  assert.match(
    sql,
    /CHECK \(`max_uses` >= 1 AND `used_count` >= 0 AND `used_count` <= `max_uses`\)/,
  );
  assert.doesNotMatch(sql, /FOREIGN KEY \(`qq_normalized`\)|FOREIGN KEY \(`phone_normalized`\)/);
});

test("M1 Migration 使用摘要 Session 与持久化登录限流", async () => {
  const sql = await readFile(m1MigrationPath, "utf8");
  assert.match(sql, /CREATE TABLE `auth_sessions`/);
  assert.match(sql, /`token_digest` BINARY\(32\) NOT NULL/);
  assert.match(sql, /CREATE TABLE `login_throttles`/);
  assert.match(sql, /`key_digest` BINARY\(32\) NOT NULL/);
  assert.doesNotMatch(sql, /qq_normalized|ip_address|plain_token/i);
});

test("M2 Migration 建立维修核心、照片元数据、审核与时间线", async () => {
  const sql = await readFile(m2MigrationPath, "utf8");
  for (const table of [
    "repair_categories",
    "repair_records",
    "repair_photos",
    "repair_reviews",
    "repair_timeline_events",
  ])
    assert.match(sql, new RegExp("CREATE TABLE `" + table + "`"));
  assert.match(sql, /`repair_date` DATE NULL/);
  assert.match(sql, /`sha256_digest` BINARY\(32\) NOT NULL/);
  assert.match(sql, /repair_records_create_request_uq/);
  assert.doesNotMatch(sql, /qq|phone|student_id/i);
});

test("M4 Migration 建立评论、提及、收藏与通知且外键指向成员档案", async () => {
  const sql = await readFile(m4MigrationPath, "utf8");
  for (const table of ["repair_comments", "comment_mentions", "repair_favorites", "notifications"]) {
    assert.match(sql, new RegExp("CREATE TABLE `" + table + "`"));
  }
  const createTables = sql.match(/CREATE TABLE/g) ?? [];
  const collations = sql.match(/DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/g) ?? [];
  assert.equal(collations.length, createTables.length);
  assert.match(sql, /ENGINE=InnoDB/);
  assert.match(sql, /repair_favorites_member_record_uq/);
  assert.match(sql, /comment_mentions_comment_member_uq/);
  assert.match(sql, /REFERENCES `member_profiles`/);
  assert.match(sql, /REFERENCES `repair_records`/);
  const ddl = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(ddl, /qq|phone|student_id/i);
});

test("M6 批次 2 Migration 建立公开内容设置单行表并约束展示策略取值", async () => {
  const sql = await readFile(m6SettingsMigrationPath, "utf8");
  assert.match(sql, /CREATE TABLE `public_content_settings`/);
  assert.match(sql, /PRIMARY KEY \(`id`\)/);
  assert.match(
    sql,
    /CHECK \(`ranking_display_name` IN \('REAL_NAME', 'NICKNAME', 'HIDDEN'\)\)/,
  );
  assert.match(sql, /DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB/);
  assert.match(sql, /REFERENCES `users`\(`id`\)/);
  // 单行表：只允许一个主键，不允许出现额外的唯一键或业务外键（策略不挂在成员身上）。
  assert.doesNotMatch(sql, /UNIQUE INDEX/);
  assert.doesNotMatch(sql, /REFERENCES `member_profiles`|REFERENCES `repair_records`/);
  const ddl = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(ddl, /qq|phone|student_id/i);
});

test("Issue #60 rememberMe Migration 只追加可空列：不回填、不改写既有会话到期", async () => {
  const sql = await readFile(rememberMeMigrationPath, "utf8");
  // 变更是纯增量：给 auth_sessions 追加一个可空的 remember_me 列（存量会话保持 NULL）。
  assert.match(sql, /ALTER TABLE `auth_sessions`/);
  assert.match(sql, /ADD COLUMN `remember_me` BOOLEAN NULL/);
  // 验收 6：schema 变更在隔离库上必须是增量的，绝不能回填或改写既有会话的 expires_at，
  // 也不得 DROP / MODIFY 任何列。expires_at 只出现在 `--` 注释里，因此先剥掉注释再断言 DDL。
  const ddl = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(ddl, /UPDATE|DROP|MODIFY|expires_at/i);
});
