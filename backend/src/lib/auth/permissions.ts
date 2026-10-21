import { AppError } from "@/lib/api/errors";
import type { AuthorizedActor, Permission, RoleCode } from "@/types/contracts";

/**
 * 客户基础权限（Issue #37）。
 *
 * 客户在本模型里是**没有 `MEMBER` / `ADMIN` 角色的普通账号**，`roles` 为空数组。
 * 若只按角色取权限，客户将得到空集、被 `requirePermission` 全拒，
 * 因此这里为「无角色」这一情形单独定义一份最小权限：只能操作**自己的**报修单。
 *
 * 数据归属不靠权限码保证：`repair.order:read` 只表示「可读报修单」，
 * 「只能读本人」由 repair-order-policy 按 `submittedByUserId` 逐条校验。
 * 这样 MEMBER / ADMIN 也能复用同一个权限码读全部单据（#38 处理报修用）。
 *
 * ⚠️ 保持 `roles` 响应仍为 `[]`（方案 B），不新增 `CUSTOMER` 角色码，
 * 以免改变 Issue #36 已验收的登录响应契约。
 */
export const customerPermissions: readonly Permission[] = [
  "repair.order:create",
  "repair.order:read",
];

export const rolePermissions: Readonly<Record<RoleCode, readonly Permission[]>> = {
  MEMBER: [
    "invite:redeem",
    "repair:create",
    "repair:read",
    "repair:update",
    "repair:submit",
    "member.profile.read_self",
    "member.profile.update_self",
    "member.profile.read_internal",
    "member.skill.assign_self",
    "comment:create",
    "comment:read",
    "favorite:manage",
    "notification:read",
    "analytics:read_internal",
    "activity:staff",
    // 工作人员需要看客户报修单才能受理（#38）；本 Issue 只用到读。
    "repair.order:create",
    "repair.order:read",
    // 维修队耗材属于工作人员维护范围（#84）；二手商品任何登录用户都可发布，
    // 不需要权限码，因此这里只加耗材维护。
    "shopping.consumable:manage",
  ],
  ADMIN: [
    "join:read",
    "join:review",
    "member:provision",
    "member:manage",
    "invite:create",
    "invite:read",
    "invite:revoke",
    "audit:read",
    "repair:create",
    "repair:read",
    "repair:update",
    "repair:submit",
    "repair:review",
    "repair:delete",
    "repair:flag",
    "repair:category:manage",
    "member.profile.read_self",
    "member.profile.update_self",
    "member.profile.read_internal",
    "member.skill.assign_self",
    "comment:create",
    "comment:read",
    "comment:delete",
    "favorite:manage",
    "notification:read",
    "analytics:read_internal",
    // M6：导出等于把站内数据带出系统，只给管理员。
    "data:export",
    // M6 批次 2
    "comment:moderate",
    "skill:manage",
    "settings:manage",
    "activity:admin",
    "activity:staff",
    // 管理员处理客户报修（#38）；本 Issue 只用到读。
    "repair.order:create",
    "repair.order:read",
    // 管理员可下架任意商品（#84），并天然拥有耗材维护权限。
    "shopping.consumable:manage",
    "shopping.product:moderate",
  ],
};

/**
 * 角色 → 权限。**无角色即客户**（方案 B，2026-10-10 用户拍板）：
 * 空角色数组返回客户基础权限，而不是空集。
 */
export function permissionsForRoles(roles: readonly RoleCode[]): Permission[] {
  if (roles.length === 0) return [...customerPermissions];
  return [...new Set(roles.flatMap((role) => rolePermissions[role]))];
}

export function requirePermission(
  actor: AuthorizedActor | null,
  permission: Permission,
): AuthorizedActor {
  if (!actor) throw new AppError("UNAUTHENTICATED", "请先登录");
  if (actor.userStatus !== "ACTIVE") throw new AppError("FORBIDDEN", "账号当前不可用");
  if (actor.actorType === "USER" && !actor.userId) {
    throw new AppError("UNAUTHENTICATED", "登录状态无效");
  }
  if (!actor.permissions.includes(permission)) {
    throw new AppError("FORBIDDEN", "没有执行该操作的权限");
  }
  return actor;
}
