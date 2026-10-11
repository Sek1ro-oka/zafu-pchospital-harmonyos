import { ApiClient, ApiRequestError } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { SessionStore } from '../../core/auth/SessionStore';
import { RepairRecordView, RepairReviewBody } from './StaffRepairContract';

const ADMIN_LIST_PATH: string = '/api/v1/admin/repairs';
const REVIEW_PATH_PREFIX: string = '/api/v1/admin/repairs/';

async function ready(): Promise<string> {
  if (ApiConfig.getBaseUrl() === '') {
    throw new ApiRequestError('NETWORK_ERROR', '服务器地址未配置，请回到登录页填写', 0, '');
  }
  const token = await SessionStore.readToken();
  if (token === '') {
    throw new ApiRequestError('UNAUTHENTICATED', '登录状态已失效，请重新登录', 0, '');
  }
  return token;
}

/**
 * 业务备案审核服务（App 内管理员审核，Issue #38）。
 *
 * 列表与审核接口都要求 `repair:review`（服务端判定，普通工作人员拿到 403）；
 * 单条审核的幂等键在**请求体**里（与 Web 管理端一致），不是请求头。
 */
export class RepairReviewService {
  /** 待审核列表（分页）。 */
  static async pendingRecords(page: number): Promise<RepairRecordView[]> {
    const token = await ready();
    const items = await ApiClient.get<RepairRecordView[]>(
      ApiConfig.getBaseUrl(),
      `${ADMIN_LIST_PATH}?status=PENDING&page=${page}`,
      token
    );
    return items === undefined || items === null ? [] : items;
  }

  /** 通过 / 退回。退回必须带原因（服务端强校验）。 */
  static async review(
    recordId: string,
    decision: string,
    note: string,
    idempotencyKey: string
  ): Promise<RepairRecordView> {
    const token = await ready();
    const body: RepairReviewBody = {
      decision: decision,
      idempotencyKey: idempotencyKey
    };
    if (note.trim() !== '') {
      body.note = note.trim();
    }
    return await ApiClient.post<RepairRecordView>(
      ApiConfig.getBaseUrl(),
      `${REVIEW_PATH_PREFIX}${recordId}/reviews`,
      JSON.stringify(body),
      token
    );
  }
}
