import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { guideCategory } from "../../../app/entry/src/main/ets/features/knowledge/GuideCategory";

function page<T>(file: string, name: string, deps: Record<string, unknown>): T {
  const source = readFileSync(`../app/entry/src/main/ets/features/${file}`, "utf8");
  const state = source.slice(0, source.indexOf("  @Builder"))
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g, "")
    .replace(/@Watch\('[^']+'\)\s*/g, "")
    .replace(/@(Component|State|Prop)\s*/g, "")
    .replace(`export struct ${name}`, `class ${name}`);
  const code = ts.transpileModule(state + `\n}\nnew ${name}();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(code, {
    ApiRequestError: class extends Error {},
    ApiConfig: { getBaseUrl: () => "https://harmony-api.pczafu.cn" },
    HOME_STAFF: "STAFF",
    guideCategory,
    ...deps,
  }) as T;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("未初始化"); };
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

interface Knowledge {
  authenticated: boolean; home: string; permissions: string[];
  cases: { id: string }[]; casesLoading: boolean; casesError: string;
  loadCases(): Promise<void>; authChanged(): void;
  guides: { id: string; title: string; revision: null }[]; category: string; query: string;
  visibleGuides(): { id: string }[];
}

test("游客/客户知识首页不请求工作人员案例；授权工作人员才加载", async () => {
  let calls = 0;
  const library = page<Knowledge>("knowledge/KnowledgeLibraryPage.ets", "KnowledgeLibraryPage", {
    KnowledgeCaseService: { listCases: async () => { calls++; return []; } },
  });
  library.authChanged();
  library.authenticated = true;
  library.home = "CUSTOMER";
  library.authChanged();
  assert.equal(calls, 0);
  library.home = "STAFF";
  library.authChanged();
  assert.equal(calls, 0, "工作人员仍需实际 repair:read 权限");
  library.permissions = ["repair:read"];
  library.authChanged();
  await Promise.resolve();
  assert.equal(calls, 1);
});

test("退出后工作人员案例的迟到响应不泄入客户/游客首页", async () => {
  const pending = deferred<{ id: string }[]>();
  const library = page<Knowledge>("knowledge/KnowledgeLibraryPage.ets", "KnowledgeLibraryPage", {
    KnowledgeCaseService: { listCases: () => pending.promise },
  });
  library.authenticated = true;
  library.home = "STAFF";
  library.permissions = ["repair:read"];
  const request = library.loadCases();
  library.authenticated = false;
  library.authChanged();
  pending.resolve([{ id: "internal-case" }]);
  await request;
  assert.equal(library.cases.length, 0);
  assert.equal(library.casesLoading, false);
  assert.equal(library.casesError, "");
});

test("公开指南按标题分类与搜索共同过滤，无匹配返回空态", () => {
  const library = page<Knowledge>("knowledge/KnowledgeLibraryPage.ets", "KnowledgeLibraryPage", {});
  library.guides = [
    { id: "a", title: "开机黑屏", revision: null },
    { id: "b", title: "暗影精灵开机风扇不转", revision: null },
    { id: "c", title: "开机进临时桌面", revision: null },
    { id: "d", title: "认证相关", revision: null },
  ];
  library.category = "开机故障";
  assert.equal(library.visibleGuides().map((x) => x.id).join(","), "a");
  library.category = "散热";
  library.query = "风扇";
  assert.equal(library.visibleGuides().map((x) => x.id).join(","), "b");
  library.query = "黑屏";
  assert.equal(library.visibleGuides().length, 0);
  assert.equal(guideCategory("开机进临时桌面"), "系统软件");
});

interface Activities {
  activities: { id: string; title: string }[]; loading: boolean; query: string; errorText: string;
  load(): Promise<void>; aboutToDisappear(): void; visibleActivities(): { id: string }[];
}

test("活动刷新最新请求获胜，旧结果不覆盖；关键词只过滤真实列表", async () => {
  const older = deferred<{ id: string; title: string }[]>();
  let calls = 0;
  const activity = page<Activities>("activity/ActivityPage.ets", "ActivityPage", {
    ApiClient: { get: () => ++calls === 1 ? older.promise : Promise.resolve([{ id: "new", title: "校园维修" }]) },
  });
  const first = activity.load();
  await activity.load();
  older.resolve([{ id: "old", title: "旧活动" }]);
  await first;
  assert.equal(activity.activities[0].id, "new");
  assert.equal(activity.loading, false);
  activity.query = "不存在";
  assert.equal(activity.visibleActivities().length, 0);
});

test("活动页面销毁后的请求不更新状态", async () => {
  const pending = deferred<{ id: string; title: string }[]>();
  const activity = page<Activities>("activity/ActivityPage.ets", "ActivityPage", {
    ApiClient: { get: () => pending.promise },
  });
  const request = activity.load();
  activity.aboutToDisappear();
  pending.resolve([{ id: "late", title: "迟到活动" }]);
  await request;
  assert.equal(activity.activities.length, 0);
});
