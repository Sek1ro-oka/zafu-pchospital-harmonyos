import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

interface Identity {
  home: string;
}
interface HomeShell {
  authenticated: boolean;
  currentTab: number;
  pathStack: { names: string[]; getAllPathName(): string[] };
  openRoute(route: string, param: object | null): void;
  selectNavigation(index: number): void;
  canChangeTab(index: number): boolean;
  cancelLogin(): void;
  completeLogin(identity: Identity): void;
  logoutToGuest(): Promise<void>;
  onLoggedIn: (identity: Identity) => void;
  onLogout: () => Promise<void>;
}

/** 执行真实壳页面方法，导航和平台使用模拟依赖；不能替代设备检查。 */
function shell(): HomeShell {
  const source = readFileSync("../app/entry/src/main/ets/features/home/HomePage.ets", "utf8");
  const start = source.slice(0, source.indexOf("  @Builder"));
  const select = source.slice(
    source.indexOf("  private canChangeTab"),
    source.indexOf("  build()"),
  );
  const intent = readFileSync("../app/entry/src/main/ets/core/auth/LoginIntent.ets", "utf8");
  const state = (intent + "\n" + start + select + "\n}\nnew HomePage();")
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g, "")
    .replace(/@Component/g, "")
    .replace(/@(State|Prop)\s+/g, "")
    .replace(/export /g, "")
    .replace("struct HomePage", "class HomePage");
  const code = ts.transpileModule(state, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  class Stack {
    names: string[] = [];
    getAllPathName() {
      return this.names;
    }
    params: unknown[] = [];
    pushPathByName(name: string, param?: object) {
      this.names.push(name);
      this.params.push(param);
    }
    pop() {
      this.names.pop();
      this.params.pop();
    }
    clear() {
      this.names = [];
    }
  }
  return runInNewContext(code, {
    NavPathStack: Stack,
    TabsController: class {
      changeIndex() {}
    },
    NavPusher: class {
      push(stack: Stack, route: string, param: object) {
        stack.pushPathByName(route, param);
      }
    },
    HOME_STAFF: "STAFF",
    ROUTE_REPAIR_ORDERS: "repair-orders",
    ROUTE_STAFF_ORDERS: "staff-repair-orders",
    ROUTE_PUBLIC_GUIDES: "public-guides",
    ROUTE_KNOWLEDGE: "knowledge",
    ROUTE_ACTIVITY_DETAIL: "activity-detail",
    ROUTE_ACTIVITY_LOOKUP: "activity-lookup",
  }) as HomeShell;
}

test("游客公开指南不登录；受保护操作只压入一次登录页", () => {
  const page = shell();
  page.openRoute("public-guides", null);
  assert.equal(page.pathStack.names[0], "public-guides");
  page.openRoute("repair-orders", null);
  page.openRoute("knowledge", null);
  assert.equal(page.pathStack.names.join(","), "public-guides,login");
});
test("取消登录保留原页，下一次登录不执行取消的意图", () => {
  const page = shell();
  page.openRoute("public-guides", null);
  page.openRoute("repair-orders", null);
  page.cancelLogin();
  assert.equal(page.pathStack.names.join(","), "public-guides");
  page.selectNavigation(4);
  page.completeLogin({ home: "CUSTOMER" });
  assert.equal(page.currentTab, 4);
  assert.equal(page.pathStack.names.join(","), "public-guides");
});
test("报修登录成功按服务器角色续接目标，不遗留登录页", () => {
  for (const [home, route] of [
    ["CUSTOMER", "repair-orders"],
    ["STAFF", "staff-repair-orders"],
  ]) {
    const page = shell();
    page.openRoute("repair-orders", null);
    page.completeLogin({ home });
    assert.equal(page.pathStack.names.join(","), route);
  }
});
test("游客我的触发登录；退出清导航并回游客首页", async () => {
  const page = shell();
  page.selectNavigation(4);
  assert.equal(page.currentTab, 0);
  assert.equal(page.pathStack.names.join(","), "login");
  page.onLoggedIn = () => {
    page.authenticated = true;
  };
  page.completeLogin({ home: "CUSTOMER" });
  assert.equal(page.currentTab, 4);
  page.onLogout = async () => {
    page.authenticated = false;
  };
  await page.logoutToGuest();
  assert.equal(page.currentTab, 0);
  assert.equal(page.authenticated, false);
  assert.equal(page.pathStack.names.length, 0);
});

test("滑动进入我的也被登录守卫拦截；取消留在原知识页", () => {
  const page = shell();
  page.currentTab = 3;
  assert.equal(page.canChangeTab(4), false);
  assert.equal(page.canChangeTab(4), false);
  assert.equal(page.pathStack.names.join(","), "login");
  page.cancelLogin();
  assert.equal(page.currentTab, 3);
  assert.equal(page.canChangeTab(2), true);
  assert.equal(page.canChangeTab(3), true);
});

test("服务器登录成功后可跨过 Prop 更新的一帧；退出作废临时通行", async () => {
  const page = shell();
  page.selectNavigation(4);
  page.completeLogin({ home: "CUSTOMER" });
  assert.equal(page.canChangeTab(4), true);
  await page.logoutToGuest();
  assert.equal(page.canChangeTab(4), false);
  assert.equal(page.currentTab, 0);
});

test("退出请求进行中拦截切页，完成后回游客首页，避免落在空我的页面", async () => {
  const page = shell();
  page.authenticated = true;
  page.currentTab = 4;
  let finish: () => void = () => {};
  page.onLogout = () =>
    new Promise<void>((resolve) => {
      finish = () => {
        page.authenticated = false;
        resolve();
      };
    });
  const leaving = page.logoutToGuest();
  assert.equal(page.canChangeTab(3), false);
  assert.equal(page.canChangeTab(4), false);
  page.selectNavigation(4);
  page.openRoute("knowledge", null);
  assert.equal(page.pathStack.names.length, 0);
  finish();
  await leaving;
  assert.equal(page.currentTab, 0);
  assert.equal(page.canChangeTab(3), true);
  assert.equal(page.canChangeTab(4), false);
  assert.equal(page.pathStack.names.join(","), "login");
});

test("新安装采用共享地址，已有开发地址保留", async () => {
  const source = readFileSync("../app/entry/src/main/ets/core/network/ApiConfig.ets", "utf8")
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g, "")
    .replace(/export /g, "");
  for (const [saved, expected] of [
    ["", "https://harmony-api.pczafu.cn"],
    ["http://127.0.0.1:13080", "http://127.0.0.1:13080"],
  ]) {
    const code = ts.transpileModule(source + "\nApiConfig;", {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    const config = runInNewContext(code, {
      preferences: { getPreferences: async () => ({ get: async () => saved }) },
    }) as { loadSaved(context: object): Promise<string> };
    assert.equal(await config.loadSaved({}), expected);
  }
});

test("没有会话或恢复断网时进入游客首页，不授予身份", async () => {
  const source = readFileSync("../app/entry/src/main/ets/pages/Index.ets", "utf8");
  const state = source
    .slice(0, source.indexOf("  @Builder"))
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g, "")
    .replace(/@(Entry|Component)\s*/g, "")
    .replace(/@State\s+/g, "")
    .replace("struct Index", "class Index");
  const code = ts.transpileModule(state + "\n}\nnew Index();", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  for (const unavailableReason of ["", "网络不可达"]) {
    const root = runInNewContext(code, {
      ApiConfig: { loadSaved: async () => "https://harmony-api.pczafu.cn" },
      SessionService: { restore: async () => ({ identity: null, unavailableReason }) },
    }) as {
      boot(): Promise<void>;
      getUIContext: () => object;
      authenticated: boolean;
      phase: number;
      permissions: string[];
    };
    root.getUIContext = () => ({ getHostContext: () => ({}) });
    await root.boot();
    assert.equal(root.phase, 2);
    assert.equal(root.authenticated, false);
    assert.equal(root.permissions.length, 0);
  }
});

test("活动详情游客可读；报名登录/注册后保留活动目标，取消回详情", () => {
  const page = shell();
  const target = { activityId: "synthetic-activity" };
  page.openRoute("activity-detail", target);
  page.openRoute("activity-signup", target);
  assert.equal(page.pathStack.names.join(","), "activity-detail,login");
  page.cancelLogin();
  assert.equal(page.pathStack.names.join(","), "activity-detail");
  page.openRoute("activity-signup", target);
  page.completeLogin({ home: "CUSTOMER" });
  assert.equal(page.pathStack.names.join(","), "activity-detail,activity-signup");
  assert.equal((page.pathStack as unknown as { params: object[] }).params[1], target);
});
