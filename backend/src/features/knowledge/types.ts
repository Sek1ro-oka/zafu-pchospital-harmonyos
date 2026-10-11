/**
 * 知识检索与问答的共享类型（Issue #39；案例块扩展为 Issue #40）。
 *
 * 这份文件同时是**客户端契约的来源**：`app/entry/src/main/ets/features/knowledge/KnowledgeContract.ts`
 * 与此处字段一一对应，改动时两边同步（见 backend/docs/knowledge-ai.md 与 knowledge-cases-api.md）。
 */

import type { CaseEvidence, CaseStatus, CaseVisibility } from "@/features/knowledge-cases/case-types";

export const CHUNKER_VERSION = "chunker@1";
export const INDEX_FORMAT_VERSION = 1;

/** 请求体与历史的上限（契约的一部分，客户端与文档同步这些默认值）。 */
export const MAX_REQUEST_BYTES = 32 * 1024;
export const MAX_HISTORY_MESSAGES = 8;
export const MAX_MESSAGE_CHARS = 2000;
export const MAX_TOTAL_HISTORY_CHARS = 8000;
export const MAX_QUESTION_CHARS = 1000;
export const MAX_SEARCH_QUERY_CHARS = 500;
export const MAX_ANSWER_CHARS = 6000;
export const SEARCH_TOP_K_DEFAULT = 5;
export const SEARCH_TOP_K_MAX = 10;
export const CHAT_EVIDENCE_TOP_K = 6;
/** AI 请求客户端读取超时（毫秒）：后端一次问答总预算默认 50s（AI_TOTAL_BUDGET_MS），客户端留出余量。 */
export const CLIENT_CHAT_READ_TIMEOUT_MS = 60000;

/** 资料可见范围：PUBLIC 所有登录账号；STAFF 仅工作人员（MEMBER/ADMIN）。 */
export const KNOWLEDGE_VISIBILITIES = ["PUBLIC", "STAFF"] as const;
export type KnowledgeVisibility = (typeof KNOWLEDGE_VISIBILITIES)[number];

/** 实际使用的检索模式。降级时必须是 keyword，且附 degradation 说明。 */
export type RetrievalMode = "keyword" | "hybrid";

export type RetrievalDegradationReason =
  | "EMBEDDING_NOT_CONFIGURED"
  | "INDEX_WITHOUT_EMBEDDING"
  | "INDEX_EMBEDDING_MISMATCH"
  | "EMBEDDING_REQUEST_FAILED";

export type RetrievalDegradation = {
  reason: RetrievalDegradationReason;
  message: string;
};

/** 问答状态：有据回答 / 澄清追问 / 资料不足。 */
export type ChatStatus = "answer" | "clarify" | "insufficient_evidence";

/** 块来源：文档快照 / 内部测试资料 / 数据库维修案例（Issue #40）。 */
export type KnowledgeChunkOrigin = "snapshot" | "internal" | "case";

/** 索引分块（embedding 为解码后的向量，检索时使用；序列化形式见 StoredChunk）。 */
export type KnowledgeChunk = {
  /** 稳定块 ID（kch_ 前缀）：内容与位置不变则跨重建保持稳定；正文变化会产生新 ID。 */
  id: string;
  sourcePath: string;
  origin: KnowledgeChunkOrigin;
  docTitle: string;
  /** 标题层级路径（从一级标题到当前小节），用于“章节”展示。 */
  headingPath: string[];
  heading: string;
  anchor: string;
  startLine: number;
  endLine: number;
  partIndex: number | null;
  partTotal: number | null;
  visibility: KnowledgeVisibility;
  /** 快照提交；内部资料为 null。 */
  revision: string | null;
  content: string;
  contentSha: string;
  embedding: Float32Array | null;
};

export type StoredChunk = Omit<KnowledgeChunk, "embedding"> & {
  /** base64(Float32Array 小端字节)；null 表示该块没有向量。 */
  embeddingBase64: string | null;
};

export type KnowledgeDocumentRecord = {
  path: string;
  title: string;
  visibility: KnowledgeVisibility;
  origin: KnowledgeChunkOrigin;
  revision: string | null;
  contentSha: string;
  chunkCount: number;
};

export type EmbeddingFingerprint = {
  provider: string;
  model: string;
  dimensions: number;
};

export type KnowledgeIndexFile = {
  formatVersion: number;
  indexVersion: string;
  builtAt: string;
  chunkerVersion: string;
  /** 索引是否带向量与其指纹；null 表示关键词索引。 */
  embedding: EmbeddingFingerprint | null;
  sources: { repo: string; revision: string } | null;
  documents: KnowledgeDocumentRecord[];
  chunks: StoredChunk[];
};

/** 运行时索引（加载后）。 */
export type KnowledgeIndex = {
  indexVersion: string;
  builtAt: string;
  chunkerVersion: string;
  embedding: EmbeddingFingerprint | null;
  sources: { repo: string; revision: string } | null;
  documents: KnowledgeDocumentRecord[];
  chunks: KnowledgeChunk[];
  byId: Map<string, KnowledgeChunk>;
};

export type RetrievalRankInfo = {
  keywordRank: number | null;
  vectorRank: number | null;
  keywordScore: number;
  vectorSimilarity: number | null;
};

export type RetrievalCandidate = {
  chunk: KnowledgeChunk;
  fusedScore: number;
  ranks: RetrievalRankInfo;
};

export type RetrievalOutcome = {
  mode: RetrievalMode;
  degradation: RetrievalDegradation | null;
  candidates: RetrievalCandidate[];
};

/** 引用载荷：URL、正文与版本由后端生成，不接受模型输出。 */
export type Citation = {
  sourceId: string;
  /**
   * 与正文中 [Sx] 标注对应的引用编号（如 "S2"）。
   * 契约：正文标记与引用卡都使用该编号一一对应，App 不得按数组下标重新编号
   * （模型可能只引用 S2 或按 S3、S1 乱序引用）。
   */
  label: string;
  title: string;
  docTitle: string;
  headingPath: string[];
  snippet: string;
  originalUrl: string | null;
  revision: string | null;
  visibility: KnowledgeVisibility;
  indexVersion: string;
};

export type KnowledgeSearchHit = Citation & {
  score: number;
  ranks: { keyword: number | null; vector: number | null };
};

export type KnowledgeChatData = {
  status: ChatStatus;
  answer: string | null;
  clarifyingQuestion: string | null;
  citations: Citation[];
  retrievalMode: RetrievalMode;
  degradation: RetrievalDegradation | null;
  indexVersion: string;
  /** 送入模型前的授权候选数量。 */
  evidenceCount: number;
  /** 校验过程中产生的说明（如下调引用被丢弃），便于审查。 */
  notes: string[];
};

export type KnowledgeSearchData = {
  query: string;
  retrievalMode: RetrievalMode;
  degradation: RetrievalDegradation | null;
  indexVersion: string;
  results: KnowledgeSearchHit[];
};

/** 引用详情的来源类型：文档块（doc）或数据库案例块（case）。 */
export type KnowledgeSourceKind = "doc" | "case";

/** 案例引用详情中的单条来源证据（客户只看到可公开的引文，不返回作者姓名与备案 ID）。 */
export type KnowledgeCaseCitationSource = {
  index: number;
  authorName: string | null;
  repairDate: string | null;
  categoryName: string | null;
  deviceModel: string | null;
  result: string | null;
  quotes: CaseEvidence[];
  repairRecordId: string | null;
  canOpen: boolean;
};

/** 案例引用详情：本次引用的案例与逐条来源证据。 */
export type KnowledgeCaseCitationDetail = {
  caseId: string;
  title: string;
  status: CaseStatus;
  visibility: CaseVisibility;
  contentVersion: number;
  /** 结构化正文（客户端按字段渲染）。 */
  content: {
    title: string;
    deviceModel: string | null;
    fault: string | null;
    investigation: string | null;
    cause: string | null;
    resolution: string | null;
    result: string;
    category: string | null;
    differences: string | null;
    unknowns: string[];
    mergeReason: string | null;
  };
  /** 确定性渲染的纯文本正文（检索与纯文本展示用）。 */
  displayText: string;
  model: string | null;
  promptVersion: string | null;
  publishedAt: string | null;
  updatedAt: string;
  sources: KnowledgeCaseCitationSource[];
};

export type KnowledgeSourceData = {
  sourceId: string;
  /** 文档或案例：案例在 caseDetail 中附带结构化正文与来源证据。 */
  kind: KnowledgeSourceKind;
  caseDetail: KnowledgeCaseCitationDetail | null;
  title: string;
  docTitle: string;
  headingPath: string[];
  content: string;
  startLine: number;
  endLine: number;
  partIndex: number | null;
  partTotal: number | null;
  sourcePath: string;
  visibility: KnowledgeVisibility;
  revision: string | null;
  originalUrl: string | null;
  indexVersion: string;
};

/** 聊天输入：历史只接受 user/assistant；当前问题单独传入。 */
export type KnowledgeChatMessageInput = { role: "user" | "assistant"; content: string };
export type KnowledgeChatRequestInput = {
  question: string;
  history: KnowledgeChatMessageInput[];
};
export type KnowledgeSearchRequestInput = {
  query: string;
  topK: number | null;
  retrieval: RetrievalMode | "auto";
};
