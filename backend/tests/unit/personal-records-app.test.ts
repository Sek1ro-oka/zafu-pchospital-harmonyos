import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function component<T>(file: string, name: string, globals: Record<string, unknown>): T {
  const source = readFileSync(`../app/entry/src/main/ets/features/repair/${file}.ets`, "utf8");
  const end =
    source.indexOf("  @Builder") > 0 ? source.indexOf("  @Builder") : source.indexOf("  build()");
  const state = source
    .slice(0, end)
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g, "")
    .replace(/@Watch\('[^']+'\)\s*/g, "")
    .replace(/@(Component|State|Prop)\s*/g, "")
    .replace(`export struct ${name}`, `class ${name}`);
  return runInNewContext(
    ts.transpileModule(state + `\n}\nnew ${name}();`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText,
    { exports: {}, ApiRequestError: Error, isSessionExpiredCode: () => false, ...globals },
  ) as T;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
interface Records {
  create(): Promise<void>;
  load(reset: boolean): Promise<void>;
  applyFilter(): void;
  aboutToDisappear(): void;
  onOpen(): void;
  query: string;
  filter: string;
  items: unknown[];
  param: { library: boolean };
}
test("建独立草稿防连点；网络失败重用幂等键，成功后更换；销毁后不跳转", async () => {
  const pending = deferred<{ id: string }>();
  const keys: string[] = [];
  let failed = true,
    next = 0,
    opens = 0;
  const page = component<Records>("RepairRecordsPage", "RepairRecordsPage", {
    RepairRecordService: {
      createKey: () => `key${++next}`,
      create: (key: string) => {
        keys.push(key);
        if (failed) {
          failed = false;
          throw new Error("network");
        }
        return pending.promise;
      },
    },
    ROUTE_STAFF_RECORD: "record",
  });
  page.onOpen = () => {
    opens++;
  };
  await page.create();
  const request = page.create();
  await page.create();
  assert.equal(keys.join(","), "key1,key1");
  page.aboutToDisappear();
  pending.resolve({ id: "old-record" });
  await request;
  assert.equal(opens, 0);
});
test("备案分页失败不推进页号；筛选固定在请求快照，不能在下一页换查询", async () => {
  const pages: number[] = [];
  const filters: string[] = [];
  let fail = true;
  const page = component<Records>("RepairRecordsPage", "RepairRecordsPage", {
    RepairRecordService: {
      createKey: () => "key",
      list: async (_mine: boolean, p: number, filter: string) => {
        pages.push(p);
        filters.push(filter);
        if (p === 2 && fail) {
          fail = false;
          throw new Error("network");
        }
        return p === 1 ? Array.from({ length: 20 }, (_, id) => ({ id })) : [{ id: "new" }];
      },
    },
  });
  page.query = "黑屏";
  page.applyFilter();
  await new Promise((resolve) => setImmediate(resolve));
  page.query = "改输入尚未筛选";
  await page.load(false);
  await page.load(false);
  assert.equal(pages.join(","), "1,2,2");
  assert.equal(new Set(filters).size, 1);
  assert.equal(page.items.length, 21);
});
test("评论提交防重、失败保留正文与回复目标、成功后清空并刷新", async () => {
  let sends = 0,
    failed = true;
  const pending = deferred<unknown>();
  const page = component<{
    body: string;
    replyId: string;
    mentions: unknown[];
    send(): Promise<void>;
    items: unknown[];
  }>("RecordComments", "RecordComments", {
    ApiConfig: { getBaseUrl: () => "http://local" },
    SessionStore: { readToken: async () => "token" },
    ApiClient: {
      post: () => {
        sends++;
        if (failed) {
          failed = false;
          throw new Error("network");
        }
        return pending.promise;
      },
      get: async () => [],
    },
  });
  page.body = "真实讨论";
  page.replyId = "root";
  await page.send();
  assert.equal(page.body, "真实讨论");
  assert.equal(page.replyId, "root");
  const first = page.send();
  await page.send();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sends, 2);
  pending.resolve({});
  await first;
  assert.equal(page.body, "");
  assert.equal(page.replyId, "");
  assert.equal(page.items.length, 0);
});
test("工作摘要刷新失败清除旧数据；销毁后迟到响应不回填", async () => {
  const pending = deferred<unknown>();
  const page = component<{ dashboard: unknown; load(): Promise<void>; aboutToDisappear(): void }>(
    "WorkbenchSummary",
    "WorkbenchSummary",
    {
      SessionStore: { readToken: async () => "token" },
      ApiConfig: { getBaseUrl: () => "http://local" },
      ApiClient: { get: () => pending.promise },
    },
  );
  page.dashboard = { old: true };
  const loading = page.load();
  assert.equal(page.dashboard, null);
  page.aboutToDisappear();
  pending.resolve({ private: true });
  await loading;
  assert.equal(page.dashboard, null);
});
