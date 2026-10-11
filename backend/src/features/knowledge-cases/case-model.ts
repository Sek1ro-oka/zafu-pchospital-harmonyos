import { ChatModelError } from "@/features/knowledge/chat-model";

import {
  materialTextOf,
  quoteInMaterial,
  unknownsOf,
  deriveResult,
  type RepairMaterial,
} from "./case-material";
import type { CaseEvidence, CaseResult, CaseStructuredContent } from "./case-types";

/**
 * 案例整理的提示词与结构化输出校验（Issue #40 §4）。
 *
 * 关键口径：
 * - 模型输出必须逐个字段校验（类型、长度、来源编号、引文可定位），
 *   证据无法定位到来源的字段**降级为未提供**，绝不放行凭空补写的维修事实；
 * - 案例结果由服务端按来源结果强制推导（混合结果不得被抹平）；
 * - 模型不写数据库、不决定可见范围与权限（这些在服务层/事务内校验）。
 */

export const CASE_PROMPT_VERSION = "case-prompt@1";

/** 单个字段的长度上限（防御模型超长输出；超限截断并记录）。 */
const FIELD_LIMITS = {
  title: 120,
  deviceModel: 120,
  fault: 500,
  investigation: 1000,
  cause: 500,
  resolution: 1000,
  category: 80,
  differences: 800,
  mergeReason: 300,
  quote: 500,
} as const;

const CASE_FIELDS = ["deviceModel", "fault", "investigation", "cause", "resolution", "category"] as const;

export type CaseModelSourceInput = {
  /** 输入编号（S1…Sn，全局唯一，跨新来源与候选案例来源）。 */
  label: string;
  material: RepairMaterial;
  repairDate: string | null;
};

export type CaseModelCandidateInput = {
  /** 候选编号（C1…Cm）。 */
  label: string;
  caseId: string;
  title: string;
  visibility: string;
  sources: CaseModelSourceInput[];
};

export type CaseModelInput = {
  newSource: CaseModelSourceInput;
  candidates: CaseModelCandidateInput[];
};

function systemPrompt(): string {
  return [
    "你是浙江农林大学电脑医院的维修案例整理助手。根据「维修备案来源」整理一张结构化维修案例卡。",
    "",
    "硬性规则：",
    "1. 只使用来源中明确写出的信息。来源没有写出的原因、机型、排查步骤、结果一律保持 null，禁止推测、补写或从常识补充。",
    "2. 每个非空字段都必须给出「引文证据」：quote 必须逐字来自某个来源的原文（空白可有差异，字词不得改写）。找不到原文依据的字段请填 null。",
    "3. fault/investigation/cause/resolution 描述的是**维修过程的事实**，不能把客户报修时的故障描述说成已经完成的维修经过。",
    "4. result 由系统按来源结果推导，你仍按来源填写：全部已完成填 COMPLETED，全部未完成填 NOT_COMPLETED，其余填 UNKNOWN（如有混合请写入 differences，不要抹平）。",
    "",
    "判断新来源与候选案例的关系（action）：",
    "- merge：新来源与某候选是**同一台机器/同一类故障的同一维修记录系列**（机型或故障描述一致，且合并后能形成一份完整案例）；",
    "- new：机型相近但故障或处置不同、原因未知、结果相反——这些情况保持独立案例，不要强行合并；",
    "- 最多合并到一个候选；没有合适候选时 action=new、target=null。",
    "merge 时的正文必须基于**该候选的全部来源 + 新来源**重新整理，而不是只拼接旧摘要；不同来源的结果、条件、步骤不一致时，在 differences 中逐来源说明（如「S1 结果为已完成，S2 结果为未完成」），不得把不同记录的检查步骤串成一次维修经历。无差异时 differences=null。",
    "",
    "只输出一个 JSON 对象（不要输出任何其他文字）：",
    '{"action":"merge 或 new","target":"C1 或 null","merge_reason":"合并或新建的一句依据","title":"案例标题","device_model":null或字符串,"fault":null或字符串,"investigation":null或字符串,"cause":null或字符串,"resolution":null或字符串,"result":"COMPLETED 或 NOT_COMPLETED 或 UNKNOWN","category":null或字符串,"differences":null或字符串,"evidences":[{"source":"S1","field":"fault","quote":"原文片段"}]}',
  ].join("\n");
}

const SOURCE_BODY_CHARS = 1000;

function renderSource(source: CaseModelSourceInput): string {
  const header = `[${source.label}] 维修备案${source.repairDate ? `（${source.repairDate}）` : ""}`;
  const body = materialTextOf(source.material);
  return `${header}\n${body.slice(0, SOURCE_BODY_CHARS)}`;
}

export function renderCaseInput(input: CaseModelInput): string {
  const lines: string[] = ["【新来源】", "", renderSource(input.newSource), ""];
  if (input.candidates.length === 0) {
    lines.push("【候选案例】无（知识库中暂无相似案例，action 必须为 new）。");
    return lines.join("\n");
  }
  lines.push("【候选案例】（判断是否合并；merge 时 target 只能填其中一个 C 编号）");
  for (const candidate of input.candidates) {
    lines.push("");
    lines.push(`[${candidate.label}] 标题：${candidate.title} ｜ 可见范围：${candidate.visibility}`);
    for (const source of candidate.sources) {
      const body = materialTextOf(source.material);
      lines.push(`  [${source.label}] ${body.slice(0, SOURCE_BODY_CHARS)}`);
    }
  }
  return lines.join("\n");
}

export function buildCaseMessages(input: CaseModelInput): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: systemPrompt() },
    { role: "user", content: renderCaseInput(input) },
  ];
}

/**
 * 既有案例的重整提示词：全部来源都已是同一案例的组成部分，
 * 不涉及「判断合并」——要求直接输出覆盖全部来源的一张案例卡。
 */
export function buildRegenerateMessages(
  sources: CaseModelSourceInput[],
): Array<{ role: "system" | "user"; content: string }> {
  const lines: string[] = [
    "【本次任务】以下全部来源均已是同一维修案例的组成部分，请把它们**重新整理为一张合并后的案例卡**（正文必须覆盖全部来源的事实）。",
    "action 一律填 new、target 一律填 null（本次不需要判断合并对象）。",
    "",
  ];
  for (const source of sources) {
    lines.push(`[${source.label}] 维修备案${source.repairDate ? `（${source.repairDate}）` : ""}`);
    lines.push(materialTextOf(source.material).slice(0, SOURCE_BODY_CHARS));
    lines.push("");
  }
  return [
    { role: "system", content: systemPrompt() },
    { role: "user", content: lines.join("\n") },
  ];
}

function extractJsonObject(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new ChatModelError("bad_response", "模型返回内容不包含 JSON 对象");
  }
  return text.slice(start, end + 1);
}

function readString(record: Record<string, unknown>, key: string, limit?: number): string | null {
  const value = record[key];
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed === "") return null;
  return limit !== undefined && trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

export type ParsedCaseOutput = {
  action: "new" | "merge";
  /** 目标案例 ID（merge 时来自候选白名单；new 时为 null）。 */
  targetCaseId: string | null;
  content: CaseStructuredContent;
  /** 各来源（S 编号）各自可定位的引文；发布时按来源快照保存。 */
  evidenceByLabel: Map<string, CaseEvidence[]>;
  notes: string[];
};

export type CaseOutputContext = {
  /** 来源材料文本（归一化后）按编号索引：引文必须能在对应文本中定位。 */
  sourceTexts: Map<string, string>;
  /** 来源维修结果按编号索引：案例结果由服务端强制推导。 */
  sourceResults: Map<string, string | null>;
  /** 候选白名单：编号 → 案例 ID。 */
  candidates: Map<string, string>;
  /**
   * 新来源的编号（默认 S1）。决策模式下它才是 new 时唯一实际参与案例的来源：
   * 候选来源只用于「判断是否合并」，未选中候选的结果与证据不得进入本次案例。
   */
  newSourceLabel?: string;
  /** 候选编号（C1）→ 该候选渲染的来源编号集合：merge 时并入实际来源集合后再校验。 */
  candidateSourceLabels?: Map<string, string[]>;
};

export type ParseCaseOptions = {
  /** false 表示重整模式：不校验 action/target（来源已属于同一案例）。 */
  requireDecision?: boolean;
};

/**
 * 解析并校验模型输出。
 *
 * 服务端强制项（模型无权决定）：
 * - `target` 必须在候选白名单内，否则按坏响应处理（防止合并到未授权/不存在的案例）；
 * - `result` 按来源结果推导覆盖；
 * - 每个非空字段必须有可定位引文，否则清空为 null（宁缺毋造）；
 * - MIXED 结果必须带差异说明（缺失时服务端生成事实性说明）。
 */
export function parseCaseModelOutput(
  raw: string,
  context: CaseOutputContext,
  options: ParseCaseOptions = {},
): ParsedCaseOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch (error) {
    if (error instanceof ChatModelError) throw error;
    throw new ChatModelError("bad_response", "模型返回的 JSON 无法解析");
  }
  const record = parsed as Record<string, unknown>;
  const notes: string[] = [];

  const requireDecision = options.requireDecision !== false;
  const newSourceLabel = context.newSourceLabel ?? "S1";
  let targetCaseId: string | null = null;
  // 实际参与本次案例的来源集合：new = S1；merge = S1 + 选中候选的来源。
  // 未选中候选只用于「判断是否合并」，其来源不得作为事实依据（防止结果/证据污染）。
  const activeLabels = new Set<string>();
  if (requireDecision) {
    activeLabels.add(newSourceLabel);
    const action = record.action;
    if (action !== "new" && action !== "merge") {
      throw new ChatModelError("bad_response", `模型返回了未知 action：${String(action)}`);
    }
    if (action === "merge") {
      const target = readString(record, "target");
      if (!target || !context.candidates.has(target)) {
        throw new ChatModelError(
          "bad_response",
          `模型要求合并到非法目标：${String(record.target)}（候选白名单：${[...context.candidates.keys()].join(", ")}）`,
        );
      }
      targetCaseId = context.candidates.get(target) ?? null;
      for (const label of context.candidateSourceLabels?.get(target) ?? []) {
        activeLabels.add(label);
      }
    }
    if (
      action === "new" &&
      context.candidates.size === 0 &&
      record.target !== null &&
      record.target !== undefined
    ) {
      // 无候选时 target 必须为空；给出值但 action=new 仍按 new 处理（不采信 target）。
      notes.push("无候选时模型仍给出 target，已忽略");
    }
  } else {
    // 重整模式：全部来源都属于同一案例，全部参与。
    for (const label of context.sourceTexts.keys()) {
      activeLabels.add(label);
    }
  }

  // 引文校验：编号合法 + 属于本次实际来源集合 + 可定位到该来源材料文本。
  const validQuotes = new Map<string, CaseEvidence[]>();
  const rawEvidences = record.evidences;
  let droppedQuotes = 0;
  let outOfScopeQuotes = 0;
  if (Array.isArray(rawEvidences)) {
    for (const entry of rawEvidences) {
      const item = entry as Record<string, unknown>;
      const sourceLabel = readString(item, "source");
      const field = readString(item, "field");
      const quote = readString(item, "quote", FIELD_LIMITS.quote);
      if (!sourceLabel || !field || !quote) {
        droppedQuotes += 1;
        continue;
      }
      if (!activeLabels.has(sourceLabel)) {
        // 有效来源编号但未进入本次案例（未选中候选）：直接忽略并记录。
        outOfScopeQuotes += 1;
        continue;
      }
      const sourceText = context.sourceTexts.get(sourceLabel);
      if (!sourceText || !quoteInMaterial(sourceText, quote)) {
        droppedQuotes += 1;
        continue;
      }
      const list = validQuotes.get(sourceLabel) ?? [];
      list.push({ field, quote });
      validQuotes.set(sourceLabel, list);
    }
  }
  if (droppedQuotes > 0) {
    notes.push(`丢弃了 ${droppedQuotes} 条无法定位到来源原文的引文`);
  }
  if (outOfScopeQuotes > 0) {
    notes.push(`忽略了 ${outOfScopeQuotes} 条来自未选中候选的引文（未参与本次案例）`);
  }

  const fieldHasEvidence = new Map<string, boolean>();
  for (const quotes of validQuotes.values()) {
    for (const quote of quotes) fieldHasEvidence.set(quote.field, true);
  }

  const fields: Record<(typeof CASE_FIELDS)[number], string | null> = {
    deviceModel: readString(record, "device_model", FIELD_LIMITS.deviceModel),
    fault: readString(record, "fault", FIELD_LIMITS.fault),
    investigation: readString(record, "investigation", FIELD_LIMITS.investigation),
    cause: readString(record, "cause", FIELD_LIMITS.cause),
    resolution: readString(record, "resolution", FIELD_LIMITS.resolution),
    category: readString(record, "category", FIELD_LIMITS.category),
  };
  const evidenceFieldNames: Record<(typeof CASE_FIELDS)[number], string> = {
    deviceModel: "device_model",
    fault: "fault",
    investigation: "investigation",
    cause: "cause",
    resolution: "resolution",
    category: "category",
  };
  // 机型/分类属于来源直接列出的结构化字段：允许两种证据形态 ——
  // ① 显式引文；② 取值本身能在某个来源材料文本中定位（同样不允许凭空补写）。
  // 只在本次实际来源集合内取证：未选中候选的机型/分类不得被采用。
  const allSourceText = [...activeLabels]
    .map((label) => context.sourceTexts.get(label) ?? "")
    .map((text) => text.replace(/\s+/g, " "))
    .join(" ");
  const metadataAllowed = (value: string | null): boolean =>
    value !== null && (allSourceText.includes(value) || quoteInMaterial(allSourceText, value));
  let withoutEvidence = 0;
  for (const field of CASE_FIELDS) {
    if (fields[field] === null) continue;
    const hasQuote = fieldHasEvidence.get(evidenceFieldNames[field]) === true;
    if (field === "deviceModel" || field === "category") {
      if (!hasQuote && !metadataAllowed(fields[field])) {
        fields[field] = null;
        withoutEvidence += 1;
      }
      continue;
    }
    if (!hasQuote) {
      fields[field] = null;
      withoutEvidence += 1;
    }
  }
  if (withoutEvidence > 0) {
    notes.push(`${withoutEvidence} 个字段因缺少可定位引文被置为未提供`);
  }

  const title = readString(record, "title", FIELD_LIMITS.title) ?? fields.fault?.slice(0, FIELD_LIMITS.title) ?? null;
  if (!title) {
    throw new ChatModelError("bad_response", "模型未给出可用的案例标题");
  }

  // 结果只按实际参与本次案例的来源推导：未选中候选的结果不参与（不得把案例改成 MIXED/COMPLETED）。
  const activeResultEntries = [...activeLabels]
    .filter((label) => context.sourceResults.has(label))
    .map((label) => [label, context.sourceResults.get(label) ?? null] as const);
  const result: CaseResult = deriveResult(activeResultEntries.map(([, value]) => value));
  let differences = readString(record, "differences", FIELD_LIMITS.differences);
  if (activeLabels.size <= 1) {
    // 单一来源没有「来源间差异」可言：此刻的差异说明必然引用了未参与本次案例的资料。
    differences = null;
  }
  if (result === "MIXED" && !differences) {
    const perSource = activeResultEntries
      .map(([label, value]) => `${label} 结果为${value === "COMPLETED" ? "已完成" : value === "NOT_COMPLETED" ? "未完成" : "未知"}`)
      .join("；");
    differences = `来源间维修结果不一致：${perSource}。`;
    notes.push("模型未说明混合结果差异，已由服务端补事实性说明");
  }

  const content: CaseStructuredContent = {
    title,
    deviceModel: fields.deviceModel,
    fault: fields.fault,
    investigation: fields.investigation,
    cause: fields.cause,
    resolution: fields.resolution,
    result,
    category: fields.category,
    differences,
    unknowns: unknownsOf({
      title,
      deviceModel: fields.deviceModel,
      fault: fields.fault,
      investigation: fields.investigation,
      cause: fields.cause,
      resolution: fields.resolution,
      result,
      category: fields.category,
    }),
    mergeReason: readString(record, "merge_reason", FIELD_LIMITS.mergeReason),
  };

  return { action: targetCaseId ? "merge" : "new", targetCaseId, content, evidenceByLabel: validQuotes, notes };
}
