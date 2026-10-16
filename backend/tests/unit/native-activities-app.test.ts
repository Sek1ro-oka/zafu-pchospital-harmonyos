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
  const contract = readFileSync(
    "../app/entry/src/main/ets/features/activity/ActivityContract.ets",
    "utf8",
  );
  const source = (contract + "\n" + guard + "\n" + file.slice(0, end) + "\n}\nnew " + name + "();")
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
      ApiRequestError: RequestError,
      isSessionExpiredCode: () => false,
      ROUTE_MY_REGISTRATION: "my-activity-registration",
      KeyboardAvoidMode: { RESIZE: 1 },
    },
  ) as T;
}
class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

test("#77 multiple contacts for one event navigate to the selected real registration, never the first match", () => {
  interface ListChoice {
    open(item: { id: string; activityId: string }): void;
    onOpen: (route: string, target: object | null) => void;
  }
  const page = component<ListChoice>("MyRegistrationsPage", {}, () => null);
  const targets: object[] = [];
  page.onOpen = (_route, target) => {
    if (target) targets.push(target);
  };
  page.open({ id: "first-contact", activityId: "same-event" });
  page.open({ id: "second-contact", activityId: "same-event" });
  assert.equal(
    JSON.stringify(targets),
    JSON.stringify([
      { activityId: "same-event", registrationId: "first-contact" },
      { activityId: "same-event", registrationId: "second-contact" },
    ]),
  );
});
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
  page.detail = { id: "", status: "OPEN", consent: { version: "current" } };
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
interface Detail77 {
  param: { activityId: string };
  detail: { id: string; status: string; consent: { version: string } } | null;
  name: string;
  phone: string;
  deviceModel: string;
  consentAccepted: boolean;
  submittedId: string;
  actionText: string;
  errorText: string;
  loading: boolean;
  busy: boolean;
  onOpen: (route: string, param: object | null) => void;
  load(): Promise<void>;
  submit(): Promise<void>;
  refresh(): void;
  retry(): Promise<void>;
  openSubmitted(): void;
  primaryEnabled(): boolean;
  primaryLabel(): string;
  fieldError(field: string): string;
}
function detail77(services: Record<string, unknown>, session: () => object | null) {
  const page = component<Detail77>("ActivityDetailPage", services, session);
  page.param = { activityId: "event" };
  return page;
}
const event77 = (status = "OPEN", version = "v1") => ({
  id: "event",
  status,
  consent: { version },
});
for (const status of ["UPCOMING", "FULL", "CLOSED", "ENDED", "UNRECOGNIZED"]) {
  test(
    "#77 server " + status + " disables CTA and direct submit, regardless of local counts/time",
    async () => {
      let writes = 0;
      const page = detail77(
        {
          detail: async () => event77(status),
          signup: async () => {
            writes++;
          },
        },
        () => null,
      );
      await page.load();
      page.consentAccepted = true;
      assert.equal(page.primaryEnabled(), false);
      await page.submit();
      assert.equal(writes, 0);
      assert.notEqual(page.primaryLabel(), "报名参加");
    },
  );
}
test("#77 consent required; version change reloads actual terms, resets consent and preserves contact draft", async () => {
  const identity = {};
  let version = "v1",
    writes = 0;
  const page = detail77(
    {
      detail: async () => event77("OPEN", version),
      signup: async () => {
        writes++;
        version = "v2";
        throw new RequestError("ACTIVITY_CONSENT_VERSION_CHANGED", "updated");
      },
    },
    () => identity,
  );
  await page.load();
  page.name = "合成长姓名";
  page.phone = "13800770001";
  page.deviceModel = "保留机型";
  await page.submit();
  assert.equal(writes, 0);
  page.consentAccepted = true;
  await page.submit();
  assert.equal(writes, 1);
  assert.equal(page.detail?.consent.version, "v2");
  assert.equal(page.consentAccepted, false);
  assert.equal(page.name, "合成长姓名");
  assert.equal(page.phone, "13800770001");
  assert.equal(page.deviceModel, "保留机型");
});
test("#77 field errors remain attached to inputs; failed refresh removes stale OPEN but preserves draft and consent version", async () => {
  let fail = false;
  const page = detail77(
    {
      detail: async () => {
        if (fail) throw Error("offline");
        return event77();
      },
      signup: async () => {
        throw new RequestError("VALIDATION_FAILED", "bad phone", { phone: ["格式错误"] });
      },
    },
    () => null,
  );
  await page.load();
  page.phone = "123";
  page.consentAccepted = true;
  await page.submit();
  assert.equal(page.fieldError("phone"), "格式错误");
  fail = true;
  await page.load();
  assert.equal(page.detail, null);
  assert.equal(page.primaryEnabled(), false);
  assert.equal(page.phone, "123");
  fail = false;
  await page.load();
  assert.equal(page.consentAccepted, true);
});
test("#77 successful signup keeps real ID through failed refresh; retry reads only; account switch clears personal draft/ID", async () => {
  let identity: object = {},
    writes = 0,
    reads = 0;
  const page = detail77(
    {
      detail: async () => {
        if (++reads === 2) throw Error("offline");
        return event77();
      },
      signup: async () => {
        writes++;
        return { id: "real-registration" };
      },
    },
    () => identity,
  );
  await page.load();
  page.consentAccepted = true;
  await page.submit();
  assert.equal(page.submittedId, "real-registration");
  assert.equal(page.primaryLabel(), "查看本次报名");
  assert.equal(page.primaryEnabled(), true);
  let target: object | null = null;
  page.onOpen = (_r, p) => {
    target = p;
  };
  page.openSubmitted();
  assert.equal(
    JSON.stringify(target),
    JSON.stringify({ activityId: "event", registrationId: "real-registration" }),
  );
  await page.load();
  await page.submit();
  assert.equal(writes, 1);
  identity = {};
  await page.load();
  assert.equal(page.submittedId, "");
  assert.equal(page.phone, "");
});
interface Mine77 {
  param: { activityId: string; registrationId: string };
  item: { id: string; activityId: string; issueType: string; canEditIssueType: boolean } | null;
  issueType: string;
  errorText: string;
  actionText: string;
  loading: boolean;
  busy: boolean;
  load(): Promise<void>;
  save(): Promise<void>;
  retry(): Promise<void>;
  refresh(): void;
  aboutToDisappear(): void;
}
const row77 = (issueType = "OTHER", canEditIssueType = true) => ({
  id: "reg",
  activityId: "event",
  issueType,
  canEditIssueType,
});
function mine77(services: Record<string, unknown>, session: () => object | null) {
  const page = component<Mine77>("MyRegistrationPage", services, session);
  page.param = { activityId: "event", registrationId: "reg" };
  return page;
}
test("#77 saving retry retains original activity/registration/type snapshot after selection changes", async () => {
  const writes: string[] = [];
  let fail = true;
  const page = mine77(
    {
      registration: async () => row77(),
      updateMine: async (activity: string, id: string, issue: string) => {
        writes.push([activity, id, issue].join("/"));
        if (fail) {
          fail = false;
          throw Error("offline");
        }
      },
    },
    () => null,
  );
  await page.load();
  page.issueType = "CLEAN_ONLY";
  await page.save();
  assert.equal(page.issueType, "CLEAN_ONLY");
  page.issueType = "OTHER";
  await page.retry();
  assert.equal(writes.join(","), "event/reg/CLEAN_ONLY,event/reg/CLEAN_ONLY");
});
test("#77 write success + refresh failure retries only read; canEditIssueType false prevents direct write", async () => {
  let writes = 0,
    reads = 0;
  const page = mine77(
    {
      registration: async () => {
        if (++reads === 2) throw Error("offline");
        return row77("OTHER", reads < 3);
      },
      updateMine: async () => {
        writes++;
      },
    },
    () => null,
  );
  await page.load();
  await page.save();
  assert.equal(page.item, null);
  await page.retry();
  assert.equal(writes, 1);
  assert.equal(reads, 3);
  await page.save();
  assert.equal(writes, 1);
});
test("#77 account switch / wrong params clears old data; failed read never retries a previous user's write", async () => {
  let identity: object = {},
    writes = 0,
    rejectRead = false;
  const page = mine77(
    {
      registration: async () => {
        if (rejectRead) throw Error("404");
        return row77();
      },
      updateMine: async () => {
        writes++;
        throw Error("offline");
      },
    },
    () => identity,
  );
  await page.load();
  await page.save();
  identity = {};
  rejectRead = true;
  await page.retry();
  assert.equal(page.item, null);
  assert.equal(page.actionText, "");
  await page.retry();
  assert.equal(writes, 1);
});
test("#77 late detail/error/finally cannot overwrite a different activity or registration request", async () => {
  const old = deferred<object>(),
    newer = deferred<object>();
  let calls = 0;
  const page = mine77(
    { registration: () => (++calls === 1 ? old.promise : newer.promise) },
    () => null,
  );
  const first = page.load();
  page.aboutToDisappear();
  page.param = { activityId: "event-B", registrationId: "reg-B" };
  const second = page.load();
  old.resolve(row77());
  await first;
  assert.equal(page.item, null);
  assert.equal(page.loading, true);
  newer.resolve({ ...row77(), id: "reg-B", activityId: "event-B" });
  await second;
  assert.equal(page.item?.id, "reg-B");
  assert.equal(page.loading, false);
});
test("#77 status stages use server enum, withdrawal hides old timestamps, unknown is neutral, SERVED never means repaired", () => {
  const source = readFileSync(
    "../app/entry/src/main/ets/features/activity/ActivityContract.ets",
    "utf8",
  ).replace(/export /g, "");
  const policy = runInNewContext(
    ts.transpileModule(
      source +
        "\n({ registrationStageReached, registrationStageTime, registrationStatusLabel, activityStatusLabel });",
      { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
    ).outputText,
  );
  assert.equal(policy.registrationStageReached("REGISTERED", 1), false);
  assert.equal(policy.registrationStageTime("REGISTERED", 1, "2026-10-15T01:00:00Z"), "尚未签到");
  assert.equal(policy.registrationStageReached("CHECKED_IN", 2), false);
  assert.equal(policy.registrationStageTime("SERVED", 2, null), "暂无时间");
  assert.equal(policy.registrationStageReached("UNKNOWN", 0), false);
  assert.equal(policy.registrationStatusLabel("UNKNOWN"), "状态暂不可用");
  assert.equal(policy.activityStatusLabel("UNKNOWN"), "状态暂不可用");
  assert.ok(policy.registrationStatusLabel("SERVED").includes("已接待"));
  assert.ok(!policy.registrationStatusLabel("SERVED").includes("已完成"));
});

test("#77 signup scopes keyboard resize to its lifetime and restores the previous page mode", () => {
  interface KeyboardPage extends Detail77 {
    signup: boolean;
    getUIContext(): { getKeyboardAvoidMode(): number; setKeyboardAvoidMode(value: number): void };
    aboutToAppear(): void;
    aboutToDisappear(): void;
  }
  let mode = 0;
  const changes: number[] = [];
  const page = detail77({ detail: async () => event77() }, () => null) as KeyboardPage;
  page.signup = true;
  page.getUIContext = () => ({
    getKeyboardAvoidMode: () => mode,
    setKeyboardAvoidMode: (value) => {
      mode = value;
      changes.push(value);
    },
  });
  page.aboutToAppear();
  assert.equal(mode, 1);
  page.aboutToDisappear();
  assert.equal(mode, 0);
  page.aboutToDisappear();
  assert.equal(changes.join(","), "1,0");
});
