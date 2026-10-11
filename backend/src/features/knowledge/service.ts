import { AppError } from "@/lib/api/errors";

import {
  citationIndexVersionOf,
  getCaseCitationDetail,
  realCaseSource,
  withCaseChunks,
  type CaseSourceProvider,
} from "./case-blocks";
import { sourceUrlOf } from "./chat";
import { readEmbeddingConfig } from "./config";
import type { embedTexts } from "./embedding";
import { loadKnowledgeIndex } from "./index-store";
import { retrieveKnowledge } from "./retrieval";
import { snippetOf } from "./tokenize";
import {
  MAX_SEARCH_QUERY_CHARS,
  SEARCH_TOP_K_DEFAULT,
  SEARCH_TOP_K_MAX,
  type KnowledgeSearchData,
  type KnowledgeSearchRequestInput,
  type KnowledgeSourceData,
} from "./types";
import { parseCaseChunkId } from "@/features/knowledge-cases/case-types";

/**
 * 检索与来源详情（任务书 §6 的最小契约）。
 * 来源详情只按索引 ID 查已导入内容，不开放任意 URL / 文件路径；
 * 越权与不存在统一 404，不泄露内部资料存在性。
 */

export function parseSearchRequest(rawBody: string): KnowledgeSearchRequestInput {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new AppError("VALIDATION_FAILED", "请求体不是合法 JSON");
  }
  const query = (payload as { query?: unknown }).query;
  if (typeof query !== "string" || query.trim() === "") {
    throw new AppError("VALIDATION_FAILED", "query 不能为空");
  }
  const trimmed = query.trim();
  if (trimmed.length > MAX_SEARCH_QUERY_CHARS) {
    throw new AppError("VALIDATION_FAILED", `query 过长（上限 ${MAX_SEARCH_QUERY_CHARS} 字）`);
  }
  const topKRaw = (payload as { topK?: unknown }).topK;
  let topK: number | null = null;
  if (topKRaw !== undefined && topKRaw !== null) {
    if (typeof topKRaw !== "number" || !Number.isInteger(topKRaw) || topKRaw < 1 || topKRaw > SEARCH_TOP_K_MAX) {
      throw new AppError("VALIDATION_FAILED", `topK 必须是 1–${SEARCH_TOP_K_MAX} 的整数`);
    }
    topK = topKRaw;
  }
  const retrievalRaw = (payload as { retrieval?: unknown }).retrieval;
  let retrieval: KnowledgeSearchRequestInput["retrieval"] = "auto";
  if (retrievalRaw !== undefined) {
    if (retrievalRaw !== "auto" && retrievalRaw !== "keyword") {
      throw new AppError("VALIDATION_FAILED", "retrieval 仅支持 auto 或 keyword");
    }
    retrieval = retrievalRaw;
  }
  return { query: trimmed, topK, retrieval };
}

export type SearchKnowledgeOptions = {
  input: KnowledgeSearchRequestInput;
  includeStaff: boolean;
  embedFn?: typeof embedTexts;
  /** 案例块来源：默认真实数据库；单测注入 null 或桩实现。 */
  caseSource?: CaseSourceProvider | null;
};

export async function searchKnowledge(options: SearchKnowledgeOptions): Promise<KnowledgeSearchData> {
  const index = loadKnowledgeIndex();
  const caseSource = options.caseSource === undefined ? realCaseSource : options.caseSource;
  let knowledgeIndex = index;
  if (caseSource) {
    try {
      knowledgeIndex = withCaseChunks(
        index,
        await caseSource.loadChunks({ includeStaff: options.includeStaff, indexEmbedding: index.embedding }),
      );
    } catch (error) {
      // 案例装配失败降级为仅文档检索（与问答同一口径）；日志留痕，不伪装成有案例证据。
      console.error("[knowledge] 案例块装配失败（搜索）：", error);
    }
  }
  const outcome = await retrieveKnowledge({
    index: knowledgeIndex,
    query: options.input.query,
    includeStaff: options.includeStaff,
    embedding: readEmbeddingConfig(),
    topK: options.input.topK ?? SEARCH_TOP_K_DEFAULT,
    forceKeyword: options.input.retrieval === "keyword",
    embedFn: options.embedFn,
  });
  // 返回前复核案例候选：检索（含向量等待）期间被撤回/改内部/重整/版本变化（或复核失败）
  // 的案例不得继续返回旧摘要；文档块不受影响。
  let candidates = outcome.candidates;
  if (caseSource) {
    const caseChunkIds = candidates
      .filter((candidate) => candidate.chunk.origin === "case")
      .map((candidate) => candidate.chunk.id);
    if (caseChunkIds.length > 0) {
      let valid: Set<string>;
      try {
        valid = await caseSource.revalidate(caseChunkIds, options.includeStaff);
      } catch (error) {
        console.error("[knowledge] 案例检索复核失败（搜索）：", error);
        valid = new Set<string>();
      }
      candidates = candidates.filter(
        (candidate) => candidate.chunk.origin !== "case" || valid.has(candidate.chunk.id),
      );
    }
  }
  return {
    query: options.input.query,
    retrievalMode: outcome.mode,
    degradation: outcome.degradation,
    indexVersion: knowledgeIndex.indexVersion,
    results: candidates.map((candidate, position) => ({
      sourceId: candidate.chunk.id,
      label: `S${position + 1}`,
      title: candidate.chunk.heading === "" ? candidate.chunk.docTitle : candidate.chunk.heading,
      docTitle: candidate.chunk.docTitle,
      headingPath: candidate.chunk.headingPath,
      snippet: snippetOf(candidate.chunk.content),
      originalUrl: sourceUrlOf(candidate.chunk, knowledgeIndex.sources?.repo ?? null),
      revision: candidate.chunk.revision,
      visibility: candidate.chunk.visibility,
      indexVersion: citationIndexVersionOf(candidate.chunk, knowledgeIndex),
      score: candidate.fusedScore,
      ranks: { keyword: candidate.ranks.keywordRank, vector: candidate.ranks.vectorRank },
    })),
  };
}

export type KnowledgeSourceViewer = {
  includeStaff: boolean;
  userId: string | null;
};

/**
 * 引用详情：文档块按索引 ID 查已导入内容；案例块（kcase_*）按当前数据库状态查——
 * 已撤回、重整中、失败或旧版本引用统一 404；案例的来源证据按请求者权限收口
 * （客户只见 PUBLIC 案例与引文，工作人员可见作者与原始备案入口）。
 */
export async function getKnowledgeSource(
  sourceId: string,
  viewer: KnowledgeSourceViewer,
): Promise<KnowledgeSourceData> {
  const notFound = () =>
    new AppError("KNOWLEDGE_SOURCE_NOT_FOUND", "该引用不存在或已过期（内容可能已更新），请重新检索", {
      status: 404,
    });
  const caseChunk = parseCaseChunkId(sourceId);
  if (caseChunk) {
    const detail = await getCaseCitationDetail(caseChunk.caseId, caseChunk.contentVersion, {
      includeStaff: viewer.includeStaff,
      userId: viewer.userId,
    });
    if (!detail) throw notFound();
    return {
      sourceId,
      kind: "case",
      caseDetail: detail,
      title: detail.title,
      docTitle: "维修案例",
      headingPath: [detail.title],
      content: detail.displayText,
      startLine: 1,
      endLine: 1,
      partIndex: null,
      partTotal: null,
      sourcePath: `cases/${detail.caseId}`,
      visibility: detail.visibility,
      revision: `v${detail.contentVersion}`,
      originalUrl: null,
      indexVersion: `case.v${detail.contentVersion}`,
    };
  }
  const index = loadKnowledgeIndex();
  const chunk = index.byId.get(sourceId);
  if (!chunk) throw notFound();
  if (!viewer.includeStaff && chunk.visibility !== "PUBLIC") throw notFound();
  return {
    sourceId: chunk.id,
    kind: "doc",
    caseDetail: null,
    title: chunk.heading === "" ? chunk.docTitle : chunk.heading,
    docTitle: chunk.docTitle,
    headingPath: chunk.headingPath,
    content: chunk.content,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    partIndex: chunk.partIndex,
    partTotal: chunk.partTotal,
    sourcePath: chunk.sourcePath,
    visibility: chunk.visibility,
    revision: chunk.revision,
    originalUrl: sourceUrlOf(chunk, index.sources?.repo ?? null),
    indexVersion: index.indexVersion,
  };
}
