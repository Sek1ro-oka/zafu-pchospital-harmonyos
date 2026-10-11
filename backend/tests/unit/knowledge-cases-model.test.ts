import assert from "node:assert/strict";
import test from "node:test";

import { ChatModelError } from "../../src/features/knowledge/chat-model";
import { materialOf, materialTextOf } from "../../src/features/knowledge-cases/case-material";
import {
  buildCaseMessages,
  buildRegenerateMessages,
  parseCaseModelOutput,
} from "../../src/features/knowledge-cases/case-model";

/**
 * 案例整理提示词与结构化输出校验（Issue #40 §4）：
 * 引文必须可定位（否则字段降级为未提供）、目标必须在候选白名单、结果由服务端推导。
 */

const RECORD_A = {
  deviceModel: "ThinkPad E14",
  category: { name: "硬件维修" },
  content: "键盘进水后部分按键失灵，拆机清理排线后恢复正常。",
  result: "COMPLETED",
  remark: null,
};

const RECORD_B = {
  deviceModel: "ThinkPad E14",
  category: { name: "硬件维修" },
  content: "同型号键盘进水，清理后 W 键仍失灵感，更换键盘模块后恢复。",
  result: "NOT_COMPLETED",
  remark: null,
};

function contextFor() {
  const materialA = materialOf(RECORD_A);
  const materialB = materialOf(RECORD_B);
  return {
    sourceTexts: new Map([
      ["S1", materialTextOf(materialA)],
      ["S2", materialTextOf(materialB)],
    ]),
    sourceResults: new Map<string, string | null>([
      ["S1", "COMPLETED"],
      ["S2", "NOT_COMPLETED"],
    ]),
    candidates: new Map([["C1", "case-1"]]),
    // 与真实调用点一致：候选的来源编号映射（用于按实际选择收窄来源集合）。
    candidateSourceLabels: new Map([["C1", ["S2"]]]),
  };
}

test("提示词：包含硬性规则、来源与候选白名单说明", () => {
  const messages = buildCaseMessages({
    newSource: { label: "S1", material: materialOf(RECORD_A), repairDate: "2026-10-01" },
    candidates: [
      {
        label: "C1",
        caseId: "case-1",
        title: "键盘进水",
        visibility: "STAFF",
        sources: [{ label: "S2", material: materialOf(RECORD_B), repairDate: null }],
      },
    ],
  });
  const system = messages[0].content;
  const user = messages[1].content;
  assert.match(system, /只使用来源中明确写出的信息/);
  assert.match(system, /引文证据/);
  assert.match(system, /merge/);
  assert.match(user, /\[S1\] 维修备案（2026-10-01）/);
  assert.match(user, /\[C1\] 标题：键盘进水/);
  assert.match(user, /\[S2\]/);
});

test("解析：合法输出保留可定位字段，引文按来源编号分桶", () => {
  const parsed = parseCaseModelOutput(
    JSON.stringify({
      action: "merge",
      target: "C1",
      title: "ThinkPad E14 键盘进水处理",
      device_model: "ThinkPad E14",
      fault: "键盘部分按键失灵",
      investigation: null,
      cause: null,
      resolution: "拆机清理排线",
      result: "COMPLETED",
      category: "硬件维修",
      differences: "S1 已恢复，S2 更换键盘模块后仍未完全恢复。",
      merge_reason: "同一机型同类故障的后续记录",
      evidences: [
        { source: "S1", field: "fault", quote: "键盘进水后部分按键失灵" },
        { source: "S2", field: "resolution", quote: "更换键盘模块后恢复" },
      ],
    }),
    contextFor(),
  );
  assert.equal(parsed.action, "merge");
  assert.equal(parsed.targetCaseId, "case-1");
  assert.equal(parsed.content.fault, "键盘部分按键失灵");
  assert.equal(parsed.content.deviceModel, "ThinkPad E14");
  assert.equal(parsed.content.investigation, null);
  assert.equal(parsed.content.cause, null, "未知原因必须保持未知");
  assert.equal(parsed.evidenceByLabel.get("S1")?.length, 1);
  assert.equal(parsed.evidenceByLabel.get("S2")?.length, 1);
});

test("解析：结果由来源强制推导（混合结果不允许被模型抹平）", () => {
  // 合并到 C1：实际来源 = S1 + C1 的来源（S2），一完成一未完成必须 MIXED。
  const parsed = parseCaseModelOutput(
    JSON.stringify({
      action: "merge",
      target: "C1",
      title: "ThinkPad 键盘问题合并",
      device_model: "ThinkPad E14",
      fault: "键盘失灵",
      investigation: null,
      cause: null,
      resolution: "清理排线并更换键盘模块",
      result: "COMPLETED",
      category: null,
      differences: null,
      merge_reason: "同一机型同类故障",
      evidences: [
        { source: "S1", field: "fault", quote: "键盘进水后部分按键失灵" },
        { source: "S2", field: "resolution", quote: "更换键盘模块后恢复" },
      ],
    }),
    contextFor(),
  );
  assert.equal(parsed.content.result, "MIXED", "一完成一未完成必须推导为 MIXED");
  assert.match(parsed.content.differences ?? "", /结果不一致/);
  assert.ok(parsed.notes.some((note) => note.includes("服务端补")));
});

test("解析：new 不受未选中候选的结果与证据影响（审查 P1-1 回归）", () => {
  // 模型选择 new，却把证据/差异写成来自候选 C1 的来源（S2）：一律不得进入本次案例。
  const parsed = parseCaseModelOutput(
    JSON.stringify({
      action: "new",
      target: null,
      title: "ThinkPad E14 键盘进水处理",
      device_model: "ThinkPad E14",
      fault: "W 键仍失灵", // 只在 S2（候选来源）里，S1 中不存在
      investigation: null,
      cause: null,
      resolution: "更换键盘模块后恢复", // 同样只在 S2
      result: "MIXED",
      category: null,
      differences: "S1 结果为已完成，S2 结果为未完成。",
      merge_reason: "知识库中暂无相同来源",
      evidences: [
        { source: "S2", field: "fault", quote: "W 键仍失灵" },
        { source: "S2", field: "resolution", quote: "更换键盘模块后恢复" },
      ],
    }),
    contextFor(),
  );
  assert.equal(parsed.action, "new");
  assert.equal(parsed.targetCaseId, null);
  assert.equal(parsed.content.result, "COMPLETED", "未选中候选的 NOT_COMPLETED 不得参与结果推导");
  assert.equal(parsed.content.fault, null, "引文只来自未选中候选时字段必须置为未提供");
  assert.equal(parsed.content.resolution, null);
  assert.equal(parsed.content.differences, null, "单一来源的差异说明必然引用未参与资料，必须清空");
  assert.equal(parsed.evidenceByLabel.get("S2"), undefined, "未选中候选的引文不得保留");
  assert.ok(parsed.notes.some((note) => note.includes("未选中候选")), "应如实记录被忽略的越界引文");
});

test("解析：merge 选中 C1 时，C2 的证据与结果不参与（审查 P1-1 回归）", () => {
  const materialC = materialOf({
    deviceModel: "ThinkPad E14",
    category: { name: "硬件维修" },
    content: "键盘进水后开不了机，烘干主板后恢复。",
    result: "COMPLETED",
    remark: null,
  });
  const context = {
    sourceTexts: new Map([
      ["S1", materialTextOf(materialOf(RECORD_B))], // 待合并的新来源：COMPLETED
      ["S2", materialTextOf(materialOf(RECORD_A))], // C1 的来源：COMPLETED
      ["S3", materialTextOf(materialC)], // C2 的来源：NOT_COMPLETED
    ]),
    sourceResults: new Map<string, string | null>([
      ["S1", "COMPLETED"],
      ["S2", "COMPLETED"],
      ["S3", "NOT_COMPLETED"],
    ]),
    candidates: new Map([
      ["C1", "case-1"],
      ["C2", "case-2"],
    ]),
    candidateSourceLabels: new Map([
      ["C1", ["S2"]],
      ["C2", ["S3"]],
    ]),
  };
  const parsed = parseCaseModelOutput(
    JSON.stringify({
      action: "merge",
      target: "C1",
      title: "ThinkPad E14 键盘进水处理",
      device_model: "ThinkPad E14",
      fault: "键盘失灵",
      investigation: null,
      cause: null,
      resolution: "更换键盘模块",
      result: "COMPLETED",
      category: null,
      differences: null,
      merge_reason: "与 C1 同类故障",
      evidences: [
        { source: "S1", field: "resolution", quote: "更换键盘模块后恢复" },
        { source: "S3", field: "fault", quote: "烘干主板后恢复" }, // C2（未选中）的引文
      ],
    }),
    context,
  );
  assert.equal(parsed.content.result, "COMPLETED", "未选中的 C2（NOT_COMPLETED）不得把结果改成 MIXED");
  assert.equal(parsed.evidenceByLabel.get("S1")?.length, 1);
  assert.equal(parsed.evidenceByLabel.get("S3"), undefined, "C2 的引文必须被拒绝");
  assert.ok(parsed.notes.some((note) => note.includes("未选中候选")));
});

test("解析：无法定位的引文被丢弃，字段无证据时降级为未提供（宁缺毋造）", () => {
  const parsed = parseCaseModelOutput(
    JSON.stringify({
      action: "new",
      title: "键盘问题",
      device_model: null,
      fault: "键盘失灵",
      investigation: "更换了主板芯片", // 引文无法定位 → investigation 应被清空
      cause: null,
      resolution: null,
      result: "UNKNOWN",
      category: null,
      differences: null,
      evidences: [
        { source: "S1", field: "fault", quote: "键盘进水后部分按键失灵" },
        { source: "S1", field: "investigation", quote: "更换了主板芯片" },
        { source: "S9", field: "cause", quote: "随便" },
      ],
    }),
    contextFor(),
  );
  assert.equal(parsed.content.fault, "键盘失灵");
  assert.equal(parsed.content.investigation, null, "引文无法定位时字段必须清空");
  assert.ok(parsed.notes.some((note) => note.includes("无法定位")));
  assert.ok(parsed.notes.some((note) => note.includes("缺少可定位引文")));
});

test("解析：非法动作/目标/坏 JSON 都是坏响应", () => {
  const context = contextFor();
  assert.throws(
    () => parseCaseModelOutput("这不是 JSON", context),
    (error: unknown) => error instanceof ChatModelError && error.kind === "bad_response",
  );
  assert.throws(
    () => parseCaseModelOutput(JSON.stringify({ action: "archive", title: "x" }), context),
    /未知 action/,
  );
  assert.throws(
    () =>
      parseCaseModelOutput(
        JSON.stringify({ action: "merge", target: "C9", title: "x", evidences: [] }),
        context,
      ),
    /非法目标/,
    "合并目标必须在候选白名单内",
  );
  assert.throws(
    () => parseCaseModelOutput(JSON.stringify({ action: "new", target: null, evidences: [] }), context),
    /标题/,
    "缺少标题且没有可回退的故障字段时必须失败",
  );
});

test("解析：无候选时忽略模型误给的 target；重整模式不校验动作", () => {
  const noCandidates = {
    sourceTexts: new Map([["S1", materialTextOf(materialOf(RECORD_A))]]),
    sourceResults: new Map<string, string | null>([["S1", "COMPLETED"]]),
    candidates: new Map<string, string>(),
  };
  const parsed = parseCaseModelOutput(
    JSON.stringify({
      action: "new",
      target: "C1",
      title: "单来源案例",
      fault: "键盘失灵",
      evidences: [{ source: "S1", field: "fault", quote: "键盘进水后部分按键失灵" }],
    }),
    noCandidates,
  );
  assert.equal(parsed.action, "new");
  assert.equal(parsed.targetCaseId, null);
  assert.ok(parsed.notes.some((note) => note.includes("忽略")));

  const regenerate = parseCaseModelOutput(
    JSON.stringify({
      action: "merge",
      target: "C7",
      title: "重整案例",
      fault: "键盘失灵",
      evidences: [{ source: "S1", field: "fault", quote: "键盘进水后部分按键失灵" }],
    }),
    noCandidates,
    { requireDecision: false },
  );
  assert.equal(regenerate.action, "new");
  assert.equal(regenerate.targetCaseId, null);
});

test("重整提示词：全部来源以 S1 起编号渲染，不要求判断合并对象", () => {
  const messages = buildRegenerateMessages([
    { label: "S1", material: materialOf(RECORD_A), repairDate: null },
    { label: "S2", material: materialOf(RECORD_B), repairDate: null },
  ]);
  const user = messages[1].content;
  assert.match(user, /重新整理为一张合并后的案例卡/);
  assert.match(user, /\[S1\]/);
  assert.match(user, /\[S2\]/);
});
