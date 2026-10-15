import assert from "node:assert/strict";
import { test } from "node:test";
import { assertExperimentDatabase } from "../../tools/db-target.mjs";
import { assertDestructiveDbAllowed, assertTestDatabase, integrationTestsEnabled } from "../integration/db-guard";

function withTarget(database: string, run: () => void) {
  const saved = { ...process.env };
  try {
    process.env.EXPERIMENT_DEV_DB = "pchospital_exp_dev";
    process.env.EXPERIMENT_TEST_DB = "pchospital_exp_dev_test";
    process.env.DATABASE_URL = `mysql://user:placeholder@localhost/${database}`;
    run();
  } finally {
    process.env = saved;
  }
}

test("only the configured _test database permits database tests and reset", () => {
  withTarget("pchospital_exp_dev_test", () => {
    assert.doesNotThrow(assertTestDatabase);
    assert.doesNotThrow(assertDestructiveDbAllowed);
  });
});

test("development, production and unknown _test databases are rejected even with legacy overrides", () => {
  for (const database of ["pchospital_exp_dev", "zafu_pchospital", "unrelated_test"]) {
    withTarget(database, () => {
      process.env.ALLOW_NON_TEST_DB = "1";
      process.env.ALLOW_DESTRUCTIVE_DB_TESTS = "1";
      assert.throws(assertTestDatabase, /Refusing/);
      assert.throws(assertDestructiveDbAllowed, /Refusing/);
    });
  }
});

test("integration tests skip when disabled and reject the development database when enabled", () => {
  withTarget("pchospital_exp_dev", () => {
    delete process.env.RUN_DB_TESTS;
    delete process.env.npm_lifecycle_event;
    assert.equal(integrationTestsEnabled(), false);
    process.env.RUN_DB_TESTS = "1";
    assert.throws(integrationTestsEnabled, /Refusing/);
  });
});

test("migrate 与 seed 模式只放行本地实验库，拒绝共享 / 生产库", () => {
  // 验收 6：迁移与种子脚本必须拒绝对非本地库执行。此前只有 test / reset-test 模式被测过，
  // migrate-dev / migrate / seed 三种模式从未覆盖——这里补上门禁：本地实验开发库放行，
  // 共享 / 生产 / 未知库一律抛错（Refusing）。
  withTarget("pchospital_exp_dev", () => {
    assert.doesNotThrow(() => assertExperimentDatabase("migrate-dev"));
    assert.doesNotThrow(() => assertExperimentDatabase("migrate"));
    assert.doesNotThrow(() => assertExperimentDatabase("seed"));
  });
  for (const database of ["zafu_pchospital", "unrelated_test"]) {
    withTarget(database, () => {
      assert.throws(() => assertExperimentDatabase("migrate-dev"), /Refusing/);
    });
  }
});
