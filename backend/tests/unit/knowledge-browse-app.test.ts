import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { BrowseCase, BrowseCasePage, BrowseGuide, KnowledgeSearchController, highlightQuery } from "../../../app/entry/src/main/ets/features/knowledge/KnowledgeBrowse";
import { guideCategory, GUIDE_CATEGORIES } from "../../../app/entry/src/main/ets/features/knowledge/GuideCategory";
import { parseBrowseQuery, browseExcerpt, matchesBrowseQuery } from "../../src/features/knowledge/case-search";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const guide: BrowseGuide = { id: "guide-A", title: "Windows 系统排查", revision: "abc" };
function item(id: string): BrowseCase { return { caseId: id, title: id, excerpt: "真实摘要", contentVersion: 1, visibility: "PUBLIC", sourceCount: 1, updatedAt: "2026-10-15" }; }
function page(ids: string[], number = 1, more = false): BrowseCasePage { return { items: ids.map(item), page: number, pageSize: 20, total: 21, hasMore: more }; }
function controller(cases: (q: string, page: number) => Promise<BrowseCasePage>, guides = async () => [guide]) {
  return new KnowledgeSearchController({ cases, guides, message: () => "断网，请重试", changed: () => {} });
}
test("清空输入立即清除内容，旧查询迟到不回填", async () => {
  const pending = deferred<BrowseCasePage>(); const c = controller(() => pending.promise);
  const first = c.search("Windows", "all", true);
  await c.search("", "all", true); pending.resolve(page(["old"])); await first;
  assert.equal(c.state.query, ""); assert.deepEqual(c.state.cases, []); assert.deepEqual(c.state.guides, []);
});
test("切换类型/关键词后，旧响应和 finally 不污染新范围", async () => {
  const pending = deferred<BrowseCasePage>(); const c = controller(() => pending.promise);
  const old = c.search("旧", "cases", true); await c.search("WINDOWS", "guides", true);
  pending.resolve(page(["old"])); await old;
  assert.equal(c.state.type, "guides"); assert.deepEqual(c.state.guides, [guide]); assert.deepEqual(c.state.cases, []);
});
test("分页失败重试同一页；成功后去重追加，不跳页", async () => {
  const requested: number[] = []; let fail = true;
  const c = controller(async (_q, n) => { requested.push(n); if (n === 1) return page(["A"], 1, true); if (fail) { fail = false; throw new Error(); } return page(["A", "B"], 2); });
  await c.search("排查", "cases", true); await c.more(); assert.equal(c.state.page, 1); assert.equal(c.state.moreLoading, false);
  await c.more(); assert.deepEqual(requested, [1, 2, 2]); assert.deepEqual(c.state.cases.map((v) => v.caseId), ["A", "B"]);
});
test("分页期间换词后旧页不追加；新查询 loading 不被旧请求清除", async () => {
  const oldMore = deferred<BrowseCasePage>(), newFirst = deferred<BrowseCasePage>();
  const c = controller((q, n) => q === "旧" ? n === 1 ? Promise.resolve(page(["old"], 1, true)) : oldMore.promise : newFirst.promise);
  await c.search("旧", "cases", true); const more = c.more(); const fresh = c.search("新", "cases", true);
  oldMore.resolve(page(["old2"], 2)); await more; assert.equal(c.state.casesLoading, true); assert.equal(c.state.moreLoading, false);
  newFirst.resolve(page(["new"])); await fresh; assert.deepEqual(c.state.cases.map((v) => v.caseId), ["new"]);
});
test("离开后同词返回重新请求，旧页面响应不替换新结果", async () => {
  const late = deferred<BrowseCasePage>(); let calls = 0;
  const c = controller(() => ++calls === 1 ? late.promise : Promise.resolve(page(["new"])));
  const old = c.search("案例", "cases", true); c.invalidate(); await c.search("案例", "cases", true);
  late.resolve(page(["old"])); await old; assert.equal(c.state.cases[0].caseId, "new");
});
test("指南错误与案例结果独立；游客不调用案例接口；空搜索不请求", async () => {
  let calls = 0; const c = controller(async () => { calls++; return page(["A"]); }, async () => { throw new Error(); });
  await c.search("排查", "all", true); assert.equal(c.state.guideError, "断网，请重试"); assert.equal(c.state.cases.length, 1);
  await c.search("排查", "all", false); await c.search("  ", "all", true); assert.equal(calls, 1);
});
test("标题粗分类复用基线；高亮按字面匹配，大小写不改变原文", () => {
  assert.ok(GUIDE_CATEGORIES.includes(guideCategory("校园网认证"))); assert.equal(guideCategory("驱动安装"), "系统软件");
  assert.deepEqual(highlightQuery("[Win] WIN", "win"), [{ text: "[", matched: false }, { text: "Win", matched: true }, { text: "] ", matched: false }, { text: "WIN", matched: true }]);
  assert.equal(highlightQuery("a[b", "[")[1].matched, true);
});
test("搜索词校验与摘要：大小写一致匹配，仅截取已有正文", () => {
  assert.equal(parseBrowseQuery("  Windows "), "Windows"); assert.throws(() => parseBrowseQuery(" ")); assert.throws(() => parseBrowseQuery("a".repeat(101)));
  assert.ok(matchesBrowseQuery("Windows 线缆", "原文", "windows")); assert.ok(matchesBrowseQuery("案例", "连接线缆恢复", "线缆"));
  const result = browseExcerpt("前文".repeat(100) + "命中词" + "后文".repeat(100), "命中词"); assert.ok(result.includes("命中词")); assert.ok(result.length <= 162);
});

interface SearchPage {
  authenticated: boolean; home: string; permissions: string[]; onOpen: () => void; notice: string;
  aboutToAppear(): void; aboutToDisappear(): void; search(query: string, type: string): void;
  openCase(item: BrowseCase): Promise<void>;
}
function searchPage(target: Promise<BrowseCasePage>): SearchPage {
  const source = readFileSync("../app/entry/src/main/ets/features/knowledge/KnowledgeSearchPage.ets", "utf8");
  const start = source.indexOf("export struct KnowledgeSearchPage");
  const methods = source.slice(start, source.indexOf("  @Builder", start))
    .replace("export struct KnowledgeSearchPage", "class KnowledgeSearchPage")
    .replace(/@(State|Prop)\s*/g, "").replace(/@Watch\('[^']+'\)\s*/g, "");
  const script = ts.transpileModule(methods + "\n}\nnew KnowledgeSearchPage();", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(script, { emptySearchState: () => ({ query: "", type: "all" }), KnowledgeSearchController,
    KnowledgeBrowseService: { guides: async () => [], cases: (_q: string, _p: number, id?: string) => id ? target : Promise.resolve(page(["A"])) },
    ApiRequestError: class extends Error {}, isSessionExpiredCode: () => false, HOME_STAFF: "STAFF",
    ROUTE_CASE_DETAIL: "case-detail", ROUTE_PUBLIC_CASE_DETAIL: "public-case-detail" }) as SearchPage;
}
test("实际搜索页：打开案例的迟到确认不跨查询或跨页面导航", async () => {
  for (const leave of [false, true]) {
    const pending = deferred<BrowseCasePage>(), view = searchPage(pending.promise); let opened = 0;
    view.authenticated = true; view.home = "STAFF"; view.permissions = ["repair:read"]; view.onOpen = () => { opened++; };
    view.aboutToAppear(); view.search("线缆", "cases"); const opening = view.openCase(item("A"));
    if (leave) view.aboutToDisappear(); else view.search("系统", "guides");
    pending.resolve(page(["A"])); await opening; assert.equal(opened, 0);
  }
});
test("实际搜索页：目标失效只刷新并说明，不打开旧案例；有效目标才导航", async () => {
  for (const valid of [false, true]) {
    const view = searchPage(Promise.resolve(page(valid ? ["A"] : []))); let opened = 0;
    view.authenticated = true; view.home = "STAFF"; view.permissions = ["repair:read"]; view.onOpen = () => { opened++; };
    view.aboutToAppear(); view.search("线缆", "cases"); await view.openCase(item("A"));
    assert.equal(opened, valid ? 1 : 0); if (!valid) assert.match(view.notice, /不可访问/);
  }
});
