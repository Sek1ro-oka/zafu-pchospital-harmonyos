import { providerLabelFromUrl, type EmbeddingConfig } from "./config";
import { EmbeddingError, embedTexts } from "./embedding";
import { Bm25Index } from "./tokenize";
import type {
  KnowledgeChunk,
  KnowledgeIndex,
  RetrievalCandidate,
  RetrievalDegradation,
  RetrievalOutcome,
} from "./types";

/**
 * 混合检索：中文关键词（BM25）＋ 向量相似度，排名融合用 RRF（不直接相加不同量纲的分数）。
 *
 * - 可见性过滤在排名前执行：客户请求的语料里根本不含 STAFF 块；
 * - embedding 未配置 / 索引无向量 / 索引与当前 embedding 配置不匹配 / 查询向量请求失败时，
 *   明确降级为关键词检索并返回 degradation 说明——绝不宣称降级请求做过向量检索；
 * - 向量相似度低于阈值不进入融合（相似度靠前不代表相关）。
 */

/** RRF 常数：语料很小，取 20 拉大头部排名差距。 */
export const RRF_K = 20;
/**
 * 向量相似度下限：低于此值视为不相关，不参与融合。
 * 0.6 是按 bge-m3 实测校准的：域内问题（校园网认证失败）最高相似度 0.81，
 * 域外问题（今天天气/食堂几点开门）最高只有 0.50–0.55；
 * 取 0.35 时 135 块里会有 90+ 块通过，等于没有过滤。后续换模型需重新校准。
 */
export const VECTOR_MIN_SIMILARITY = 0.6;
const KEYWORD_RANK_LIMIT = 40;
const VECTOR_RANK_LIMIT = 40;

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** 排名融合：每个排名列表的贡献为 weight / (k + rank)。 */
export function fuseRankings(
  rankings: Array<Array<{ id: string; score: number }>>,
  k: number = RRF_K,
): Array<{ id: string; score: number }> {
  const fused = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((entry, index) => {
      fused.set(entry.id, (fused.get(entry.id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return [...fused.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

const bm25Cache = new WeakMap<KnowledgeIndex, Map<boolean, Bm25Index>>();

function bm25For(index: KnowledgeIndex, includeStaff: boolean): Bm25Index {
  let variants = bm25Cache.get(index);
  if (!variants) {
    variants = new Map();
    bm25Cache.set(index, variants);
  }
  const existing = variants.get(includeStaff);
  if (existing) return existing;
  const bm25 = new Bm25Index(
    index.chunks
      .filter((chunk) => includeStaff || chunk.visibility === "PUBLIC")
      .map((chunk) => ({
        id: chunk.id,
        text: chunk.content,
        boostText: [...chunk.headingPath, chunk.docTitle].join(" "),
        boostWeight: 2,
      })),
  );
  variants.set(includeStaff, bm25);
  return bm25;
}

export type RetrieveOptions = {
  index: KnowledgeIndex;
  query: string;
  includeStaff: boolean;
  embedding: EmbeddingConfig | null;
  topK: number;
  /** 显式要求仅关键词（验收对比用）：此时 retrievalMode=keyword 且不报降级。 */
  forceKeyword?: boolean;
  /** 测试注入；默认走真实 embedding 服务。 */
  embedFn?: typeof embedTexts;
};

/** 预检查向量可用性；返回 null 表示可走向量检索，否则返回降级原因。 */
function vectorPlan(
  index: KnowledgeIndex,
  embedding: EmbeddingConfig | null,
): { ok: true } | { ok: false; degradation: RetrievalDegradation } {
  if (!embedding) {
    return {
      ok: false,
      degradation: { reason: "EMBEDDING_NOT_CONFIGURED", message: "未配置 embedding 服务，本次使用关键词检索" },
    };
  }
  const provider = providerLabelFromUrl(embedding.baseUrl);
  if (index.embedding === null) {
    return {
      ok: false,
      degradation: {
        reason: "INDEX_WITHOUT_EMBEDDING",
        message: "当前索引不包含向量（构建时未配置 embedding），请运行 pnpm knowledge:index 重建后启用混合检索",
      },
    };
  }
  if (index.embedding.provider !== provider || index.embedding.model !== embedding.model) {
    return {
      ok: false,
      degradation: {
        reason: "INDEX_EMBEDDING_MISMATCH",
        message: `索引向量与当前 embedding 配置不一致（索引：${index.embedding.provider}/${index.embedding.model}），请重建索引；本次仅用关键词检索`,
      },
    };
  }
  return { ok: true };
}

export async function retrieveKnowledge(options: RetrieveOptions): Promise<RetrievalOutcome> {
  const { index, query, includeStaff, topK } = options;
  const authorized = index.chunks.filter((chunk) => includeStaff || chunk.visibility === "PUBLIC");
  if (authorized.length === 0) return { mode: "keyword", degradation: null, candidates: [] };

  const keywordRanking = bm25For(index, includeStaff).search(query, KEYWORD_RANK_LIMIT);

  if (options.forceKeyword) {
    return {
      mode: "keyword",
      degradation: null,
      candidates: candidatesFromKeyword(index, keywordRanking, topK),
    };
  }

  const plan = vectorPlan(index, options.embedding);
  if (!plan.ok) {
    return {
      mode: "keyword",
      degradation: plan.degradation,
      candidates: candidatesFromKeyword(index, keywordRanking, topK),
    };
  }

  const embedding = options.embedding!;
  const embedFn = options.embedFn ?? embedTexts;
  let queryVector: number[];
  try {
    const vectors = await embedFn(embedding, [query]);
    queryVector = vectors[0];
  } catch (error) {
    const kind = error instanceof EmbeddingError ? `${error.kind}${error.status ? ` HTTP ${error.status}` : ""}` : "unknown";
    return {
      mode: "keyword",
      degradation: {
        reason: "EMBEDDING_REQUEST_FAILED",
        message: `查询向量生成失败（${kind}），本次降级为关键词检索，结果可能不完整`,
      },
      candidates: candidatesFromKeyword(index, keywordRanking, topK),
    };
  }

  if (index.embedding !== null && queryVector.length !== index.embedding.dimensions) {
    return {
      mode: "keyword",
      degradation: {
        reason: "INDEX_EMBEDDING_MISMATCH",
        message: `查询向量维度（${queryVector.length}）与索引（${index.embedding.dimensions}）不一致，请重建索引；本次仅用关键词检索`,
      },
      candidates: candidatesFromKeyword(index, keywordRanking, topK),
    };
  }

  const queryFloat = Float32Array.from(queryVector);
  const vectorRanking = authorized
    .filter((chunk): chunk is KnowledgeChunk & { embedding: Float32Array } => chunk.embedding !== null)
    .map((chunk) => ({ id: chunk.id, score: cosineSimilarity(queryFloat, chunk.embedding) }))
    .filter((entry) => entry.score >= VECTOR_MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, VECTOR_RANK_LIMIT);

  const fused = fuseRankings([keywordRanking, vectorRanking]);
  const keywordRankById = new Map(keywordRanking.map((entry, index_) => [entry.id, index_ + 1]));
  const vectorRankById = new Map(vectorRanking.map((entry, index_) => [entry.id, index_ + 1]));
  const keywordScoreById = new Map(keywordRanking.map((entry) => [entry.id, entry.score]));
  const vectorScoreById = new Map(vectorRanking.map((entry) => [entry.id, entry.score]));

  const candidates: RetrievalCandidate[] = [];
  for (const entry of fused) {
    if (candidates.length >= topK) break;
    const chunk = index.byId.get(entry.id);
    if (!chunk) continue;
    if (!includeStaff && chunk.visibility !== "PUBLIC") continue;
    candidates.push({
      chunk,
      fusedScore: entry.score,
      ranks: {
        keywordRank: keywordRankById.get(entry.id) ?? null,
        vectorRank: vectorRankById.get(entry.id) ?? null,
        keywordScore: keywordScoreById.get(entry.id) ?? 0,
        vectorSimilarity: vectorScoreById.get(entry.id) ?? null,
      },
    });
  }
  return { mode: "hybrid", degradation: null, candidates };
}

function candidatesFromKeyword(
  index: KnowledgeIndex,
  keywordRanking: Array<{ id: string; score: number }>,
  topK: number,
): RetrievalCandidate[] {
  const candidates: RetrievalCandidate[] = [];
  keywordRanking.forEach((entry, position) => {
    if (candidates.length >= topK) return;
    const chunk = index.byId.get(entry.id);
    if (!chunk) return;
    candidates.push({
      chunk,
      fusedScore: 1 / (RRF_K + position + 1),
      ranks: {
        keywordRank: position + 1,
        vectorRank: null,
        keywordScore: entry.score,
        vectorSimilarity: null,
      },
    });
  });
  return candidates;
}
