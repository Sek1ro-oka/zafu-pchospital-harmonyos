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

  /**
   * 会话代次（epoch，Issue #60 迟到响应回归的结构性保证）。
   *
   * 语义：**本地会话归属每变一次就单调 +1** —— 登录 / 注册落库成功、`restore()`
   * 建立或清空身份、`logout()` 清会话、改密换新令牌，都会推进它。
   *
   * 为什么光有「令牌非空」不够：`SessionStore.writeToken` 是迟到响应唯一能篡改本地
   * 会话的入口，而「当前位置有没有会话」无法区分「还是同一个账号」与「已经换成另一个
   * 账号」。代次把这两件事区分开：请求发起前记下代次与当时的令牌，响应回来后两者
   * 只要有一个对不上，这份响应就属于一个**已被放弃的账号**，整份丢弃（fail-closed）。
   */
  private static epoch: number = 0;

  /** 会话归属发生变化时调用；只递增，不重置（重置会让旧响应的代次重新「看起来匹配」）。 */
  private static advanceEpoch(): void {
    SessionService.epoch += 1;
  }

  /**
   * 这次响应是否仍属于**发起请求时的那个会话**。
   *
   * 两个条件都比，缺一不可：
   * - `epoch` 变化 = 期间发生过退出 / 换账号 / 恢复会话这类归属变更；
   * - 令牌比对 = 期间本地令牌被别的路径改写（代次没赶上，但归属事实上已经变了）。
   * 任一不一致都按「已被放弃的响应」处理；读取令牌失败（返回空串）同样按不一致处理，
   * 宁可丢弃也不能把不确定归属的令牌写进去。
   */
  private static async stillCurrentSession(epoch: number, token: string): Promise<boolean> {
    if (SessionService.epoch !== epoch) {
      return false;
    }
    const current = await SessionStore.readToken();
    return current === token;
  }

  /**
   * 丢弃一个已不属于当前会话的服务端会话。
   *
   * 服务端在改密 / 登录成功那一刻已经**吊销旧会话并发出了新会话**；本地既然不采用，
   * 它就成了「活着但没人持有」的悬空会话（拿到这个令牌的人依然能冒充该账号），
   * 所以要尽力用**这个新令牌**去 logout 撤销它 —— 与 `writeToken` 失败分支同一手法。
   * 撤销失败只记日志：本地绝不因为「撤销不掉」而把别的账号的令牌写进来。
   */
  private static async revokeAbandonedSession(baseUrl: string, token: string): Promise<void> {
    if (token === '' || baseUrl === '') {
      return;
    }
    try {
      await ApiClient.post<LogoutData>(baseUrl, LOGOUT_PATH, '', token);
    } catch (error) {
      hilog.warn(DOMAIN, TAG, '%{public}s', '迟到响应带来的新会话撤销未成功');
    }
  }

  static current(): SessionIdentity | null {
    return SessionService.identity;
  }

  /**
   * 会话快照标识（#84 审查第三轮：业务页迟到回调的归属校验）。
   *
   * 业务页在发出**写请求之前**记下它，回调到达时再比对一次：代次或 userId
   * 任一变化（退出 / 换账号 / 恢复会话）都说明发起请求的那个会话已被放弃，
   * 迟到的成功 / 失败回调必须整份丢弃 —— 不得导航、不得触发 expireSession、
   * 不得更新页面状态。只做整体相等比较，不解析内容。
   */
  static sessionStamp(): string {
    const identity = SessionService.identity;
    return `${SessionService.epoch}|${identity === null ? '' : identity.userId}`;
  }

  static async login(qq: string, password: string, rememberMe: boolean = false): Promise<SessionIdentity> {
    const baseUrl = ApiConfig.getBaseUrl();
    if (baseUrl === '') {
      throw new ApiRequestError('NETWORK_ERROR', '请先填写服务器地址', 0, '');
    }
    const request: LoginRequest = { qq: qq, password: password, rememberMe: rememberMe };
    const previousToken = await SessionStore.readToken();
    const epoch = SessionService.epoch;
    const data = await ApiClient.post<NativeLoginData>(baseUrl, LOGIN_PATH, JSON.stringify(request), '');
    const identity = await SessionService.adoptSession(data, epoch, previousToken);
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
    const previousToken = await SessionStore.readToken();
    const epoch = SessionService.epoch;
    const data = await ApiClient.post<NativeLoginData>(baseUrl, CUSTOMER_REGISTER_PATH, JSON.stringify(request), '');
    return await SessionService.adoptSession(data, epoch, previousToken);
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
    const previousToken = await SessionStore.readToken();
    const epoch = SessionService.epoch;
    const data = await ApiClient.post<NativeLoginData>(baseUrl, STAFF_REGISTER_PATH, JSON.stringify(request), '');
    return await SessionService.adoptSession(data, epoch, previousToken);
  }

  /**
   * 登录 / 注册共用的收尾：保存令牌并建立内存身份。
   *
   * 保存前先做**归属校验**：请求在途期间会话归属若已经变了（用户退出、或已经登录了
   * 另一个账号），这份响应属于被放弃的账号，返回它的令牌就是把本地会话换成别人的
   * （账号串用）。此时丢弃响应，并尽力撤销刚拿到的服务端新会话。
   *
   * 保存失败按既有 `LOCAL_STORAGE_ERROR` 语义处理 —— 调 `logout` 撤销服务端会话，
   * 内存身份置空，抛错让界面停留在原表单，**绝不展示「已登录/已注册成功」**。
   */
  private static async adoptSession(data: NativeLoginData, epoch: number,
    previousToken: string): Promise<SessionIdentity> {
    const baseUrl = ApiConfig.getBaseUrl();
    if (!(await SessionService.stillCurrentSession(epoch, previousToken))) {
      await SessionService.revokeAbandonedSession(baseUrl, data.token);
      throw new ApiRequestError('SESSION_CHANGED', '登录状态已变更，本次结果未采用，请重新登录', 0, '');
    }
    const persisted = await SessionStore.writeToken(data.token);
    if (!persisted) {
      SessionService.identity = null;
      SessionService.advanceEpoch();
      try {
        await ApiClient.post<LogoutData>(baseUrl, LOGOUT_PATH, '', data.token);
      } catch (error) {
        hilog.warn(DOMAIN, TAG, '%{public}s', '本地令牌保存失败，服务端撤销也未成功');
      }
      throw new ApiRequestError('LOCAL_STORAGE_ERROR', '无法保存登录凭证，请检查设备存储后重试', 0, '');
    }
    SessionService.identity = data;
    SessionService.advanceEpoch();
    return data;
  }

  /**
   * 重启恢复：本地有令牌就向服务器验证；失效即清除并进入游客首页；
   * 网络不可达时保留令牌并返回提示，允许重试。
   */
  static async restore(): Promise<RestoreResult> {
    const result = new RestoreResult();
    SessionService.identity = null;
    // 恢复流程会重建 / 清空本地会话归属：先推进代次，让此前发起的任何认证写请求迟到时
    // 都按「不属于当前会话」处理（boot 期间不会有这类请求，这里是语义上的封口）。
    SessionService.advanceEpoch();
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
    // 退出即换了一代会话归属：此前发出的认证写请求（尤其是改密）迟到时必须被丢弃，
    // 否则它会把刚清空、甚至已经换成另一个账号的令牌重新写回（账号串用）。
    SessionService.advanceEpoch();
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
   * **归属校验（Issue #60 迟到响应回归）**：落库前必须确认「这份响应仍属于发起请求时的
   * 那个会话」。普通改密（非强制）在途时用户可以用返回键离开，于是可能出现
   * 「A 的改密响应迟到、本地已经是 B」的交错 —— 无条件覆盖令牌就是账号串用。
   * 代次 / 令牌任一不一致即整份丢弃（`SESSION_CHANGED`），并尽力撤销刚拿到的服务端新会话。
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
    // 发起前记下「这次响应属于谁」：会话代次 + 当时的令牌。
    const epoch = SessionService.epoch;
    const data = await ApiClient.post<PasswordChangeData>(
      baseUrl,
      PASSWORD_CHANGE_PATH,
      JSON.stringify(request),
      token
    );
    // 归属校验（Issue #60 迟到响应回归）：请求在途期间用户可能已经离开改密页、退出本账号、
    // 甚至登录了另一个账号。此时这份响应里的令牌属于**被放弃的账号**，写进本地就会出现
    // 「界面与内存身份是 B、后续请求头却是 A 的令牌」的账号串用。所以先比对再落库。
    if (!(await SessionService.stillCurrentSession(epoch, token))) {
      await SessionService.revokeAbandonedSession(baseUrl, data.token);
      // 文案必须写明**密码已经改成功**：服务端在返回之前就已提交改密（更新口令、吊销该账号
      // 全部未吊销会话、发出新会话），丢弃的只是这份响应里的令牌归属。写成「本次修改结果
      // 未采用」会诱导用户拿**旧**密码重登，而旧口令在服务端已经不存在了 —— 必然失败。
      throw new ApiRequestError('SESSION_CHANGED', '密码已修改成功，但登录状态已变更，请用新密码重新登录', 0, '');
    }
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
      SessionService.advanceEpoch();
      throw new ApiRequestError('LOCAL_STORAGE_ERROR', '无法保存新的登录凭证，请检查设备存储后重试', 0, '');
    }
    // 令牌已轮换 = 会话归属又变了一代：此后任何**更早发起**的认证写请求迟到时都会被丢弃，
    // 不会再把上一代的令牌盖回来。
    //
    // 这里封的是**已发生的归属变更**（退出 / 换账号 / 恢复会话），**不是**并发写入本身的
    // 串行化：归属校验是 check-then-act，`writeToken` 内部还有 await，两次改密同时在途时
    // 这个窗口内没有二次校验。真正阻止重复提交的是界面侧（`PasswordChangePage.submit`
    // 的 `if (this.busy) return`、提交按钮与档位开关的 `.enabled(!this.busy)`，以及
    // `HomePage.interceptBack` 对改密页返回键的拦截）。
    SessionService.advanceEpoch();
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
