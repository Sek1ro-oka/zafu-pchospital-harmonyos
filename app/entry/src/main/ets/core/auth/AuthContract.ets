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
}

/** POST /api/v1/auth/native/logout 的 data。 */
export interface LogoutData {
  loggedOut: boolean;
}

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
