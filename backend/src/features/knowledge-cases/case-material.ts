import { createHash } from "node:crypto";

import type { CaseResult, CaseStructuredContent } from "./case-types";

/**
 * 备案「实质内容」的归一化与哈希（纯函数）。
 *
 * 稳定性的关键：只取参与整理的文字字段，不含 `version`、时间戳、照片等
 * ——标记操作引起的 version 自增不得被误判为正文变化（否则会无限重整）。
 * 归一化（空白折叠 + 全角冒号统一）保证「同一内容的不同排版」哈希一致。
 */

export type RepairMaterial = {
  deviceModel: string | null;
  categoryName: string | null;
  content: string | null;
  result: string | null;
  remark: string | null;
};

/** 折叠空白、去首尾、空串归 null；不改变可比较的文字内容。 */
export function normalizeText(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  let collapsed = input.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  // CJK 字符/标点相邻的空白是排版差异，不影响实质内容（同一记录的中文排版变化
  // 不应产生不同哈希而触发无限重整；引文定位也用同一归一化口径）。
  collapsed = collapsed.replace(
    /([\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]) | ([\u3000-\u303f\u4e00-\u9fff\uff00-\uffef])/g,
    (_match, before: string | undefined, after: string | undefined) => before ?? after ?? "",
  );
  return collapsed;
}

export function materialOf(record: {
  deviceModel: string | null;
  category: { name: string } | null;
  content: string | null;
  result: string | null;
  remark: string | null;
}): RepairMaterial {
  return {
    deviceModel: normalizeText(record.deviceModel),
    categoryName: normalizeText(record.category?.name ?? null),
    content: normalizeText(record.content),
    result: normalizeText(record.result),
    remark: normalizeText(record.remark),
  };
}

/** 备案实质内容哈希：字段缺失（null）与空串归一后同义。 */
export function materialHashOf(material: RepairMaterial): string {
  const hash = createHash("sha256");
  for (const value of [
    material.deviceModel,
    material.categoryName,
    material.content,
    material.result,
    material.remark,
  ]) {
    hash.update("\u0000").update(value ?? "\u0001");
  }
  return hash.digest("hex");
}

/** 材料文本渲染（模型输入与引文定位共用；引文必须能在这段文本里找到子串）。 */
export function materialTextOf(material: RepairMaterial): string {
  const lines: string[] = [];
  lines.push(`机型：${material.deviceModel ?? "未提供"}`);
  lines.push(`分类：${material.categoryName ?? "未提供"}`);
  lines.push(`维修正文：${material.content ?? "未提供"}`);
  lines.push(`维修结果：${material.result ?? "未提供"}`);
  lines.push(`备注：${material.remark ?? "未提供"}`);
  return lines.join("\n");
}

/** 引文校验：归一化后必须是材料文本的子串（模型不得凭空编造证据）。 */
export function quoteInMaterial(materialText: string, quote: string): boolean {
  const normalizedQuote = normalizeText(quote);
  if (!normalizedQuote) return false;
  return normalizeText(materialText)?.includes(normalizedQuote) ?? false;
}

/** 案例正文文本哈希（displayText）：判断未变内容以复用向量缓存。 */
export function caseContentHashOf(displayText: string): string {
  return createHash("sha256").update(displayText, "utf8").digest("hex");
}

const RESULT_LABELS: Record<CaseResult, string> = {
  COMPLETED: "已完成",
  NOT_COMPLETED: "未完成",
  MIXED: "混合（多来源结果不一致，见差异说明）",
  UNKNOWN: "未知（来源未写明）",
};

/**
 * 由来源结果集合强制推导案例结果：模型无权把混合结果抹平成单一结论。
 * 全部 COMPLETED → COMPLETED；全部 NOT_COMPLETED → NOT_COMPLETED；
 * 两者都有 → MIXED；其余（null/未知/无来源）→ UNKNOWN。
 */
export function deriveResult(sourceResults: Array<string | null>): CaseResult {
  const known = sourceResults.filter((result) => result === "COMPLETED" || result === "NOT_COMPLETED");
  if (known.length === 0) return "UNKNOWN";
  const completed = known.filter((result) => result === "COMPLETED").length;
  if (completed === known.length) return "COMPLETED";
  if (completed === 0) return "NOT_COMPLETED";
  return "MIXED";
}

/** 结构化正文的确定性渲染（检索正文与展示正文共用；模型不直接写这段文字）。 */
export function renderCaseDisplayText(content: CaseStructuredContent): string {
  const lines: string[] = [content.title];
  const fields: Array<[string, string | null]> = [
    ["适用机型", content.deviceModel],
    ["故障现象", content.fault],
    ["排查过程", content.investigation],
    ["原因", content.cause],
    ["处置", content.resolution],
  ];
  for (const [label, value] of fields) {
    if (value) lines.push(`${label}：${value}`);
  }
  lines.push(`维修结果：${RESULT_LABELS[content.result]}`);
  if (content.category) lines.push(`分类：${content.category}`);
  if (content.differences) lines.push(`多来源差异：${content.differences}`);
  if (content.unknowns.length > 0) lines.push(`原文未提供：${content.unknowns.join("、")}`);
  return lines.join("\n");
}

/** 服务端按 null 字段生成「原文未提供」清单：未知保持未知，不推断。 */
export function unknownsOf(content: Omit<CaseStructuredContent, "unknowns" | "differences" | "mergeReason">): string[] {
  const unknowns: string[] = [];
  if (!content.deviceModel) unknowns.push("机型");
  if (!content.fault) unknowns.push("故障现象");
  if (!content.investigation) unknowns.push("排查过程");
  if (!content.cause) unknowns.push("原因");
  if (!content.resolution) unknowns.push("处置");
  if (!content.category) unknowns.push("分类");
  return unknowns;
}
