export const ROUTE_PUBLIC_GUIDES: string = 'public-guides';
export const ROUTE_PERSONAL_PROFILE: string = 'personal-profile';
export const ROUTE_MEMBER_DIRECTORY: string = 'member-directory';
export const ROUTE_FAVORITES: string = 'favorites';
export const ROUTE_MESSAGES: string = 'messages';

/**
 * 客户自主注册（Issue #60 App 侧第三批）。
 * 与 ROUTE_STAFF_REGISTER 是两个语义完全不同的入口，命名与标题都要区分清楚。
 */
export const ROUTE_REGISTER_CUSTOMER: string = 'register-customer';

/** 邀请码注册工作人员（Issue #60 App 侧第三批）：必须带有效邀请码，成功产生 MEMBER + 成员档案。 */
export const ROUTE_STAFF_REGISTER: string = 'staff-register';

/** 原生修改密码（Issue #60 App 侧第三批）：普通改密与首次/强制改密共用这一个入口。 */
export const ROUTE_PASSWORD_CHANGE: string = 'password-change';
export const ROUTE_PUBLIC_CASES: string = 'public-cases';
export const ROUTE_PUBLIC_CASE_DETAIL: string = 'public-case-detail';
export interface GuideFocusParam { guideId: string; }
export const ROUTE_SERVICE: string = 'service';
/**
 * 「我的报修」深链参数：从首页「进行中的报修」预览卡进入时带上订单 ID，
 * 我的报修页打开后直接展开该单的详情进度；普通入口传 null 即可。
 */
export interface RepairOrderFocusParam {
  orderId: string;
}

/**
 * 客户：我的报修单（Issue #37）。
 *
 * 与工作人员路由刻意分开：两者在数据上是不同对象
 * （客户报修申报 vs 工作人员维修备案），合成一个路由会让入口分流形同虚设，
 * 客户点进去看到备案列表或反之，都是越权与语义混淆。
 */
export const ROUTE_REPAIR_ORDERS: string = 'repair-orders';
export const ROUTE_KNOWLEDGE: string = 'knowledge';
export const ROUTE_KNOWLEDGE_SOURCE: string = 'knowledgeSource';
export const ROUTE_STAFF_ORDERS: string = 'staff-repair-orders';
export const ROUTE_STAFF_ORDER_DETAIL: string = 'staff-repair-order-detail';
export const ROUTE_REPAIR_RECORDS: string = 'repair-records';
export const ROUTE_STAFF_RECORD: string = 'staff-repair-record';
export const ROUTE_STAFF_REVIEW: string = 'staff-repair-review';

/** 典型案例库与案例详情（Issue #40，知识回流）。 */
export const ROUTE_CASE_LIBRARY: string = 'knowledge-case-library';
export const ROUTE_CASE_DETAIL: string = 'knowledge-case-detail';

/**
 * 子页标题的唯一来源：HomePage 的 navDestination 统一用 NavDestination 包裹各页面，
 * 标题从这里取，保证所有子页的系统标题栏与返回按钮样式一致（Issue #41）。
 */
export function routeTitle(name: string): string {
  if (name === ROUTE_FAVORITES) return '我的收藏';
  if (name === ROUTE_REGISTER_CUSTOMER) return '注册账号';
  if (name === ROUTE_STAFF_REGISTER) return '工作人员注册（需邀请码）';
  if (name === ROUTE_PASSWORD_CHANGE) return '修改密码';
  if (name === ROUTE_MESSAGES) return '站内消息';
  if (name === ROUTE_PUBLIC_CASES) return '公开 AI 案例';
  if (name === ROUTE_PUBLIC_CASE_DETAIL) return '公开案例详情';
  if (name === ROUTE_PERSONAL_PROFILE) return '个人资料';
  if (name === ROUTE_MEMBER_DIRECTORY) return '成员资料';
  if (name === ROUTE_PUBLIC_GUIDES) return '公开维修指南';
  if (name === ROUTE_SERVICE) {
    return '客户服务';
  }
  if (name === ROUTE_STAFF_ORDERS) {
    return '工作人员工作台';
  }
  if (name === ROUTE_STAFF_ORDER_DETAIL) {
    return '报修处理';
  }
  if (name === ROUTE_REPAIR_RECORDS) return '维修备案记录';
  if (name === ROUTE_STAFF_RECORD) {
    return '维修备案';
  }
  if (name === ROUTE_STAFF_REVIEW) {
    return '备案审核';
  }
  if (name === ROUTE_REPAIR_ORDERS) {
    return '我的报修';
  }
  if (name === ROUTE_KNOWLEDGE) {
    return '知识问答';
  }
  if (name === ROUTE_KNOWLEDGE_SOURCE) {
    return '引用详情';
  }
  if (name === ROUTE_CASE_LIBRARY) {
    return '典型案例库';
  }
  if (name === ROUTE_CASE_DETAIL) {
    return '案例详情';
  }
  return name;
}

/**
 * 页面跳转的统一入口：在 `pushPathByName` 外加 500ms 防抖，
 * 避免快速双击入口卡片把同一个页面压栈两次。
 * 返回不在这里处理：子页由 NavDestination 提供标题栏返回按钮，
 * 系统返回手势/返回键默认弹栈，会话状态留在根页面不丢失。
 */
export class NavPusher {
  private lastPushAt: number = 0;

  push(stack: NavPathStack, name: string, param: Object | null): void {
    const now: number = Date.now();
    if (now - this.lastPushAt < 500) {
      return;
    }
    this.lastPushAt = now;
    stack.pushPathByName(name, param);
  }
}
