import { AppError } from "@/lib/api/errors";

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
};

export async function searchKnowledge(options: SearchKnowledgeOptions): Promise<KnowledgeSearchData> {
  const index = loadKnowledgeIndex();
  const outcome = await retrieveKnowledge({
    index,
    query: options.input.query,
    includeStaff: options.includeStaff,
    embedding: readEmbeddingConfig(),
    topK: options.input.topK ?? SEARCH_TOP_K_DEFAULT,
    forceKeyword: options.input.retrieval === "keyword",
    embedFn: options.embedFn,
  });
  return {
    query: options.input.query,
    retrievalMode: outcome.mode,
    degradation: outcome.degradation,
    indexVersion: index.indexVersion,
    results: outcome.candidates.map((candidate, position) => ({
      sourceId: candidate.chunk.id,
      label: `S${position + 1}`,
      title: candidate.chunk.heading === "" ? candidate.chunk.docTitle : candidate.chunk.heading,
      docTitle: candidate.chunk.docTitle,
      headingPath: candidate.chunk.headingPath,
      snippet: snippetOf(candidate.chunk.content),
      originalUrl: sourceUrlOf(candidate.chunk, index.sources?.repo ?? null),
      revision: candidate.chunk.revision,
      visibility: candidate.chunk.visibility,
      indexVersion: index.indexVersion,
      score: candidate.fusedScore,
      ranks: { keyword: candidate.ranks.keywordRank, vector: candidate.ranks.vectorRank },
    })),
  };
}

export function getKnowledgeSource(sourceId: string, includeStaff: boolean): KnowledgeSourceData {
  const index = loadKnowledgeIndex();
  const notFound = () =>
    new AppError("KNOWLEDGE_SOURCE_NOT_FOUND", "该引用不存在或已过期（内容可能已更新），请重新检索", {
      status: 404,
    });
  const chunk = index.byId.get(sourceId);
  if (!chunk) throw notFound();
  if (!includeStaff && chunk.visibility !== "PUBLIC") throw notFound();
  return {
    sourceId: chunk.id,
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
