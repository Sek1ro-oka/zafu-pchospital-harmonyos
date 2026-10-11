import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { EmbeddingConfig } from "../../src/features/knowledge/config";
import { EmbeddingError } from "../../src/features/knowledge/embedding";
import {
  generateEmbeddingsWithCache,
  loadEmbeddingCache,
  saveEmbeddingCache,
} from "../../src/features/knowledge/index-embedding";

/**
 * 建索引缓存的回归（对应审查问题 5）：
 * - 每个成功批次立即原子落盘：后续批次失败时，本轮已成功的向量可续用，重跑不重复付费；
 * - 完整索引仍待全部成功后由调用方替换（本文件只验证缓存侧）；
 * - provider/model 不兼容时缓存整体丢弃，不混用新旧向量。
 */

const EMBEDDING: EmbeddingConfig = {
  baseUrl: "https://api.siliconflow.cn/v1",
  model: "BAAI/test-model",
  apiKey: "test-key",
  timeoutMs: 1_000,
};

function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "knowledge-embedding-cache-test-"));
  return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("建索引缓存：中途批次失败时已成功批次已落盘，重跑只补缺失块", async () => {
  await withTempDir(async (dir) => {
    const cachePath = path.join(dir, "embedding-cache.json");
    const contentShas = Array.from({ length: 20 }, (_, index) => `sha${String(index).padStart(2, "0")}`);
    const textForSha = (sha: string): string => `内容 ${sha}`;

    const firstRunRequests: string[][] = [];
    const failOnSecondBatch = async (_config: EmbeddingConfig, texts: string[]): Promise<number[][]> => {
      firstRunRequests.push([...texts]);
      if (firstRunRequests.length === 2) {
        throw new EmbeddingError("http", "上游返回 HTTP 500", 500);
      }
      return texts.map(() => [0.1, 0.2]);
    };

    await assert.rejects(
      generateEmbeddingsWithCache({
        contentShas,
        textForSha,
        embedding: EMBEDDING,
        cachePath,
        embedFn: failOnSecondBatch,
      }),
      (error: unknown) => error instanceof EmbeddingError && error.kind === "http",
    );
    assert.equal(firstRunRequests[0].length, 16);
    assert.equal(firstRunRequests[1].length, 4);

    const cache = loadEmbeddingCache(cachePath, "siliconflow", "BAAI/test-model");
    assert.ok(cache, "第一批成功后缓存必须已落盘（修复前要等全部批次成功才写入）");
    assert.deepEqual(
      Object.keys(cache.vectors).sort(),
      contentShas.slice(0, 16).sort(),
      "缓存应只包含已成功的 16 块",
    );
    assert.equal(cache.dimensions, 2);

    const secondRunRequests: string[][] = [];
    const succeed = async (_config: EmbeddingConfig, texts: string[]): Promise<number[][]> => {
      secondRunRequests.push([...texts]);
      return texts.map(() => [0.3, 0.4]);
    };
    const result = await generateEmbeddingsWithCache({
      contentShas,
      textForSha,
      embedding: EMBEDDING,
      cachePath,
      embedFn: succeed,
    });
    assert.deepEqual(
      secondRunRequests.flat(),
      contentShas.slice(16).map(textForSha),
      "重跑只应请求缺失的 4 块，不得重复生成已缓存向量",
    );
    assert.equal(result.embeddings.size, 20);
    assert.equal(result.fingerprint.dimensions, 2);

    const cacheAfter = loadEmbeddingCache(cachePath, "siliconflow", "BAAI/test-model");
    assert.equal(Object.keys(cacheAfter?.vectors ?? {}).length, 20, "重跑完成后缓存应补齐到 20 块");
  });
});

test("建索引缓存：provider/model 或分段版本不兼容时整体丢弃，重新生成", async () => {
  await withTempDir(async (dir) => {
    const cachePath = path.join(dir, "embedding-cache.json");
    saveEmbeddingCache(cachePath, {
      provider: "siliconflow",
      model: "BAAI/other-model",
      dimensions: 2,
      chunkerVersion: "k1",
      vectors: { sha0: "AAAAAAAAAAA=" },
    });
    assert.equal(
      loadEmbeddingCache(cachePath, "siliconflow", "BAAI/test-model"),
      null,
      "model 不一致必须丢弃整个缓存",
    );
    assert.equal(loadEmbeddingCache(cachePath, "other-provider", "BAAI/other-model"), null);

    const requested: string[][] = [];
    const result = await generateEmbeddingsWithCache({
      contentShas: ["sha0", "sha1"],
      textForSha: (sha) => `内容 ${sha}`,
      embedding: EMBEDDING,
      cachePath,
      embedFn: async (_config, texts) => {
        requested.push([...texts]);
        return texts.map(() => [0.5, 0.6]);
      },
    });
    assert.deepEqual(requested.flat(), ["内容 sha0", "内容 sha1"], "不兼容缓存不得被复用");
    assert.equal(result.embeddings.size, 2);
  });
});

test("建索引缓存：同批内维度不一致立即失败，且该批不进入缓存", async () => {
  await withTempDir(async (dir) => {
    const cachePath = path.join(dir, "embedding-cache.json");
    await assert.rejects(
      generateEmbeddingsWithCache({
        contentShas: ["sha0", "sha1"],
        textForSha: (sha) => `内容 ${sha}`,
        embedding: EMBEDDING,
        cachePath,
        embedFn: async (_config, texts) => texts.map((_text, index) => (index === 0 ? [0.1, 0.2] : [0.1, 0.2, 0.3])),
      }),
      (error: unknown) => error instanceof EmbeddingError && error.kind === "bad_response",
    );
    assert.equal(loadEmbeddingCache(cachePath, "siliconflow", "BAAI/test-model"), null, "不合格批次不得写入缓存");
  });
});
