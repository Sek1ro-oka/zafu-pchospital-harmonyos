// 知识问答契约：字段与后端 /api/v1/knowledge/* 的返回一一对应（见 backend/docs/knowledge-ai.md）。
// 引用 URL、正文与版本由后端生成；客户端只读展示，不提交任何影响权限的字段。

import { KnowledgeCaseCitationDetail } from './KnowledgeCaseContract';

/** 请求体与历史的上限（与后端契约同步）。 */
export const MAX_HISTORY_MESSAGES: number = 8;
export const MAX_MESSAGE_CHARS: number = 2000;
export const MAX_QUESTION_CHARS: number = 1000;
export const MAX_TOTAL_HISTORY_CHARS: number = 8000;
/** AI 请求的读取超时：后端一次问答总预算默认 50s（AI_TOTAL_BUDGET_MS），这里留出余量。 */
export const CHAT_READ_TIMEOUT_MS: number = 60000;

export interface KnowledgeCitation {
  sourceId: string;
  /** 与正文 [Sx] 标注对应的编号（如 "S2"）：引用卡必须显示它，不能按数组下标重新编号。 */
  label: string;
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
  /**
   * 来源类型：doc（文档快照块）或 case（数据库典型案例块）。
   * 案例的正文与来源证据在 caseDetail 中，客户拿到的来源没有作者与备案 ID。
   */
  kind: string;
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
