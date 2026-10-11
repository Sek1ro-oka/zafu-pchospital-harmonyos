export const ROUTE_SERVICE: string = 'service';
/** 工作人员：维修备案（RepairRecord 审核流）。 */
export const ROUTE_REPAIR: string = 'repair';
/**
 * 客户：我的报修单（Issue #37）。
 *
 * 与 `ROUTE_REPAIR` **刻意分开**：两者在数据上是不同对象
 * （客户报修申报 vs 工作人员维修备案），合成一个路由会让入口分流形同虚设，
 * 客户点进去看到备案列表或反之，都是越权与语义混淆。
 */
export const ROUTE_REPAIR_ORDERS: string = 'repair-orders';
export const ROUTE_KNOWLEDGE: string = 'knowledge';
export const ROUTE_KNOWLEDGE_SOURCE: string = 'knowledgeSource';

/**
 * 子页标题的唯一来源：HomePage 的 navDestination 统一用 NavDestination 包裹各页面，
 * 标题从这里取，保证所有子页的系统标题栏与返回按钮样式一致（Issue #41）。
 */
export function routeTitle(name: string): string {
  if (name === ROUTE_SERVICE) {
    return '客户服务';
  }
  if (name === ROUTE_REPAIR) {
    return '工作人员工作台';
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
