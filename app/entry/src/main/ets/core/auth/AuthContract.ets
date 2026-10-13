// 原生会话契约：字段与后端 /api/v1/auth/native/* 的返回一一对应。
// 身份与角色一律由服务端认定；客户端只读，不提交、不改写。

/** 客户端入口（服务端计算）：客户服务 / 工作人员。 */
export const HOME_CUSTOMER: string = 'CUSTOMER';
export const HOME_STAFF: string = 'STAFF';

/** 服务端返回的会话身份（不含令牌）。 */
export interface SessionIdentity {
  userId: string;
  displayName: string | null;
  roles: string[];
  permissions: string[];
  memberProfileId: string | null;
  memberStatus: string | null;
  mustChangePassword: boolean;
  home: string;
}

/** POST /api/v1/auth/native/login 的 data。 */
export interface NativeLoginData extends SessionIdentity {
  token: string;
  expiresAt: string;
}

/** GET /api/v1/auth/native/session 的 data。 */
export interface NativeSessionData extends SessionIdentity {
}

export interface LoginRequest {
  qq: string;
  password: string;
  /** 保持登录（30 天）；false / 缺省 = 普通档位（24 小时）。见 native-client-api.md「rememberMe 与会话有效期」。 */
  rememberMe?: boolean;
}

/** POST /api/v1/auth/native/logout 的 data。 */
export interface LogoutData {
  loggedOut: boolean;
}

/**
 * POST /api/v1/auth/register/customer 的请求体（Issue #60 第三批）。
 *
 * 昵称与联系电话不在本入口接收（由个人资料模块补充）；服务端自行生成
 * `客户<QQ>` 展示名。身份与角色一律由服务端决定，客户端不提交 roles 等字段。
 */
export interface CustomerRegisterRequest {
  qq: string;
  password: string;
  passwordConfirmation: string;
  /** 保持登录（30 天）；false / 缺省 = 普通档位（24 小时）。 */
  rememberMe?: boolean;
}

/**
 * POST /api/v1/auth/register/staff 的请求体（Issue #60 第三批）。
 *
 * 必须带有效邀请码；成功产生 MEMBER 角色 + 成员档案并返回会话。
 * `studentId` / `className` 选填：留空时**不带这两个键**，
 * 避免把「没填」提交成「填了一个空值」。
 */
export interface StaffRegisterRequest {
  code: string;
  /** 客户端生成的幂等键：同一份表单的重试复用，成功后换新的。 */
  idempotencyKey: string;
  realName: string;
  qq: string;
  phone: string;
  studentId?: string;
  className?: string;
  password: string;
  passwordConfirmation: string;
  /** 保持登录（30 天）；false / 缺省 = 普通档位（24 小时）。 */
  rememberMe?: boolean;
}

/** POST /api/v1/auth/native/password/change 的 data（Issue #60 第二批契约）。 */
export interface PasswordChangeData {
  changed: boolean;
  mustChangePassword: boolean;
  /** 轮换后的新令牌：旧令牌已失效，客户端必须保存并替换本地令牌。 */
  token: string;
  expiresAt: string;
}

/**
 * POST /api/v1/auth/native/password/change 的请求体。
 *
 * `rememberMe` **省略时沿用当前会话的档位**（服务端从库里读原会话的选择），
 * 所以界面上的开关是「本次想切换档位时才提交」；为了不把 30 天账号偷偷降档，
 * 这里用可空布尔表达三态：undefined = 沿用，true / false = 显式选择。
 */
export interface PasswordChangeRequest {
  currentPassword: string;
  newPassword: string;
  newPasswordConfirmation: string;
  rememberMe?: boolean;
}

/**
 * 改密档位开关的三态（与 `PasswordChangeRequest.rememberMe` 对应）：
 * 沿用当前会话档位（省略字段）/ 显式普通档位 / 显式保持登录。
 */
export const PASSWORD_LIFETIME_KEEP: string = 'keep';
export const PASSWORD_LIFETIME_SHORT: string = 'short';
export const PASSWORD_LIFETIME_LONG: string = 'long';

/**
 * 本地表单校验用的口令长度区间（与后端 `password-policy.ts` 的 6–128 保持一致）。
 * 客户端只用于「让用户少跑一趟」，长度权威仍在服务端。
 */
export const PASSWORD_MIN_LENGTH: number = 6;
export const PASSWORD_MAX_LENGTH: number = 128;

/** 角色显示名：仅用于界面展示，不参与任何权限判断。 */
export function roleLabelFor(roles: string[]): string {
  if (roles.includes('ADMIN')) {
    return '超级管理员';
  }
  if (roles.includes('MEMBER')) {
    return '工作人员';
  }
  return '客户';
}

/**
 * 保持登录开关的文案（注册 / 登录 / 改密三处共用）。
 *
 * 只描述档位时长，不承诺「绝对安全」；设备共用提示单独一行给出。
 */
export const REMEMBER_ME_LABEL: string = '保持登录（30 天）';
export const REMEMBER_ME_HINT: string = '关闭时会话 24 小时后失效，需重新登录';

/**
 * QQ 号格式（与后端 `normalization.ts` 的 `^\d{5,11}$` 一致）：
 * 客户端只做「明显不合法」的拦截，服务端仍是权威。
 */
export function isQqFormatValid(qq: string): boolean {
  return /^\d{5,11}$/.test(qq);
}

/**
 * 口令长度是否合规（与后端 `password-policy.ts` 的 6–128 一致）。
 * 不含复杂度规则 —— 服务端没有这条规则，客户端不自行加码。
 */
export function isPasswordLengthValid(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}
