import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { assertExperimentDatabase } from "./db-target.mjs";

if (existsSync(".env")) loadEnvFile(".env");

const mode = process.argv[2];
const testFiles = process.argv.slice(3);
if (
  testFiles.length &&
  (mode !== "test" ||
    testFiles.some(
      (file) => !/^tests\/integration\/[\w-]+\.test\.ts$/.test(file) || !existsSync(file),
    ))
) {
  throw new Error("Only existing tests/integration/*.test.ts files may be selected");
}
if (
  !["migrate-dev", "migrate", "migrate-test", "seed", "seed-test", "reset-test", "test"].includes(
    mode,
  )
) {
  throw new Error("Unknown database task");
}
if (["test", "reset-test", "migrate-test", "seed-test"].includes(mode)) {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error("TEST_DATABASE_URL is required for tests/reset");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
const db = assertExperimentDatabase(["migrate-test", "seed-test"].includes(mode) ? "test" : mode);
console.log(`Verified experiment database: ${db} (${mode})`);
const require = createRequire(import.meta.url);
const cli = require.resolve(
  ["test", "seed", "seed-test"].includes(mode) ? "tsx/cli" : "prisma/build/index.js",
);
const args =
  mode === "migrate-dev"
    ? ["migrate", "dev"]
    : ["migrate", "migrate-test"].includes(mode)
      ? ["migrate", "deploy"]
      : ["seed", "seed-test"].includes(mode)
        ? ["prisma/seed.ts"]
        : mode === "reset-test"
          ? ["migrate", "reset", "--force"]
          : [
              "--test",
              "--test-concurrency=1",
              ...(testFiles.length ? testFiles : ["tests/integration/**/*.test.ts"]),
            ];
const result = spawnSync(process.execPath, [cli, ...args], {
  stdio: "inherit",
  env: mode === "test" ? { ...process.env, RUN_DB_TESTS: "1" } : process.env,
  shell: false,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
