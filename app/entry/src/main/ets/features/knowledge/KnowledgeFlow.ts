import { KnowledgeChatData, KnowledgeCitation } from './KnowledgeContract';

/**
 * 消息列表的纯状态迁移（无 ArkUI 依赖，可直接被回归用例执行）。
 *
 * 关键不变量：回答**永远紧跟它所回答的问题**（插入而不是追加）。
 * 否则先失败后重试的旧问题，其回答会跑到后续问题之后；再次失败时
 * 「前一条必须是用户消息」的定位也会失效，重试按钮变成死按钮。
 */

export const ROLE_USER: string = 'user';
export const ROLE_ASSISTANT: string = 'assistant';
export const STATUS_DONE: string = 'done';
export const STATUS_PENDING: string = 'pending';
export const STATUS_FAILED: string = 'failed';
export const KIND_ANSWER: string = 'answer';
export const KIND_CLARIFY: string = 'clarify';
export const KIND_INSUFFICIENT: string = 'insufficient_evidence';

export interface ChatMessage {
  id: number;
  role: string;
  text: string;
  status: string;
  kind: string;
  citations: KnowledgeCitation[];
  retrievalMode: string;
  degradationMessage: string;
  errorCode: string;
  errorMessage: string;
}

export function userMessage(id: number, text: string): ChatMessage {
  return {
    id: id,
    role: ROLE_USER,
    text: text,
    status: STATUS_DONE,
    kind: '',
    citations: [],
    retrievalMode: '',
    degradationMessage: '',
    errorCode: '',
    errorMessage: ''
  };
}

export function pendingMessage(id: number): ChatMessage {
  return {
    id: id,
    role: ROLE_ASSISTANT,
    text: '',
    status: STATUS_PENDING,
    kind: '',
    citations: [],
    retrievalMode: '',
    degradationMessage: '',
    errorCode: '',
    errorMessage: ''
  };
}

export function responseMessage(id: number, data: KnowledgeChatData): ChatMessage {
  const isClarify: boolean = data.status === KIND_CLARIFY;
  const text: string = isClarify
    ? (data.clarifyingQuestion !== null ? data.clarifyingQuestion : '')
    : (data.answer !== null ? data.answer : '');
  return {
    id: id,
    role: ROLE_ASSISTANT,
    text: text,
    status: STATUS_DONE,
    kind: data.status,
    citations: data.citations,
    retrievalMode: data.retrievalMode,
    degradationMessage: data.degradation !== null ? data.degradation.message : '',
    errorCode: '',
    errorMessage: ''
  };
}

export function failedMessage(id: number, errorCode: string, errorMessage: string): ChatMessage {
  return {
    id: id,
    role: ROLE_ASSISTANT,
    text: '',
    status: STATUS_FAILED,
    kind: '',
    citations: [],
    retrievalMode: '',
    degradationMessage: '',
    errorCode: errorCode,
    errorMessage: errorMessage
  };
}

/** 把消息插到 userMessageIndex 之后（新提问与重试共用，保证回答紧跟问题）。 */
export function insertAfterUser(
  messages: ChatMessage[],
  userMessageIndex: number,
  pending: ChatMessage
): ChatMessage[] {
  return messages.slice(0, userMessageIndex + 1).concat([pending], messages.slice(userMessageIndex + 1));
}

export function appendMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return messages.concat([message]);
}

export function replaceMessageById(
  messages: ChatMessage[],
  id: number,
  replacement: ChatMessage
): ChatMessage[] {
  return messages.map((message: ChatMessage) => (message.id === id ? replacement : message));
}

export function removeMessageById(messages: ChatMessage[], id: number): ChatMessage[] {
  return messages.filter((message: ChatMessage) => message.id !== id);
}

/**
 * 重试定位：失败卡必须紧跟它所回答的用户问题。
 * 返回用户消息下标；找不到（或结构不符合不变量）返回 -1，调用方不发送请求。
 */
export function retryUserIndex(messages: ChatMessage[], failedId: number): number {
  const index: number = messages.findIndex(
    (message: ChatMessage) => message.id === failedId && message.status === STATUS_FAILED
  );
  if (index <= 0) {
    return -1;
  }
  if (messages[index - 1].role !== ROLE_USER) {
    return -1;
  }
  return index - 1;
}
