// 典型案例（知识回流）契约：字段与后端 /api/v1/knowledge-cases/* 的返回一一对应
// （见 backend/docs/knowledge-cases-api.md）。
//
// 状态、能力标记（canMark/canUnmark/canRetry/canManage...）全部由服务端计算，
// 客户端只读渲染并据此显示按钮，不作为授权依据。

/** 备案的来源贡献状态（与后端 RecordCaseProcessingView.status 一致）。 */
export const RECORD_CASE_STATUS_NONE: string = 'NONE';
export const RECORD_CASE_STATUS_PENDING: string = 'PENDING';
export const RECORD_CASE_STATUS_PROCESSING: string = 'PROCESSING';
export const RECORD_CASE_STATUS_PUBLISHED: string = 'PUBLISHED';
export const RECORD_CASE_STATUS_FAILED: string = 'FAILED';

/** 案例状态。 */
export const CASE_STATUS_PUBLISHED: string = 'PUBLISHED';
export const CASE_STATUS_REPROCESSING: string = 'REPROCESSING';
export const CASE_STATUS_FAILED: string = 'FAILED';
export const CASE_STATUS_WITHDRAWN: string = 'WITHDRAWN';

/** 可见范围。 */
export const CASE_VISIBILITY_STAFF: string = 'STAFF';
export const CASE_VISIBILITY_PUBLIC: string = 'PUBLIC';

export const CASE_LIST_PAGE_SIZE: number = 20;

/** 备案的典型整理状态视图（GET /api/v1/knowledge-cases/records/[id]/status）。 */
export interface RecordCaseProcessingView {
  recordId: string;
  isTypical: boolean;
  canMark: boolean;
  canUnmark: boolean;
  canRetry: boolean;
  status: string;
  caseId: string | null;
  caseStatus: string | null;
  caseTitle: string | null;
  caseVisibility: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  updatedAt: string | null;
}

/** 标记/重试后的一次处理产出（POST typical / POST retry 的 outcome）。 */
export interface CaseProcessOutcome {
  status: string;
  caseId: string | null;
  caseStatus: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  notes: string[];
}

/** 重试结果：state 是最新状态，outcome 是本次动作的真实产出（可能为 null）。 */
export interface RecordCaseRetryResult {
  state: RecordCaseProcessingView;
  outcome: CaseProcessOutcome | null;
}

/** 单条来源证据：quote 是来源材料原文的子串。 */
export interface CaseEvidence {
  field: string;
  quote: string;
}

/** 结构化案例正文。 */
export interface CaseStructuredContent {
  title: string;
  deviceModel: string | null;
  fault: string | null;
  investigation: string | null;
  cause: string | null;
  resolution: string | null;
  result: string;
  category: string | null;
  differences: string | null;
  unknowns: string[];
  mergeReason: string | null;
}

/** 案例列表项。 */
export interface CaseListItem {
  id: string;
  title: string;
  status: string;
  visibility: string;
  contentVersion: number;
  sourceCount: number;
  failureCode: string | null;
  failureMessage: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

/** 案例详情中的一条来源。 */
export interface CaseSourceView {
  id: string;
  recordId: string;
  authorName: string;
  repairDate: string | null;
  categoryName: string | null;
  deviceModel: string | null;
  result: string | null;
  quotes: CaseEvidence[];
  attachedAt: string | null;
}

/** 案例详情（GET /api/v1/knowledge-cases/[id]）。 */
export interface CaseDetailView {
  id: string;
  title: string;
  status: string;
  visibility: string;
  contentVersion: number;
  content: CaseStructuredContent;
  displayText: string;
  model: string | null;
  promptVersion: string | null;
  embedding: CaseEmbeddingView;
  failure: CaseFailureView | null;
  withdrawn: CaseWithdrawnView | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sources: CaseSourceView[];
  actions: CaseActionsView;
}

export interface CaseEmbeddingView {
  status: string;
  fingerprint: string | null;
  error: string | null;
}

export interface CaseFailureView {
  code: string;
  message: string;
}

export interface CaseWithdrawnView {
  source: string;
  at: string | null;
}

/** 服务端计算的管理能力（仅管理员为 true）。 */
export interface CaseActionsView {
  canManage: boolean;
  canReprocess: boolean;
  canRestore: boolean;
  canReembed: boolean;
}

/** 案例引用详情中的一条来源证据（客户看不到作者与备案 ID：字段为 null）。 */
export interface KnowledgeCaseCitationSource {
  index: number;
  authorName: string | null;
  repairDate: string | null;
  categoryName: string | null;
  deviceModel: string | null;
  result: string | null;
  quotes: CaseEvidence[];
  repairRecordId: string | null;
  canOpen: boolean;
}

/** 案例引用详情（引用详情页的案例分支）。 */
export interface KnowledgeCaseCitationDetail {
  caseId: string;
  title: string;
  status: string;
  visibility: string;
  contentVersion: number;
  content: CaseStructuredContent;
  displayText: string;
  model: string | null;
  promptVersion: string | null;
  publishedAt: string | null;
  updatedAt: string;
  sources: KnowledgeCaseCitationSource[];
}

/** 导航参数：案例详情页。 */
export interface CaseDetailParam {
  caseId: string;
  title: string;
}

/** 列表查询条件（服务端白名单校验）。 */
export interface CaseListQuery {
  status: string;
  visibility: string;
  page: number;
}

/** 备案的典型处理状态文案；未知值原样返回，不美化。 */
export function recordCaseStatusLabel(status: string): string {
  if (status === RECORD_CASE_STATUS_NONE) {
    return '未标记典型案例';
  }
  if (status === RECORD_CASE_STATUS_PENDING) {
    return '已标记，等待整理';
  }
  if (status === RECORD_CASE_STATUS_PROCESSING) {
    return 'AI 正在整理';
  }
  if (status === RECORD_CASE_STATUS_PUBLISHED) {
    return '已入库可检索';
  }
  if (status === RECORD_CASE_STATUS_FAILED) {
    return '整理失败';
  }
  return status;
}

/** 案例状态文案。 */
export function caseStatusLabel(status: string): string {
  if (status === CASE_STATUS_PUBLISHED) {
    return '已发布';
  }
  if (status === CASE_STATUS_REPROCESSING) {
    return '重整中';
  }
  if (status === CASE_STATUS_FAILED) {
    return '整理失败';
  }
  if (status === CASE_STATUS_WITHDRAWN) {
    return '已撤回';
  }
  return status;
}

/** 可见范围文案。 */
export function caseVisibilityLabel(visibility: string): string {
  if (visibility === CASE_VISIBILITY_STAFF) {
    return '内部可见（仅工作人员）';
  }
  if (visibility === CASE_VISIBILITY_PUBLIC) {
    return '公开可见（含客户）';
  }
  return visibility;
}

/** 案例维修结果文案；MIXED 必须如实说明多来源结果不一致。 */
export function caseResultLabel(result: string): string {
  if (result === 'COMPLETED') {
    return '已完成';
  }
  if (result === 'NOT_COMPLETED') {
    return '未完成';
  }
  if (result === 'MIXED') {
    return '多来源结果不一致';
  }
  if (result === 'UNKNOWN') {
    return '未写明';
  }
  return result;
}

/** 撤回来源文案。 */
export function caseWithdrawnLabel(source: string): string {
  if (source === 'ADMIN') {
    return '管理员撤回';
  }
  if (source === 'SOURCES_EXHAUSTED') {
    return '来源已全部移除，自动撤下';
  }
  return source;
}

/** 向量状态文案。 */
export function caseEmbeddingLabel(status: string): string {
  if (status === 'READY') {
    return '已生成';
  }
  if (status === 'PENDING') {
    return '待生成';
  }
  if (status === 'FAILED') {
    return '生成失败（先按关键词检索）';
  }
  return status;
}

/** 来源结果文案（与备案一致的口径）。 */
export function caseSourceResultLabel(result: string | null): string {
  if (result === 'COMPLETED') {
    return '已完成';
  }
  if (result === 'NOT_COMPLETED') {
    return '未完成';
  }
  return '未填写';
}

/** 证据字段名文案。 */
export function caseEvidenceFieldLabel(field: string): string {
  if (field === 'fault') {
    return '故障现象';
  }
  if (field === 'investigation') {
    return '排查过程';
  }
  if (field === 'cause') {
    return '原因';
  }
  if (field === 'resolution') {
    return '处置';
  }
  if (field === 'device_model') {
    return '设备机型';
  }
  if (field === 'category') {
    return '故障分类';
  }
  return field;
}
