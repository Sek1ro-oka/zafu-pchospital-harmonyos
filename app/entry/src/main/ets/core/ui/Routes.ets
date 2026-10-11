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
