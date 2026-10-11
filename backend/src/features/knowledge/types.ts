/**
 * 知识检索与问答的共享类型（Issue #39）。
 *
 * 这份文件同时是**客户端契约的来源**：`app/entry/src/main/ets/features/knowledge/KnowledgeContract.ets`
 * 与此处字段一一对应，改动时两边同步（见 backend/docs/knowledge-ai.md）。
 */

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
/** AI 请求客户端读取超时（毫秒）：后端模型超时上限 45s，客户端留出余量。 */
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

export type KnowledgeChunkOrigin = "snapshot" | "internal";

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

export type KnowledgeSourceData = {
  sourceId: string;
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
