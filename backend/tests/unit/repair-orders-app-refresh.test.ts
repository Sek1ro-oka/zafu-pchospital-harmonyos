import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

/** 执行实际 ArkUI 页面的状态方法；只去掉 UI 构建部分和装饰器，平台/网络使用模拟依赖。 */
interface PageState {
  orders: { id: string }[];
  showForm: boolean;
  status: string;
  loadingMore: boolean;
  hasMore: boolean;
  currentPage: number;
  load(): Promise<void>;
  loadMore(): Promise<void>;
  switchStatus(status: string): void;
  afterSubmit(): Promise<void>;
}

function pageWithList(
  listMine: (status: string, page: number) => Promise<{ id: string }[]>,
): PageState {
  const source = readFileSync(
    "../app/entry/src/main/ets/features/repair/RepairOrdersPage.ets",
    "utf8",
  );
  const stateMethods = source
    .slice(0, source.indexOf("  @Builder"))
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g, "")
    .replace("@Component", "")
    .replace("export struct RepairOrdersPage", "class RepairOrdersPage")
    .replace(/@State\s+/g, "");
  const script = ts.transpileModule(`${stateMethods}\n}\nnew RepairOrdersPage();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(script, {
    RepairOrderService: { listMine },
    ApiRequestError: class extends Error {},
    isSessionExpiredCode: () => false,
    isNetworkErrorCode: () => false,
  }) as PageState;
}

test("提交成功发生在首次列表请求期间：排队刷新显示新单，普通重复点击不额外请求", async () => {
  let resolveInitial: (orders: { id: string }[]) => void = () => {
    throw new Error("尚未发起首次请求");
  };
  const initial = new Promise<{ id: string }[]>((resolve) => {
    resolveInitial = resolve;
  });
  let calls = 0;
  const page = pageWithList(() => {
    calls += 1;
    return calls === 1 ? initial : Promise.resolve([{ id: "new-order" }]);
  });
  const loading = page.load();
  await page.load();
  assert.equal(calls, 1, "普通重复点击仍然防重");
  page.showForm = true;
  await page.afterSubmit();
  assert.equal(page.showForm, false);
  assert.equal(calls, 1, "等待正在进行的请求结束，不并发刷新");
  resolveInitial([]);
  await loading;
  assert.equal(calls, 2, "提交后的刷新必须执行");
  assert.equal(page.orders[0]?.id, "new-order", "最终列表必须展示新提交的报修单");
});

test("首次列表未返回时切换状态：旧范围不回填，结束后读取最终选中的真实状态", async () => {
  let resolveInitial!: (orders: { id: string }[]) => void;
  const initial = new Promise<{ id: string }[]>((resolve) => {
    resolveInitial = resolve;
  });
  const requested: string[] = [];
  const page = pageWithList((status) => {
    requested.push(status);
    return requested.length === 1 ? initial : Promise.resolve([{ id: "completed-order" }]);
  });
  const loading = page.load();
  page.switchStatus("SUBMITTED");
  page.switchStatus("COMPLETED");
  resolveInitial([{ id: "old-range-order" }]);
  await loading;
  assert.deepEqual(requested, ["", "COMPLETED"]);
  assert.equal(page.orders[0]?.id, "completed-order");
});

test("加载更多时切换状态：迟到旧页不混入新列表，也不覆盖新范围的分页结果", async () => {
  let resolveOld!: (orders: { id: string }[]) => void;
  const oldPage = new Promise<{ id: string }[]>((resolve) => {
    resolveOld = resolve;
  });
  const page = pageWithList((status, pageNumber) => {
    if (pageNumber === 2) return oldPage;
    return Promise.resolve(
      status === "COMPLETED" ? [{ id: "completed-order" }] : [{ id: "initial-order" }],
    );
  });
  await page.load();
  page.hasMore = true;
  const loadingMore = page.loadMore();
  page.switchStatus("COMPLETED");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(page.loadingMore, false);
  resolveOld([{ id: "late-old-order" }]);
  await loadingMore;
  assert.equal(page.orders.length, 1);
  assert.equal(page.orders[0]?.id, "completed-order");
  assert.equal(page.currentPage, 1);
  assert.equal(page.hasMore, false);
});
