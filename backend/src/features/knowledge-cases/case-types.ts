/**
 * 典型案例（知识回流）的共享常量与类型（Issue #40）。
 *
 * 案例由已审核维修备案自动整理/合并生成，默认 `STAFF` 可见；
 * `status` 同时表达「可检索 / 撤回 / 需重整」三种状态语义：
 * 只有 `PUBLISHED` 参与检索与来源读取。
 */

export const CASE_STATUSES = ["PUBLISHED", "REPROCESSING", "FAILED", "WITHDRAWN"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_VISIBILITIES = ["STAFF", "PUBLIC"] as const;
export type CaseVisibility = (typeof CASE_VISIBILITIES)[number];

/** 来源贡献状态：PENDING（已标记待处理）/ PROCESSING（持有租约）/ PUBLISHED（已入案例）/ FAILED / REMOVED（已移除贡献）。 */
export const CASE_SOURCE_STATUSES = ["PENDING", "PROCESSING", "PUBLISHED", "FAILED", "REMOVED"] as const;
export type CaseSourceStatus = (typeof CASE_SOURCE_STATUSES)[number];

/**
 * 案例维修结果。`MIXED` 表示多个来源结果不一致（如一条已完成、一条未完成），
 * 由服务端按来源结果强制推导，模型无权把混合结果写成单一结论。
 */
export const CASE_RESULTS = ["COMPLETED", "NOT_COMPLETED", "MIXED", "UNKNOWN"] as const;
export type CaseResult = (typeof CASE_RESULTS)[number];

/** 撤回来源：管理员主动撤回（普通重试/重建不会自动恢复）或来源耗尽被撤下。 */
export const CASE_WITHDRAWN_SOURCES = ["ADMIN", "SOURCES_EXHAUSTED"] as const;
export type CaseWithdrawnSource = (typeof CASE_WITHDRAWN_SOURCES)[number];

export const CASE_EMBEDDING_STATUSES = ["PENDING", "READY", "FAILED"] as const;
export type CaseEmbeddingStatus = (typeof CASE_EMBEDDING_STATUSES)[number];

/** 结构化案例正文（模型输出的受控部分；证据与来源对应关系单独保存）。 */
export type CaseStructuredContent = {
  title: string;
  deviceModel: string | null;
  /** 故障现象 */
  fault: string | null;
  /** 排查过程 */
  investigation: string | null;
  /** 原因（来源未写明时保持 null，不推断） */
  cause: string | null;
  /** 处置 */
  resolution: string | null;
  result: CaseResult;
  category: string | null;
  /** 多来源差异说明（结果/条件/处置不同时逐来源说明） */
  differences: string | null;
  /** 服务端按 null 字段生成的「原文未提供」清单。 */
  unknowns: string[];
  /** 合并/新建依据（模型说明，供审查与展示）。 */
  mergeReason: string | null;
};

/** 单条来源证据：quote 必须是该来源材料文本的子串（服务端校验）。 */
export type CaseEvidence = {
  field: string;
  quote: string;
};

/** 来源贡献的发布时快照（证据 + 材料，重新校验与展示用）。 */
export type CaseSourceEvidenceSnapshot = {
  material: {
    deviceModel: string | null;
    categoryName: string | null;
    content: string | null;
    result: string | null;
    remark: string | null;
    repairDate: string | null;
  };
  quotes: CaseEvidence[];
  mergeReason: string | null;
};

/** 案例引用块 ID：与内容版本绑定，正文变化后旧版本引用按过期处理。 */
export function caseChunkId(caseId: string, contentVersion: number): string {
  return `kcase_${caseId}_v${contentVersion}`;
}

const CASE_CHUNK_PATTERN = /^kcase_([0-9a-fA-F-]{36})_v(\d+)$/;

export function parseCaseChunkId(sourceId: string): { caseId: string; contentVersion: number } | null {
  const match = CASE_CHUNK_PATTERN.exec(sourceId);
  if (!match) return null;
  return { caseId: match[1], contentVersion: Number.parseInt(match[2], 10) };
}

/** 案例块在检索索引中的来源路径前缀（区别于文档快照与内部资料）。 */
export const CASE_SOURCE_PATH_PREFIX = "cases/";
