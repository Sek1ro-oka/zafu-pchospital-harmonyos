import { ApiClient, ApiRequestError } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { SessionStore } from '../../core/auth/SessionStore';
import {
  CHAT_READ_TIMEOUT_MS,
  KnowledgeChatData,
  KnowledgeChatMessage,
  KnowledgeChatRequest,
  KnowledgeSourceData
} from './KnowledgeContract';

const CHAT_PATH: string = '/api/v1/knowledge/chat';
const SOURCES_PATH: string = '/api/v1/knowledge/sources/';

/**
 * 知识问答服务：复用现有 ApiClient 与会话令牌；聊天走放宽的读取超时，
 * 其他接口保持默认。会话失效由 ApiRequestError 的 code 表达，交给上层处理。
 */
export class KnowledgeService {
  /** 多轮问答：history 为本次会话中更早的 user/assistant 消息（不含当前问题）。 */
  static async sendChat(question: string, history: KnowledgeChatMessage[]): Promise<KnowledgeChatData> {
    const baseUrl = ApiConfig.getBaseUrl();
    if (baseUrl === '') {
      throw new ApiRequestError('NETWORK_ERROR', '请先填写服务器地址', 0, '');
    }
    const token = await SessionStore.readToken();
    const request: KnowledgeChatRequest = { question: question, history: history };
    return ApiClient.post<KnowledgeChatData>(baseUrl, CHAT_PATH, JSON.stringify(request), token, {
      readTimeoutMs: CHAT_READ_TIMEOUT_MS,
      connectTimeoutMs: 10000
    });
  }

  /** 引用详情：按索引 ID 取正文、定位、版本与原文链接。 */
  static async fetchSource(sourceId: string): Promise<KnowledgeSourceData> {
    const baseUrl = ApiConfig.getBaseUrl();
    if (baseUrl === '') {
      throw new ApiRequestError('NETWORK_ERROR', '请先填写服务器地址', 0, '');
    }
    const token = await SessionStore.readToken();
    const path: string = `${SOURCES_PATH}${encodeURIComponent(sourceId)}`;
    return ApiClient.get<KnowledgeSourceData>(baseUrl, path, token, { readTimeoutMs: 15000 });
  }
}
