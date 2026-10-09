import type { RoleCode } from "@/types/contracts";

/** 原生客户端登录后的落地入口：客户服务入口 / 工作人员入口。 */
export type SessionHome = "CUSTOMER" | "STAFF";

/**
 * 角色 → 客户端入口映射（唯一来源；客户与工作人员如何对应现有模型）：
 *
 * - `MEMBER` = 维修队成员（工作人员），进入工作人员入口；
 * - `ADMIN` = 超级管理员，权限是另一套（管理后台），在 App 里也进入工作人员入口，
 *   但「进入工作人员入口」不代表获得任何管理权限，也不把工作人员等同为管理员；
 * - 其余（无 `MEMBER` / `ADMIN` 角色）的普通账号是客户，进入客户服务入口。
 *
 * 这只是界面分流。业务权限一律由服务端按账号实际角色/权限判定，客户端提交的角色字段一律忽略。
 */
export function sessionHomeForRoles(roles: readonly RoleCode[]): SessionHome {
  return roles.includes("MEMBER") || roles.includes("ADMIN") ? "STAFF" : "CUSTOMER";
}
