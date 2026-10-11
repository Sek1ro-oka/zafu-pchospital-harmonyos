import { appendAuditLog } from "@/lib/audit/audit-service";
import { scheduleBackgroundTask } from "@/lib/api/background";
import { AppError } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import type { AuthorizedActor } from "@/types/contracts";
import { callChatModel } from "@/features/knowledge/chat-model";
import { providerLabelFromUrl, readEmbeddingConfig } from "@/features/knowledge/config";
import { embedTexts } from "@/features/knowledge/embedding";

import { readCaseProcessingConfig } from "./case-config";
import {
  caseTitleOf,
  detachSourceContribution,
  processSourceContribution,
  reprocessCase,
  type CaseReprocessOutcome,
  type ProcessSourceOutcome,
} from "./case-process-service";
import { encodeVector } from "./case-vector";
import {
  CASE_SOURCE_STATUSES,
  CASE_VISIBILITIES,
  type CaseEvidence,
  type CaseSourceStatus,
  type CaseStatus,
  type CaseStructuredContent,
  type CaseVisibility,
} from "./case-types";

/**
 * 典型案例的标记、状态、列表、详情与管理动作（Issue #40 §3 / §7）。
 *
 * 权限口径：
 * - 标记/取消/重试：`repair:read` +（本人备案 || `repair:review`）；客户无 `repair:read` 直接被拒；
 * - 案例列表/详情：工作人员与管理员（`repair:read`）；
 * - 范围调整/撤回/恢复/重发向量：`repair:review`（本项目里即管理员）。
 * 不把 `repair:flag` / `repair:review` 整体授予 MEMBER：作者侧只允许改 isTypical 这一个字段。
 */

const REVIEW_CODE = "repair:review";

export type RecordCaseStatusValue = "NONE" | CaseSourceStatus;

export type RecordCaseProcessingView = {
  recordId: string;
  isTypical: boolean;
  canMark: boolean;
  canUnmark: boolean;
  canRetry: boolean;
  status: RecordCaseStatusValue;
  caseId: string | null;
  caseStatus: CaseStatus | null;
  caseTitle: string | null;
  caseVisibility: CaseVisibility | null;
  failureCode: string | null;
  failureMessage: string | null;
  updatedAt: string | null;
};

export type KnowledgeCaseListItem = {
  id: string;
  title: string;
  status: CaseStatus;
  visibility: CaseVisibility;
  contentVersion: number;
  sourceCount: number;
  failureCode: string | null;
  failureMessage: string | null;
  publishedAt: string | null;
  updatedAt: string;
};

export type KnowledgeCaseSourceView = {
  id: string;
  recordId: string;
  authorName: string;
  repairDate: string | null;
  categoryName: string | null;
  deviceModel: string | null;
  result: string | null;
  quotes: CaseEvidence[];
  attachedAt: string | null;
};

export type KnowledgeCaseDetailView = {
  id: string;
  title: string;
  status: CaseStatus;
  visibility: CaseVisibility;
  contentVersion: number;
  content: CaseStructuredContent;
  displayText: string;
  model: string | null;
  promptVersion: string | null;
  embedding: { status: string; fingerprint: string | null; error: string | null };
  failure: { code: string; message: string } | null;
  withdrawn: { source: string; at: string | null } | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sources: KnowledgeCaseSourceView[];
  actions: {
    canManage: boolean;
    canReprocess: boolean;
    canRestore: boolean;
    canReembed: boolean;
  };
};

export type CaseListQuery = {
  page: number;
  pageSize: number;
  status: CaseStatus | "";
  visibility: CaseVisibility | "";
};

type Injections = {
  callModelFn?: typeof callChatModel;
  embedFn?: typeof embedTexts;
};

type EligibleRecord = {
  id: string;
  status: string;
  deletedAt: Date | null;
  isTypical: boolean;
  memberProfile: { userId: string };
};

async function loadEligibleRecord(
  actor: AuthorizedActor,
  recordId: string,
  options: { requireApproved: boolean },
): Promise<EligibleRecord> {
  requirePermission(actor, "repair:read");
  const record = await getDb().repairRecord.findUnique({
    where: { id: recordId },
    include: { memberProfile: { select: { userId: true } } },
  });
  if (!record || record.deletedAt) {
    throw new AppError("REPAIR_NOT_FOUND", "维修记录不存在", { status: 404 });
  }
  const owner = record.memberProfile.userId === actor.userId;
  const reviewer = actor.permissions.includes(REVIEW_CODE);
  if (!owner && !reviewer) {
    throw new AppError("FORBIDDEN", "只能操作本人的维修备案，或需要审核权限", { status: 403 });
  }
  if (options.requireApproved && record.status !== "APPROVED") {
    throw new AppError("CASE_RECORD_NOT_ELIGIBLE", "只有已审核通过的备案可以标记为典型案例", { status: 409 });
  }
  return {
    id: record.id,
    status: record.status,
    deletedAt: record.deletedAt,
    isTypical: record.isTypical,
    memberProfile: record.memberProfile,
  };
}

async function buildRecordState(actor: AuthorizedActor, recordId: string): Promise<RecordCaseProcessingView> {
  const db = getDb();
  const record = await db.repairRecord.findUnique({
    where: { id: recordId },
    include: { memberProfile: { select: { userId: true } } },
  });
  if (!record || record.deletedAt) {
    throw new AppError("REPAIR_NOT_FOUND", "维修记录不存在", { status: 404 });
  }
  const contribution = await db.knowledgeCaseSource.findUnique({
    where: { repairRecordId: recordId },
  });
  const caseRow = contribution?.caseId
    ? await db.knowledgeCase.findUnique({
        where: { id: contribution.caseId },
        select: { id: true, status: true, structured: true, visibility: true },
      })
    : null;
  const owner = record.memberProfile.userId === actor.userId;
  const reviewer = actor.permissions.includes(REVIEW_CODE);
  const eligible = record.status === "APPROVED";
  const canOperate = (owner || reviewer) && eligible;
  const config = readCaseProcessingConfig();
  const leaseExpired =
    contribution?.status === "PROCESSING" &&
    (contribution.processingStartedAt === null ||
      Date.now() - contribution.processingStartedAt.getTime() > config.leaseMs);
  const status: RecordCaseStatusValue =
    !contribution || contribution.status === "REMOVED"
      ? "NONE"
      : (CASE_SOURCE_STATUSES as readonly string[]).includes(contribution.status)
        ? (contribution.status as CaseSourceStatus)
        : "NONE";
  const caseStatus = (caseRow?.status as CaseStatus | undefined) ?? null;
  const canRetry =
    canOperate &&
    record.isTypical &&
    (status === "NONE" ||
      status === "PENDING" ||
      status === "FAILED" ||
      leaseExpired ||
      (status === "PUBLISHED" && caseStatus === "FAILED"));

  // 历史标记或中断（PENDING）的备案：状态查询时补一次后台处理，避免「已标记但从未整理」永久停留。
  if (
    canOperate &&
    record.isTypical &&
    contribution &&
    contribution.status === "PENDING" &&
    Date.now() - contribution.updatedAt.getTime() > 5_000
  ) {
    scheduleBackgroundTask(async () => {
      await processSourceContribution(recordId, {
        actorUserId: null,
        requestId: `case-heal:${recordId}`,
      });
    });
  }

  return {
    recordId,
    isTypical: record.isTypical,
    canMark: canOperate && !record.isTypical,
    canUnmark: (owner || reviewer) && record.isTypical,
    canRetry,
    status,
    caseId: contribution?.caseId ?? null,
    caseStatus,
    caseTitle: caseRow ? caseTitleOf(caseRow) : null,
    caseVisibility: (caseRow?.visibility as CaseVisibility | undefined) ?? null,
    failureCode: contribution?.failureCode ?? null,
    failureMessage: contribution?.failureMessage ?? null,
    updatedAt: contribution?.updatedAt.toISOString() ?? null,
  };
}

/** 标记典型并整理（本人 APPROVED 备案，或审核权限）；已标记且内容未变时取回现状，不重复调用模型。 */
async function markTypical(
  actor: AuthorizedActor,
  recordId: string,
  injections: Injections = {},
): Promise<RecordCaseProcessingView> {
  const record = await loadEligibleRecord(actor, recordId, { requireApproved: true });
  if (!record.isTypical) {
    await inSerializableTransaction(async (tx) => {
      await tx.repairRecord.update({ where: { id: recordId }, data: { isTypical: true } });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "knowledge.typical.marked",
        targetType: "RepairRecord",
        targetId: recordId,
        result: "SUCCESS",
        before: { isTypical: false },
        after: { isTypical: true },
      });
    });
  }
  await processSourceContribution(recordId, {
    actorUserId: actor.userId ?? null,
    requestId: actor.requestId,
    callModelFn: injections.callModelFn,
    embedFn: injections.embedFn,
  });
  return buildRecordState(actor, recordId);
}

/** 取消典型：移除贡献；受影响案例立即停止检索并按剩余来源自动重整/撤下。 */
async function unmarkTypical(actor: AuthorizedActor, recordId: string): Promise<RecordCaseProcessingView> {
  const record = await loadEligibleRecord(actor, recordId, { requireApproved: false });
  if (record.isTypical) {
    await inSerializableTransaction(async (tx) => {
      await tx.repairRecord.update({ where: { id: recordId }, data: { isTypical: false } });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "knowledge.typical.unmarked",
        targetType: "RepairRecord",
        targetId: recordId,
        result: "SUCCESS",
        before: { isTypical: true },
        after: { isTypical: false },
      });
    });
  }
  const { caseId, shouldReprocess } = await detachSourceContribution(recordId, "备案取消典型标记");
  if (caseId && shouldReprocess) scheduleReprocessCase(caseId);
  return buildRecordState(actor, recordId);
}

/** 失败/中断后的单条重试；案例层面失败时改为重整案例。不可重试时返回真实状态冲突。 */
async function retryProcessing(
  actor: AuthorizedActor,
  recordId: string,
  injections: Injections = {},
): Promise<{ state: RecordCaseProcessingView; outcome: ProcessSourceOutcome | CaseReprocessOutcome | null }> {
  const record = await loadEligibleRecord(actor, recordId, { requireApproved: true });
  if (!record.isTypical) {
    throw new AppError("CASE_RECORD_NOT_ELIGIBLE", "备案未标记为典型案例，请先标记", { status: 409 });
  }
  const db = getDb();
  const config = readCaseProcessingConfig();
  const contribution = await db.knowledgeCaseSource.findUnique({ where: { repairRecordId: recordId } });
  const runSource = async () => {
    const outcome = await processSourceContribution(recordId, {
      actorUserId: actor.userId ?? null,
      requestId: actor.requestId,
      callModelFn: injections.callModelFn,
      embedFn: injections.embedFn,
    });
    return { state: await buildRecordState(actor, recordId), outcome };
  };

  if (!contribution || contribution.status === "PENDING" || contribution.status === "FAILED") {
    return runSource();
  }
  if (contribution.status === "REMOVED") {
    return runSource();
  }
  if (contribution.status === "PROCESSING") {
    const stale =
      contribution.processingStartedAt === null ||
      Date.now() - contribution.processingStartedAt.getTime() > config.leaseMs;
    if (!stale) {
      throw new AppError("CASE_STATE_CONFLICT", "整理任务正在执行，请稍后重试", { status: 409 });
    }
    return runSource();
  }
  // PUBLISHED：来源已入库；案例层面失败时重整案例，其余状态没有可重试的动作。
  if (contribution.caseId) {
    const caseRow = await db.knowledgeCase.findUnique({
      where: { id: contribution.caseId },
      select: { id: true, status: true, withdrawnSource: true },
    });
    if (!caseRow) throw new AppError("CASE_NOT_FOUND", "案例不存在", { status: 404 });
    if (caseRow.status === "FAILED") {
      const outcome = await reprocessCase(caseRow.id, {
        actorUserId: actor.userId ?? null,
        requestId: actor.requestId,
        callModelFn: injections.callModelFn,
        embedFn: injections.embedFn,
      });
      return { state: await buildRecordState(actor, recordId), outcome };
    }
    if (caseRow.status === "REPROCESSING") {
      throw new AppError("CASE_STATE_CONFLICT", "案例正在重整中，请稍后查看", { status: 409 });
    }
    throw new AppError(
      "CASE_STATE_CONFLICT",
      caseRow.withdrawnSource === "ADMIN"
        ? "案例已被管理员撤回，需管理员恢复后才能重新发布"
        : "当前状态无需重试",
      { status: 409 },
    );
  }
  throw new AppError("CASE_STATE_CONFLICT", "当前状态无需重试", { status: 409 });
}

async function getRecordCaseStatus(actor: AuthorizedActor, recordId: string): Promise<RecordCaseProcessingView> {
  requirePermission(actor, "repair:read");
  return buildRecordState(actor, recordId);
}

function parseCaseStatusFilter(value: string | null): CaseStatus | "" {
  if (!value) return "";
  if (value === "PUBLISHED" || value === "REPROCESSING" || value === "FAILED" || value === "WITHDRAWN") {
    return value;
  }
  throw new AppError("VALIDATION_FAILED", "status 参数无效");
}

function parseVisibilityFilter(value: string | null): CaseVisibility | "" {
  if (!value) return "";
  if ((CASE_VISIBILITIES as readonly string[]).includes(value)) return value as CaseVisibility;
  throw new AppError("VALIDATION_FAILED", "visibility 参数无效");
}

export function caseListQuery(params: URLSearchParams, page: number, pageSize: number): CaseListQuery {
  return {
    page,
    pageSize,
    status: parseCaseStatusFilter(params.get("status")),
    visibility: parseVisibilityFilter(params.get("visibility")),
  };
}

async function listCases(
  actor: AuthorizedActor,
  query: CaseListQuery,
): Promise<{ items: KnowledgeCaseListItem[]; total: number }> {
  requirePermission(actor, "repair:read");
  const db = getDb();
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.visibility ? { visibility: query.visibility } : {}),
  };
  const [total, rows] = await Promise.all([
    db.knowledgeCase.count({ where }),
    db.knowledgeCase.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        status: true,
        visibility: true,
        contentVersion: true,
        structured: true,
        failureCode: true,
        failureMessage: true,
        publishedAt: true,
        updatedAt: true,
        sources: { where: { status: "PUBLISHED" }, select: { id: true } },
      },
    }),
  ]);
  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      title: caseTitleOf(row),
      status: row.status as CaseStatus,
      visibility: row.visibility as CaseVisibility,
      contentVersion: row.contentVersion,
      sourceCount: row.sources.length,
      failureCode: row.failureCode,
      failureMessage: row.failureMessage,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}

const SOURCE_INCLUDE = {
  status: "PUBLISHED",
  record: {
    select: {
      id: true,
      repairDate: true,
      memberProfile: {
        select: { nickname: true, realName: true, user: { select: { displayName: true } } },
      },
    },
  },
} as const;

async function getCaseDetail(actor: AuthorizedActor, caseId: string): Promise<KnowledgeCaseDetailView> {
  requirePermission(actor, "repair:read");
  const db = getDb();
  const caseRow = await db.knowledgeCase.findUnique({
    where: { id: caseId },
    include: {
      sources: {
        where: { status: "PUBLISHED" },
        orderBy: { createdAt: "asc" },
        include: { record: { select: SOURCE_INCLUDE.record.select } },
      },
    },
  });
  if (!caseRow) throw new AppError("CASE_NOT_FOUND", "案例不存在", { status: 404 });
  const reviewer = actor.permissions.includes(REVIEW_CODE);
  const structured = caseRow.structured as unknown as CaseStructuredContent;
  return {
    id: caseRow.id,
    title: caseTitleOf(caseRow),
    status: caseRow.status as CaseStatus,
    visibility: caseRow.visibility as CaseVisibility,
    contentVersion: caseRow.contentVersion,
    content: structured,
    displayText: caseRow.displayText,
    model: caseRow.model,
    promptVersion: caseRow.promptVersion,
    embedding: {
      status: caseRow.embeddingStatus,
      fingerprint: caseRow.embeddingFingerprint,
      error: caseRow.embeddingError,
    },
    failure: caseRow.failureCode
      ? { code: caseRow.failureCode, message: caseRow.failureMessage ?? "" }
      : null,
    withdrawn: caseRow.withdrawnSource
      ? { source: caseRow.withdrawnSource, at: caseRow.withdrawnAt?.toISOString() ?? null }
      : null,
    publishedAt: caseRow.publishedAt?.toISOString() ?? null,
    createdAt: caseRow.createdAt.toISOString(),
    updatedAt: caseRow.updatedAt.toISOString(),
    sources: caseRow.sources.map((source) => {
      const snapshot = source.evidence as
        | {
            material?: { categoryName?: unknown; deviceModel?: unknown; result?: unknown };
            quotes?: unknown;
          }
        | null;
      const material = snapshot?.material ?? {};
      const quotes = Array.isArray(snapshot?.quotes)
        ? (snapshot?.quotes as CaseEvidence[]).filter(
            (entry) => typeof entry?.field === "string" && typeof entry?.quote === "string",
          )
        : [];
      const profile = source.record.memberProfile;
      return {
        id: source.id,
        recordId: source.record.id,
        authorName:
          profile.nickname || profile.realName || profile.user.displayName || "成员",
        repairDate: source.record.repairDate?.toISOString().slice(0, 10) ?? null,
        categoryName: typeof material.categoryName === "string" ? material.categoryName : null,
        deviceModel: typeof material.deviceModel === "string" ? material.deviceModel : null,
        result: typeof material.result === "string" ? material.result : null,
        quotes,
        attachedAt: source.processedAt?.toISOString() ?? null,
      };
    }),
    actions: {
      canManage: reviewer,
      canReprocess:
        reviewer &&
        (caseRow.status === "FAILED" ||
          (caseRow.status === "REPROCESSING" &&
            Date.now() - caseRow.updatedAt.getTime() > readCaseProcessingConfig().leaseMs)),
      canRestore: reviewer && caseRow.status === "WITHDRAWN" && caseRow.withdrawnSource === "ADMIN",
      canReembed: reviewer && caseRow.status === "PUBLISHED" && caseRow.embeddingStatus !== "READY",
    },
  };
}

async function setCaseVisibility(
  actor: AuthorizedActor,
  caseId: string,
  visibility: CaseVisibility,
): Promise<KnowledgeCaseDetailView> {
  requirePermission(actor, REVIEW_CODE);
  if (!(CASE_VISIBILITIES as readonly string[]).includes(visibility)) {
    throw new AppError("VALIDATION_FAILED", "visibility 参数无效");
  }
  const db = getDb();
  const caseRow = await db.knowledgeCase.findUnique({ where: { id: caseId } });
  if (!caseRow) throw new AppError("CASE_NOT_FOUND", "案例不存在", { status: 404 });
  if (caseRow.status === "WITHDRAWN") {
    throw new AppError("CASE_STATE_CONFLICT", "已撤回的案例不能调整可见范围", { status: 409 });
  }
  if (caseRow.visibility !== visibility) {
    await inSerializableTransaction(async (tx) => {
      const updated = await tx.knowledgeCase.updateMany({
        where: { id: caseId, visibility: caseRow.visibility },
        data: { visibility },
      });
      if (updated.count !== 1) {
        throw new AppError("CASE_STATE_CONFLICT", "案例状态已变化，请刷新后重试", { status: 409 });
      }
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "knowledge.case.visibility.changed",
        targetType: "KnowledgeCase",
        targetId: caseId,
        result: "SUCCESS",
        before: { visibility: caseRow.visibility },
        after: { visibility },
      });
    });
  }
  return getCaseDetail(actor, caseId);
}

async function withdrawCase(actor: AuthorizedActor, caseId: string): Promise<KnowledgeCaseDetailView> {
  requirePermission(actor, REVIEW_CODE);
  const db = getDb();
  const caseRow = await db.knowledgeCase.findUnique({ where: { id: caseId } });
  if (!caseRow) throw new AppError("CASE_NOT_FOUND", "案例不存在", { status: 404 });
  // 每次显式撤回都刷新 withdrawnAt：它同时是「撤回代次」——重整/恢复流程把它作为
  // 处理代次守卫的一部分，重复撤回必须能被在途的旧结果察觉（否则恢复会被旧结果顶掉）。
  await inSerializableTransaction(async (tx) => {
    const updated = await tx.knowledgeCase.updateMany({
      where: { id: caseId },
      data: {
        status: "WITHDRAWN",
        withdrawnSource: "ADMIN",
        withdrawnAt: new Date(),
        withdrawnByUserId: actor.userId,
      },
    });
    if (updated.count !== 1) {
      throw new AppError("CASE_STATE_CONFLICT", "案例状态已变化，请刷新后重试", { status: 409 });
    }
    await appendAuditLog(tx, {
      actor,
      actorType: "USER",
      actorUserId: actor.userId,
      action: "knowledge.case.withdrawn",
      targetType: "KnowledgeCase",
      targetId: caseId,
      result: "SUCCESS",
      before: { status: caseRow.status },
      after: { status: "WITHDRAWN", withdrawnSource: "ADMIN" },
    });
  });
  return getCaseDetail(actor, caseId);
}

/**
 * 管理员重整动作：失败重试 / 撤回后显式恢复（重新整理发布）/ 卡住的重整重试。
 * 这是「管理员明确触发」的唯一恢复入口，普通重试与索引重建都不会自动恢复撤回案例。
 */
async function reprocessCaseByAdmin(
  actor: AuthorizedActor,
  caseId: string,
  injections: Injections = {},
): Promise<{ case: KnowledgeCaseDetailView; outcome: CaseReprocessOutcome }> {
  requirePermission(actor, REVIEW_CODE);
  const db = getDb();
  const caseRow = await db.knowledgeCase.findUnique({
    where: { id: caseId },
    select: { id: true, status: true, withdrawnSource: true },
  });
  if (!caseRow) throw new AppError("CASE_NOT_FOUND", "案例不存在", { status: 404 });
  const allowAdminWithdrawnRestore =
    caseRow.status === "WITHDRAWN" && caseRow.withdrawnSource === "ADMIN";
  if (caseRow.status === "WITHDRAWN" && caseRow.withdrawnSource === "SOURCES_EXHAUSTED") {
    const validSources = await db.knowledgeCaseSource.count({
      where: { caseId, status: "PUBLISHED" },
    });
    if (validSources === 0) {
      throw new AppError("CASE_NO_VALID_SOURCES", "案例没有有效来源，无法恢复", { status: 409 });
    }
  }
  const outcome = await reprocessCase(caseId, {
    actorUserId: actor.userId ?? null,
    requestId: actor.requestId,
    allowAdminWithdrawnRestore,
    callModelFn: injections.callModelFn,
    embedFn: injections.embedFn,
  });
  return { case: await getCaseDetail(actor, caseId), outcome };
}

/** 单条向量重试：正文未变的案例可单独补生成向量（不重新整理正文、不重复付费模型）。 */
async function reembedCase(
  actor: AuthorizedActor,
  caseId: string,
  injections: Injections = {},
): Promise<KnowledgeCaseDetailView> {
  requirePermission(actor, REVIEW_CODE);
  const db = getDb();
  const caseRow = await db.knowledgeCase.findUnique({ where: { id: caseId } });
  if (!caseRow) throw new AppError("CASE_NOT_FOUND", "案例不存在", { status: 404 });
  if (caseRow.status !== "PUBLISHED") {
    throw new AppError("CASE_STATE_CONFLICT", "仅已发布案例需要生成向量", { status: 409 });
  }
  const embeddingConfig = readEmbeddingConfig();
  if (!embeddingConfig) {
    throw new AppError("AI_NOT_CONFIGURED", "尚未配置向量服务（EMBEDDING_API_KEY）", { status: 503 });
  }
  let vector: number[] | null = null;
  try {
    const vectors = await (injections.embedFn ?? embedTexts)(embeddingConfig, [caseRow.displayText]);
    vector = vectors[0] ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    throw new AppError("AI_PROVIDER_ERROR", `向量服务请求失败：${message.slice(0, 200)}`, { status: 502 });
  }
  if (!vector || vector.length === 0) {
    throw new AppError("AI_PROVIDER_ERROR", "向量服务返回空结果", { status: 502 });
  }
  const fingerprint = `${providerLabelFromUrl(embeddingConfig.baseUrl)}:${embeddingConfig.model}`;
  await inSerializableTransaction(async (tx) => {
    await tx.knowledgeCase.update({
      where: { id: caseId },
      data: {
        embedding: encodeVector(vector as number[]),
        embeddingFingerprint: fingerprint,
        embeddingStatus: "READY",
        embeddingError: null,
      },
    });
    await appendAuditLog(tx, {
      actor,
      actorType: "USER",
      actorUserId: actor.userId,
      action: "knowledge.case.embedding.regenerated",
      targetType: "KnowledgeCase",
      targetId: caseId,
      result: "SUCCESS",
      after: { fingerprint, contentVersion: caseRow.contentVersion },
    });
  });
  return getCaseDetail(actor, caseId);
}

/** 取消典型/内容修改/软删后的失效入口（repairs 服务与 Web 管理路径共用）。 */
export async function invalidateRecordSources(recordId: string, reason: string): Promise<void> {
  const { caseId, shouldReprocess } = await detachSourceContribution(recordId, reason);
  if (caseId && shouldReprocess) scheduleReprocessCase(caseId);
}

/** 管理员/系统标记典型（如 Web 管理端 flags 接口把 isTypical 置 true）后的后台整理入口。 */
export function scheduleTypicalProcessing(recordId: string): void {
  scheduleBackgroundTask(async () => {
    await processSourceContribution(recordId, {
      actorUserId: null,
      requestId: `case-mark:${recordId}`,
    });
  });
}

export function scheduleReprocessCase(caseId: string): void {
  scheduleBackgroundTask(async () => {
    await reprocessCase(caseId, {
      actorUserId: null,
      requestId: `case-reprocess:${caseId}`,
      // 失效路径刚把案例刷成 REPROCESSING，必须跳过忙碌守卫，否则重整会被自己拦下。
      force: true,
    });
  });
}

export const knowledgeCaseService = {
  markTypical,
  unmarkTypical,
  retryProcessing,
  getRecordCaseStatus,
  listCases,
  getCaseDetail,
  setCaseVisibility,
  withdrawCase,
  reprocessCaseByAdmin,
  reembedCase,
};

export { detachSourceContribution };
