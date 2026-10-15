import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const ETS = "../app/entry/src/main/ets";

/**
 * 与 `guest-login-app.test.ts` / `customer-community-app.test.ts` 同一套做法：
 * 读真实 `.ets` 源码 → 剥掉 import 与 ArkUI 装饰器 → `struct` 当 `class` → 转译 → 沙箱执行。
 * 这样测的是**页面上的真方法**，不是另写一份实现；沙箱里只放切片真正引用到的全局。
 * 它不能替代真机验证（@Builder 与平台组件不参与执行）。
 */
function ets(source: string): string {
  return source
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g, "")
    .replace(/@(Component|State|Prop|Builder|Watch\('[^']+'\))\s*/g, "")
    .replace(/export /g, "")
    .replace(/struct (\w+)/g, "class $1");
}

function run(code: string, mocks: Record<string, unknown>): unknown {
  const script = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(script, mocks);
}

/** `ApiRequestError` 的最小真实现：页面靠 `instanceof` + `error.code` 分流，桩成 `Error` 会漏分支。 */
class ApiRequestError extends Error {
  code: string;
  status: number;
  requestId: string;
  fieldErrors: Record<string, string[]> | undefined;
  constructor(
    code: string,
    message: string,
    status: number,
    requestId: string,
    fieldErrors?: Record<string, string[]>
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.fieldErrors = fieldErrors;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class Stack {
  names: string[] = [];
  getAllPathName() {
    return this.names;
  }
  pushPathByName(name: string) {
    this.names.push(name);
  }
  pop() {
    this.names.pop();
  }
  clear() {
    this.names = [];
  }
}

/** HomePage 的返回键拦截面：只需要文件开头到第一个 `@Builder` 之前那一段。 */
interface BackShell {
  loginBusy: boolean;
  registerBusy: boolean;
  passwordChangeForced: boolean;
  passwordChangeBusy: boolean;
  interceptBack(name: string): boolean;
}

function homeShell(): BackShell {
  const source = readFileSync(`${ETS}/features/home/HomePage.ets`, "utf8");
  const start = source.slice(0, source.indexOf("  @Builder"));
  const intent = readFileSync(`${ETS}/core/auth/LoginIntent.ets`, "utf8");
  return run(ets(intent + "\n" + start) + "\n}\nnew HomePage();", {
    NavPathStack: Stack,
    TabsController: class {
      changeIndex() {}
    },
    NavPusher: class {
      push(stack: Stack, route: string) {
        stack.pushPathByName(route);
      }
    },
    HOME_STAFF: "STAFF",
    ROUTE_REPAIR_ORDERS: "repair-orders",
    ROUTE_STAFF_ORDERS: "staff-repair-orders",
    ROUTE_PUBLIC_GUIDES: "public-guides",
    ROUTE_KNOWLEDGE: "knowledge",
  }) as BackShell;
}

/** `SessionService` 是普通 export class（无 build()），整份源码直接 eval。 */
interface SessionSvc {
  login(qq: string, password: string, rememberMe?: boolean): Promise<unknown>;
  changePassword(request: object): Promise<unknown>;
  current(): unknown;
}

function sessionService(mocks: Record<string, unknown>): SessionSvc {
  const source = readFileSync(`${ETS}/core/auth/SessionService.ets`, "utf8");
  return run(ets(source) + "\nSessionService;", mocks) as SessionSvc;
}

/** 让已发出的（挂起的）请求真正进入 ApiClient：等一个宏任务，微任务队列全部流失。 */
function tick(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** 服务端会话响应体的最小形状（登录 / 注册 / 改密三处共用同一份 JSON 契约）。 */
function sessionPayload(userId: string, token: string) {
  return {
    userId,
    displayName: null,
    roles: [],
    permissions: [],
    memberProfileId: null,
    memberStatus: null,
    mustChangePassword: false,
    home: "CUSTOMER",
    token,
    expiresAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * A/B 交错回归的脚手架（Issue #60 P1：认证写响应迟到覆盖本地令牌）。
 *
 * 复现真实时序所需的最小假依赖：一个**有状态**的 SessionStore（令牌就是一个变量）、
 * 一个按路径分发的 ApiClient，以及让「第一次认证写请求」挂起的 deferred。
 *
 * - `kind = "changePassword"`：A 已登录（token-A）并提交**普通**改密，请求挂起；
 * - `kind = "login"`：游客（无令牌）正在登录 A，请求挂起。
 *
 * 之后由用例驱动：退出 → 登录 B → 放行 A 的迟到响应。
 */
function staleResponseRace(kind: "changePassword" | "login", logoutFails: boolean) {
  let token = kind === "changePassword" ? "token-A" : "";
  let firstIssued = false;
  const revoked: string[] = [];
  const first = deferred<unknown>();
  const service = sessionService({
    ApiConfig: { getBaseUrl: () => "https://x" },
    SessionStore: {
      readToken: async () => token,
      writeToken: async (next: string) => {
        token = next;
        return true;
      },
      clearToken: async () => {
        token = "";
      },
    },
    ApiClient: {
      post: async (_url: string, path: string, _body: string, bearer: string) => {
        if (path.includes("/native/password/change")) {
          // 第一次认证写请求挂起；kind = "login" 时这条分支不会被走到。
          firstIssued = true;
          return first.promise;
        }
        if (path.includes("/native/login")) {
          if (!firstIssued) {
            // 第一次是 A 的登录；之后（登录 B）立刻返回，B 才是「当前会话」。
            firstIssued = true;
            return first.promise;
          }
          return sessionPayload("B", "token-B");
        }
        if (path.includes("/native/logout")) {
          revoked.push(bearer);
          if (logoutFails) throw new ApiRequestError("NETWORK_ERROR", "网络不可达", 0, "");
          return { loggedOut: true };
        }
        throw new ApiRequestError("UNEXPECTED_RESPONSE", path, 0, "");
      },
    },
    ApiRequestError,
    isSessionExpiredCode: () => false,
    hilog: { warn() {}, error() {}, info() {}, debug() {} },
  });

  const pending =
    kind === "changePassword"
      ? service.changePassword({ currentPassword: "a", newPassword: "b", newPasswordConfirmation: "b" })
      : service.login("11111111", "secret1");
  // 立刻接住结果：丢弃路径会 reject，晚一步挂 handler 会先触发 unhandledRejection。
  const settled = pending.then(
    () => "resolved",
    (error: unknown) => error
  );
  return {
    service,
    settled,
    first,
    revoked,
    currentToken: () => token,
  };
}

interface ChangePage {
  lifetime: string;
  busy: boolean;
  errorText: string;
  failed: boolean;
  currentPassword: string;
  newPassword: string;
  newPasswordConfirmation: string;
  onChanged: (data: unknown) => void;
  onSessionExpired: () => void;
  onBusyChange: (busy: boolean) => void;
  selectLifetime(value: string, isChecked: boolean): void;
  submit(): Promise<void>;
  aboutToDisappear(): void;
}

function changePage(service: Record<string, unknown>): ChangePage {
  const source = readFileSync(`${ETS}/features/auth/PasswordChangePage.ets`, "utf8");
  const state = source.slice(0, source.indexOf("  build()"));
  return run(ets(state) + "\n}\nnew PasswordChangePage();", {
    PASSWORD_LIFETIME_KEEP: "keep",
    PASSWORD_LIFETIME_SHORT: "short",
    PASSWORD_LIFETIME_LONG: "long",
    ApiRequestError,
    isSessionExpiredCode: () => false,
    SessionService: service,
    passwordChangeErrorText: (error: ApiRequestError) => error.message,
    passwordLifetimeHint: () => "",
  }) as ChangePage;
}

interface RegisterPage {
  busy: boolean;
  rememberMe: boolean;
  onBusyChange: (busy: boolean) => void;
  onRegistered: (identity: unknown) => void;
  qq: string;
  password: string;
  passwordConfirmation: string;
  code: string;
  realName: string;
  phone: string;
  submit(): Promise<void>;
  aboutToDisappear(): void;
}

/** 两个注册页共用同一套 busy 上报契约，只有服务方法与文案函数不同名。 */
function registerPage(name: "RegisterCustomerPage" | "RegisterStaffPage", service: unknown): RegisterPage {
  const source = readFileSync(`${ETS}/features/auth/${name}.ets`, "utf8");
  const state = source.slice(0, source.indexOf("  build()"));
  const text = (error: ApiRequestError) => error.message;
  const mocks: Record<string, unknown> = {
    ApiRequestError,
    isSessionExpiredCode: () => false,
    SessionService: service,
    util: { generateRandomUUID: () => "uuid" },
  };
  if (name === "RegisterCustomerPage") {
    mocks.customerRegisterErrorText = text;
  } else {
    mocks.staffRegisterErrorText = text;
  }
  return run(ets(state) + `\n}\nnew ${name}();`, mocks) as RegisterPage;
}

function fillRegister(page: RegisterPage, name: string): void {
  page.qq = "12345678";
  page.password = "secret1";
  page.passwordConfirmation = "secret1";
  if (name === "RegisterStaffPage") {
    page.code = "INVITE-1";
    page.realName = "张三";
    page.phone = "13800000000";
  }
}

test("认证写请求进行中拦截系统返回：注册、登录、强制改密各自只看自己的标记", () => {
  const page = homeShell();
  assert.equal(page.interceptBack("register-customer"), false);
  assert.equal(page.interceptBack("staff-register"), false);
  page.registerBusy = true;
  // 两个注册入口共用一个标记：客户注册挂起时也不能从工作人员注册页返回。
  assert.equal(page.interceptBack("register-customer"), true);
  assert.equal(page.interceptBack("staff-register"), true);
  // 注册标记不得顺带拦掉登录页与业务页。
  assert.equal(page.interceptBack("login"), false);
  assert.equal(page.interceptBack("password-change"), false);
  assert.equal(page.interceptBack("repair-orders"), false);
  page.registerBusy = false;
  assert.equal(page.interceptBack("register-customer"), false);
  assert.equal(page.interceptBack("staff-register"), false);
  page.loginBusy = true;
  assert.equal(page.interceptBack("login"), true);
  assert.equal(page.interceptBack("register-customer"), false);
  page.passwordChangeForced = true;
  assert.equal(page.interceptBack("password-change"), true);
});

test("普通改密在途也拦返回键：强制标记与请求中标记各管一段、互不替代", () => {
  const page = homeShell();
  // 非强制（用户自愿改密）且请求还没发出去：可以返回。
  assert.equal(page.passwordChangeForced, false);
  assert.equal(page.interceptBack("password-change"), false);
  // 普通改密请求在途：页面由 PasswordChangePage 的 onBusyChange 上报 true，
  // 此时必须拦下返回 —— 否则用户离开后 A 的迟到响应会覆盖本地令牌（账号串用）。
  page.passwordChangeBusy = true;
  assert.equal(page.interceptBack("password-change"), true);
  // 改密标记不得顺带拦掉别的路由。
  assert.equal(page.interceptBack("login"), false);
  assert.equal(page.interceptBack("register-customer"), false);
  assert.equal(page.interceptBack("staff-register"), false);
  assert.equal(page.interceptBack("repair-orders"), false);
  // 请求结束（上报 false）后恢复可返回；但强制改密仍然不许跳过。
  page.passwordChangeBusy = false;
  assert.equal(page.interceptBack("password-change"), false);
  page.passwordChangeForced = true;
  assert.equal(page.interceptBack("password-change"), true);
  page.passwordChangeForced = false;
  page.passwordChangeBusy = true;
  assert.equal(page.interceptBack("password-change"), true);
});

test("改密新令牌本地保存失败：撤销刚发的新令牌而不是已死的旧令牌", async () => {
  let revoked = "";
  const service = sessionService({
    ApiConfig: { getBaseUrl: () => "https://x" },
    SessionStore: {
      readToken: async () => "old-token",
      writeToken: async () => false,
      clearToken: async () => {},
    },
    ApiClient: {
      post: async (_url: string, path: string, _body: string, token: string) => {
        if (path.includes("/password/change")) {
          return {
            changed: true,
            mustChangePassword: false,
            token: "new-token",
            expiresAt: "2026-01-01T00:00:00.000Z",
          };
        }
        if (path.includes("/logout")) {
          revoked = token;
          return { loggedOut: true };
        }
        throw new ApiRequestError("UNEXPECTED_RESPONSE", path, 0, "");
      },
    },
    ApiRequestError,
    isSessionExpiredCode: () => false,
    hilog: {
      warn() {},
      error() {},
      info() {},
      debug() {},
    },
  });
  await assert.rejects(
    () =>
      service.changePassword({
        currentPassword: "a",
        newPassword: "b",
        newPasswordConfirmation: "b",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.code, "LOCAL_STORAGE_ERROR");
      return true;
    }
  );
  // 旧令牌在改密那一刻已被服务端吊销，拿它调 logout 是空操作，新会话会留在服务端。
  assert.equal(revoked, "new-token");
  assert.equal(service.current(), null);
});

test("档位 Radio 取消选中不写回：只有 isChecked 为真才改档位", () => {
  const page = changePage({});
  assert.equal(page.lifetime, "keep");
  page.selectLifetime("long", true);
  assert.equal(page.lifetime, "long");
  // 切换单选时旧项会触发一次 onChange(false)（取消选中）；这一路不得把旧档位写回。
  page.selectLifetime("keep", false);
  assert.equal(page.lifetime, "long");
  page.selectLifetime("short", true);
  assert.equal(page.lifetime, "short");
});

test("改密本地保存失败导回登录页，不停在原页当可重试错误", async () => {
  let expired = 0;
  const page = changePage({
    changePassword: () =>
      Promise.reject(new ApiRequestError("LOCAL_STORAGE_ERROR", "无法保存新的登录凭证", 0, "")),
  });
  page.onSessionExpired = () => {
    expired += 1;
  };
  page.currentPassword = "old-pass";
  page.newPassword = "new-pass";
  page.newPasswordConfirmation = "new-pass";
  await page.submit();
  // 此刻密码已改、本地令牌已清：原样重试是错的，唯一正确终态是经上层回登录页。
  assert.equal(expired, 1);
  assert.equal(page.errorText, "");
  assert.equal(page.failed, false);
});

function fillChange(page: ChangePage): void {
  page.currentPassword = "old-pass";
  page.newPassword = "new-pass";
  page.newPasswordConfirmation = "new-pass";
}

test("改密写请求期间上报 busy，完成后复位父级返回键拦截标记", async () => {
  const pending = deferred<unknown>();
  const reported: boolean[] = [];
  const page = changePage({ changePassword: () => pending.promise });
  page.onBusyChange = (busy: boolean) => {
    reported.push(busy);
  };
  fillChange(page);
  const running = page.submit();
  // 请求已发出、还没回来：HomePage 必须已经知道要拦返回键。
  assert.deepEqual(reported, [true]);
  pending.resolve(sessionPayload("A", "token-A-new"));
  await running;
  assert.deepEqual(reported, [true, false]);
});

test("改密挂起时离开页面：本地 busy 受代次保护，父级上报仍无条件复位", async () => {
  const pending = deferred<unknown>();
  const reported: boolean[] = [];
  const page = changePage({ changePassword: () => pending.promise });
  page.onBusyChange = (busy: boolean) => {
    reported.push(busy);
  };
  fillChange(page);
  const running = page.submit();
  assert.deepEqual(reported, [true]);
  page.aboutToDisappear();
  pending.resolve(sessionPayload("A", "token-A-new"));
  await running;
  // aboutToDisappear 递增了代次，受保护的 this.busy = false 被跳过；
  // 但父级标记必须复位，否则下一个改密页的返回键会被永久错误拦截。
  assert.equal(page.busy, true);
  assert.deepEqual(reported, [true, false]);
});

test("改密响应被丢弃（SESSION_CHANGED）：页面不当作成功，交回上层处理", async () => {
  const page = changePage({
    changePassword: () =>
      Promise.reject(new ApiRequestError("SESSION_CHANGED", "登录状态已变更，本次修改结果未采用", 0, "")),
  });
  let changed = 0;
  page.onChanged = () => {
    changed += 1;
  };
  fillChange(page);
  await page.submit();
  // 迟到响应被 SessionService 丢弃后不能再走 onChanged（否则会收起登录栈、续接到别人的意图上）。
  assert.equal(changed, 0);
  assert.equal(page.failed, true);
  assert.match(page.errorText, /登录状态已变更/);
});

for (const name of ["RegisterCustomerPage", "RegisterStaffPage"] as const) {
  const label = name === "RegisterCustomerPage" ? "客户注册" : "工作人员注册";
  const method = name === "RegisterCustomerPage" ? "registerCustomer" : "registerStaff";

  test(`${label}写请求期间上报 busy，完成后复位父级拦截标记`, async () => {
    const pending = deferred<unknown>();
    const reported: boolean[] = [];
    const page = registerPage(name, { [method]: () => pending.promise });
    fillRegister(page, name);
    page.onBusyChange = (busy: boolean) => {
      reported.push(busy);
    };
    const running = page.submit();
    // 请求已发出、还没回来：HomePage 必须已经知道要拦返回键。
    assert.deepEqual(reported, [true]);
    pending.resolve({ home: "CUSTOMER" });
    await running;
    assert.deepEqual(reported, [true, false]);
  });

  test(`${label}挂起时离开页面：本地 busy 受代次保护，父级上报仍无条件复位`, async () => {
    const pending = deferred<unknown>();
    const reported: boolean[] = [];
    const page = registerPage(name, { [method]: () => pending.promise });
    fillRegister(page, name);
    page.onBusyChange = (busy: boolean) => {
      reported.push(busy);
    };
    const running = page.submit();
    page.aboutToDisappear();
    pending.resolve({ home: "CUSTOMER" });
    await running;
    // aboutToDisappear 递增了代次，受保护的 this.busy = false 被跳过；
    // 但父级标记必须复位，否则下一个注册页的返回键会被永久错误拦截。
    assert.equal(page.busy, true);
    assert.deepEqual(reported, [true, false]);
  });
}

test("注册页默认勾选保持登录（清单第 7 项：App 默认保持登录，用户可关闭）", () => {
  for (const name of ["RegisterCustomerPage", "RegisterStaffPage"] as const) {
    const page = registerPage(name, {});
    // 构造即读默认值：清单要求 App 默认保持登录（30 天），用户仍可关闭降为 24 小时。
    assert.equal(page.rememberMe, true, `${name} 的保持登录开关应默认勾选`);
  }
});

test("登录页保持登录默认勾选（清单第 7 项）：源码守卫", () => {
  // LoginPage 带健康检测等依赖，不单独搭 eval 壳；用源码守卫盯住默认值，
  // 与注册页的行为测试合起来覆盖「登录 / 注册三处都默认保持登录」。
  const source = readFileSync(`${ETS}/features/auth/LoginPage.ets`, "utf8");
  assert.match(
    source,
    /@State rememberMe: boolean = true;/,
    "登录页 rememberMe 应默认 true（App 默认保持登录，用户可关闭）"
  );
});

test("登录令牌本地保存失败：撤销刚建立的服务端会话，绝不展示已登录（注册共用同一收尾）", async () => {
  let revoked = "";
  const service = sessionService({
    ApiConfig: { getBaseUrl: () => "https://x" },
    SessionStore: {
      readToken: async () => "",
      writeToken: async () => false, // 本地保存失败
      clearToken: async () => {},
    },
    ApiClient: {
      post: async (_url: string, path: string, _body: string, token: string) => {
        if (path.includes("/native/login")) {
          return {
            userId: "u1", displayName: null, roles: [], permissions: [],
            memberProfileId: null, memberStatus: null, mustChangePassword: false,
            home: "CUSTOMER", token: "fresh-token", expiresAt: "2026-01-01T00:00:00.000Z",
          };
        }
        if (path.includes("/logout")) {
          revoked = token;
          return { loggedOut: true };
        }
        throw new ApiRequestError("UNEXPECTED_RESPONSE", path, 0, "");
      },
    },
    ApiRequestError,
    isSessionExpiredCode: () => false,
    hilog: {
      warn() {},
      error() {},
      info() {},
      debug() {},
    },
  });
  await assert.rejects(
    () => service.login("12345678", "secret1"),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.code, "LOCAL_STORAGE_ERROR");
      return true;
    }
  );
  // adoptSession 是登录 / 注册共用的收尾：保存失败时用**刚拿到的**令牌撤销服务端会话
  // （登录没有旧令牌，撤销的正是这次新建立的会话，不留「本地没存成、服务端却活着」的悬空会话），
  // 并把内存身份置空 —— 界面因此不会展示「已登录 / 已注册成功」。
  assert.equal(revoked, "fresh-token");
  assert.equal(service.current(), null);
});

/**
 * Issue #60 P1 回归：**普通改密的迟到响应不得覆盖本地令牌**。
 *
 * 旧代码（`changePassword` 在请求返回后无条件 `SessionStore.writeToken(data.token)`）
 * 在这条时序上必然失败：本地令牌会变成 `token-A-new`（A 的迟到响应），
 * 而界面与内存身份已经是 B —— 后续请求带 A 的令牌，就是账号串用。
 */
for (const logoutFails of [false, true]) {
  const suffix = logoutFails ? "（撤销新会话失败也不影响本地归属）" : "";
  test(`A/B 交错：A 的普通改密响应迟到，B 的令牌与内存身份不被覆盖${suffix}`, async () => {
    const race = staleResponseRace("changePassword", logoutFails);
    await tick();
    // A 的请求已发出并挂起，本地此刻还是 A 的令牌。
    assert.equal(race.currentToken(), "token-A");

    // 用户在改密在途时按返回键离开改密页并退出 A，随后登录 B。
    await race.service.logout();
    assert.equal(race.currentToken(), "");
    const identityB = (await race.service.login("22222222", "secret1")) as { userId: string };
    assert.equal(race.currentToken(), "token-B");
    assert.equal(identityB.userId, "B");

    // A 的改密响应此刻才到：服务端已吊销 A 的旧会话并发出新令牌。
    race.first.resolve(sessionPayload("A", "token-A-new"));
    const outcome = await race.settled;
    // 核心断言：B 的令牌没有被覆盖，内存身份也仍然是 B
    // （有缺陷的旧代码在这里会是 token-A-new —— 界面是 B，请求头却是 A）。
    assert.equal(race.currentToken(), "token-B");
    assert.equal((race.service.current() as { userId: string }).userId, "B");
    assert.ok(outcome instanceof ApiRequestError, "迟到响应必须按错误丢弃，不能走成功路径");
    assert.equal(outcome.code, "SESSION_CHANGED");
    // 服务端那个「活着但没人持有」的新会话被尽力撤销 —— 用**新**令牌，不是已死的旧令牌。
    assert.deepEqual(race.revoked, ["token-A", "token-A-new"]);
  });
}

test("登录响应迟到：期间会话已换成别人时不写入，并撤销这次建立的服务端会话", async () => {
  // adoptSession 是登录 / 客户注册 / 工作人员注册共用的收尾，这条时序对三者同构：
  // 第一次认证写请求在途期间会话归属变了（退出 + 登录 B），它的响应回来时已被放弃。
  const race = staleResponseRace("login", false);
  await tick();
  await race.service.logout();
  const identityB = (await race.service.login("22222222", "secret1")) as { userId: string };
  assert.equal(race.currentToken(), "token-B");
  assert.equal(identityB.userId, "B");

  race.first.resolve(sessionPayload("A", "token-A-new"));
  const outcome = await race.settled;
  // B 的令牌与身份保持不变；A 那次登录建立的服务端会话被撤销。
  assert.equal(race.currentToken(), "token-B");
  assert.equal((race.service.current() as { userId: string }).userId, "B");
  assert.ok(outcome instanceof ApiRequestError);
  assert.equal(outcome.code, "SESSION_CHANGED");
  assert.deepEqual(race.revoked, ["token-A-new"]);
});

test("同一账号的改密响应未被抢占时照常写回新令牌（归属校验不误伤正常路径）", async () => {
  let token = "token-A";
  const revoked: string[] = [];
  const service = sessionService({
    ApiConfig: { getBaseUrl: () => "https://x" },
    SessionStore: {
      readToken: async () => token,
      writeToken: async (next: string) => {
        token = next;
        return true;
      },
      clearToken: async () => {
        token = "";
      },
    },
    ApiClient: {
      post: async (_url: string, path: string, _body: string, bearer: string) => {
        if (path.includes("/native/login")) {
          return sessionPayload("A", "token-A");
        }
        if (path.includes("/native/password/change")) {
          return sessionPayload("A", "token-A-new");
        }
        if (path.includes("/native/logout")) {
          revoked.push(bearer);
          return { loggedOut: true };
        }
        throw new ApiRequestError("UNEXPECTED_RESPONSE", path, 0, "");
      },
    },
    ApiRequestError,
    isSessionExpiredCode: () => false,
    hilog: { warn() {}, error() {}, info() {}, debug() {} },
  });
  // 先建立一次内存身份（真实路径上改密前必然已登录）。
  await service.login("11111111", "secret1");
  const data = (await service.changePassword({
    currentPassword: "a",
    newPassword: "b",
    newPasswordConfirmation: "b",
  })) as { token: string };
  assert.equal(data.token, "token-A-new");
  assert.equal(token, "token-A-new");
  assert.deepEqual(revoked, []);
});

test("注册/改密页不把 $$ 双向绑定传进自定义组件（模拟器 ReferenceError 回归守卫）", () => {
  // `$$this.x` 只对框架组件属性（如 TextInput({ text: $$this.x })）有效；把它作为参数传给
  // 自定义组件 LabeledInput 时编译器不展开宏，运行时留下字面量 $$this，渲染即抛
  // ReferenceError: $$this is not defined（模拟器 jscrash 实测：打开注册页进程崩溃）。
  // 这三页必须用单向 text: this.x + onChange 回写，故源码里不应再出现 $$this.。
  for (const name of ["RegisterCustomerPage", "RegisterStaffPage", "PasswordChangePage"] as const) {
    const source = readFileSync(`${ETS}/features/auth/${name}.ets`, "utf8");
    assert.doesNotMatch(
      source,
      /\$\$this\./,
      `${name} 不应使用 $$ 双向绑定（传给 LabeledInput 会在渲染时崩溃）`
    );
  }
});
