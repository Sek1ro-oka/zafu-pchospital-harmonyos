// 知识问答契约：字段与后端 /api/v1/knowledge/* 的返回一一对应（见 backend/docs/knowledge-ai.md）。
// 引用 URL、正文与版本由后端生成；客户端只读展示，不提交任何影响权限的字段。

/** 请求体与历史的上限（与后端契约同步）。 */
export const MAX_HISTORY_MESSAGES: number = 8;
export const MAX_MESSAGE_CHARS: number = 2000;
export const MAX_QUESTION_CHARS: number = 1000;
export const MAX_TOTAL_HISTORY_CHARS: number = 8000;
/** AI 请求的读取超时：后端模型超时上限 45s，这里留出余量。 */
export const CHAT_READ_TIMEOUT_MS: number = 60000;

export interface KnowledgeCitation {
  sourceId: string;
  title: string;
  docTitle: string;
  headingPath: string[];
  snippet: string;
  originalUrl: string | null;
  revision: string | null;
  visibility: string;
  indexVersion: string;
}

export interface KnowledgeDegradation {
  reason: string;
  message: string;
}

export interface KnowledgeChatData {
  status: string;
  answer: string | null;
  clarifyingQuestion: string | null;
  citations: KnowledgeCitation[];
  retrievalMode: string;
  degradation: KnowledgeDegradation | null;
  indexVersion: string;
  evidenceCount: number;
  notes: string[];
}

export interface KnowledgeChatMessage {
  role: string;
  content: string;
}

export interface KnowledgeChatRequest {
  question: string;
  history: KnowledgeChatMessage[];
}

export interface KnowledgeSearchHit extends KnowledgeCitation {
  score: number;
}

export interface KnowledgeSourceData {
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
  visibility: string;
  revision: string | null;
  originalUrl: string | null;
  indexVersion: string;
}

/** 引用详情页的路由参数。 */
export interface KnowledgeSourceParam {
  sourceId: string;
  title: string;
}

/** 章节路径的展示文本。 */
export function headingTrailText(headingPath: string[]): string {
  return headingPath.length > 0 ? headingPath.join(' > ') : '（文档开头）';
}

/** 引用位置文本：行范围与拆分段号。 */
export function sourceLocationText(data: KnowledgeSourceData): string {
  let text = `第 ${data.startLine}–${data.endLine} 行`;
  if (data.partIndex !== null && data.partTotal !== null) {
    text += ` · 第 ${data.partIndex}/${data.partTotal} 段`;
  }
  return text;
}
