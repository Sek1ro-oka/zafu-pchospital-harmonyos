import { ApiClient, ApiRequestError } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { SessionStore } from '../../core/auth/SessionStore';
import {
  RecordCreateResult,
  StaffCancelBody,
  StaffNoteBody,
  StaffProgressBody,
  StaffRepairOrderView,
} from './StaffRepairContract';

const STAFF_LIST_PATH: string = '/api/v1/staff/repair-orders';

/** 统一取令牌与地址，并在未配置/未登录时抛出与其它服务一致的错误。 */
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
 * 工作人员报修处理服务（Issue #38）。
 *
 * 归属与允许动作全部由服务端判定：这里不传用户标识，也传不了受理人；
 * 抢单冲突（409）、状态冲突等错误原样抛出，由界面提示「刷新后查看」。
 */
export class StaffRepairOrderService {
  /** 队列：scope = unassigned / mine / all；status 为空表示不限。 */
  static async queue(scope: string, status: string, page: number): Promise<StaffRepairOrderView[]> {
    const token = await ready();
    const params: string[] = [`scope=${scope}`];
    if (status !== '') {
      params.push(`status=${status}`);
    }
    if (page > 1) {
      params.push(`page=${page}`);
    }
    const items = await ApiClient.get<StaffRepairOrderView[]>(
      ApiConfig.getBaseUrl(),
      `${STAFF_LIST_PATH}?${params.join('&')}`,
      token
    );
    return items === undefined || items === null ? [] : items;
  }

  static async detail(id: string): Promise<StaffRepairOrderView> {
    const token = await ready();
    return await ApiClient.get<StaffRepairOrderView>(
      ApiConfig.getBaseUrl(),
      `${STAFF_LIST_PATH}/${id}`,
      token
    );
  }

  /** 受理（说明选填）。 */
  static async accept(id: string, note: string): Promise<StaffRepairOrderView> {
    const token = await ready();
    const body: StaffNoteBody = {};
    if (note.trim() !== '') {
      body.note = note.trim();
    }
    return await ApiClient.post<StaffRepairOrderView>(
      ApiConfig.getBaseUrl(),
      `${STAFF_LIST_PATH}/${id}/accept`,
      JSON.stringify(body),
      token
    );
  }

  /** 推进：toStatus = REPAIRING / COMPLETED（说明选填）。 */
  static async progress(id: string, toStatus: string, note: string): Promise<StaffRepairOrderView> {
    const token = await ready();
    const body: StaffProgressBody = { toStatus: toStatus };
    if (note.trim() !== '') {
      body.note = note.trim();
    }
    return await ApiClient.post<StaffRepairOrderView>(
      ApiConfig.getBaseUrl(),
      `${STAFF_LIST_PATH}/${id}/progress`,
      JSON.stringify(body),
      token
    );
  }

  /** 取消（管理员；说明必填，服务端会再校验）。 */
  static async cancel(id: string, note: string): Promise<StaffRepairOrderView> {
    const token = await ready();
    const body: StaffCancelBody = { note: note.trim() };
    return await ApiClient.post<StaffRepairOrderView>(
      ApiConfig.getBaseUrl(),
      `${STAFF_LIST_PATH}/${id}/cancel`,
      JSON.stringify(body),
      token
    );
  }

  /**
   * 从报修单建立关联备案草稿（仅受理人）。
   * 幂等键由调用方生成并在重试时复用，服务端据此返回同一份草稿。
   */
  static async createRecord(orderId: string, idempotencyKey: string): Promise<RecordCreateResult> {
    const token = await ready();
    const headers: Record<string, string> = {};
    headers['Idempotency-Key'] = idempotencyKey;
    return await ApiClient.postWithHeaders<RecordCreateResult>(
      ApiConfig.getBaseUrl(),
      `${STAFF_LIST_PATH}/${orderId}/record`,
      '{}',
      token,
      headers
    );
  }
}
