import { getDb } from "@/lib/db/client";
import {
  CASE_SOURCE_PATH_PREFIX,
  caseChunkId,
  parseCaseChunkId,
  type CaseEvidence,
  type CaseStatus,
  type CaseVisibility,
} from "@/features/knowledge-cases/case-types";
import { decodeVector } from "@/features/knowledge-cases/case-vector";

import type {
  EmbeddingFingerprint,
  KnowledgeCaseCitationDetail,
  KnowledgeChunk,
  KnowledgeIndex,
  KnowledgeVisibility,
} from "./types";

/**
 * 案例块与文档索引的运行时装配（Issue #40 §6）。
 *
 * 数据库是案例的权威来源：每次请求按**当前** DB 状态装配案例块（撤回/重整中/失败
 * 一律不出现），发布后无需重建索引即可检索；重建文档索引永远不会误删案例。
 * 案例向量只有在指纹与文档索引兼容时才参与混合检索，绝不同维度硬混。
 */

export type CaseChunkRow = {
  id: string;
  visibility: string;
  contentVersion: number;
  displayText: string;
  contentHash: string;
  structured: unknown;
  embedding: Uint8Array | null;
  embeddingFingerprint: string | null;
};

export function caseChunkOf(row: CaseChunkRow, indexEmbedding: EmbeddingFingerprint | null): KnowledgeChunk {
  const structured = row.structured as { title?: unknown };
  const title =
    typeof structured?.title === "string" && structured.title.trim() !== ""
      ? structured.title
      : "未命名案例";
  let embedding: Float32Array | null = null;
  if (
    row.embedding &&
    row.embeddingFingerprint &&
    indexEmbedding &&
    row.embeddingFingerprint === `${indexEmbedding.provider}:${indexEmbedding.model}`
  ) {
    const decoded = decodeVector(row.embedding);
    if (decoded.length === indexEmbedding.dimensions) embedding = decoded;
  }
  return {
    id: caseChunkId(row.id, row.contentVersion),
    sourcePath: `${CASE_SOURCE_PATH_PREFIX}${row.id}`,
    origin: "case",
    docTitle: "维修案例",
    headingPath: [title],
    heading: title,
    anchor: "",
    startLine: 1,
    endLine: 1,
    partIndex: null,
    partTotal: null,
    visibility: row.visibility as KnowledgeVisibility,
    revision: `v${row.contentVersion}`,
    content: row.displayText,
    contentSha: row.contentHash,
    embedding,
  };
}

export type CaseSourceProvider = {
  loadChunks(options: {
    includeStaff: boolean;
    indexEmbedding: EmbeddingFingerprint | null;
  }): Promise<KnowledgeChunk[]>;
  /** 回答/返回引用前复核：只保留仍 PUBLISHED、版本未变、对当前请求者可见的案例块。 */
  revalidate(chunkIds: string[], includeStaff: boolean): Promise<Set<string>>;
};

async function loadCaseChunks(options: {
  includeStaff: boolean;
  indexEmbedding: EmbeddingFingerprint | null;
}): Promise<KnowledgeChunk[]> {
  const rows = await getDb().knowledgeCase.findMany({
    where: {
      status: "PUBLISHED",
      ...(options.includeStaff ? {} : { visibility: "PUBLIC" }),
    },
    select: {
      id: true,
      visibility: true,
      contentVersion: true,
      displayText: true,
      contentHash: true,
      structured: true,
      embedding: true,
      embeddingFingerprint: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((row) => caseChunkOf(row, options.indexEmbedding));
}

async function revalidateCaseChunks(chunkIds: string[], includeStaff: boolean): Promise<Set<string>> {
  const valid = new Set<string>();
  const wanted = new Map<string, number>();
  for (const chunkId of chunkIds) {
    const parsed = parseCaseChunkId(chunkId);
    if (parsed) wanted.set(parsed.caseId, parsed.contentVersion);
  }
  if (wanted.size === 0) return valid;
  const rows = await getDb().knowledgeCase.findMany({
    where: { id: { in: [...wanted.keys()] } },
    select: { id: true, status: true, contentVersion: true, visibility: true },
  });
  for (const row of rows) {
    if (row.status !== "PUBLISHED") continue;
    if (!includeStaff && row.visibility !== "PUBLIC") continue;
    if (wanted.get(row.id) !== row.contentVersion) continue;
    valid.add(caseChunkId(row.id, row.contentVersion));
  }
  return valid;
}

/** 真实数据库案例源（问答/检索/来源详情共用）。 */
export const realCaseSource: CaseSourceProvider = {
  loadChunks: loadCaseChunks,
  revalidate: revalidateCaseChunks,
};

/** 把案例块装配进已加载的文档索引（不改动磁盘索引，也不影响 BM25 过滤语义）。 */
export function withCaseChunks(index: KnowledgeIndex, chunks: KnowledgeChunk[]): KnowledgeIndex {
  if (chunks.length === 0) return index;
  const merged = [...index.chunks, ...chunks];
  return {
    ...index,
    chunks: merged,
    byId: new Map(merged.map((chunk) => [chunk.id, chunk])),
  };
}

/** 案例引用块的 indexVersion：与内容版本绑定；文档块沿用索引版本。 */
export function citationIndexVersionOf(chunk: KnowledgeChunk, index: KnowledgeIndex): string {
  if (chunk.origin === "case" && chunk.revision) return `case.${chunk.revision}`;
  return index.indexVersion;
}

export type KnowledgeCaseCitationSource = {
  index: number;
  authorName: string | null;
  repairDate: string | null;
  categoryName: string | null;
  deviceModel: string | null;
  result: string | null;
  quotes: CaseEvidence[];
  repairRecordId: string | null;
  canOpen: boolean;
};

export type CaseViewer = {
  /** 工作人员（MEMBER/ADMIN）通道：可见 STAFF 案例并打开原始备案。 */
  includeStaff: boolean;
  userId: string | null;
};

/**
 * 案例引用详情：本次引用的案例 + 逐条来源证据。
 *
 * - 仅 PUBLISHED 且版本一致时可读；撤回/重整中/失败/旧版本统一按过期处理（404，由调用方抛出）；
 * - 客户只看到 PUBLIC 案例与引文证据：不返回作者姓名、备案 ID，也不给原备案入口；
 * - 工作人员可见来源作者与原备案入口（原备案读取仍由原接口按原权限判定）。
 */
export async function getCaseCitationDetail(
  caseId: string,
  contentVersion: number,
  viewer: CaseViewer,
): Promise<KnowledgeCaseCitationDetail | null> {
  const caseRow = await getDb().knowledgeCase.findUnique({
    where: { id: caseId },
    include: {
      sources: {
        where: { status: "PUBLISHED" },
        orderBy: { createdAt: "asc" },
        include: {
          record: {
            select: {
              id: true,
              repairDate: true,
              memberProfile: {
                select: { nickname: true, realName: true, user: { select: { displayName: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!caseRow) return null;
  if (caseRow.status !== "PUBLISHED") return null;
  if (caseRow.contentVersion !== contentVersion) return null;
  if (!viewer.includeStaff && caseRow.visibility !== "PUBLIC") return null;
  const structured = caseRow.structured as KnowledgeCaseCitationDetail["content"];
  return {
    caseId: caseRow.id,
    title: typeof structured?.title === "string" ? structured.title : "未命名案例",
    status: caseRow.status as CaseStatus,
    visibility: caseRow.visibility as CaseVisibility,
    contentVersion: caseRow.contentVersion,
    content: structured,
    displayText: caseRow.displayText,
    model: caseRow.model,
    promptVersion: caseRow.promptVersion,
    publishedAt: caseRow.publishedAt?.toISOString() ?? null,
    updatedAt: caseRow.updatedAt.toISOString(),
    sources: caseRow.sources.map((source, index) => {
      const snapshot = source.evidence as
        | { material?: { categoryName?: unknown; deviceModel?: unknown; result?: unknown }; quotes?: unknown }
        | null;
      const material = snapshot?.material ?? {};
      const quotes = Array.isArray(snapshot?.quotes)
        ? (snapshot?.quotes as CaseEvidence[]).filter(
            (entry) => typeof entry?.field === "string" && typeof entry?.quote === "string",
          )
        : [];
      const profile = source.record.memberProfile;
      return {
        index: index + 1,
        authorName: viewer.includeStaff
          ? profile.nickname || profile.realName || profile.user.displayName || "成员"
          : null,
        repairDate: source.record.repairDate?.toISOString().slice(0, 10) ?? null,
        categoryName: typeof material.categoryName === "string" ? material.categoryName : null,
        deviceModel: typeof material.deviceModel === "string" ? material.deviceModel : null,
        result: typeof material.result === "string" ? material.result : null,
        quotes,
        repairRecordId: viewer.includeStaff ? source.record.id : null,
        canOpen: viewer.includeStaff,
      };
    }),
  };
}
