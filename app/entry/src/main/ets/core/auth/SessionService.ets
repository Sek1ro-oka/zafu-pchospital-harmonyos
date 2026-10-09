import { hilog } from '@kit.PerformanceAnalysisKit';
import { HealthData } from '../network/ApiContract';
import { ApiClient, ApiRequestError, isSessionExpiredCode } from '../network/ApiClient';
import { ApiConfig } from '../network/ApiConfig';
import { LoginRequest, LogoutData, NativeLoginData, NativeSessionData, SessionIdentity } from './AuthContract';
import { SessionStore } from './SessionStore';

const DOMAIN: number = 0x0000;
const TAG: string = 'SessionService';
const LOGIN_PATH: string = '/api/v1/auth/native/login';
const SESSION_PATH: string = '/api/v1/auth/native/session';
const LOGOUT_PATH: string = '/api/v1/auth/native/logout';
const HEALTH_PATH: string = '/api/v1/health';

/** restore() 结果：identity 为空且 unavailableReason 为空 = 未登录，去登录页。 */
export class RestoreResult {
  identity: SessionIdentity | null = null;
  /** 非空：无法与服务器确认会话（网络类问题），本地令牌保留，界面应提供重试。 */
  unavailableReason: string = '';
}

/**
 * 会话编排：登录 / 重启恢复 / 退出 / 连接检测。
 * 身份只取自服务端响应；本地只保存令牌本身。
 */
export class SessionService {
  private static identity: SessionIdentity | null = null;

  static current(): SessionIdentity | null {
    return SessionService.identity;
  }

  static async login(qq: string, password: string): Promise<SessionIdentity> {
    const baseUrl = ApiConfig.getBaseUrl();
    if (baseUrl === '') {
      throw new ApiRequestError('NETWORK_ERROR', '请先填写服务器地址', 0, '');
    }
    const request: LoginRequest = { qq: qq, password: password };
    const data = await ApiClient.post<NativeLoginData>(baseUrl, LOGIN_PATH, JSON.stringify(request), '');
    const persisted = await SessionStore.writeToken(data.token);
    if (!persisted) {
      SessionService.identity = null;
      try {
        await ApiClient.post<LogoutData>(baseUrl, LOGOUT_PATH, '', data.token);
      } catch (error) {
        hilog.warn(DOMAIN, TAG, '%{public}s', '本地令牌保存失败，服务端撤销也未成功');
      }
      throw new ApiRequestError('LOCAL_STORAGE_ERROR', '无法保存登录凭证，请检查设备存储后重试', 0, '');
    }
    SessionService.identity = data;
    return data;
  }

  /**
   * 重启恢复：本地有令牌就向服务器验证；失效即清除并回登录页；
   * 网络不可达时保留令牌并返回提示，允许重试。
   */
  static async restore(): Promise<RestoreResult> {
    const result = new RestoreResult();
    const baseUrl = ApiConfig.getBaseUrl();
    const token = await SessionStore.readToken();
    if (token === '') {
      SessionService.identity = null;
      return result;
    }
    if (baseUrl === '') {
      // 有令牌但没有服务器地址（配置被清）：回登录页重新建立。
      await SessionStore.clearToken();
      SessionService.identity = null;
      return result;
    }
    try {
      const data = await ApiClient.get<NativeSessionData>(baseUrl, SESSION_PATH, token);
      SessionService.identity = data;
      result.identity = data;
      return result;
    } catch (error) {
      if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) {
        await SessionStore.clearToken();
        SessionService.identity = null;
        return result;
      }
      result.unavailableReason = error instanceof ApiRequestError
        ? error.message
        : '无法确认登录状态，请重试';
      return result;
    }
  }

  /** 退出：服务端吊销令牌（尽力而为），随后无论成败都清除本地会话。 */
  static async logout(): Promise<void> {
    const baseUrl = ApiConfig.getBaseUrl();
    const token = await SessionStore.readToken();
    if (token !== '' && baseUrl !== '') {
      try {
        await ApiClient.post<LogoutData>(baseUrl, LOGOUT_PATH, '', token);
      } catch (error) {
        hilog.warn(DOMAIN, TAG, '服务端退出失败，仍清除本地会话: %{public}s', JSON.stringify(error));
      }
    }
    await SessionStore.clearToken();
    SessionService.identity = null;
  }

  /** 后端连通性检测（登录页显示状态）。失败时抛 ApiRequestError。 */
  static async checkHealth(): Promise<string> {
    const baseUrl = ApiConfig.getBaseUrl();
    if (baseUrl === '') {
      throw new ApiRequestError('NETWORK_ERROR', '请先填写服务器地址', 0, '');
    }
    const data = await ApiClient.get<HealthData>(baseUrl, HEALTH_PATH, '');
    const database = data.database === 'reachable' ? '数据库可达' : `数据库：${data.database}`;
    return `后端可达 · ${database}`;
  }
}
