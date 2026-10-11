// 客户报修单契约（Issue #37）：字段与后端 /api/v1/repair-orders 的返回一一对应。
//
// ⚠️ 与「维修备案」是**两个不同对象**：备案是工作人员对维修过程的记录，
// 由工作人员工作台（Issue #38）承载；本文件描述的是客户提交的故障申报。
// 后端刻意不返回 createRequestKey / assigneeMemberProfileId / repairRecordId，
// 客户端因此也拿不到，不要在这里补上。

/** 报修单处理状态，与后端 RepairOrderStatus 枚举逐字对齐。 */
export const REPAIR_ORDER_SUBMITTED: string = 'SUBMITTED';
export const REPAIR_ORDER_ACCEPTED: string = 'ACCEPTED';
export const REPAIR_ORDER_REPAIRING: string = 'REPAIRING';
export const REPAIR_ORDER_COMPLETED: string = 'COMPLETED';
export const REPAIR_ORDER_CANCELLED: string = 'CANCELLED';

/** 进度事件：每次状态变更留一条，用于渲染时间线。 */
export interface RepairOrderEventView {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
}

/** 报修单对外形状（列表与详情共用）。 */
export interface RepairOrderView {
  id: string;
  deviceModel: string;
  deviceSerial: string | null;
  faultDescription: string;
  contactPhone: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastProgressAt: string | null;
  events: RepairOrderEventView[];
}

/** POST /api/v1/repair-orders 的请求体。 */
export interface RepairOrderSubmitRequest {
  deviceModel: string;
  deviceSerial?: string;
  faultDescription: string;
  contactPhone: string;
}

/** 分页元信息：与后端 paginationMeta 对齐。 */
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** GET /api/v1/repair-orders 的信封 meta 分页（ApiClient 只拆出 data，故单列）。 */
export interface RepairOrderListData {
  items: RepairOrderView[];
  pagination: PageMeta;
}

/**
 * 客户端侧字段上限：与后端 repair-order-validation.ts 对齐，用于提交前即时提示。
 * 用显式 interface（不是 Record 字面量）—— ArkTS 不允许无声明类型的对象字面量。
 */
export interface RepairOrderLimits {
  deviceModelMaxLength: number;
  deviceSerialMaxLength: number;
  faultDescriptionMinLength: number;
  faultDescriptionMaxLength: number;
  contactPhoneMinLength: number;
  contactPhoneMaxLength: number;
}

export const REPAIR_ORDER_LIMITS: RepairOrderLimits = {
  deviceModelMaxLength: 60,
  deviceSerialMaxLength: 120,
  faultDescriptionMinLength: 5,
  faultDescriptionMaxLength: 2000,
  contactPhoneMinLength: 5,
  contactPhoneMaxLength: 32,
};

/**
 * 状态 → 界面文案。
 * 状态值本身是服务端契约，界面上不直接展示英文，统一在这里映射。
 */
export function repairOrderStatusLabel(status: string): string {
  if (status === REPAIR_ORDER_SUBMITTED) {
    return '待受理';
  }
  if (status === REPAIR_ORDER_ACCEPTED) {
    return '已受理';
  }
  if (status === REPAIR_ORDER_REPAIRING) {
    return '维修中';
  }
  if (status === REPAIR_ORDER_COMPLETED) {
    return '已完成';
  }
  if (status === REPAIR_ORDER_CANCELLED) {
    return '已取消';
  }
  // 未知状态原样展示，好过在界面上凭空猜一个中文名。
  return status;
}

/** 两位补零。ArkTS 不允许把箭头函数赋值给 const 后调用，所以用函数声明。 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * 时间显示：解析 ISO 字符串并按本地时区格式化为 `YYYY-MM-DD HH:mm`。
 * 直接截取 UTC 字符串会导致时区错误（如 `04:30Z` 显示为 `04:30` 而非北京 `12:30`）。
 */
export function formatOrderTime(iso: string): string {
  if (iso === null || iso === undefined || iso === '') {
    return '';
  }
  const d: Date = new Date(iso);
  if (isNaN(d.getTime())) {
    return iso.length < 16 ? iso : `${iso.substring(0, 10)} ${iso.substring(11, 16)}`;
  }
  const year: number = d.getFullYear();
  const month: number = d.getMonth() + 1;
  const day: number = d.getDate();
  const hours: number = d.getHours();
  const minutes: number = d.getMinutes();
  return `${year}-${pad2(month)}-${pad2(day)} ${pad2(hours)}:${pad2(minutes)}`;
}
