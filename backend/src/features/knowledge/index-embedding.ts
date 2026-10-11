import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { providerLabelFromUrl, type EmbeddingConfig } from "./config";
import { EmbeddingError, embedTexts } from "./embedding";
import { decodeEmbedding, encodeEmbedding } from "./index-builder";
import { CHUNKER_VERSION, type EmbeddingFingerprint } from "./types";

/**
 * 向量生成与缓存（`knowledge:index` 的核心步骤，独立成模块便于回归测试）。
 *
 * - 缓存键：provider + model + 分段规则版本 + 内容哈希；维度记录在缓存文件里参与兼容检查；
 * - 每个成功批次校验后**立即原子落盘**：中途失败时已成功的批次可续用，重跑不重复调用；
 * - provider/model/分段版本不兼容时整体丢弃缓存重建，不混用新旧向量；
 * - 缓存按当前语料裁剪：删除的正文不会把旧向量带入新索引。
 */

export type EmbeddingCacheFile = {
  provider: string;
  model: string;
  dimensions: number;
  chunkerVersion: string;
  /** contentSha → base64(Float32 小端字节) */
  vectors: Record<string, string>;
};

export function loadEmbeddingCache(
  cachePath: string,
  provider: string,
  model: string,
): EmbeddingCacheFile | null {
  if (!existsSync(cachePath)) return null;
  try {
    const cache = JSON.parse(readFileSync(cachePath, "utf8")) as EmbeddingCacheFile;
    const compatible =
      cache.provider === provider &&
      cache.model === model &&
      cache.chunkerVersion === CHUNKER_VERSION &&
      Number.isInteger(cache.dimensions) &&
      cache.dimensions > 0 &&
      typeof cache.vectors === "object" &&
      cache.vectors !== null;
    if (!compatible) {
      console.warn("[knowledge:index] embedding 配置或分段版本已变化，缓存整体丢弃并重建（不混用新旧向量）");
      return null;
    }
    return cache;
  } catch {
    console.warn("[knowledge:index] embedding 缓存无法解析，已丢弃");
    return null;
  }
}

export function saveEmbeddingCache(cachePath: string, cache: EmbeddingCacheFile): void {
  writeFileSync(`${cachePath}.tmp`, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  renameSync(`${cachePath}.tmp`, cachePath);
}

export type GenerateEmbeddingsOptions = {
  /** 本次语料去重后的内容哈希（顺序即生成顺序）。 */
  contentShas: string[];
  textForSha: (sha: string) => string;
  embedding: EmbeddingConfig;
  cachePath: string;
  batchSize?: number;
  /** 测试注入；默认走真实 embedding 服务。 */
  embedFn?: typeof embedTexts;
  onCacheInfo?: (hits: number, total: number, dimensions: number) => void;
  onBatch?: (done: number, total: number) => void;
};

export type GenerateEmbeddingsResult = {
  embeddings: Map<string, number[]>;
  fingerprint: EmbeddingFingerprint;
};

export async function generateEmbeddingsWithCache(
  options: GenerateEmbeddingsOptions,
): Promise<GenerateEmbeddingsResult> {
  const { contentShas, embedding, cachePath } = options;
  const batchSize = Math.max(1, options.batchSize ?? 16);
  const embedFn = options.embedFn ?? embedTexts;
  const provider = providerLabelFromUrl(embedding.baseUrl);
  const fingerprint: EmbeddingFingerprint = { provider, model: embedding.model, dimensions: 0 };
  const embeddings = new Map<string, number[]>();

  const cache = loadEmbeddingCache(cachePath, provider, embedding.model);
  if (cache) {
    for (const sha of contentShas) {
      const encoded = cache.vectors[sha];
      if (encoded === undefined) continue;
      const vector = decodeEmbedding(encoded);
      if (vector.length === cache.dimensions) embeddings.set(sha, [...vector]);
    }
    fingerprint.dimensions = cache.dimensions;
    options.onCacheInfo?.(embeddings.size, contentShas.length, cache.dimensions);
  }

  const missing = contentShas.filter((sha) => !embeddings.has(sha));
  for (let offset = 0; offset < missing.length; offset += batchSize) {
    const batch = missing.slice(offset, offset + batchSize);
    const vectors = await embedFn(embedding, batch.map((sha) => options.textForSha(sha)));
    if (vectors.length !== batch.length) {
      throw new EmbeddingError(
        "bad_response",
        `embedding 返回条目数量与请求不一致（${vectors.length}/${batch.length}）`,
      );
    }
    for (let index = 0; index < batch.length; index += 1) {
      const vector = vectors[index];
      if (fingerprint.dimensions === 0) fingerprint.dimensions = vector.length;
      if (vector.length !== fingerprint.dimensions) {
        throw new EmbeddingError(
          "bad_response",
          `嵌入维度不一致（期望 ${fingerprint.dimensions}，出现 ${vector.length}），请检查模型配置`,
        );
      }
      embeddings.set(batch[index], vector);
    }
    // 先落盘再继续下一批：中途失败时本批向量可续用；完整索引仍待全部成功后由调用方替换。
    const cacheVectors: Record<string, string> = {};
    for (const sha of contentShas) {
      const vector = embeddings.get(sha);
      if (vector) cacheVectors[sha] = encodeEmbedding(vector);
    }
    saveEmbeddingCache(cachePath, {
      provider,
      model: embedding.model,
      dimensions: fingerprint.dimensions,
      chunkerVersion: CHUNKER_VERSION,
      vectors: cacheVectors,
    });
    options.onBatch?.(Math.min(offset + batchSize, missing.length), missing.length);
  }
  return { embeddings, fingerprint };
}
