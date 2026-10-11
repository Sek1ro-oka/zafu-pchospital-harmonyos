// 典型案例面板的纯状态迁移与展示文案（无 ArkUI 依赖，可被回归用例执行）。
//
// 关键不变量：
// - 按钮可见性只来自服务端计算的能力标记（canMark/canUnmark/canRetry），客户端不推断权限；
// - 「重试」只在服务端说可以重试（canRetry）时出现，避免给出必然 409 的死按钮；
// - 失败的 originalMessage 原样展示，不伪装成成功或吞掉错误。

import {
  CASE_STATUS_FAILED,
  CASE_STATUS_PUBLISHED,
  CASE_STATUS_REPROCESSING,
  CASE_STATUS_WITHDRAWN,
  CaseStructuredContent,
  RecordCaseProcessingView,
  RECORD_CASE_STATUS_FAILED,
  RECORD_CASE_STATUS_NONE,
  RECORD_CASE_STATUS_PENDING,
  RECORD_CASE_STATUS_PROCESSING,
  RECORD_CASE_STATUS_PUBLISHED,
  recordCaseStatusLabel,
} from './KnowledgeCaseContract';

/** 面板模式：由服务端状态映射，决定主文案与按钮组合。 */
export const PANEL_MODE_UNMARKED: string = 'unmarked';
export const PANEL_MODE_PENDING: string = 'pending';
export const PANEL_MODE_PROCESSING: string = 'processing';
export const PANEL_MODE_PUBLISHED: string = 'published';
export const PANEL_MODE_FAILED: string = 'failed';

export interface TypicalPanelModel {
  mode: string;
  /** 状态行文案（如「已入库可检索」）。 */
  summary: string;
  /** 补充说明：失败原因或案例标题 + 可见范围。 */
  detail: string;
  showMark: boolean;
  showUnmark: boolean;
  showRetry: boolean;
  /** 是否展示「打开关联案例」按钮。 */
  canOpenCase: boolean;
}

function modeOf(status: string): string {
  if (status === RECORD_CASE_STATUS_NONE) {
    return PANEL_MODE_UNMARKED;
  }
  if (status === RECORD_CASE_STATUS_PENDING) {
    return PANEL_MODE_PENDING;
  }
  if (status === RECORD_CASE_STATUS_PROCESSING) {
    return PANEL_MODE_PROCESSING;
  }
  if (status === RECORD_CASE_STATUS_PUBLISHED) {
    return PANEL_MODE_PUBLISHED;
  }
  if (status === RECORD_CASE_STATUS_FAILED) {
    return PANEL_MODE_FAILED;
  }
  return PANEL_MODE_UNMARKED;
}

/**
 * 状态行文案：来源贡献状态与**案例当前状态**分开表达。
 * 「来源已入库」不等于「案例可检索」——管理员撤回 / 重整中 / 整理失败的案例
 * 都不参与检索，必须如实显示，不能继续写「已入库可检索」。
 */
function summaryOf(view: RecordCaseProcessingView): string {
  const status: string = view.status;
  if (status === RECORD_CASE_STATUS_PUBLISHED) {
    const caseStatus: string | null = view.caseStatus;
    if (caseStatus === CASE_STATUS_PUBLISHED) {
      return '已入库可检索';
    }
    if (caseStatus === CASE_STATUS_WITHDRAWN) {
      return '来源已入库，案例已撤回（暂不参与检索）';
    }
    if (caseStatus === CASE_STATUS_REPROCESSING) {
      return '来源已入库，案例重整中（暂不参与检索）';
    }
    if (caseStatus === CASE_STATUS_FAILED) {
      return '来源已入库，案例整理失败（暂不参与检索）';
    }
    return '来源已入库';
  }
  if (status === RECORD_CASE_STATUS_NONE && view.isTypical) {
    // 来源被移除（归一为 NONE）但仍是典型：如实说明可重试，不显示「未标记」。
    return '来源暂未入库';
  }
  return recordCaseStatusLabel(status);
}

/** 由服务端状态计算面板模型。按钮可见性只来自服务端能力标记。 */
export function typicalPanelModel(view: RecordCaseProcessingView): TypicalPanelModel {
  const mode: string = modeOf(view.status);
  let detail: string = '';
  if (view.failureMessage !== null && view.failureMessage !== '') {
    detail = view.failureMessage;
  } else if (view.status === RECORD_CASE_STATUS_PUBLISHED && view.caseTitle !== null) {
    detail = view.caseTitle;
    if (view.caseVisibility !== null) {
      detail += view.caseVisibility === 'PUBLIC' ? '（公开可见）' : '（内部可见）';
    }
    if (view.caseStatus === CASE_STATUS_WITHDRAWN) {
      detail += '；需管理员在案例库中显式恢复';
    }
  }
  return {
    mode: mode,
    summary: summaryOf(view),
    detail: detail,
    showMark: view.canMark && !view.isTypical,
    showUnmark: view.canUnmark && view.isTypical,
    // 重试完全跟随服务端 canRetry（覆盖 NONE/来源被移除后的恢复入口），客户端不加额外条件。
    showRetry: view.canRetry,
    canOpenCase: view.caseId !== null
  };
}

/**
 * 写操作上下文守卫：面板的标记/重试/取消响应只能写回**发起时**的备案与代次。
 * 切换备案（@Watch 触发 load 推进代次）或同一备案刷新后，旧响应一律丢弃——
 * 否则 A 的迟到结果会覆盖已切到 B 的面板（展示与实际操作对象不一致）。
 */
export function isActionContextCurrent(
  currentRecordId: string,
  currentGeneration: number,
  actionRecordId: string,
  actionGeneration: number,
): boolean {
  return actionRecordId === currentRecordId && actionGeneration === currentGeneration;
}

/** 「原文未提供」清单文案；为空返回空串（不显示空行）。 */
export function unknownsText(unknowns: string[]): string {
  if (unknowns.length === 0) {
    return '';
  }
  return `原文未提供：${unknowns.join('、')}`;
}

/** 结构化正文的字段行（字段名 + 值）；null/空值跳过，未知保持「未提供」。 */
export interface CaseContentRow {
  label: string;
  value: string;
}

export function contentRows(content: CaseStructuredContent): CaseContentRow[] {
  const rows: CaseContentRow[] = [];
  const push = (label: string, value: string | null): void => {
    if (value !== null && value !== '') {
      rows.push({ label: label, value: value });
    }
  };
  push('故障现象', content.fault);
  push('排查过程', content.investigation);
  push('原因', content.cause);
  push('处置', content.resolution);
  push('差异说明', content.differences);
  push('合并依据', content.mergeReason);
  push('设备机型', content.deviceModel);
  push('故障分类', content.category);
  return rows;
}
