import assert from "node:assert/strict";
import test from "node:test";

import {
  CaseStructuredContent,
  caseEmbeddingLabel,
  caseResultLabel,
  caseSourceResultLabel,
  caseStatusLabel,
  caseVisibilityLabel,
  RecordCaseProcessingView,
  recordCaseStatusLabel,
} from "../../../app/entry/src/main/ets/features/knowledge/KnowledgeCaseContract";
import {
  contentRows,
  isActionContextCurrent,
  PANEL_MODE_FAILED,
  PANEL_MODE_PUBLISHED,
  PANEL_MODE_PROCESSING,
  PANEL_MODE_UNMARKED,
  typicalPanelModel,
  unknownsText,
} from "../../../app/entry/src/main/ets/features/knowledge/KnowledgeCaseFlow";

/**
 * 典型案例面板的页面状态回归（复用页面使用的 KnowledgeCaseFlow 纯函数）：
 * - 按钮可见性只来自服务端能力标记：canRetry=false 时不得出现重试按钮（否则是死按钮）；
 * - 失败原因原样透出；已入库时给出案例标题与打开入口；
 * - 「原文未提供」清单与结构化字段行不漏不造。
 */

function view(overrides: Partial<RecordCaseProcessingView>): RecordCaseProcessingView {
  return {
    recordId: "rec_1",
    isTypical: false,
    canMark: false,
    canUnmark: false,
    canRetry: false,
    status: "NONE",
    caseId: null,
    caseStatus: null,
    caseTitle: null,
    caseVisibility: null,
    failureCode: null,
    failureMessage: null,
    updatedAt: null,
    ...overrides,
  };
}

test("面板：未标记且可标记时只出现标记按钮", () => {
  const model = typicalPanelModel(view({ canMark: true }));
  assert.equal(model.mode, PANEL_MODE_UNMARKED);
  assert.equal(model.showMark, true);
  assert.equal(model.showRetry, false);
  assert.equal(model.showUnmark, false);
  assert.equal(model.canOpenCase, false);
});

test("面板：整理失败时原样展示失败原因，重试按钮以服务端 canRetry 为准", () => {
  const retryable = typicalPanelModel(
    view({ isTypical: true, canUnmark: true, canRetry: true, status: "FAILED", failureCode: "MODEL_TIMEOUT", failureMessage: "整理模型超时，可重试" }),
  );
  assert.equal(retryable.mode, PANEL_MODE_FAILED);
  assert.equal(retryable.detail, "整理模型超时，可重试");
  assert.equal(retryable.showRetry, true);
  assert.equal(retryable.showMark, false);
  assert.equal(retryable.showUnmark, true);

  const notRetryable = typicalPanelModel(
    view({ isTypical: true, status: "FAILED", failureMessage: "案例已被管理员撤回，需管理员恢复后才能重新发布" }),
  );
  assert.equal(notRetryable.showRetry, false, "服务端说不能重试时不得出现死按钮");
});

test("面板：已入库显示案例标题与打开入口；案例层面失败仍可重试", () => {
  const published = typicalPanelModel(
    view({
      isTypical: true,
      canUnmark: true,
      status: "PUBLISHED",
      caseId: "case_1",
      caseStatus: "PUBLISHED",
      caseTitle: "ThinkPad E14 键盘进水清理",
      caseVisibility: "STAFF",
    }),
  );
  assert.equal(published.mode, PANEL_MODE_PUBLISHED);
  assert.equal(published.canOpenCase, true);
  assert.equal(published.summary, "已入库可检索");
  assert.ok(published.detail.includes("ThinkPad E14 键盘进水清理"));
  assert.ok(published.detail.includes("内部可见"));

  const caseFailed = typicalPanelModel(
    view({
      isTypical: true,
      canUnmark: true,
      canRetry: true,
      status: "PUBLISHED",
      caseId: "case_1",
      caseStatus: "FAILED",
      caseTitle: "ThinkPad E14 键盘进水清理",
      caseVisibility: "PUBLIC",
      failureMessage: "案例来源在重整期间发生变化，请重试",
    }),
  );
  assert.equal(caseFailed.showRetry, true, "来源已入库但案例失败时必须允许重试");
  assert.equal(caseFailed.canOpenCase, true);
});

test("面板：来源已入库但案例撤回/重整/失败时不写「可检索」，如实区分两类状态", () => {
  const base = {
    isTypical: true,
    canUnmark: true,
    status: "PUBLISHED",
    caseId: "case_1",
    caseTitle: "案例标题",
    caseVisibility: "STAFF",
  };
  const withdrawn = typicalPanelModel(view({ ...base, caseStatus: "WITHDRAWN" }));
  assert.ok(withdrawn.summary.includes("案例已撤回"), withdrawn.summary);
  assert.ok(!withdrawn.summary.includes("可检索"), "撤回案例不得显示可检索");
  assert.ok(withdrawn.detail.includes("需管理员"), "撤回后应给出恢复路径说明");
  assert.equal(withdrawn.canOpenCase, true, "工作人员仍可打开查看撤回案例");

  const reprocessing = typicalPanelModel(view({ ...base, caseStatus: "REPROCESSING" }));
  assert.ok(reprocessing.summary.includes("案例重整中"), reprocessing.summary);
  assert.ok(!reprocessing.summary.includes("可检索"));

  const failed = typicalPanelModel(view({ ...base, caseStatus: "FAILED" }));
  assert.ok(failed.summary.includes("案例整理失败"), failed.summary);
  assert.ok(!failed.summary.includes("可检索"));
});

test("面板：来源被移除归一为 NONE 时，重试入口跟随服务端 canRetry", () => {
  const removed = typicalPanelModel(
    view({ isTypical: true, canUnmark: true, canRetry: true, status: "NONE" }),
  );
  assert.equal(removed.mode, PANEL_MODE_UNMARKED);
  assert.equal(removed.showRetry, true, "服务端可重试时必须给出恢复入口（不能只剩取消再标记）");
  assert.equal(removed.showMark, false);
  assert.equal(removed.summary, "来源暂未入库");
  assert.equal(removed.canOpenCase, false);
});

test("写操作守卫：切换备案或代次过期后，迟到的 A 响应不得写回面板", () => {
  assert.equal(isActionContextCurrent("A", 1, "A", 1), true);
  assert.equal(isActionContextCurrent("B", 2, "A", 1), false, "切到 B 后 A 的响应（含错误/回调/busy）必须失效");
  assert.equal(isActionContextCurrent("A", 2, "A", 1), false, "同一备案刷新推进代次后旧响应也必须失效");
});

test("面板：处理中状态不提供重试（避免并发重复提交）", () => {
  const processing = typicalPanelModel(view({ isTypical: true, status: "PROCESSING" }));
  assert.equal(processing.mode, PANEL_MODE_PROCESSING);
  assert.equal(processing.showRetry, false);
  assert.equal(processing.showMark, false);
  assert.equal(processing.canOpenCase, false);
});

test("结构化正文：「原文未提供」清单为空不显示，非空如实拼接", () => {
  assert.equal(unknownsText([]), "");
  assert.equal(unknownsText(["原因", "排查过程"]), "原文未提供：原因、排查过程");
});

test("结构化正文：字段行跳过空值并保留差异说明与合并依据", () => {
  const content: CaseStructuredContent = {
    title: "t",
    deviceModel: "MacBook Air",
    fault: "续航缩短",
    investigation: null,
    cause: null,
    resolution: "更换电池",
    result: "MIXED",
    category: null,
    differences: "来源1 已完成，来源2 未完成",
    unknowns: ["排查过程", "原因"],
    mergeReason: "同一机型同类故障",
  };
  const rows = contentRows(content);
  const labels = rows.map((row) => row.label);
  assert.deepEqual(labels, ["故障现象", "处置", "差异说明", "合并依据", "设备机型"]);
  assert.equal(rows[1].value, "更换电池");
});

test("文案映射：状态、范围、结果与来源结果的口径一致", () => {
  assert.equal(recordCaseStatusLabel("PUBLISHED"), "已入库可检索");
  assert.equal(recordCaseStatusLabel("WEIRD"), "WEIRD", "未知状态原样展示，不美化");
  assert.equal(caseStatusLabel("REPROCESSING"), "重整中");
  assert.equal(caseVisibilityLabel("PUBLIC"), "公开可见（含客户）");
  assert.equal(caseResultLabel("MIXED"), "多来源结果不一致");
  assert.equal(caseEmbeddingLabel("FAILED"), "生成失败（先按关键词检索）");
  assert.equal(caseSourceResultLabel(null), "未填写");
  assert.equal(caseSourceResultLabel("COMPLETED"), "已完成");
});
