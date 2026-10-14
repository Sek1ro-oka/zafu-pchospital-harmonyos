import { hilog } from '@kit.PerformanceAnalysisKit';
import { HealthData } from '../network/ApiContract';
import { ApiClient, ApiRequestError, isSessionExpiredCode } from '../network/ApiClient';
import { ApiConfig } from '../network/ApiConfig';
import { LoginRequest, LogoutData, NativeLoginData, NativeSessionData, SessionIdentity,
  CustomerRegisterRequest, PasswordChangeData, PasswordChangeRequest, StaffRegisterRequest } from './AuthContract';
import { SessionStore } from './SessionStore';

const DOMAIN: number = 0x0000;
const TAG: string = 'SessionService';
const LOGIN_PATH: string = '/api/v1/auth/native/login';
const SESSION_PATH: string = '/api/v1/auth/native/session';
const LOGOUT_PATH: string = '/api/v1/auth/native/logout';
const HEALTH_PATH: string = '/api/v1/health';
const CUSTOMER_REGISTER_PATH: string = '/api/v1/auth/register/customer';
const STAFF_REGISTER_PATH: string = '/api/v1/auth/register/staff';
const PASSWORD_CHANGE_PATH: string = '/api/v1/auth/native/password/change';

/** restore() 结果：identity 为空且 unavailableReason 为空 = 未登录，进入游客首页。 */
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

  static async login(qq: string, password: string, rememberMe: boolean = false): Promise<SessionIdentity> {
    const baseUrl = ApiConfig.getBaseUrl();
    if (baseUrl === '') {
      throw new ApiRequestError('NETWORK_ERROR', '请先填写服务器地址', 0, '');
    }
    const request: LoginRequest = { qq: qq, password: password, rememberMe: rememberMe };
    const data = await ApiClient.post<NativeLoginData>(baseUrl, LOGIN_PATH, JSON.stringify(request), '');
    const identity = await SessionService.adoptSession(data);
    return identity;
  }

  /**
   * 客户自主注册（Issue #60 第三批）：`POST /api/v1/auth/register/customer`。
   *
   * 公开入口，**此时还没有令牌**（请求体不带 Authorization）；成功后响应即会话
   * （`token` + 身份），因此与登录共用同一套「落库 → 失败即撤销」的收尾逻辑，
   * 不写第二份：注册成功但本地保存失败时同样不得展示「已注册成功」。
   */
  static async registerCustomer(qq: string, password: string, passwordConfirmation: string,
    rememberMe: boolean): Promise<SessionIdentity> {
    const baseUrl = ApiConfig.getBaseUrl();
    if (baseUrl === '') {
      throw new ApiRequestError('NETWORK_ERROR', '请先填写服务器地址', 0, '');
    }
    const request: CustomerRegisterRequest = {
      qq: qq,
      password: password,
      passwordConfirmation: passwordConfirmation,
      rememberMe: rememberMe
    };
    const data = await ApiClient.post<NativeLoginData>(baseUrl, CUSTOMER_REGISTER_PATH, JSON.stringify(request), '');
    return await SessionService.adoptSession(data);
  }

  /**
   * 邀请码注册工作人员（Issue #60 第三批）：`POST /api/v1/auth/register/staff`。
   *
   * 幂等键由调用方（表单）生成并在重试时复用：与报修单提交同一约定，
   * 同一份表单的多次重试带同一个键，服务端据此去重；成功后才换新键。
   */
  static async registerStaff(request: StaffRegisterRequest): Promise<SessionIdentity> {
    const baseUrl = ApiConfig.getBaseUrl();
    if (baseUrl === '') {
      throw new ApiRequestError('NETWORK_ERROR', '请先填写服务器地址', 0, '');
    }
    const data = await ApiClient.post<NativeLoginData>(baseUrl, STAFF_REGISTER_PATH, JSON.stringify(request), '');
    return await SessionService.adoptSession(data);
  }

  /**
   * 登录 / 注册共用的收尾：保存令牌并建立内存身份。
   *
   * 保存失败按既有 `LOCAL_STORAGE_ERROR` 语义处理 —— 调 `logout` 撤销服务端会话，
   * 内存身份置空，抛错让界面停留在原表单，**绝不展示「已登录/已注册成功」**。
   */
  private static async adoptSession(data: NativeLoginData): Promise<SessionIdentity> {
    const baseUrl = ApiConfig.getBaseUrl();
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
   * 重启恢复：本地有令牌就向服务器验证；失效即清除并进入游客首页；
   * 网络不可达时保留令牌并返回提示，允许重试。
   */
  static async restore(): Promise<RestoreResult> {
    const result = new RestoreResult();
    SessionService.identity = null;
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

  /**
   * 原生修改密码（Issue #60 第二 / 三批契约）：`POST /api/v1/auth/native/password/change`。
   *
   * 成功即**轮换令牌**：旧令牌已失效（服务端吊销该账号所有未吊销会话），
   * 因此这里把响应体里的新令牌覆盖写回本地存储 —— 同别名 OVERWRITE，
   * 之后所有请求自然带上新令牌。若本地保存失败，同样按登录的
   * `LOCAL_STORAGE_ERROR` 语义处理：调 logout 撤销**刚拿到的新会话**（不能用旧令牌，
   * 服务端已把它吊销），不展示「已改密成功」。
   *
   * 强制改密账号（`mustChangePassword = true`）也能调这个入口（服务端对该入口放行），
   * 这就是强制改密账号唯一的自救通道。
   *
   * @param request `rememberMe` 省略 = 沿用当前会话档位（服务端从库里读原会话的选择）。
   */
  static async changePassword(request: PasswordChangeRequest): Promise<PasswordChangeData> {
    const baseUrl = ApiConfig.getBaseUrl();
    if (baseUrl === '') {
      throw new ApiRequestError('NETWORK_ERROR', '请先填写服务器地址', 0, '');
    }
    const token = await SessionStore.readToken();
    if (token === '') {
      throw new ApiRequestError('UNAUTHENTICATED', '登录状态已失效，请重新登录', 0, '');
    }
    const data = await ApiClient.post<PasswordChangeData>(
      baseUrl,
      PASSWORD_CHANGE_PATH,
      JSON.stringify(request),
      token
    );
    const persisted = await SessionStore.writeToken(data.token);
    if (!persisted) {
      try {
        // 撤销必须用**新**令牌 data.token：改密时服务端已吊销该账号所有旧会话，
        // 旧令牌在服务端早已是死的，拿它调 logout 是空操作，
        // 结果就是「本地没保存成、服务端却留下一个活着的新会话」。
        await ApiClient.post<LogoutData>(baseUrl, LOGOUT_PATH, '', data.token);
      } catch (error) {
        hilog.warn(DOMAIN, TAG, '%{public}s', '新令牌保存失败，服务端撤销也未成功');
      }
      await SessionStore.clearToken();
      SessionService.identity = null;
      throw new ApiRequestError('LOCAL_STORAGE_ERROR', '无法保存新的登录凭证，请检查设备存储后重试', 0, '');
    }
    // 新会话的 mustChangePassword 恒为 false（初始密码已改）；其余身份字段沿用内存值。
    if (SessionService.identity !== null) {
      SessionService.identity.mustChangePassword = data.mustChangePassword;
    }
    return data;
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
