import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

/** 执行实际 ArkUI 页面的状态方法；只去掉 UI 构建部分和装饰器，平台/网络使用模拟依赖。 */
interface PageState {
  orders: { id: string }[];
  showForm: boolean;
  load(): Promise<void>;
  afterSubmit(): Promise<void>;
}

function pageWithList(listMine: () => Promise<{ id: string }[]>): PageState {
  const source = readFileSync("../app/entry/src/main/ets/features/repair/RepairOrdersPage.ets", "utf8");
  const stateMethods = source.slice(0, source.indexOf("  @Builder"))
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
  let resolveInitial: (orders: { id: string }[]) => void = () => { throw new Error("尚未发起首次请求"); };
  const initial = new Promise<{ id: string }[]>((resolve) => { resolveInitial = resolve; });
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
