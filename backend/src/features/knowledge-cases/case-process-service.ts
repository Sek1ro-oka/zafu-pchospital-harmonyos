import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { AppError } from "@/lib/api/errors";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { callChatModel, ChatModelError, type ChatModelMessage } from "@/features/knowledge/chat-model";
import {
  providerLabelFromUrl,
  readChatModelConfig,
  readEmbeddingConfig,
} from "@/features/knowledge/config";
import { embedTexts } from "@/features/knowledge/embedding";

import { readCaseProcessingConfig, type CaseProcessingConfig } from "./case-config";
import { cosineSimilarity, decodeVector, encodeVector } from "./case-vector";
import {
  caseContentHashOf,
  materialHashOf,
  materialOf,
  materialTextOf,
  normalizeText,
  renderCaseDisplayText,
  type RepairMaterial,
} from "./case-material";
import {
  buildCaseMessages,
  buildRegenerateMessages,
  CASE_PROMPT_VERSION,
  parseCaseModelOutput,
  type CaseModelCandidateInput,
  type CaseModelSourceInput,
} from "./case-model";
import {
  CASE_SOURCE_STATUSES,
  type CaseEvidence,
  type CaseSourceEvidenceSnapshot,
  type CaseSourceStatus,
  type CaseStatus,
  type CaseStructuredContent,
  type CaseVisibility,
} from "./case-types";

/**
 * 案例自动处理流水线（Issue #40 §4–§6）。
 *
 * 一次来源处理 = 候选规划（哈希去重 + 向量/机型/分类预筛）→ 一次模型调用
 * （合并判断 + 正文生成一并完成）→ 服务端校验 → 案例向量 → **版本/哈希复核后原子发布**。
 *
 * 并发与失效口径：
 * - 来源处理用 `generation` 租约防重复；租约过期可安全接管；
 * - 发布事务内复核来源仍 APPROVED、仍典型、内容哈希未变，目标案例状态/范围/版本未变，
 *   且目标案例的有效来源集合与决策时一致 —— 模型期间的撤回/修改/合并都会使旧结果作废；
 * - 「完全重复」直接复用已有案例并挂接来源（不再调用模型）；
 * - 管理员主动撤回的案例不能被普通处理/重试恢复（`CASE_WITHDRAWN`）。
 */

export const CASE_FAILURE_CODES = {
  MODEL_NOT_CONFIGURED: "MODEL_NOT_CONFIGURED",
  MODEL_TIMEOUT: "MODEL_TIMEOUT",
  MODEL_RATE_LIMITED: "MODEL_RATE_LIMITED",
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
  MODEL_OUTPUT_INVALID: "MODEL_OUTPUT_INVALID",
  BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED",
  STALE_INPUT: "STALE_INPUT",
  CASE_WITHDRAWN: "CASE_WITHDRAWN",
  CASE_VERSION_CONFLICT: "CASE_VERSION_CONFLICT",
  CASE_VISIBILITY_CHANGED: "CASE_VISIBILITY_CHANGED",
  CASE_SOURCES_CHANGED: "CASE_SOURCES_CHANGED",
  CASE_STATE_CONFLICT: "CASE_STATE_CONFLICT",
  CASE_SOURCE_LIMIT: "CASE_SOURCE_LIMIT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

const RECORD_INCLUDE = {
  memberProfile: { select: { userId: true } },
  category: { select: { name: true } },
} satisfies Prisma.RepairRecordInclude;

const CASE_WITH_SOURCES = {
  sources: { where: { status: "PUBLISHED" }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.KnowledgeCaseInclude;
type CaseWithSources = Prisma.KnowledgeCaseGetPayload<{ include: typeof CASE_WITH_SOURCES }>;

/**
 * 单案例来源上限（= 单次渲染上限）：模型一次只能忠实覆盖这么多来源。
 * 达到上限后的合并/挂接被**明确拒绝**（`CASE_SOURCE_LIMIT`，可人工处理），
 * 而不是静默只把前 8 条交给模型导致正文抹掉已合入来源的事实。
 */
const MAX_SOURCES_PER_CASE = 8;
const MAX_RENDERED_SOURCES_PER_CANDIDATE = MAX_SOURCES_PER_CASE;
/** 案例向量：一个案例一个块（displayText），与文档块同维度同 provider 才能参与混合检索。 */
const MIN_EMBEDDING_BUDGET_MS = 3000;

export type ProcessSourceOutcome = {
  /** PUBLISHED=已入案例；FAILED=处理失败可重试；REMOVED=来源已失效被移除；SKIPPED/BUSY=未产生新结果。 */
  status: "PUBLISHED" | "FAILED" | "REMOVED" | "SKIPPED" | "BUSY";
  caseId: string | null;
  caseStatus: CaseStatus | null;
  failureCode: string | null;
  failureMessage: string | null;
  notes: string[];
};

export type ProcessSourceOptions = {
  actorUserId: string | null;
  requestId: string;
  /** 测试注入；默认走真实模型与向量服务。 */
  callModelFn?: typeof callChatModel;
  embedFn?: typeof embedTexts;
};

function failureOf(error: unknown): { code: string; message: string } {
  if (error instanceof ChatModelError) {
    if (error.kind === "timeout") return { code: CASE_FAILURE_CODES.MODEL_TIMEOUT, message: "整理模型超时，可重试" };
    if (error.kind === "rate_limited")
      return { code: CASE_FAILURE_CODES.MODEL_RATE_LIMITED, message: "整理模型当前限流，可重试" };
    if (error.kind === "bad_response")
      return { code: CASE_FAILURE_CODES.MODEL_OUTPUT_INVALID, message: `整理模型输出无法使用：${error.message}` };
    return { code: CASE_FAILURE_CODES.MODEL_UNAVAILABLE, message: "整理模型暂时不可用，可重试" };
  }
  if (error instanceof AppError) {
    return {
      code: error.code === "AI_NOT_CONFIGURED" ? CASE_FAILURE_CODES.MODEL_NOT_CONFIGURED : error.code,
      message: error.message,
    };
  }
  return { code: CASE_FAILURE_CODES.INTERNAL_ERROR, message: "整理过程出现未预期错误，可重试" };
}

function evidenceSnapshotOf(evidence: Prisma.JsonValue | null): CaseSourceEvidenceSnapshot | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const record = evidence as Record<string, unknown>;
  const material = record.material;
  if (!material || typeof material !== "object" || Array.isArray(material)) return null;
  const m = material as Record<string, unknown>;
  const read = (value: unknown): string | null => (typeof value === "string" ? value : null);
  const quotes = Array.isArray(record.quotes)
    ? record.quotes
        .map((entry) => {
          const item = entry as Record<string, unknown>;
          const field = read(item.field);
          const quote = read(item.quote);
          return field && quote ? { field, quote } : null;
        })
        .filter((entry): entry is CaseEvidence => entry !== null)
    : [];
  return {
    material: {
      deviceModel: read(m.deviceModel),
      categoryName: read(m.categoryName),
      content: read(m.content),
      result: read(m.result),
      remark: read(m.remark),
      repairDate: read(m.repairDate),
    },
    quotes,
    mergeReason: read(record.mergeReason),
  };
}

function snapshotToMaterial(snapshot: CaseSourceEvidenceSnapshot): RepairMaterial {
  return {
    deviceModel: snapshot.material.deviceModel,
    categoryName: snapshot.material.categoryName,
    content: snapshot.material.content,
    result: snapshot.material.result,
    remark: snapshot.material.remark,
  };
}

function buildEvidenceSnapshot(
  material: RepairMaterial,
  repairDate: string | null,
  quotes: CaseEvidence[],
  mergeReason: string | null,
): CaseSourceEvidenceSnapshot {
  return {
    material: {
      deviceModel: material.deviceModel,
      categoryName: material.categoryName,
      content: material.content,
      result: material.result,
      remark: material.remark,
      repairDate,
    },
    quotes,
    mergeReason,
  };
}

export function repairDateOf(record: { repairDate: Date | null }): string | null {
  return record.repairDate ? record.repairDate.toISOString().slice(0, 10) : null;
}

function similarityQueryOf(material: RepairMaterial): string {
  return normalizeText(
    [material.deviceModel, material.categoryName, material.content?.slice(0, 300)].filter(Boolean).join(" "),
  )?.slice(0, 400) ?? "";
}

type CandidatePlan = {
  exactDuplicateCaseId: string | null;
  /** 完全重复目标的规划时可见范围（挂接事务复核用）。 */
  exactDuplicateVisibility: CaseVisibility | null;
  candidates: CaseModelCandidateInput[];
  /** C 编号 → 案例 ID（服务端白名单）。 */
  candidateMap: Map<string, string>;
  /** C 编号 → 该候选渲染的来源编号：解析时按实际选择收窄来源集合（防未选中候选污染）。 */
  candidateSourceLabels: Map<string, string[]>;
  /** S 编号 → 材料文本（引文定位白名单）。 */
  sourceTexts: Map<string, string>;
  /** S 编号 → 维修结果（结果推导用）。 */
  sourceResults: Map<string, string | null>;
  /** 案例 ID → 决策时的范围与版本（发布事务复核用）。 */
  targetVisibility: Map<string, CaseVisibility>;
  targetVersion: Map<string, number>;
  /** 目标案例决策时的有效来源 ID 集合（发布事务复核用）。 */
  targetSourceIds: Map<string, string[]>;
  notes: string[];
};

/**
 * 候选规划：先做完全重复判定（哈希），再按向量相似度 + 机型/分类筛选相似候选。
 * 相似只提供给模型判断，「相似 ≠ 同一故障」；找不到候选就是新建。
 */
async function planCandidates(params: {
  recordId: string;
  material: RepairMaterial;
  hash: string;
  preferredCaseId: string | null;
  config: CaseProcessingConfig;
  deadline: number;
  embedFn: typeof embedTexts;
}): Promise<CandidatePlan> {
  const db = getDb();
  const notes: string[] = [];
  const sourceTexts = new Map<string, string>([["S1", materialTextOf(params.material)]]);
  const sourceResults = new Map<string, string | null>([["S1", params.material.result]]);

  // 1) 完全重复：同一实质内容的既有发布来源 → 复用其案例（同范围，或本来源原先所属案例）。
  const duplicate = await db.knowledgeCaseSource.findFirst({
    where: {
      contentHash: params.hash,
      status: "PUBLISHED",
      repairRecordId: { not: params.recordId },
      caseId: { not: null },
    },
    include: { case: { include: CASE_WITH_SOURCES } },
  });
  let exactDuplicateCaseId: string | null = null;
  let exactDuplicateVisibility: CaseVisibility | null = null;
  if (duplicate?.case && duplicate.case.status === "PUBLISHED") {
    if (duplicate.case.visibility === "STAFF" || duplicate.case.id === params.preferredCaseId) {
      exactDuplicateCaseId = duplicate.case.id;
      // 规划时的可见范围快照：挂接事务内必须仍是它（防止规划后目标被改为公开而引入内部来源）。
      exactDuplicateVisibility = duplicate.case.visibility as CaseVisibility;
    }
  }

  const candidateMap = new Map<string, string>();
  const candidateSourceLabels = new Map<string, string[]>();
  const targetVisibility = new Map<string, CaseVisibility>();
  const targetVersion = new Map<string, number>();
  const targetSourceIds = new Map<string, string[]>();
  const candidates: CaseModelCandidateInput[] = [];

  // 2) 优先候选：本来源原先所属案例（内容变化后的身份复用；范围随该案例保持不变）。
  let preferred: CaseWithSources | null = null;
  if (params.preferredCaseId && params.preferredCaseId !== exactDuplicateCaseId) {
    const row = await db.knowledgeCase.findUnique({
      where: { id: params.preferredCaseId },
      include: CASE_WITH_SOURCES,
    });
    if (row && (row.status === "PUBLISHED" || row.status === "REPROCESSING" || row.status === "FAILED")) {
      preferred = row;
    }
  }

  // 3) 相似候选池：同范围（STAFF）的有效案例；内部贡献不会自动混入公开案例。
  const pool = await db.knowledgeCase.findMany({
    where: {
      status: "PUBLISHED",
      visibility: "STAFF",
      id: {
        notIn: [exactDuplicateCaseId, preferred?.id].filter(
          (id): id is string => typeof id === "string",
        ),
      },
    },
    include: CASE_WITH_SOURCES,
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const embeddingConfig = readEmbeddingConfig();
  const fingerprint = embeddingConfig
    ? `${providerLabelFromUrl(embeddingConfig.baseUrl)}:${embeddingConfig.model}`
    : null;
  let queryVector: number[] | null = null;
  const vectorizable = (row: CaseWithSources): Float32Array | null => {
    if (!row.embedding || !row.embeddingFingerprint) return null;
    if (!fingerprint || row.embeddingFingerprint !== fingerprint) return null;
    return decodeVector(Buffer.from(row.embedding));
  };
  const hasVectorCandidate = pool.some((row) => vectorizable(row) !== null);
  if (embeddingConfig && hasVectorCandidate) {
    const remaining = params.deadline - Date.now();
    if (remaining >= MIN_EMBEDDING_BUDGET_MS) {
      try {
        const vectors = await params.embedFn(
          { ...embeddingConfig, timeoutMs: Math.min(embeddingConfig.timeoutMs, remaining) },
          [similarityQueryOf(params.material)],
        );
        queryVector = vectors[0] ?? null;
      } catch {
        notes.push("候选相似度向量请求失败，改用机型/分类筛选");
      }
    } else {
      notes.push("预算不足，跳过候选相似度向量请求，改用机型/分类筛选");
    }
  } else if (embeddingConfig && pool.length > 0 && !hasVectorCandidate) {
    notes.push("候选案例尚无兼容向量，改用机型/分类筛选");
  }

  type Scored = { row: CaseWithSources; score: number; similarity: number | null };
  const scored: Scored[] = [];
  for (const row of pool) {
    const materials = row.sources
      .map((source) => evidenceSnapshotOf(source.evidence))
      .filter((snapshot): snapshot is CaseSourceEvidenceSnapshot => snapshot !== null)
      .map(snapshotToMaterial);
    const sameModel =
      params.material.deviceModel !== null &&
      materials.some((m) => m.deviceModel !== null && m.deviceModel === params.material.deviceModel);
    const sameCategory =
      params.material.categoryName !== null &&
      materials.some((m) => m.categoryName !== null && m.categoryName === params.material.categoryName);
    const vector = queryVector ? vectorizable(row) : null;
    const similarity =
      queryVector && vector ? cosineSimilarity(Float32Array.from(queryVector), vector) : null;
    const admitted =
      similarity !== null
        ? similarity >= params.config.similarityMin || (sameModel && sameCategory)
        : sameModel && sameCategory;
    if (!admitted) continue;
    const score = (similarity ?? 0) + (sameModel ? 0.1 : 0) + (sameCategory ? 0.1 : 0);
    scored.push({ row, score, similarity });
  }
  scored.sort((a, b) => b.score - a.score);

  const ordered: CaseWithSources[] = [];
  if (preferred) ordered.push(preferred);
  for (const entry of scored) {
    if (ordered.length >= params.config.maxCandidates) break;
    if (ordered.some((row) => row.id === entry.row.id)) continue;
    ordered.push(entry.row);
  }

  let labelIndex = 0;
  for (const row of ordered) {
    labelIndex += 1;
    const caseLabel = `C${labelIndex}`;
    candidateMap.set(caseLabel, row.id);
    targetVisibility.set(row.id, row.visibility as CaseVisibility);
    targetVersion.set(row.id, row.contentVersion);
    targetSourceIds.set(
      row.id,
      row.sources.map((source) => source.id),
    );
    const sources: CaseModelSourceInput[] = [];
    for (const source of row.sources.slice(0, MAX_RENDERED_SOURCES_PER_CANDIDATE)) {
      const snapshot = evidenceSnapshotOf(source.evidence);
      if (!snapshot) continue;
      const label = `S${sourceTexts.size + 1}`;
      sourceTexts.set(label, materialTextOf(snapshotToMaterial(snapshot)));
      sourceResults.set(label, snapshot.material.result);
      sources.push({
        label,
        material: snapshotToMaterial(snapshot),
        repairDate: snapshot.material.repairDate,
      });
    }
    if (row.sources.length > MAX_RENDERED_SOURCES_PER_CANDIDATE) {
      notes.push(`候选 ${caseLabel} 来源较多，仅渲染前 ${MAX_RENDERED_SOURCES_PER_CANDIDATE} 条`);
    }
    candidateSourceLabels.set(
      caseLabel,
      sources.map((source) => source.label),
    );
    const structured = row.structured as { title?: unknown };
    candidates.push({
      label: caseLabel,
      caseId: row.id,
      title: typeof structured.title === "string" ? structured.title : "未命名案例",
      visibility: row.visibility,
      sources,
    });
  }

  return {
    exactDuplicateCaseId,
    exactDuplicateVisibility,
    candidates,
    candidateMap,
    candidateSourceLabels,
    sourceTexts,
    sourceResults,
    targetVisibility,
    targetVersion,
    targetSourceIds,
    notes,
  };
}

type EmbeddingWrite = {
  embedding: Uint8Array<ArrayBuffer> | null;
  embeddingFingerprint: string | null;
  embeddingStatus: "PENDING" | "READY" | "FAILED";
  embeddingError: string | null;
};

/**
 * 案例向量：优先复用「内容未变」的既有向量（contentHash 相同且指纹兼容），
 * 否则在预算内请求；失败不阻塞发布（关键词先可用，提供单条重试）。
 */
async function ensureCaseEmbedding(params: {
  displayText: string;
  contentHash: string;
  previous: {
    contentHash: string;
    embedding: Uint8Array<ArrayBuffer> | null;
    embeddingFingerprint: string | null;
    embeddingStatus: string;
  } | null;
  deadline: number;
  embedFn: typeof embedTexts;
}): Promise<EmbeddingWrite> {
  const embeddingConfig = readEmbeddingConfig();
  const fingerprint = embeddingConfig
    ? `${providerLabelFromUrl(embeddingConfig.baseUrl)}:${embeddingConfig.model}`
    : null;
  if (
    params.previous &&
    params.previous.embedding &&
    params.previous.embeddingFingerprint === fingerprint &&
    params.previous.contentHash === params.contentHash &&
    params.previous.embeddingStatus === "READY"
  ) {
    return {
      embedding: params.previous.embedding,
      embeddingFingerprint: params.previous.embeddingFingerprint,
      embeddingStatus: "READY",
      embeddingError: null,
    };
  }
  if (!embeddingConfig) {
    return {
      embedding: null,
      embeddingFingerprint: null,
      embeddingStatus: "FAILED",
      embeddingError: "未配置向量服务（EMBEDDING_API_KEY），案例暂时只能关键词检索",
    };
  }
  const remaining = params.deadline - Date.now();
  if (remaining < MIN_EMBEDDING_BUDGET_MS) {
    return {
      embedding: null,
      embeddingFingerprint: null,
      embeddingStatus: "FAILED",
      embeddingError: "本次处理预算不足，向量未生成，可单条重试",
    };
  }
  try {
    const vectors = await params.embedFn(
      { ...embeddingConfig, timeoutMs: Math.min(embeddingConfig.timeoutMs, remaining) },
      [params.displayText],
    );
    const vector = vectors[0];
    if (!vector || vector.length === 0) {
      return {
        embedding: null,
        embeddingFingerprint: null,
        embeddingStatus: "FAILED",
        embeddingError: "向量服务返回空结果，可单条重试",
      };
    }
    return {
      embedding: encodeVector(vector),
      embeddingFingerprint: fingerprint,
      embeddingStatus: "READY",
      embeddingError: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "向量请求失败";
    return {
      embedding: null,
      embeddingFingerprint: null,
      embeddingStatus: "FAILED",
      embeddingError: `向量生成失败：${message.slice(0, 200)}`,
    };
  }
}

type PublishPayload = {
  recordId: string;
  contributionId: string;
  leaseGeneration: number;
  expectedHash: string;
  targetCaseId: string | null;
  expectedCaseVersion: number | null;
  expectedVisibility: CaseVisibility | null;
  expectedSourceIds: string[] | null;
  content: CaseStructuredContent;
  displayText: string;
  contentHash: string;
  snapshot: CaseSourceEvidenceSnapshot;
  model: string;
  promptVersion: string;
  embeddingWrite: EmbeddingWrite;
  actorUserId: string | null;
  requestId: string;
};

type PublishResult =
  | { kind: "published"; caseId: string; caseStatus: CaseStatus; contentVersion: number; merged: boolean }
  | { kind: "failed"; failureCode: string; failureMessage: string; caseId: string | null }
  | { kind: "removed"; message: string };

/** 发布事务：复核来源与目标案例后原子提交正文、版本、来源关联与审计。 */
async function publishCase(payload: PublishPayload): Promise<PublishResult> {
  const now = new Date();
  return inSerializableTransaction(async (tx) => {
    const freshRecord = await tx.repairRecord.findUnique({
      where: { id: payload.recordId },
      include: RECORD_INCLUDE,
    });
    const notEligible =
      !freshRecord ||
      freshRecord.deletedAt !== null ||
      !freshRecord.isTypical ||
      freshRecord.status !== "APPROVED";
    if (notEligible) {
      await tx.knowledgeCaseSource.updateMany({
        where: { id: payload.contributionId, generation: payload.leaseGeneration },
        data: {
          status: "REMOVED",
          caseId: null,
          failureCode: CASE_FAILURE_CODES.STALE_INPUT,
          failureMessage: "备案在整理期间被取消典型/删除/退回，结果未发布",
          processingStartedAt: null,
          processedAt: now,
        },
      });
      return { kind: "removed", message: "来源已失效，结果未发布" } as const;
    }
    if (materialHashOf(materialOf(freshRecord)) !== payload.expectedHash) {
      await failContribution(tx, payload, CASE_FAILURE_CODES.STALE_INPUT, "备案内容在整理期间已修改，请重试");
      return {
        kind: "failed",
        failureCode: CASE_FAILURE_CODES.STALE_INPUT,
        failureMessage: "备案内容在整理期间已修改",
        caseId: payload.targetCaseId,
      } as const;
    }

    let caseId: string;
    let contentVersion: number;
    let merged = false;
    if (payload.targetCaseId) {
      const caseRow = await tx.knowledgeCase.findUnique({ where: { id: payload.targetCaseId } });
      if (!caseRow || caseRow.status === "WITHDRAWN") {
        await failContribution(tx, payload, CASE_FAILURE_CODES.CASE_WITHDRAWN, "目标案例已撤回或不可用，请重试");
        return {
          kind: "failed",
          failureCode: CASE_FAILURE_CODES.CASE_WITHDRAWN,
          failureMessage: "目标案例已撤回或不可用",
          caseId: payload.targetCaseId,
        } as const;
      }
      if (payload.expectedVisibility !== null && caseRow.visibility !== payload.expectedVisibility) {
        await failContribution(
          tx,
          payload,
          CASE_FAILURE_CODES.CASE_VISIBILITY_CHANGED,
          "目标案例可见范围已调整，请重试",
        );
        return {
          kind: "failed",
          failureCode: CASE_FAILURE_CODES.CASE_VISIBILITY_CHANGED,
          failureMessage: "目标案例可见范围已调整",
          caseId: payload.targetCaseId,
        } as const;
      }
      if (payload.expectedCaseVersion !== null && caseRow.contentVersion !== payload.expectedCaseVersion) {
        await failContribution(
          tx,
          payload,
          CASE_FAILURE_CODES.CASE_VERSION_CONFLICT,
          "目标案例已被其他整理更新，请重试",
        );
        return {
          kind: "failed",
          failureCode: CASE_FAILURE_CODES.CASE_VERSION_CONFLICT,
          failureMessage: "目标案例已被其他整理更新",
          caseId: payload.targetCaseId,
        } as const;
      }
      const currentSources = await tx.knowledgeCaseSource.findMany({
        where: { caseId: payload.targetCaseId, status: "PUBLISHED" },
        select: { id: true },
      });
      const expected = payload.expectedSourceIds ?? [];
      const currentIds = currentSources.map((row) => row.id).sort();
      const expectedIds = [...expected].sort();
      if (
        currentIds.length !== expectedIds.length ||
        currentIds.some((id, index) => id !== expectedIds[index])
      ) {
        await failContribution(
          tx,
          payload,
          CASE_FAILURE_CODES.CASE_SOURCES_CHANGED,
          "目标案例的来源在整理期间发生变化，请重试",
        );
        return {
          kind: "failed",
          failureCode: CASE_FAILURE_CODES.CASE_SOURCES_CHANGED,
          failureMessage: "目标案例的来源在整理期间发生变化",
          caseId: payload.targetCaseId,
        } as const;
      }
      // 来源上限（与模型单次可忠实覆盖的来源数一致）：达到上限的合并被明确拒绝，
      // 而不是让模型只看到前 8 条、静默抹掉其余已合入来源的事实。失败可重试/人工处理。
      const mergedSourceCount = await tx.knowledgeCaseSource.count({
        where: { caseId: payload.targetCaseId, status: "PUBLISHED", id: { not: payload.contributionId } },
      });
      if (mergedSourceCount >= MAX_SOURCES_PER_CASE) {
        await failContribution(
          tx,
          payload,
          CASE_FAILURE_CODES.CASE_SOURCE_LIMIT,
          `目标案例来源已达上限（${MAX_SOURCES_PER_CASE} 条），未自动合并；请人工整理后重试`,
        );
        return {
          kind: "failed",
          failureCode: CASE_FAILURE_CODES.CASE_SOURCE_LIMIT,
          failureMessage: `目标案例来源已达上限（${MAX_SOURCES_PER_CASE} 条），未自动合并`,
          caseId: payload.targetCaseId,
        } as const;
      }
      const updated = await tx.knowledgeCase.updateMany({
        where: { id: payload.targetCaseId, contentVersion: payload.expectedCaseVersion ?? caseRow.contentVersion },
        data: {
          displayText: payload.displayText,
          structured: payload.content as unknown as Prisma.InputJsonValue,
          status: "PUBLISHED",
          contentVersion: { increment: 1 },
          contentHash: payload.contentHash,
          model: payload.model,
          promptVersion: payload.promptVersion,
          embedding: payload.embeddingWrite.embedding ?? undefined,
          embeddingFingerprint: payload.embeddingWrite.embeddingFingerprint,
          embeddingStatus: payload.embeddingWrite.embeddingStatus,
          embeddingError: payload.embeddingWrite.embeddingError,
          failureCode: null,
          failureMessage: null,
          publishedAt: now,
        },
      });
      if (updated.count !== 1) {
        await failContribution(
          tx,
          payload,
          CASE_FAILURE_CODES.CASE_VERSION_CONFLICT,
          "目标案例已被其他整理更新，请重试",
        );
        return {
          kind: "failed",
          failureCode: CASE_FAILURE_CODES.CASE_VERSION_CONFLICT,
          failureMessage: "目标案例已被其他整理更新",
          caseId: payload.targetCaseId,
        } as const;
      }
      caseId = payload.targetCaseId;
      contentVersion = caseRow.contentVersion + 1;
      merged = true;
    } else {
      const created = await tx.knowledgeCase.create({
        data: {
          id: randomUUID(),
          displayText: payload.displayText,
          structured: payload.content as unknown as Prisma.InputJsonValue,
          status: "PUBLISHED",
          visibility: "STAFF",
          contentVersion: 1,
          contentHash: payload.contentHash,
          model: payload.model,
          promptVersion: payload.promptVersion,
          embedding: payload.embeddingWrite.embedding,
          embeddingFingerprint: payload.embeddingWrite.embeddingFingerprint,
          embeddingStatus: payload.embeddingWrite.embeddingStatus,
          embeddingError: payload.embeddingWrite.embeddingError,
          publishedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      });
      caseId = created.id;
      contentVersion = 1;
    }

    const attached = await tx.knowledgeCaseSource.updateMany({
      where: { id: payload.contributionId, generation: payload.leaseGeneration },
      data: {
        caseId,
        status: "PUBLISHED",
        contentHash: payload.expectedHash,
        evidence: payload.snapshot as unknown as Prisma.InputJsonValue,
        failureCode: null,
        failureMessage: null,
        processingStartedAt: null,
        processedAt: now,
      },
    });
    if (attached.count !== 1) {
      // 租约被接管：本次结果作废，不覆盖新处理代次（抛出让事务回滚）。
      throw new AppError("CASE_STATE_CONFLICT", "处理租约已被接管，本次结果未发布", { status: 409 });
    }

    await appendAuditLog(tx, {
      actor: { requestId: payload.requestId },
      actorType: payload.actorUserId ? "USER" : "SYSTEM",
      actorUserId: payload.actorUserId ?? undefined,
      action: "knowledge.case.published",
      targetType: "KnowledgeCase",
      targetId: caseId,
      result: "SUCCESS",
      after: {
        merged,
        contentVersion,
        promptVersion: payload.promptVersion,
        model: payload.model,
        embeddingStatus: payload.embeddingWrite.embeddingStatus,
      },
    });
    return { kind: "published", caseId, caseStatus: "PUBLISHED", contentVersion, merged } as const;
  });
}

/** 事务内记录来源处理失败并释放租约（只在本代次租约仍有效时写入；失败可重试）。 */
async function failContribution(
  tx: Prisma.TransactionClient,
  lease: { contributionId: string; leaseGeneration: number },
  code: string,
  message: string,
): Promise<void> {
  await tx.knowledgeCaseSource.updateMany({
    where: { id: lease.contributionId, generation: lease.leaseGeneration },
    data: {
      status: "FAILED",
      failureCode: code,
      failureMessage: message.slice(0, 500),
      processingStartedAt: null,
      processedAt: new Date(),
    },
  });
}

/**
 * 「完全重复」路径：不调用模型，直接把来源挂接到既有案例（内容与向量保持不变）。
 *
 * 规划之后目标仍可能变化：事务内复核目标仍 PUBLISHED、可见范围与规划一致、
 * 来源数未达上限 —— 任一条不满足都以可重试的 FAILED 收尾（释放租约），
 * 不让内部来源跨范围落进被改成公开的案例，也不越过单案例来源上限。
 */
async function attachExactDuplicate(params: {
  recordId: string;
  contributionId: string;
  leaseGeneration: number;
  expectedHash: string;
  targetCaseId: string;
  /** 规划时的目标可见范围（复核用；null 表示未取得，按冲突处理）。 */
  expectedVisibility: CaseVisibility | null;
  material: RepairMaterial;
  repairDate: string | null;
  actorUserId: string | null;
  requestId: string;
}): Promise<PublishResult> {
  const now = new Date();
  const snapshot = buildEvidenceSnapshot(
    params.material,
    params.repairDate,
    [],
    "与案例现有来源实质内容完全重复，已复用该案例",
  );
  return inSerializableTransaction(async (tx) => {
    const freshRecord = await tx.repairRecord.findUnique({
      where: { id: params.recordId },
      include: RECORD_INCLUDE,
    });
    if (
      !freshRecord ||
      freshRecord.deletedAt !== null ||
      !freshRecord.isTypical ||
      freshRecord.status !== "APPROVED" ||
      materialHashOf(materialOf(freshRecord)) !== params.expectedHash
    ) {
      await tx.knowledgeCaseSource.updateMany({
        where: { id: params.contributionId, generation: params.leaseGeneration },
        data: {
          status: "REMOVED",
          caseId: null,
          failureCode: CASE_FAILURE_CODES.STALE_INPUT,
          failureMessage: "备案在整理期间发生变化，结果未发布",
          processingStartedAt: null,
          processedAt: now,
        },
      });
      return { kind: "removed", message: "来源已失效，结果未发布" } as const;
    }
    const caseRow = await tx.knowledgeCase.findUnique({ where: { id: params.targetCaseId } });
    if (!caseRow || caseRow.status !== "PUBLISHED") {
      await failContribution(
        tx,
        params,
        CASE_FAILURE_CODES.CASE_STATE_CONFLICT,
        "重复来源的目标案例已不可用，请重试",
      );
      return {
        kind: "failed",
        failureCode: CASE_FAILURE_CODES.CASE_STATE_CONFLICT,
        failureMessage: "重复来源的目标案例已不可用，请重试",
        caseId: params.targetCaseId,
      } as const;
    }
    if (params.expectedVisibility === null || caseRow.visibility !== params.expectedVisibility) {
      // 规划后目标可见范围被调整：跨范围挂接（内部来源 → 公开案例）必须拒绝，失败可重试。
      await failContribution(
        tx,
        params,
        CASE_FAILURE_CODES.CASE_VISIBILITY_CHANGED,
        "目标案例可见范围已调整，未自动挂接，请重试",
      );
      return {
        kind: "failed",
        failureCode: CASE_FAILURE_CODES.CASE_VISIBILITY_CHANGED,
        failureMessage: "目标案例可见范围已调整，未自动挂接，请重试",
        caseId: params.targetCaseId,
      } as const;
    }
    const publishedCount = await tx.knowledgeCaseSource.count({
      where: { caseId: params.targetCaseId, status: "PUBLISHED", id: { not: params.contributionId } },
    });
    if (publishedCount >= MAX_SOURCES_PER_CASE) {
      await failContribution(
        tx,
        params,
        CASE_FAILURE_CODES.CASE_SOURCE_LIMIT,
        `目标案例来源已达上限（${MAX_SOURCES_PER_CASE} 条），未自动挂接；请人工整理后重试`,
      );
      return {
        kind: "failed",
        failureCode: CASE_FAILURE_CODES.CASE_SOURCE_LIMIT,
        failureMessage: `目标案例来源已达上限（${MAX_SOURCES_PER_CASE} 条），未自动挂接；请人工整理后重试`,
        caseId: params.targetCaseId,
      } as const;
    }
    const attached = await tx.knowledgeCaseSource.updateMany({
      where: { id: params.contributionId, generation: params.leaseGeneration },
      data: {
        caseId: params.targetCaseId,
        status: "PUBLISHED",
        contentHash: params.expectedHash,
        evidence: snapshot as unknown as Prisma.InputJsonValue,
        failureCode: null,
        failureMessage: null,
        processingStartedAt: null,
        processedAt: now,
      },
    });
    if (attached.count !== 1) {
      throw new AppError("CASE_STATE_CONFLICT", "处理租约已被接管，本次结果未发布", { status: 409 });
    }
    await appendAuditLog(tx, {
      actor: { requestId: params.requestId },
      actorType: params.actorUserId ? "USER" : "SYSTEM",
      actorUserId: params.actorUserId ?? undefined,
      action: "knowledge.case.published",
      targetType: "KnowledgeCase",
      targetId: params.targetCaseId,
      result: "SUCCESS",
      after: { merged: true, duplicate: true, contentVersion: caseRow.contentVersion },
    });
    return {
      kind: "published",
      caseId: params.targetCaseId,
      caseStatus: "PUBLISHED",
      contentVersion: caseRow.contentVersion,
      merged: true,
    } as const;
  });
}

async function takeLease(
  contributionId: string,
  generation: number,
  leaseMs: number,
  now: Date,
): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - leaseMs);
  const result = await getDb().knowledgeCaseSource.updateMany({
    where: {
      id: contributionId,
      generation,
      OR: [
        // PENDING/FAILED/REMOVED：待处理、失败重试、来源失效后重新标记；
        // PUBLISHED：正文哈希已变化（同一来源实质内容修改后重新整理）。
        { status: { in: ["PENDING", "FAILED", "REMOVED", "PUBLISHED"] } },
        { status: "PROCESSING", processingStartedAt: null },
        { status: "PROCESSING", processingStartedAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: "PROCESSING",
      generation: { increment: 1 },
      processingStartedAt: now,
      failureCode: null,
      failureMessage: null,
    },
  });
  return result.count === 1;
}

async function readContributionState(recordId: string): Promise<{
  status: CaseSourceStatus | "NONE";
  caseId: string | null;
  caseStatus: CaseStatus | null;
  failureCode: string | null;
  failureMessage: string | null;
}> {
  const db = getDb();
  const contribution = await db.knowledgeCaseSource.findUnique({ where: { repairRecordId: recordId } });
  if (!contribution || (contribution.status === "REMOVED" && contribution.caseId === null)) {
    return { status: "NONE", caseId: null, caseStatus: null, failureCode: null, failureMessage: null };
  }
  const status = (CASE_SOURCE_STATUSES as readonly string[]).includes(contribution.status)
    ? (contribution.status as CaseSourceStatus)
    : "NONE";
  let caseStatus: CaseStatus | null = null;
  if (contribution.caseId) {
    const caseRow = await db.knowledgeCase.findUnique({
      where: { id: contribution.caseId },
      select: { status: true },
    });
    caseStatus = (caseRow?.status as CaseStatus | undefined) ?? null;
  }
  return {
    status,
    caseId: contribution.caseId,
    caseStatus,
    failureCode: contribution.failureCode,
    failureMessage: contribution.failureMessage,
  };
}

/**
 * 单条来源处理入口（标记 / 重试都走这里）。
 * 返回真实终态；重复点击且内容未变时直接取回现状，不重复调用模型。
 */
export async function processSourceContribution(
  recordId: string,
  options: ProcessSourceOptions,
): Promise<ProcessSourceOutcome> {
  const db = getDb();
  const config = readCaseProcessingConfig();
  const deadline = Date.now() + config.budgetMs;
  const notes: string[] = [];

  const record = await db.repairRecord.findUnique({ where: { id: recordId }, include: RECORD_INCLUDE });
  if (!record || record.deletedAt) return removedOutcome("备案不存在或已删除");
  if (!record.isTypical || record.status !== "APPROVED") {
    return removedOutcome("备案未标记典型或不是已审核状态，不进入整理");
  }
  const material = materialOf(record);
  const hash = materialHashOf(material);

  let contribution = await db.knowledgeCaseSource.findUnique({ where: { repairRecordId: recordId } });
  if (!contribution) {
    try {
      contribution = await db.knowledgeCaseSource.create({
        data: {
          id: randomUUID(),
          repairRecordId: recordId,
          status: "PENDING",
          contentHash: hash,
          generation: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } catch {
      contribution = await db.knowledgeCaseSource.findUnique({ where: { repairRecordId: recordId } });
    }
  }
  if (!contribution) throw new AppError("INTERNAL_ERROR", "案例来源记录创建失败", { status: 500 });

  // 幂等：已发布且内容未变 → 取回现状（含管理员撤回等真实状态），不重复调用模型。
  if (contribution.status === "PUBLISHED" && contribution.contentHash === hash && contribution.caseId) {
    const caseRow = await db.knowledgeCase.findUnique({
      where: { id: contribution.caseId },
      select: { status: true },
    });
    if (caseRow) {
      return {
        status: "SKIPPED",
        caseId: contribution.caseId,
        caseStatus: caseRow.status as CaseStatus,
        failureCode: caseRow.status === "WITHDRAWN" ? CASE_FAILURE_CODES.CASE_WITHDRAWN : null,
        failureMessage: caseRow.status === "WITHDRAWN" ? "所属案例已被撤回" : null,
        notes: ["内容未变，已取回当前处理状态"],
      };
    }
  }

  // 管理员撤回的案例不能被普通处理/重试自动恢复。
  if (contribution.caseId) {
    const caseRow = await db.knowledgeCase.findUnique({
      where: { id: contribution.caseId },
      select: { withdrawnSource: true },
    });
    if (caseRow?.withdrawnSource === "ADMIN") {
      return {
        status: "SKIPPED",
        caseId: contribution.caseId,
        caseStatus: "WITHDRAWN",
        failureCode: CASE_FAILURE_CODES.CASE_WITHDRAWN,
        failureMessage: "所属案例已被管理员撤回，需管理员恢复后才能重新发布",
        notes: [],
      };
    }
  }

  const leaseGeneration = contribution.generation + 1;
  const leased = await takeLease(contribution.id, contribution.generation, config.leaseMs, new Date());
  if (!leased) {
    const state = await readContributionState(recordId);
    return {
      status: state.status === "PROCESSING" || state.status === "PENDING" ? "BUSY" : "SKIPPED",
      caseId: state.caseId,
      caseStatus: state.caseStatus,
      failureCode: state.failureCode,
      failureMessage: state.failureMessage,
      notes: ["已有处理任务在进行中，未重复执行"],
    };
  }

  const repairDate = repairDateOf(record);
  try {
    const plan = await planCandidates({
      recordId,
      material,
      hash,
      preferredCaseId: contribution.caseId,
      config,
      deadline,
      embedFn: options.embedFn ?? embedTexts,
    });
    notes.push(...plan.notes);

    if (plan.exactDuplicateCaseId) {
      const result = await attachExactDuplicate({
        recordId,
        contributionId: contribution.id,
        leaseGeneration,
        expectedHash: hash,
        targetCaseId: plan.exactDuplicateCaseId,
        expectedVisibility: plan.exactDuplicateVisibility,
        material,
        repairDate,
        actorUserId: options.actorUserId,
        requestId: options.requestId,
      });
      return publishResultToOutcome(result, notes);
    }

    const modelConfig = readChatModelConfig();
    if (!modelConfig) {
      throw new AppError("AI_NOT_CONFIGURED", "尚未配置整理模型（AI_API_KEY），案例整理暂不可用", { status: 503 });
    }
    const remaining = deadline - Date.now();
    if (remaining < 1000) {
      throw new AppError("AI_PROVIDER_TIMEOUT", "本次处理的时间预算已用尽", { status: 504 });
    }
    const messages: ChatModelMessage[] = buildCaseMessages({
      newSource: { label: "S1", material, repairDate },
      candidates: plan.candidates,
    });
    const raw = await (options.callModelFn ?? callChatModel)(
      {
        ...modelConfig,
        maxOutputTokens: config.maxOutputTokens,
        timeoutMs: Math.min(modelConfig.timeoutMs, remaining),
      },
      messages,
    );
    const parsed = parseCaseModelOutput(raw, {
      sourceTexts: plan.sourceTexts,
      sourceResults: plan.sourceResults,
      candidates: plan.candidateMap,
      newSourceLabel: "S1",
      // 按实际选择收窄：new 只有 S1；merge 为 S1 + 选中候选的来源（未选中候选不得污染结果/证据）。
      candidateSourceLabels: plan.candidateSourceLabels,
    });
    notes.push(...parsed.notes);

    const targetCaseId = parsed.targetCaseId;
    const displayText = renderCaseDisplayText(parsed.content);
    const contentHash = caseContentHashOf(displayText);
    const previousCase = targetCaseId
      ? await db.knowledgeCase.findUnique({
          where: { id: targetCaseId },
          select: {
            contentHash: true,
            embedding: true,
            embeddingFingerprint: true,
            embeddingStatus: true,
          },
        })
      : null;
    const embeddingWrite = await ensureCaseEmbedding({
      displayText,
      contentHash,
      previous: previousCase,
      deadline,
      embedFn: options.embedFn ?? embedTexts,
    });

    const snapshot = buildEvidenceSnapshot(material, repairDate, parsed.evidenceByLabel.get("S1") ?? [], parsed.content.mergeReason);
    const result = await publishCase({
      recordId,
      contributionId: contribution.id,
      leaseGeneration,
      expectedHash: hash,
      targetCaseId,
      expectedCaseVersion: targetCaseId ? (plan.targetVersion.get(targetCaseId) ?? null) : null,
      expectedVisibility: targetCaseId ? (plan.targetVisibility.get(targetCaseId) ?? null) : null,
      expectedSourceIds: targetCaseId ? (plan.targetSourceIds.get(targetCaseId) ?? []) : null,
      content: parsed.content,
      displayText,
      contentHash,
      snapshot,
      model: modelConfig.model,
      promptVersion: CASE_PROMPT_VERSION,
      embeddingWrite,
      actorUserId: options.actorUserId,
      requestId: options.requestId,
    });
    return publishResultToOutcome(result, notes);
  } catch (error) {
    const failure = failureOf(error);
    if (failure.code === CASE_FAILURE_CODES.INTERNAL_ERROR) {
      console.error(`[knowledge-cases] 来源处理未预期失败（record=${recordId}）`, error);
    }
    const updated = await db.knowledgeCaseSource.updateMany({
      where: { id: contribution.id, generation: leaseGeneration },
      data: {
        status: "FAILED",
        failureCode: failure.code,
        failureMessage: failure.message.slice(0, 500),
        processingStartedAt: null,
        processedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      return {
        status: "BUSY",
        caseId: null,
        caseStatus: null,
        failureCode: null,
        failureMessage: null,
        notes: ["处理代次已被接管，本次失败未写入"],
      };
    }
    return {
      status: "FAILED",
      caseId: contribution.caseId,
      caseStatus: null,
      failureCode: failure.code,
      failureMessage: failure.message.slice(0, 500),
      notes,
    };
  }
}

function publishResultToOutcome(result: PublishResult, notes: string[]): ProcessSourceOutcome {
  if (result.kind === "published") {
    return {
      status: "PUBLISHED",
      caseId: result.caseId,
      caseStatus: result.caseStatus,
      failureCode: null,
      failureMessage: null,
      notes: [...notes, result.merged ? "已合并到既有案例" : "已新建案例"],
    };
  }
  if (result.kind === "removed") {
    return { status: "REMOVED", caseId: null, caseStatus: null, failureCode: null, failureMessage: result.message, notes };
  }
  return {
    status: "FAILED",
    caseId: result.caseId,
    caseStatus: null,
    failureCode: result.failureCode,
    failureMessage: result.failureMessage,
    notes,
  };
}

function removedOutcome(message: string): ProcessSourceOutcome {
  return { status: "REMOVED", caseId: null, caseStatus: null, failureCode: null, failureMessage: message, notes: [] };
}

/**
 * 来源失效（内容修改/软删/取消典型）时的事务处理：
 * 移除贡献（`caseId` 置空、状态 REMOVED），并按剩余有效来源调整案例状态 ——
 * 剩 0 条 → 自动撤下（SOURCES_EXHAUSTED）；有剩余 → REPROCESSING 等待重整；
 * 管理员主动撤回的案例不做任何自动复活。
 */
export async function detachSourceContribution(
  recordId: string,
  reason: string,
): Promise<{ caseId: string | null; shouldReprocess: boolean }> {
  return inSerializableTransaction(async (tx) => {
    const contribution = await tx.knowledgeCaseSource.findUnique({ where: { repairRecordId: recordId } });
    if (!contribution) return { caseId: null, shouldReprocess: false };
    const caseId = contribution.caseId;
    if (contribution.status !== "REMOVED" && contribution.status !== "PROCESSING") {
      await tx.knowledgeCaseSource.updateMany({
        where: { id: contribution.id, status: { in: ["PENDING", "FAILED", "PUBLISHED"] } },
        data: {
          status: "REMOVED",
          caseId: null,
          failureCode: CASE_FAILURE_CODES.STALE_INPUT,
          failureMessage: reason.slice(0, 500),
          processingStartedAt: null,
          processedAt: new Date(),
        },
      });
    }
    if (!caseId) return { caseId: null, shouldReprocess: false };
    const caseRow = await tx.knowledgeCase.findUnique({ where: { id: caseId } });
    if (!caseRow) return { caseId: null, shouldReprocess: false };
    if (caseRow.withdrawnSource === "ADMIN") return { caseId, shouldReprocess: false };
    const remaining = await tx.knowledgeCaseSource.count({
      where: { caseId, status: "PUBLISHED" },
    });
    if (remaining === 0) {
      await tx.knowledgeCase.updateMany({
        where: { id: caseId, status: { not: "WITHDRAWN" } },
        data: {
          status: "WITHDRAWN",
          withdrawnSource: "SOURCES_EXHAUSTED",
          withdrawnAt: new Date(),
          failureCode: null,
          failureMessage: null,
        },
      });
      return { caseId, shouldReprocess: false };
    }
    await tx.knowledgeCase.updateMany({
      where: { id: caseId, status: { not: "WITHDRAWN" } },
      data: { status: "REPROCESSING", failureCode: null, failureMessage: null },
    });
    return { caseId, shouldReprocess: true };
  });
}

export type CaseReprocessOutcome = {
  status: "PUBLISHED" | "FAILED" | "WITHDRAWN" | "SKIPPED";
  failureCode: string | null;
  failureMessage: string | null;
  contentVersion: number | null;
  notes: string[];
};

export type ReprocessCaseOptions = {
  actorUserId: string | null;
  requestId: string;
  /** 管理员显式恢复（撤回后重新整理发布）：允许从 ADMIN 撤回状态复活。 */
  allowAdminWithdrawnRestore?: boolean;
  /**
   * 跳过「REPROCESSING 忙碌」守卫。失效/取消典型会先把案例置为 REPROCESSING 并刷新
   * `updatedAt`，紧接着调度的重整会被该守卫误判为「已有任务进行中」而跳过，
   * 因此由失效路径调度的重整必须带 force。发布事务的版本守卫仍然生效，不会并发覆盖。
   */
  force?: boolean;
  callModelFn?: typeof callChatModel;
  embedFn?: typeof embedTexts;
};

/**
 * 基于案例**当前全部有效来源**重新生成正文（失效重整 / 失败重试 / 管理员恢复共用）。
 * 无有效来源 → 撤下；发布事务校验来源集合与版本，冲突时保留现状等待重试。
 */
export async function reprocessCase(
  caseId: string,
  options: ReprocessCaseOptions,
): Promise<CaseReprocessOutcome> {
  const db = getDb();
  const config = readCaseProcessingConfig();
  const deadline = Date.now() + config.budgetMs;
  const notes: string[] = [];

  const caseRow = await db.knowledgeCase.findUnique({ where: { id: caseId }, include: CASE_WITH_SOURCES });
  if (!caseRow) throw new AppError("CASE_NOT_FOUND", "案例不存在", { status: 404 });
  const restore = options.allowAdminWithdrawnRestore === true;
  if (caseRow.withdrawnSource === "ADMIN" && !restore) {
    return {
      status: "SKIPPED",
      failureCode: CASE_FAILURE_CODES.CASE_WITHDRAWN,
      failureMessage: "案例已被管理员撤回，未自动恢复",
      contentVersion: null,
      notes,
    };
  }
  if (caseRow.sources.length === 0) {
    await db.knowledgeCase.updateMany({
      where: { id: caseId, status: { not: "WITHDRAWN" } },
      data: {
        status: "WITHDRAWN",
        withdrawnSource: "SOURCES_EXHAUSTED",
        withdrawnAt: new Date(),
        failureCode: null,
        failureMessage: null,
      },
    });
    return { status: "WITHDRAWN", failureCode: null, failureMessage: "没有有效来源，案例已撤下", contentVersion: null, notes };
  }
  // 超过单次整理上限的历史数据：明确失败并说明（不静默只用前 8 条生成一份缺来源的正文）。
  if (caseRow.sources.length > MAX_SOURCES_PER_CASE) {
    const message = `案例来源数（${caseRow.sources.length}）超过单次整理上限（${MAX_SOURCES_PER_CASE}），未重新整理；请人工整理来源后重试`;
    await db.knowledgeCase.updateMany({
      where: { id: caseId, contentVersion: caseRow.contentVersion },
      data: { status: "FAILED", failureCode: CASE_FAILURE_CODES.CASE_SOURCE_LIMIT, failureMessage: message },
    });
    return {
      status: "FAILED",
      failureCode: CASE_FAILURE_CODES.CASE_SOURCE_LIMIT,
      failureMessage: message,
      contentVersion: null,
      notes,
    };
  }

  if (
    caseRow.status === "REPROCESSING" &&
    options.force !== true &&
    Date.now() - caseRow.updatedAt.getTime() < config.leaseMs
  ) {
    return {
      status: "SKIPPED",
      failureCode: null,
      failureMessage: "已有整理任务进行中",
      contentVersion: null,
      notes,
    };
  }

  const expectedVersion = caseRow.contentVersion;
  const expectedSourceIds = caseRow.sources.map((source) => source.id);
  // 撤回守卫：把「开始时的撤回状态」作为处理代次的一部分。
  // 重整期间管理员再次撤回（withdrawCase 每次都会刷新 withdrawnAt）会让守卫失配，
  // 迟到的模型结果不得重新发布，也不能覆盖后来的管理决定。
  const expectedWithdrawnAt = caseRow.withdrawnAt;
  const expectedWithdrawnSource = caseRow.withdrawnSource;
  const started = await db.knowledgeCase.updateMany({
    where: {
      id: caseId,
      contentVersion: expectedVersion,
      withdrawnAt: expectedWithdrawnAt,
      withdrawnSource: expectedWithdrawnSource,
    },
    data: { status: "REPROCESSING", failureCode: null, failureMessage: null },
  });
  if (started.count !== 1) {
    return staleReprocessOutcome(caseId, notes);
  }

  const sourceTexts = new Map<string, string>();
  const sourceResults = new Map<string, string | null>();
  const sources: CaseModelSourceInput[] = [];
  caseRow.sources.slice(0, MAX_RENDERED_SOURCES_PER_CANDIDATE).forEach((source, index) => {
    const snapshot = evidenceSnapshotOf(source.evidence);
    if (!snapshot) return;
    const label = `S${index + 1}`;
    sourceTexts.set(label, materialTextOf(snapshotToMaterial(snapshot)));
    sourceResults.set(label, snapshot.material.result);
    sources.push({ label, material: snapshotToMaterial(snapshot), repairDate: snapshot.material.repairDate });
  });
  if (caseRow.sources.length > MAX_RENDERED_SOURCES_PER_CANDIDATE) {
    notes.push(`来源较多，仅渲染前 ${MAX_RENDERED_SOURCES_PER_CANDIDATE} 条`);
  }

  try {
    const modelConfig = readChatModelConfig();
    if (!modelConfig) {
      throw new AppError("AI_NOT_CONFIGURED", "尚未配置整理模型（AI_API_KEY），案例重整暂不可用", { status: 503 });
    }
    const remaining = deadline - Date.now();
    if (remaining < 1000) {
      throw new AppError("AI_PROVIDER_TIMEOUT", "本次处理的时间预算已用尽", { status: 504 });
    }
    const messages: ChatModelMessage[] = buildRegenerateMessages(sources);
    const raw = await (options.callModelFn ?? callChatModel)(
      {
        ...modelConfig,
        maxOutputTokens: config.maxOutputTokens,
        timeoutMs: Math.min(modelConfig.timeoutMs, remaining),
      },
      messages,
    );
    const parsed = parseCaseModelOutput(
      raw,
      { sourceTexts, sourceResults, candidates: new Map() },
      { requireDecision: false },
    );
    notes.push(...parsed.notes);
    const displayText = renderCaseDisplayText(parsed.content);
    const contentHash = caseContentHashOf(displayText);
    const embeddingWrite = await ensureCaseEmbedding({
      displayText,
      contentHash,
      previous: {
        contentHash: caseRow.contentHash,
        embedding: caseRow.embedding,
        embeddingFingerprint: caseRow.embeddingFingerprint,
        embeddingStatus: caseRow.embeddingStatus,
      },
      deadline,
      embedFn: options.embedFn ?? embedTexts,
    });

    const now = new Date();
    const outcome = await inSerializableTransaction(async (tx) => {
      const currentSources = await tx.knowledgeCaseSource.findMany({
        where: { caseId, status: "PUBLISHED" },
        select: { id: true },
      });
      const currentIds = currentSources.map((row) => row.id).sort();
      const expectedIds = [...expectedSourceIds].sort();
      if (
        currentIds.length !== expectedIds.length ||
        currentIds.some((id, index) => id !== expectedIds[index])
      ) {
        return "sources-changed" as const;
      }
      const updated = await tx.knowledgeCase.updateMany({
        where: {
          id: caseId,
          contentVersion: expectedVersion,
          // 撤回守卫：期间的任何撤回（含显式恢复期间再次撤回）都会让本次结果作废。
          withdrawnAt: expectedWithdrawnAt,
        },
        data: {
          displayText,
          structured: parsed.content as unknown as Prisma.InputJsonValue,
          status: "PUBLISHED",
          contentVersion: { increment: 1 },
          contentHash,
          model: modelConfig.model,
          promptVersion: CASE_PROMPT_VERSION,
          embedding: embeddingWrite.embedding ?? undefined,
          embeddingFingerprint: embeddingWrite.embeddingFingerprint,
          embeddingStatus: embeddingWrite.embeddingStatus,
          embeddingError: embeddingWrite.embeddingError,
          failureCode: null,
          failureMessage: null,
          withdrawnSource: null,
          withdrawnAt: null,
          withdrawnByUserId: null,
          publishedAt: now,
        },
      });
      if (updated.count !== 1) {
        const current = await tx.knowledgeCase.findUnique({
          where: { id: caseId },
          select: { withdrawnSource: true },
        });
        return current?.withdrawnSource === "ADMIN" ? ("stale-withdrawn" as const) : ("version-conflict" as const);
      }
      await appendAuditLog(tx, {
        actor: { requestId: options.requestId },
        actorType: options.actorUserId ? "USER" : "SYSTEM",
        actorUserId: options.actorUserId ?? undefined,
        action: restore ? "knowledge.case.restored" : "knowledge.case.reprocessed",
        targetType: "KnowledgeCase",
        targetId: caseId,
        result: "SUCCESS",
        after: {
          contentVersion: expectedVersion + 1,
          sourceCount: expectedSourceIds.length,
          embeddingStatus: embeddingWrite.embeddingStatus,
        },
      });
      return "published" as const;
    });
    if (outcome === "sources-changed") {
      const written = await markCaseFailure(
        caseId,
        expectedVersion,
        expectedWithdrawnAt,
        CASE_FAILURE_CODES.CASE_SOURCES_CHANGED,
        "案例来源在重整期间发生变化，请重试",
      );
      if (written === "stale") {
        // 期间的撤回/更新优先：失败状态不得改写后来的管理决定。
        return staleReprocessOutcome(caseId, notes);
      }
      return {
        status: "FAILED",
        failureCode: CASE_FAILURE_CODES.CASE_SOURCES_CHANGED,
        failureMessage: "案例来源在重整期间发生变化，请重试",
        contentVersion: null,
        notes,
      };
    }
    if (outcome === "stale-withdrawn") {
      return {
        status: "SKIPPED",
        failureCode: CASE_FAILURE_CODES.CASE_WITHDRAWN,
        failureMessage: "案例在重整期间被撤回，本次结果未发布",
        contentVersion: null,
        notes,
      };
    }
    if (outcome === "version-conflict") {
      // 案例已被其他处理更新：保留最新发布结果，不覆盖。
      return {
        status: "SKIPPED",
        failureCode: CASE_FAILURE_CODES.CASE_VERSION_CONFLICT,
        failureMessage: "案例已被其他处理更新，本次结果未覆盖",
        contentVersion: null,
        notes,
      };
    }
    return { status: "PUBLISHED", failureCode: null, failureMessage: null, contentVersion: expectedVersion + 1, notes };
  } catch (error) {
    const failure = failureOf(error);
    const written = await markCaseFailure(caseId, expectedVersion, expectedWithdrawnAt, failure.code, failure.message);
    if (written === "stale") {
      return staleReprocessOutcome(caseId, notes);
    }
    return {
      status: "FAILED",
      failureCode: failure.code,
      failureMessage: failure.message,
      contentVersion: null,
      notes,
    };
  }
}

/**
 * 重整代次已过期（撤回 / 版本冲突）时的统一收尾：读当前真实状态，
 * 如实说明本次结果未发布，不把迟到结果或失败覆盖到新状态上。
 */
async function staleReprocessOutcome(caseId: string, notes: string[]): Promise<CaseReprocessOutcome> {
  const row = await getDb().knowledgeCase.findUnique({
    where: { id: caseId },
    select: { status: true, withdrawnSource: true },
  });
  if (row?.status === "WITHDRAWN" && row.withdrawnSource === "ADMIN") {
    return {
      status: "SKIPPED",
      failureCode: CASE_FAILURE_CODES.CASE_WITHDRAWN,
      failureMessage: "案例在重整期间被撤回，本次结果未发布",
      contentVersion: null,
      notes,
    };
  }
  return {
    status: "SKIPPED",
    failureCode: CASE_FAILURE_CODES.CASE_VERSION_CONFLICT,
    failureMessage: "案例已被其他整理更新，本次结果未覆盖",
    contentVersion: null,
    notes,
  };
}

export function caseTitleOf(caseRow: { structured: Prisma.JsonValue }): string {
  const structured = caseRow.structured as { title?: unknown };
  return typeof structured.title === "string" && structured.title.trim() !== "" ? structured.title : "未命名案例";
}

/**
 * 标记案例整理失败。只在「仍是本次重整代次」时写入：
 * 版本未变、仍处于 REPROCESSING、撤回状态未被刷新（期间的管理员撤回优先）。
 */
async function markCaseFailure(
  caseId: string,
  expectedVersion: number,
  expectedWithdrawnAt: Date | null,
  code: string,
  message: string,
): Promise<"written" | "stale"> {
  const updated = await getDb().knowledgeCase.updateMany({
    where: {
      id: caseId,
      contentVersion: expectedVersion,
      status: "REPROCESSING",
      withdrawnAt: expectedWithdrawnAt,
    },
    data: { status: "FAILED", failureCode: code, failureMessage: message.slice(0, 500) },
  });
  return updated.count === 1 ? "written" : "stale";
}
