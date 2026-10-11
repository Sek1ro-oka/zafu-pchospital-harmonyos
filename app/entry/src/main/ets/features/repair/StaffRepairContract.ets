// 工作人员处理与维修备案契约（Issue #38）。
//
// 与后端 /api/v1/staff/repair-orders/* 和 /api/v1/repairs/* 的返回一一对应。
// 报修单（处理流）与维修备案（审核流）是**两个不同对象**，各自的字段与状态
// 在这里分开定义，界面分别展示，互不冒充。

import { RepairOrderEventView } from './RepairOrderContract';

/** 队列范围（服务端白名单）。 */
export const STAFF_SCOPE_UNASSIGNED: string = 'unassigned';
export const STAFF_SCOPE_MINE: string = 'mine';
export const STAFF_SCOPE_ALL: string = 'all';

/** 服务端计算的工作人员允许动作；客户端只读渲染，不作为授权依据。 */
export interface RepairOrderStaffActions {
  canAccept: boolean;
  canStartRepair: boolean;
  canComplete: boolean;
  canCancel: boolean;
  canCreateRecord: boolean;
}

/** 关联备案摘要（工作人员详情用）。 */
export interface StaffRecordSummary {
  id: string;
  status: string;
  result: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
}

/** 工作人员视角的报修单（队列与详情共用）。 */
export interface StaffRepairOrderView {
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
  assignee: StaffAssigneeView | null;
  record: StaffRecordSummary | null;
  actions: RepairOrderStaffActions;
}

export interface StaffAssigneeView {
  memberProfileId: string;
  name: string;
}

/** 备案照片。 */
export interface RepairPhotoView {
  id: string;
  contentUrl: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  createdAt: string;
}

/** 分类字典项（GET /api/v1/repair-categories）。 */
export interface RepairCategoryView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface RepairReviewView {
  id: string;
  decision: string;
  note: string | null;
  reviewerName: string;
  createdAt: string;
}

export interface RepairTimelineView {
  id: string;
  eventType: string;
  actorName: string | null;
  createdAt: string;
}

/** 照片限制随详情下发（来自服务端 uploadLimits）。 */
export interface RepairPhotoLimits {
  maxBytes: number;
  maxFiles: number;
}

/** 备案基础形状（审核接口与详情共用的部分）。 */
export interface RepairRecordView {
  id: string;
  member: RepairRecordMemberView;
  repairDate: string | null;
  durationMinutes: number | null;
  category: RepairCategoryView | null;
  deviceModel: string | null;
  content: string | null;
  result: string | null;
  remark: string | null;
  status: string;
  /** 疑难/典型案例标记（Issue #40：典型标记才是案例整理的触发条件）。 */
  isTypical: boolean;
  isDifficult: boolean;
  version: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  photos: RepairPhotoView[];
}

export interface RepairRecordMemberView {
  id: string;
  name: string;
}

/** 备案详情（含编辑与审核视角标记，来自 GET /api/v1/repairs/[id]）。 */
export interface RepairRecordDetailView extends RepairRecordView {
  canEdit: boolean;
  canReview: boolean;
  photoLimits: RepairPhotoLimits;
  reviews: RepairReviewView[];
  timeline: RepairTimelineView[];
}

/** 从报修单建立备案的返回：只取后续跳转需要的字段。 */
export interface RecordCreateResult {
  id: string;
  version: number;
}

/**
 * 保存草稿的请求体（版本号 + 可空字段）。
 *
 * 平台网络层（`@ohos.net.http`）的 RequestMethod 枚举不含 PATCH，
 * 因此 App 的编辑请求走 `POST /api/v1/repairs/[id]`（服务端与 PATCH 同语义的部分更新），
 * 详见 backend/docs/native-repairs-api.md。
 */
export interface RepairRecordSaveRequest {
  version: number;
  repairDate: string | null;
  durationMinutes: number | null;
  categoryId: string | null;
  content: string | null;
  result: string | null;
  remark: string | null;
}

/** 受理请求体（说明选填）。 */
export interface StaffNoteBody {
  note?: string;
}

/** 推进请求体（目标状态 + 说明选填）。 */
export interface StaffProgressBody {
  toStatus: string;
  note?: string;
}

/** 取消请求体（说明必填，服务端再校验）。 */
export interface StaffCancelBody {
  note: string;
}

/** 单条审核请求体（幂等键在请求体里，与 Web 管理端一致）。 */
export interface RepairReviewBody {
  decision: string;
  idempotencyKey: string;
  note?: string;
}

/** 保存草稿的字段集合（版本号单独传）。 */
export interface RepairRecordFields {
  repairDate: string | null;
  durationMinutes: number | null;
  categoryId: string | null;
  content: string | null;
  result: string | null;
  remark: string | null;
}

/** 导航参数：工作人员详情页。 */
export interface StaffOrderParam {
  orderId: string;
}

/** 导航参数：备案编辑页（附带报修单原故障描述作参考）。 */
export interface StaffRecordParam {
  recordId: string;
  faultDescription: string;
}

/** 备案状态 → 界面文案。 */
export function repairRecordStatusLabel(status: string): string {
  if (status === 'DRAFT') {
    return '草稿';
  }
  if (status === 'PENDING') {
    return '待审核';
  }
  if (status === 'APPROVED') {
    return '已通过';
  }
  if (status === 'REJECTED') {
    return '已退回';
  }
  return status;
}

/** 报修单详情上的「备案状态」：没有关联备案时显示未建档。 */
export function recordSummaryLabel(summary: StaffRecordSummary | null): string {
  if (summary === null) {
    return '未建档';
  }
  return repairRecordStatusLabel(summary.status);
}

/** 维修结果文案；未填写时不假装成功。 */
export function repairResultLabel(result: string | null): string {
  if (result === 'COMPLETED') {
    return '已完成';
  }
  if (result === 'NOT_COMPLETED') {
    return '未完成';
  }
  return '未填写';
}

/** 事件文案：时间线只读展示。 */
export function repairTimelineEventLabel(eventType: string): string {
  if (eventType === 'CREATED') {
    return '创建草稿';
  }
  if (eventType === 'UPDATED') {
    return '修改记录';
  }
  if (eventType === 'PHOTO_ADDED') {
    return '添加照片';
  }
  if (eventType === 'PHOTO_REMOVED') {
    return '移除照片';
  }
  if (eventType === 'SUBMITTED') {
    return '提交审核';
  }
  if (eventType === 'RESUBMITTED') {
    return '重新提交';
  }
  if (eventType === 'APPROVED') {
    return '审核通过';
  }
  if (eventType === 'REJECTED') {
    return '审核退回';
  }
  if (eventType === 'DELETED') {
    return '已删除';
  }
  return eventType;
}

/**
 * 客户端侧字段上限：与后端 repair-validation.ts 的 repairFieldLimits 对齐，
 * 只用于提交前的即时提示；服务端仍是权威校验。
 */
export interface RepairRecordLimits {
  contentMaxLength: number;
  remarkMaxLength: number;
  durationMinutesMin: number;
  durationMinutesMax: number;
  repairDateMin: string;
}

export const REPAIR_RECORD_LIMITS: RepairRecordLimits = {
  contentMaxLength: 10000,
  remarkMaxLength: 2000,
  durationMinutesMin: 1,
  durationMinutesMax: 10080,
  repairDateMin: '2020-01-01',
};

export const REPAIR_RECORD_DEFAULT_PAGE_SIZE: number = 20;
