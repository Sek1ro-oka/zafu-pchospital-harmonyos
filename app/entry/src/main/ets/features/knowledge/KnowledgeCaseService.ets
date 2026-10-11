import { ApiClient, ApiRequestError } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { SessionStore } from '../../core/auth/SessionStore';
import {
  CaseDetailView,
  CaseListItem,
  CaseListQuery,
  RecordCaseProcessingView,
  RecordCaseRetryResult
} from './KnowledgeCaseContract';

const CASES_PATH: string = '/api/v1/knowledge-cases';
const RECORDS_PATH: string = '/api/v1/knowledge-cases/records/';

/**
 * 典型案例服务：复用现有 ApiClient 与会话令牌。
 *
 * 所有状态与能力标记（canMark/canUnmark/canRetry/canManage...）以服务端返回为准；
 * 这里的按钮只是把服务端标记渲染出来，不做本地授权判断。
 */
export class KnowledgeCaseService {
  private static async ready(): Promise<string> {
    if (ApiConfig.getBaseUrl() === '') {
      throw new ApiRequestError('NETWORK_ERROR', '服务器地址未配置，请回到登录页填写', 0, '');
    }
    const token = await SessionStore.readToken();
    if (token === '') {
      throw new ApiRequestError('UNAUTHENTICATED', '登录状态已失效，请重新登录', 0, '');
    }
    return token;
  }

  /** 备案的典型整理状态（作者或审核人员可读）。 */
  static async recordStatus(recordId: string): Promise<RecordCaseProcessingView> {
    const token = await KnowledgeCaseService.ready();
    return ApiClient.get<RecordCaseProcessingView>(
      ApiConfig.getBaseUrl(),
      `${RECORDS_PATH}${encodeURIComponent(recordId)}/status`,
      token
    );
  }

  /** 标记典型并触发整理；返回真实终态（含失败信息）。 */
  static async markTypical(recordId: string): Promise<RecordCaseProcessingView> {
    const token = await KnowledgeCaseService.ready();
    return ApiClient.post<RecordCaseProcessingView>(
      ApiConfig.getBaseUrl(),
      `${RECORDS_PATH}${encodeURIComponent(recordId)}/typical`,
      '',
      token,
      { readTimeoutMs: 90000 }
    );
  }

  /** 取消典型标记：来源贡献被移除，受影响案例自动重整或撤下。 */
  static async unmarkTypical(recordId: string): Promise<RecordCaseProcessingView> {
    const token = await KnowledgeCaseService.ready();
    return ApiClient.del<RecordCaseProcessingView>(
      ApiConfig.getBaseUrl(),
      `${RECORDS_PATH}${encodeURIComponent(recordId)}/typical`,
      token
    );
  }

  /** 失败/中断后重试整理；结果带最新状态与本次真实产出。 */
  static async retryProcessing(recordId: string): Promise<RecordCaseRetryResult> {
    const token = await KnowledgeCaseService.ready();
    return ApiClient.post<RecordCaseRetryResult>(
      ApiConfig.getBaseUrl(),
      `${RECORDS_PATH}${encodeURIComponent(recordId)}/retry`,
      '',
      token,
      { readTimeoutMs: 90000 }
    );
  }

  /** 案例列表（工作人员），按状态/范围筛选与分页。 */
  static async listCases(query: CaseListQuery): Promise<CaseListItem[]> {
    const token = await KnowledgeCaseService.ready();
    let path: string = `${CASES_PATH}?page=${query.page}`;
    if (query.status !== '') {
      path += `&status=${encodeURIComponent(query.status)}`;
    }
    if (query.visibility !== '') {
      path += `&visibility=${encodeURIComponent(query.visibility)}`;
    }
    const items = await ApiClient.get<CaseListItem[]>(ApiConfig.getBaseUrl(), path, token);
    return items === undefined || items === null ? [] : items;
  }

  /** 案例详情（含多来源证据与管理员能力标记）。 */
  static async caseDetail(caseId: string): Promise<CaseDetailView> {
    const token = await KnowledgeCaseService.ready();
    return ApiClient.get<CaseDetailView>(
      ApiConfig.getBaseUrl(),
      `${CASES_PATH}/${encodeURIComponent(caseId)}`,
      token
    );
  }

  /** 管理员：调整可见范围（STAFF/PUBLIC）。 */
  static async setVisibility(caseId: string, visibility: string): Promise<CaseDetailView> {
    const token = await KnowledgeCaseService.ready();
    const body: Record<string, string> = { 'visibility': visibility };
    return ApiClient.post<CaseDetailView>(
      ApiConfig.getBaseUrl(),
      `${CASES_PATH}/${encodeURIComponent(caseId)}/visibility`,
      JSON.stringify(body),
      token
    );
  }

  /** 管理员：撤回案例（立即停止检索；普通重试不会自动恢复）。 */
  static async withdraw(caseId: string): Promise<CaseDetailView> {
    const token = await KnowledgeCaseService.ready();
    return ApiClient.post<CaseDetailView>(
      ApiConfig.getBaseUrl(),
      `${CASES_PATH}/${encodeURIComponent(caseId)}/withdraw`,
      '',
      token
    );
  }

  /** 管理员：显式重整/恢复（撤回后的唯一恢复入口）；返回最新案例与本次真实产出。 */
  static async reprocess(caseId: string): Promise<CaseReprocessResult> {
    const token = await KnowledgeCaseService.ready();
    return ApiClient.post<CaseReprocessResult>(
      ApiConfig.getBaseUrl(),
      `${CASES_PATH}/${encodeURIComponent(caseId)}/reprocess`,
      '',
      token,
      { readTimeoutMs: 90000 }
    );
  }

  /** 管理员：单条向量重建（不重新整理正文）。 */
  static async reembed(caseId: string): Promise<CaseDetailView> {
    const token = await KnowledgeCaseService.ready();
    return ApiClient.post<CaseDetailView>(
      ApiConfig.getBaseUrl(),
      `${CASES_PATH}/${encodeURIComponent(caseId)}/embedding`,
      '',
      token,
      { readTimeoutMs: 60000 }
    );
  }
}

/** 重整接口返回：最新案例 + 本次产出（判定失败原因后如实展示）。 */
export interface CaseReprocessResult {
  case: CaseDetailView;
  outcome: RecordCaseOutcome;
}

export interface RecordCaseOutcome {
  status: string;
  failureCode: string | null;
  failureMessage: string | null;
}
