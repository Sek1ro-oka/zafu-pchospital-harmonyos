import assert from "node:assert/strict";
import test from "node:test";

import {
  caseContentHashOf,
  deriveResult,
  materialHashOf,
  materialOf,
  materialTextOf,
  normalizeText,
  quoteInMaterial,
  renderCaseDisplayText,
  unknownsOf,
} from "../../src/features/knowledge-cases/case-material";
import { caseChunkId, parseCaseChunkId } from "../../src/features/knowledge-cases/case-types";

/**
 * 案例材料归一化/哈希/渲染（Issue #40 §4）：哈希只由实质内容决定，
 * 与 version、时间戳、空白排版无关；引文必须能定位到来源材料文本。
 */

const RECORD = {
  deviceModel: "ThinkPad E14",
  category: { name: "硬件维修" },
  content: "键盘进水后部分按键失灵，拆机清理排线后恢复正常。",
  result: "COMPLETED",
  remark: "提醒客户避免在电脑旁放置液体。",
};

test("材料哈希：忽略排版空白与字段顺序噪音，只由实质内容决定", () => {
  const base = materialOf(RECORD);
  const messy = materialOf({
    ...RECORD,
    content: "  键盘进水后部分按键失灵，\n拆机清理排线后恢复正常。 ",
  });
  const changed = materialOf({ ...RECORD, content: "键盘进水后部分按键失灵，直接更换键盘模块。" });
  const differentResult = materialOf({ ...RECORD, result: "NOT_COMPLETED" });
  assert.equal(materialHashOf(base), materialHashOf(messy));
  assert.notEqual(materialHashOf(base), materialHashOf(changed));
  assert.notEqual(materialHashOf(base), materialHashOf(differentResult));
  // 未提供的备注与空串等价：都视为 null，不因序列化差异产生不同哈希。
  assert.equal(materialHashOf(materialOf({ ...RECORD, remark: null })), materialHashOf(materialOf({ ...RECORD, remark: "   " })));
});

test("材料文本与引文定位：归一化后可定位，改写/编造的引文被拒绝", () => {
  const material = materialOf(RECORD);
  const text = materialTextOf(material);
  assert.equal(quoteInMaterial(text, "键盘进水后部分按键失灵"), true);
  assert.equal(quoteInMaterial(text, "键盘进水后 部分按键失灵"), true, "空白差异可定位");
  assert.equal(quoteInMaterial(text, "更换了主板"), false, "编造的引文必须被拒绝");
  assert.equal(quoteInMaterial(text, ""), false);
  assert.equal(normalizeText("  a   b\n c "), "a b c");
});

test("案例正文哈希：正文不变哈希稳定，变化后哈希不同", () => {
  const a = caseContentHashOf("标题\n故障现象：无法开机");
  const b = caseContentHashOf("标题\n故障现象：无法开机");
  const c = caseContentHashOf("标题\n故障现象：无法开机。");
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("结果推导：全部相同取原值，混合显式 MIXED，无来源结果保持未知", () => {
  assert.equal(deriveResult(["COMPLETED", "COMPLETED"]), "COMPLETED");
  assert.equal(deriveResult(["NOT_COMPLETED"]), "NOT_COMPLETED");
  assert.equal(deriveResult(["COMPLETED", "NOT_COMPLETED"]), "MIXED", "结果相反不得被抹平");
  assert.equal(deriveResult([null, "COMPLETED"]), "COMPLETED");
  assert.equal(deriveResult([null]), "UNKNOWN");
  assert.equal(deriveResult([]), "UNKNOWN");
});

test("确定性渲染：包含差异说明与未知清单，缺失字段不伪造", () => {
  const text = renderCaseDisplayText({
    title: "键盘进水处理",
    deviceModel: null,
    fault: "部分按键失灵",
    investigation: null,
    cause: null,
    resolution: "拆机清理排线",
    result: "MIXED",
    category: "硬件维修",
    differences: "S1 结果为已完成，S2 结果为未完成。",
    unknowns: ["机型", "排查过程", "原因"],
    mergeReason: null,
  });
  assert.match(text, /键盘进水处理/);
  assert.match(text, /故障现象：部分按键失灵/);
  assert.match(text, /维修结果：混合/);
  assert.match(text, /多来源差异：S1 结果为已完成/);
  assert.match(text, /原文未提供：机型、排查过程、原因/);
  assert.ok(!text.includes("原因："), "未知原因不得渲染成有值字段");
});

test("unknownsOf：按 null 字段生成未提供清单", () => {
  assert.deepEqual(
    unknownsOf({
      title: "t",
      deviceModel: null,
      fault: "f",
      investigation: null,
      cause: null,
      resolution: "r",
      result: "UNKNOWN",
      category: null,
    }),
    ["机型", "排查过程", "原因", "分类"],
  );
});

test("案例块 ID：与内容版本绑定，可解析；其他 ID 不被识别为案例块", () => {
  const caseId = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";
  const id = caseChunkId(caseId, 3);
  assert.equal(id, `kcase_${caseId}_v3`);
  assert.deepEqual(parseCaseChunkId(id), { caseId, contentVersion: 3 });
  assert.equal(parseCaseChunkId("kch_abc123"), null);
  assert.equal(parseCaseChunkId(`kcase_${caseId}`), null);
});
