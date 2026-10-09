import { sessionHomeForRoles, type SessionHome } from "@/lib/auth/session-home";
import type { SessionPrincipal } from "@/types/contracts";

/** 原生客户端会话载荷：服务端认定的身份、角色与入口，不含任何客户端可影响的字段。 */
export type NativeSessionData = SessionPrincipal & { home: SessionHome };

export function nativeSessionPayload(principal: SessionPrincipal): NativeSessionData {
  return {
    userId: principal.userId,
    displayName: principal.displayName,
    roles: principal.roles,
    permissions: principal.permissions,
    memberProfileId: principal.memberProfileId,
    memberStatus: principal.memberStatus,
    mustChangePassword: principal.mustChangePassword,
    home: sessionHomeForRoles(principal.roles),
  };
}
