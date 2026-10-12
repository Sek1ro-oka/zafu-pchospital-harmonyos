import { ApiClient, ApiRequestError } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { SessionStore } from '../../core/auth/SessionStore';
import { NativeSessionData } from '../../core/auth/AuthContract';
import { RepairOrderView } from '../repair/RepairOrderContract';

export interface ProfileStats { total: number; pending: number; completed: number; }

/** 复用本人列表与会话接口；归属由服务端令牌决定。 */
export class ProfileService {
  private static async token(): Promise<string> {
    if (ApiConfig.getBaseUrl() === '') throw new ApiRequestError('NETWORK_ERROR', '请先配置服务器地址', 0, '');
    const token = await SessionStore.readToken();
    if (token === '') throw new ApiRequestError('UNAUTHENTICATED', '请重新登录', 0, '');
    return token;
  }

  private static async count(token: string, status: string): Promise<number> {
    const path = '/api/v1/repair-orders?pageSize=1' + (status === '' ? '' : '&status=' + status);
    const result = await ApiClient.getWithMeta<RepairOrderView[]>(ApiConfig.getBaseUrl(), path, token);
    const pagination = result.meta !== undefined ? result.meta.pagination : undefined;
    if (pagination === undefined || !Number.isInteger(pagination.total) || pagination.total < 0) {
      throw new ApiRequestError('UNEXPECTED_RESPONSE', '服务器未返回有效的统计信息，请重试', 0, '');
    }
    return pagination.total;
  }

  static async stats(): Promise<ProfileStats> {
    const token = await ProfileService.token();
    const counts = await Promise.all([
      ProfileService.count(token, ''), ProfileService.count(token, 'SUBMITTED'),
      ProfileService.count(token, 'ACCEPTED'), ProfileService.count(token, 'REPAIRING'),
      ProfileService.count(token, 'COMPLETED')
    ]);
    return { total: counts[0], pending: counts[1] + counts[2] + counts[3], completed: counts[4] };
  }

  static async identity(): Promise<NativeSessionData> {
    const token = await ProfileService.token();
    return ApiClient.get<NativeSessionData>(ApiConfig.getBaseUrl(), '/api/v1/auth/native/session', token);
  }
}
