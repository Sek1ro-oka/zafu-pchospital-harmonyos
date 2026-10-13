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
  const favorite =
    name === "StaffRepairRecordPage"
      ? (source.match(/  private async favoriteRecord\([\s\S]*?(?=\n  @Builder)/)?.[0] ?? "")
      : "";
  return runInNewContext(
    ts.transpileModule(state + favorite + `\n}\nnew ${name}();`, {
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

test("备案列表/工作摘要离开返回：旧 finally 不清新 loading，新请求完成后解锁", async () => {
  for (const name of ["RepairRecordsPage", "WorkbenchSummary"]) {
    const old = deferred<unknown>(),
      current = deferred<unknown>();
    let calls = 0;
    const read = () => (++calls === 1 ? old.promise : current.promise);
    const page = component<{
      loading: boolean;
      load(reset: boolean): Promise<void>;
      aboutToDisappear(): void;
    }>(name, name, {
      RepairRecordService: { createKey: () => "key", list: read },
      SessionStore: { readToken: async () => "token" },
      ApiConfig: { getBaseUrl: () => "http://local" },
      ApiClient: { get: read },
    });
    const first = page.load(true);
    await new Promise((done) => setImmediate(done));
    page.aboutToDisappear();
    const second = page.load(true);
    await new Promise((done) => setImmediate(done));
    assert.equal(calls, 2, name);
    old.resolve(name === "RepairRecordsPage" ? [] : {});
    await first;
    assert.equal(page.loading, true, name);
    current.resolve(name === "RepairRecordsPage" ? [] : {});
    await second;
    assert.equal(page.loading, false);
  }
});
test("建档离开返回：释放 creating，迟到结果不导航也不清新列表加载", async () => {
  const old = deferred<unknown>(),
    current = deferred<unknown>();
  let reads = 0,
    opens = 0;
  const page = component<{
    creating: boolean;
    loading: boolean;
    create(): Promise<void>;
    load(reset: boolean): Promise<void>;
    aboutToDisappear(): void;
    onOpen(): void;
  }>("RepairRecordsPage", "RepairRecordsPage", {
    RepairRecordService: {
      createKey: () => "key",
      create: () => old.promise,
      list: () => {
        reads++;
        return current.promise;
      },
    },
  });
  page.onOpen = () => {
    opens++;
  };
  const first = page.create();
  page.aboutToDisappear();
  const second = page.load(true);
  assert.equal(page.creating, false);
  assert.equal(reads, 1);
  old.resolve({ id: "late" });
  await first;
  assert.equal(opens, 0);
  assert.equal(page.loading, true);
  current.resolve([]);
  await second;
});
test("评论读取/搜索/写入离开返回：各忙状态解除，旧响应不清新代状态", async () => {
  for (const action of ["load", "search", "send"]) {
    const old = deferred<unknown>(),
      current = deferred<unknown>();
    let calls = 0;
    const invoke = () => (++calls === 1 ? old.promise : current.promise);
    const page = component<{
      body: string;
      loading: boolean;
      searching: boolean;
      writing: boolean;
      load(reset: boolean): Promise<void>;
      search(reset: boolean): Promise<void>;
      send(): Promise<void>;
      aboutToDisappear(): void;
    }>("RecordComments", "RecordComments", {
      ApiClient: { get: invoke, post: invoke },
      PersonalProfileService: { directory: invoke },
      SessionStore: { readToken: async () => "token" },
      ApiConfig: { getBaseUrl: () => "http://local" },
    });
    page.body = "合成评论";
    const run = () =>
      action === "search" ? page.search(true) : action === "send" ? page.send() : page.load(true);
    const first = run();
    await new Promise((done) => setImmediate(done));
    page.aboutToDisappear();
    assert.equal(page.loading || page.searching || page.writing, false);
    const second = action === "send" ? page.load(true) : run();
    await new Promise((done) => setImmediate(done));
    assert.equal(calls, 2);
    old.resolve(action === "search" ? { items: [], page: 1, hasMore: false } : []);
    await first;
    assert.equal(action === "search" ? page.searching : page.loading, true);
    current.resolve(action === "search" ? { items: [], page: 1, hasMore: false } : []);
    await second;
    assert.equal(page.loading || page.searching || page.writing, false);
    if (action === "send") assert.equal(page.body, "合成评论", "迟到写入不清新页正文");
  }
});
test("备案编辑请求仅在允许时发送机型，旧保存结束不回填/解锁新页", async () => {
  const old = deferred<unknown>(),
    current = deferred<unknown>();
  const favorite = deferred<unknown>();
  let writes = 0,
    loads = 0;
  const record = {
    id: "r",
    version: 2,
    canEditDeviceModel: false,
    deviceModel: "关联机型",
    ownerName: null,
    ownerPhone: null,
    repairDate: null,
    durationMinutes: null,
    category: null,
    content: null,
    result: null,
    remark: null,
    photos: [],
  };
  const page = component<{
    param: { recordId: string; faultDescription: string };
    record: typeof record | null;
    deviceModel: string;
    saving: boolean;
    favoriting: boolean;
    noticeText: string;
    buildFields(): { deviceModel?: string | null };
    saveDraft(): Promise<void>;
    favoriteRecord(): Promise<void>;
    load(): Promise<void>;
    aboutToDisappear(): void;
  }>("StaffRepairRecordPage", "StaffRepairRecordPage", {
    NavPathStack: class {},
    REPAIR_RECORD_LIMITS: { contentMaxLength: 10000, remarkMaxLength: 2000 },
    RepairRecordService: {
      save: () => (++writes === 1 ? old.promise : current.promise),
      detail: async () => {
        loads++;
        return record;
      },
      categories: async () => [],
    },
    AppStorage: { get: () => 0, setOrCreate: () => {} },
    CommunityService: { memberFavorite: () => favorite.promise },
  });
  page.param = { recordId: "r", faultDescription: "" };
  page.record = record;
  page.deviceModel = "恶意修改";
  assert.equal(page.buildFields().deviceModel, undefined);
  page.record = { ...record, canEditDeviceModel: true };
  assert.equal(page.buildFields().deviceModel, "恶意修改");
  const first = page.saveDraft();
  page.aboutToDisappear();
  await page.load();
  const second = page.saveDraft();
  old.resolve({ version: 99 });
  await first;
  assert.equal(page.saving, true);
  assert.equal(loads, 1);
  assert.equal(page.noticeText, "");
  current.resolve({ version: 3 });
  await second;
  assert.equal(page.saving, false);
  assert.equal(loads, 2);
  const favoriting = page.favoriteRecord();
  await page.load(); // 同页刷新推进读取代次，不应把收藏按钮永久锁住。
  favorite.resolve({});
  await favoriting;
  assert.equal(page.favoriting, false);
});
