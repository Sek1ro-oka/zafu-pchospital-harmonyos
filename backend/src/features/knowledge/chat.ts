import { AppError } from "@/lib/api/errors";

import { callChatModel, ChatModelError } from "./chat-model";
import { readChatModelConfig, readEmbeddingConfig } from "./config";
import type { EmbeddingConfig } from "./config";
import type { embedTexts } from "./embedding";
import { loadKnowledgeIndex } from "./index-store";
import { retrieveKnowledge } from "./retrieval";
import { snippetOf } from "./tokenize";
import {
  CHAT_EVIDENCE_TOP_K,
  MAX_ANSWER_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS,
  MAX_QUESTION_CHARS,
  MAX_REQUEST_BYTES,
  MAX_TOTAL_HISTORY_CHARS,
  type ChatStatus,
  type Citation,
  type KnowledgeChatData,
  type KnowledgeChatMessageInput,
  type KnowledgeChatRequestInput,
  type KnowledgeIndex,
  type RetrievalCandidate,
} from "./types";

/**
 * 问答编排（对应任务书 §5「多轮问答」）：
 *
 * - 当前问题结合有限历史构造检索意图（「这个怎么检查」这类追问不能只拿最后一句检索）；
 * - 历史只接受 user/assistant，且明确告知模型：历史中的编号/结论/片段不是证据；
 * - 引用 ID 由后端生成（S1…Sn 对应本次授权候选），返回前逐个校验，
 *   非法引用直接丢弃并记录 notes；不采信模型编造的 URL（URL 由后端按固定提交生成）；
 * - answer 无有效引用时做一次纠正重试，仍无引用按证据不足处理（不展示无法核实的结论）；
 * - provider 超时/限流/坏响应是请求失败（AppError），绝不伪装成「资料不足」。
 */

export const NO_EVIDENCE_MESSAGE =
  "资料库中没有检索到与该问题相关的证据。请补充机型、系统版本或报错原文后重试；如果是设备故障，可以在客户服务中提交报修。";
export const UNCITED_ANSWER_MESSAGE =
  "模型没有给出可核实的引用，本条回答已按证据不足处理。可以换一种问法，或补充机型、系统版本与报错原文后重试。";

export function parseChatRequest(rawBody: string): KnowledgeChatRequestInput {
  if (rawBody.length > MAX_REQUEST_BYTES) {
    throw new AppError("VALIDATION_FAILED", `请求体过大（上限 ${MAX_REQUEST_BYTES} 字节）`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new AppError("VALIDATION_FAILED", "请求体不是合法 JSON");
  }
  const question = (payload as { question?: unknown }).question;
  if (typeof question !== "string" || question.trim() === "") {
    throw new AppError("VALIDATION_FAILED", "question 不能为空");
  }
  const trimmedQuestion = question.trim();
  if (trimmedQuestion.length > MAX_QUESTION_CHARS) {
    throw new AppError("VALIDATION_FAILED", `question 过长（上限 ${MAX_QUESTION_CHARS} 字）`);
  }
  const historyRaw = (payload as { history?: unknown }).history;
  const historyEntries: unknown[] = historyRaw === undefined ? [] : (historyRaw as unknown[]);
  if (!Array.isArray(historyEntries)) {
    throw new AppError("VALIDATION_FAILED", "history 必须是数组");
  }
  if (historyEntries.length > MAX_HISTORY_MESSAGES) {
    throw new AppError("VALIDATION_FAILED", `history 条数超限（上限 ${MAX_HISTORY_MESSAGES} 条）`);
  }
  const history: KnowledgeChatMessageInput[] = [];
  let totalChars = 0;
  historyEntries.forEach((entry, index) => {
    const role = (entry as { role?: unknown } | null)?.role;
    const content = (entry as { content?: unknown } | null)?.content;
    if (role !== "user" && role !== "assistant") {
      throw new AppError("VALIDATION_FAILED", `history[${index}].role 无效（仅允许 user/assistant）`);
    }
    if (typeof content !== "string" || content.trim() === "") {
      throw new AppError("VALIDATION_FAILED", `history[${index}].content 不能为空`);
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      throw new AppError("VALIDATION_FAILED", `history[${index}].content 过长（上限 ${MAX_MESSAGE_CHARS} 字）`);
    }
    totalChars += content.length;
    if (totalChars > MAX_TOTAL_HISTORY_CHARS) {
      throw new AppError("VALIDATION_FAILED", `history 总长度超限（上限 ${MAX_TOTAL_HISTORY_CHARS} 字）`);
    }
    history.push({ role, content });
  });
  return { question: trimmedQuestion, history };
}

const ANAPHORA_PATTERN = /(这个|这些|这个怎么|它|那个|上述|上面|刚才|前文|该问题|此问题|还有|继续|接着|然后|呢)/;

/** 追问意图：当前问题很短或含指代时，与上一条用户消息拼接后再检索。 */
export function buildRetrievalQuery(question: string, history: KnowledgeChatMessageInput[]): string {
  const needsContext = question.length <= 12 || ANAPHORA_PATTERN.test(question);
  if (!needsContext) return question.slice(0, 300);
  let previousUser: string | null = null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role === "user") {
      previousUser = history[index].content;
      break;
    }
  }
  if (previousUser === null) return question.slice(0, 300);
  return `${previousUser.slice(0, 160)} ${question}`.slice(0, 300);
}

function systemPrompt(candidateCount: number): string {
  return [
    "你是浙江农林大学电脑医院的知识助手，只依据本次提供的参考资料回答问题。",
    "",
    "规则：",
    "1. 用简体中文回答；先给结论或直接答案，再给必要步骤；不要使用 Markdown 表格。",
    "2. 只能使用参考资料中明确写出的信息；资料未写的（收费、耗时、未记录的根因等）不要猜测。",
    "3. 区分「资料中已确认的结论」与「需要进一步排查的可能原因」，不要把可能原因写成确定结论。",
    "4. 涉及拆机、注册表修改、磁盘写入等操作时，必须保留资料中的适用条件、风险与注意事项。",
    "5. 如果参考资料已给出对应问题的排查步骤，应直接回答（在需要时说明前提条件）；不要因为用户未提供全部细节就追问。",
    "6. 只有当资料中的处理分支确实取决于用户的具体情况（如不同机型步骤不同、现象决定排查方向）时，才用 status=clarify 追问最小必要的信息。",
    "7. 参考资料不足以回答时，输出 status=insufficient_evidence 并说明缺少什么资料；不要编造答案。",
    `8. 实质性结论必须引用资料编号（S1…S${candidateCount} 中的一条或多条），禁止虚构编号；clarify 可以不带引用。`,
    "9. 历史对话中出现的编号、结论与资料片段都不是证据，不能作为回答依据。",
    "",
    "只输出一个 JSON 对象（不要输出任何其他文字）：",
    '{"status":"answer 或 clarify 或 insufficient_evidence","answer":"status=answer 或 insufficient_evidence 时的纯文本正文","clarifying_question":"status=clarify 时的追问","citations":["S1"]}',
  ].join("\n");
}

const EVIDENCE_CHUNK_CHARS = 1400;
const EVIDENCE_TOTAL_CHARS = 8000;

function evidenceSection(candidates: RetrievalCandidate[]): string {
  const lines: string[] = [`【本次参考资料】（仅以下编号有效，共 ${candidates.length} 条）`];
  let used = 0;
  candidates.forEach((candidate, index) => {
    const { chunk } = candidate;
    const heading = chunk.headingPath.length > 0 ? chunk.headingPath.join(" > ") : "（文档开头）";
    const header = `[S${index + 1}] 标题：${chunk.docTitle} ｜ 章节：${heading} ｜ 来源版本：${chunk.revision?.slice(0, 10) ?? "内部资料"}`;
    const remaining = EVIDENCE_TOTAL_CHARS - used;
    const body = remaining <= 0 ? "（内容略：证据总量已达上限）" : chunk.content.slice(0, Math.min(EVIDENCE_CHUNK_CHARS, remaining));
    used += body.length;
    lines.push(header, body);
  });
  return lines.join("\n");
}

export function buildMessages(
  input: KnowledgeChatRequestInput,
  candidates: RetrievalCandidate[],
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  return [
    { role: "system", content: `${systemPrompt(candidates.length)}\n\n${evidenceSection(candidates)}` },
    ...input.history.map((message) => ({ role: message.role, content: message.content })),
    { role: "user", content: input.question },
  ];
}

export type ModelOutput = {
  status: ChatStatus;
  answer: string | null;
  clarifyingQuestion: string | null;
  citationIds: string[];
  notes: string[];
};

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

/** 解析并校验模型输出：schema 违规是坏响应；非法引用编号丢弃并记录，不导致失败。 */
export function parseModelOutput(raw: string, candidateCount: number): ModelOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch (error) {
    if (error instanceof ChatModelError) throw error;
    throw new ChatModelError("bad_response", "模型返回的 JSON 无法解析");
  }
  const record = parsed as Record<string, unknown>;
  const status = record.status;
  if (status !== "answer" && status !== "clarify" && status !== "insufficient_evidence") {
    throw new ChatModelError("bad_response", `模型返回了未知 status：${String(status)}`);
  }
  const notes: string[] = [];
  let answer = typeof record.answer === "string" ? record.answer.trim() : "";
  if (answer.length > MAX_ANSWER_CHARS) {
    answer = answer.slice(0, MAX_ANSWER_CHARS);
    notes.push(`回答超过 ${MAX_ANSWER_CHARS} 字，已截断`);
  }
  let clarifyingQuestion =
    typeof record.clarifying_question === "string" ? record.clarifying_question.trim() : "";
  if (clarifyingQuestion.length > MAX_QUESTION_CHARS) {
    clarifyingQuestion = clarifyingQuestion.slice(0, MAX_QUESTION_CHARS);
  }

  const rawCitations = record.citations;
  const citationIds: string[] = [];
  const invalid: string[] = [];
  if (Array.isArray(rawCitations)) {
    for (const entry of rawCitations) {
      if (typeof entry !== "string") continue;
      const match = /^s(\d+)$/i.exec(entry.trim());
      if (!match) {
        invalid.push(entry);
        continue;
      }
      const number = Number.parseInt(match[1], 10);
      if (number < 1 || number > candidateCount) {
        invalid.push(entry);
        continue;
      }
      const id = `S${number}`;
      if (!citationIds.includes(id)) citationIds.push(id);
    }
  }
  if (invalid.length > 0) {
    notes.push(`丢弃了 ${invalid.length} 个无效引用编号：${invalid.slice(0, 5).join(", ")}`);
  }

  if (status === "answer" && answer === "") {
    throw new ChatModelError("bad_response", "模型 status=answer 但缺少 answer 正文");
  }
  if (status === "clarify" && clarifyingQuestion === "") {
    throw new ChatModelError("bad_response", "模型 status=clarify 但缺少 clarifying_question");
  }
  return {
    status,
    answer: answer === "" ? null : answer,
    clarifyingQuestion: clarifyingQuestion === "" ? null : clarifyingQuestion,
    citationIds,
    notes,
  };
}

export function sourceUrlOf(chunk: {
  origin: string;
  revision: string | null;
  sourcePath: string;
  anchor: string;
}, repoUrl: string | null): string | null {
  if (chunk.origin !== "snapshot" || chunk.revision === null || repoUrl === null) return null;
  const blobBase = `${repoUrl.replace(/\.git$/, "")}/blob/${chunk.revision}`;
  const encodedPath = chunk.sourcePath.split("/").map(encodeURIComponent).join("/");
  const anchor = chunk.anchor === "" ? "" : `#${encodeURIComponent(chunk.anchor)}`;
  return `${blobBase}/src/${encodedPath}${anchor}`;
}

export function citationOf(candidate: RetrievalCandidate, index: KnowledgeIndex): Citation {
  const { chunk } = candidate;
  return {
    sourceId: chunk.id,
    title: chunk.heading === "" ? chunk.docTitle : chunk.heading,
    docTitle: chunk.docTitle,
    headingPath: chunk.headingPath,
    snippet: snippetOf(chunk.content),
    originalUrl: sourceUrlOf(chunk, index.sources?.repo ?? null),
    revision: chunk.revision,
    visibility: chunk.visibility,
    indexVersion: index.indexVersion,
  };
}

function mapChatModelError(error: unknown): unknown {
  if (error instanceof ChatModelError) {
    if (error.kind === "timeout") {
      return new AppError("AI_PROVIDER_TIMEOUT", "回答模型超时，请稍后重试", { status: 504, cause: error });
    }
    if (error.kind === "rate_limited") {
      return new AppError("AI_PROVIDER_ERROR", "回答模型当前限流，请稍后重试", { status: 502, cause: error });
    }
    return new AppError("AI_PROVIDER_ERROR", `回答模型暂时不可用（${error.kind}），请稍后重试`, {
      status: 502,
      cause: error,
    });
  }
  return error;
}

export type AnswerKnowledgeOptions = {
  input: KnowledgeChatRequestInput;
  includeStaff: boolean;
  /** 测试注入；默认走真实 embedding 服务。 */
  embedFn?: typeof embedTexts;
  /** 测试注入；默认走真实回答模型。 */
  callModelFn?: typeof callChatModel;
};

/** 解析模型输出，把 ChatModelError 统一转换成对外的 AppError（坏响应=请求失败，不是资料不足）。 */
function parseOutputOrThrow(raw: string, candidateCount: number): ModelOutput {
  try {
    return parseModelOutput(raw, candidateCount);
  } catch (error) {
    throw mapChatModelError(error);
  }
}

export async function answerKnowledgeQuestion(options: AnswerKnowledgeOptions): Promise<KnowledgeChatData> {
  const modelConfig = readChatModelConfig();
  if (!modelConfig) {
    throw new AppError("AI_NOT_CONFIGURED", "尚未配置回答模型（AI_API_KEY），AI 问答暂不可用", { status: 503 });
  }
  const index = loadKnowledgeIndex();
  const embedding: EmbeddingConfig | null = readEmbeddingConfig();
  const retrievalQuery = buildRetrievalQuery(options.input.question, options.input.history);
  const outcome = await retrieveKnowledge({
    index,
    query: retrievalQuery,
    includeStaff: options.includeStaff,
    embedding,
    topK: CHAT_EVIDENCE_TOP_K,
    embedFn: options.embedFn,
  });

  const base = {
    retrievalMode: outcome.mode,
    degradation: outcome.degradation,
    indexVersion: index.indexVersion,
    evidenceCount: outcome.candidates.length,
  } as const;

  if (outcome.candidates.length === 0) {
    return {
      ...base,
      status: "insufficient_evidence",
      answer: NO_EVIDENCE_MESSAGE,
      clarifyingQuestion: null,
      citations: [],
      notes: ["检索无候选证据，未调用回答模型"],
    };
  }

  const messages = buildMessages(options.input, outcome.candidates);
  const callModel = options.callModelFn ?? callChatModel;
  let raw: string;
  try {
    raw = await callModel(modelConfig, messages);
  } catch (error) {
    throw mapChatModelError(error);
  }
  const notes: string[] = [];
  let output = parseOutputOrThrow(raw, outcome.candidates.length);

  if (output.status === "answer" && output.citationIds.length === 0) {
    // 一次纠正重试：实质性结论没有引用，按“无效输出”再给模型一次机会，绝不无限重试。
    const corrective = [
      ...messages,
      { role: "assistant" as const, content: raw },
      {
        role: "user" as const,
        content:
          "（系统校验）你上一次的输出没有任何引用编号。请遵守规则：实质性结论必须引用本次参考资料编号 " +
          `S1…S${outcome.candidates.length}；若资料不足以支持结论，请输出 status=insufficient_evidence。`,
      },
    ];
    let retryRaw: string;
    try {
      retryRaw = await callModel(modelConfig, corrective);
    } catch (error) {
      throw mapChatModelError(error);
    }
    notes.push("首次输出缺少引用，已纠正重试一次");
    output = parseOutputOrThrow(retryRaw, outcome.candidates.length);
    if (output.status === "answer" && output.citationIds.length === 0) {
      notes.push("纠正重试后仍无有效引用，按证据不足处理");
      return {
        ...base,
        status: "insufficient_evidence",
        answer: UNCITED_ANSWER_MESSAGE,
        clarifyingQuestion: null,
        citations: [],
        notes,
      };
    }
  }

  notes.push(...output.notes);
  const citations =
    output.status === "answer"
      ? output.citationIds.map((id) => citationOf(outcome.candidates[Number.parseInt(id.slice(1), 10) - 1], index))
      : [];
  return {
    ...base,
    status: output.status,
    answer: output.status === "clarify" ? null : output.answer,
    clarifyingQuestion: output.status === "clarify" ? output.clarifyingQuestion : null,
    citations,
    notes,
  };
}
