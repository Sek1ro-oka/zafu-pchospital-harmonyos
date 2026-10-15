import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
function component<T>(
  name: string,
  services: Record<string, unknown>,
  session: () => object | null,
): T {
  const file = readFileSync(`../app/entry/src/main/ets/features/activity/${name}.ets`, "utf8");
  const end =
    file.indexOf("  @Builder") >= 0 ? file.indexOf("  @Builder") : file.indexOf("  build()");
  const guard = readFileSync(
    "../app/entry/src/main/ets/features/activity/ActivityRequestGuard.ets",
    "utf8",
  );
  const source = (guard + "\n" + file.slice(0, end) + "\n}\nnew " + name + "();")
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g, "")
    .replace(/@Watch\('[^']+'\)\s*/g, "")
    .replace(/@(Component|State|Prop)\s*/g, "")
    .replace(/export /g, "")
    .replace("struct " + name, "class " + name);
  return runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText,
    {
      SessionService: { current: session },
      ActivityService: services,
      ApiRequestError: Error,
      isSessionExpiredCode: () => false,
    },
  ) as T;
}
interface Mine {
  load(reset: boolean): Promise<void>;
  refresh(): void;
  aboutToDisappear(): void;
  items: unknown[];
  page: number;
  loading: boolean;
  hasMore: boolean;
}
const pagination = (page: number, total = 25) => ({
  page,
  pageSize: 20,
  total,
  totalPages: Math.ceil(total / 20),
});
test("报名分页取真实 meta；失败不前进页码，重试仍请求原下一页", async () => {
  let fail = true;
  const requests: number[] = [];
  const identity = { id: "A" };
  const page = component<Mine>(
    "MyRegistrationsPage",
    {
      mine: async (n: number) => {
        requests.push(n);
        if (n === 2 && fail) {
          fail = false;
          throw Error("network");
        }
        return { items: [{ id: n }], pagination: pagination(n) };
      },
    },
    () => identity,
  );
  await page.load(true);
  assert.equal(page.page, 1);
  assert.equal(page.hasMore, true);
  await page.load(false);
  assert.equal(page.page, 1);
  assert.equal(page.items.length, 1);
  await page.load(false);
  assert.equal(page.page, 2);
  assert.equal(page.items.length, 2);
  assert.equal(requests.join(","), "1,2,2");
});
test("离开重进时旧 finally 不能清新请求的忙状态或覆盖新列表", async () => {
  const old = deferred<object>(),
    next = deferred<object>(),
    identity = { id: "A" };
  let count = 0;
  const page = component<Mine>(
    "MyRegistrationsPage",
    { mine: () => (++count === 1 ? old.promise : next.promise) },
    () => identity,
  );
  const first = page.load(true);
  page.aboutToDisappear();
  const second = page.load(true);
  old.resolve({ items: [{ id: "old" }], pagination: pagination(1) });
  await first;
  assert.equal(page.loading, true);
  assert.equal(page.items.length, 0);
  next.resolve({ items: [{ id: "new" }], pagination: pagination(1) });
  await second;
  assert.equal((page.items[0] as { id: string }).id, "new");
  assert.equal(page.loading, false);
});
test("账号切换后旧会话结果不能回写，刷新读取新账号", async () => {
  let identity: object = { id: "A" };
  const pending = deferred<object>();
  let count = 0;
  const page = component<Mine>(
    "MyRegistrationsPage",
    {
      mine: () =>
        ++count === 1
          ? pending.promise
          : Promise.resolve({ items: [{ id: "B" }], pagination: pagination(1) }),
    },
    () => identity,
  );
  const first = page.load(true);
  identity = { id: "B" };
  page.refresh();
  await Promise.resolve();
  await Promise.resolve();
  pending.resolve({ items: [{ id: "A" }], pagination: pagination(1) });
  await first;
  assert.equal((page.items[0] as { id: string }).id, "B");
  assert.equal(page.loading, false);
});
test("报名失败保留填写与同意选择，重复点击只发一次", async () => {
  const pending = deferred<object>(),
    identity = { id: "A" };
  let requests = 0;
  interface Signup {
    detail: object;
    name: string;
    phone: string;
    consentAccepted: boolean;
    busy: boolean;
    submit(): Promise<void>;
  }
  const page = component<Signup>(
    "ActivityDetailPage",
    {
      signup: () => {
        requests++;
        return pending.promise;
      },
    },
    () => identity,
  );
  page.detail = { consent: { version: "current" } };
  page.name = "合成机主";
  page.phone = "13800138000";
  page.consentAccepted = true;
  const first = page.submit();
  await page.submit();
  assert.equal(requests, 1);
  // A rejected request leaves the editable draft intact.
  pending.resolve(Promise.reject(Error("network")));
  await first;
  assert.equal(page.name, "合成机主");
  assert.equal(page.phone, "13800138000");
  assert.equal(page.consentAccepted, true);
  assert.equal(page.busy, false);
});

interface AdminPage {
  param: { activityId: string };
  selectedId: string;
  name: string;
  phone: string;
  issueType: string;
  loading: boolean;
  busy: boolean;
  items: unknown[];
  errorText: string;
  save(): Promise<void>;
  remove(id: string): Promise<void>;
  retry(): Promise<void>;
  load(): Promise<void>;
  aboutToDisappear(): void;
  select(item: object): void;
  getUIContext: () => object;
}
function adminPage(services: Record<string, unknown>, session: () => object | null): AdminPage {
  const page = component<AdminPage>("ActivityRegistrationAdminPage", services, session);
  page.param = { activityId: "activity" };
  page.selectedId = "A";
  page.name = "unsaved A";
  page.issueType = "OTHER";
  page.getUIContext = () => ({
    getPromptAction: () => ({ showDialog: async () => ({ index: 1 }) }),
  });
  return page;
}
test("R01 编辑 A 删除 B 失败，重试仍只删除 B，保留 A 未保存输入", async () => {
  const identity = {},
    deleted: string[] = [],
    saved: unknown[] = [];
  let calls = 0;
  const page = adminPage(
    {
      adminRegistrations: async () => [{ id: "A" }],
      saveRegistration: async (...args: unknown[]) => saved.push(args),
      deleteRegistration: async (_a: string, id: string) => {
        deleted.push(id);
        if (++calls === 1) throw Error("offline");
      },
    },
    () => identity,
  );
  await page.remove("B");
  await page.retry();
  assert.equal(deleted.join(","), "B,B");
  assert.equal(saved.length, 0);
  assert.equal(page.name, "unsaved A");
  assert.equal(page.selectedId, "A");
});
test("R02 保存重试使用原目标和提交快照，与当前表单保存分开", async () => {
  const identity = {},
    saved: { id: string; name: string }[] = [];
  let calls = 0;
  const page = adminPage(
    {
      adminRegistrations: async () => [],
      saveRegistration: async (_a: string, id: string, input: { name: string }) => {
        saved.push({ id, name: input.name });
        if (++calls === 1) throw Error("offline");
      },
    },
    () => identity,
  );
  await page.save();
  page.select({ id: "B", name: "current B", issueType: "CLEAN_ONLY" });
  await page.retry();
  await page.save();
  assert.equal(
    JSON.stringify(saved),
    JSON.stringify([
      { id: "A", name: "unsaved A" },
      { id: "A", name: "unsaved A" },
      { id: "B", name: "current B" },
    ]),
  );
});
for (const kind of ["save", "delete"])
  test("R03 " + kind + " 成功但刷新失败，重试只读取", async () => {
    const identity = {};
    let writes = 0,
      reads = 0;
    const page = adminPage(
      {
        saveRegistration: async () => {
          writes++;
        },
        deleteRegistration: async () => {
          writes++;
        },
        adminRegistrations: async () => {
          if (++reads === 1) throw Error("offline");
          return [];
        },
      },
      () => identity,
    );
    if (kind === "save") await page.save();
    else await page.remove("B");
    await page.retry();
    assert.equal(writes, 1);
    assert.equal(reads, 2);
  });
test("R04 失败后切账号/离开不重放旧提交；迟到结果不覆盖新页面", async () => {
  let identity: object = { id: "A" };
  let writes = 0;
  const page = adminPage(
    {
      saveRegistration: async () => {
        writes++;
        throw Error("offline");
      },
      adminRegistrations: async () => [{ id: "new-account" }],
    },
    () => identity,
  );
  await page.save();
  identity = { id: "B" };
  await page.retry();
  assert.equal(writes, 1);
  assert.equal(page.selectedId, "");
  page.selectedId = "B";
  await page.save();
  page.aboutToDisappear();
  await page.retry();
  assert.equal(writes, 2);
  const pending = deferred<object>();
  const later = adminPage(
    { saveRegistration: () => pending.promise, adminRegistrations: async () => [{ id: "latest" }] },
    () => identity,
  );
  const old = later.save();
  later.aboutToDisappear();
  await later.load();
  pending.resolve({});
  await old;
  assert.equal((later.items[0] as { id: string }).id, "latest");
  assert.equal(later.busy, false);
});

test("账号切换后列表刷新失败也清除上一账号的报名与编辑草稿", async () => {
  let identity: object = { id: "A" };
  const page = adminPage(
    {
      adminRegistrations: async () => {
        throw Error("offline");
      },
    },
    () => identity,
  );
  page.items = [{ id: "private-A" }];
  identity = { id: "B" };
  await page.load();
  assert.equal(page.items.length, 0);
  assert.equal(page.selectedId, "");
  assert.equal(page.name, "");
});
