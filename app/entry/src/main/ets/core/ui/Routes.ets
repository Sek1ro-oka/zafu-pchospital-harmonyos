export const ROUTE_SERVICE: string = 'service';
/**
 * 客户：我的报修单（Issue #37）。
 *
 * 与工作人员侧**刻意分开**：两者在数据上是不同对象
 * （客户报修申报 vs 工作人员维修备案），合成一个路由会让入口分流形同虚设，
 * 客户点进去看到备案列表或反之，都是越权与语义混淆。
 */
export const ROUTE_REPAIR_ORDERS: string = 'repair-orders';
export const ROUTE_KNOWLEDGE: string = 'knowledge';
export const ROUTE_KNOWLEDGE_SOURCE: string = 'knowledgeSource';

// Issue #38：工作人员处理与维修备案。
/** 工作人员工作台：报修队列（待受理 / 我负责 / 全部）。 */
export const ROUTE_STAFF_ORDERS: string = 'staff-repair-orders';
/** 报修详情：受理、推进、取消、建档入口。 */
export const ROUTE_STAFF_ORDER_DETAIL: string = 'staff-repair-order-detail';
/** 维修备案：草稿编辑、照片、提交审核。 */
export const ROUTE_STAFF_RECORD: string = 'staff-repair-record';
/** 管理员：待审核备案列表与审核操作。 */
export const ROUTE_STAFF_REVIEW: string = 'staff-repair-review';

// Issue #40：典型案例库（知识回流）。
/** 工作人员：案例列表（按状态筛选，管理员可进入详情管理）。 */
export const ROUTE_CASE_LIBRARY: string = 'knowledge-case-library';
/** 案例详情：结构化正文、多来源证据与管理员动作。 */
export const ROUTE_CASE_DETAIL: string = 'knowledge-case-detail';
