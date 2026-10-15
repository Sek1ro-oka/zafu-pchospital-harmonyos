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
