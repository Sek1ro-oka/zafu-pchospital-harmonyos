import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import path from "node:path";

import { readEmbeddingConfig, providerLabelFromUrl, knowledgeIndexPath, knowledgeDataDir } from "../src/features/knowledge/config";
import { EmbeddingError } from "../src/features/knowledge/embedding";
import { assembleIndex, sha256Of, type SourceDocument } from "../src/features/knowledge/index-builder";
import { generateEmbeddingsWithCache } from "../src/features/knowledge/index-embedding";
import type { EmbeddingFingerprint } from "../src/features/knowledge/types";

if (existsSync(".env")) loadEnvFile(".env");

/**
 * 构建知识索引（`pnpm knowledge:index`）。
 *
 * - 语料 = `data/knowledge/knowledge.sources.json` 中的快照正文（校验 sha256）＋内部测试资料；
 * - embedding 配置存在时生成/复用向量：缓存键含 provider、model、分段规则版本与内容哈希，
 *   未变化的块不重复调用；**每个成功批次立即落盘**，中途失败可续用；
 * - 模型或维度与缓存不兼容时丢弃缓存整体重建，不混用新旧向量；
 * - 失败（网络、坏响应）时不覆盖上一份完整索引：先写临时文件，成功才原子替换。
 */

type FileEntry = { path: string; title: string; sha256: string };
type Manifest = {
  snapshot: { repo: string; revision: string; files: FileEntry[] } | null;
  internal: Array<{ path: string; title: string; visibility: "STAFF"; note: string }>;
};

function fail(message: string): never {
  console.error(`[knowledge:index] ${message}`);
  process.exit(1);
}

function loadManifest(dataDir: string): Manifest {
  const manifestPath = path.join(dataDir, "knowledge.sources.json");
  if (!existsSync(manifestPath)) {
    fail(`缺少来源清单 ${manifestPath}，请先运行 pnpm knowledge:sync -- --revision <sha>`);
  }
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

function loadDocuments(dataDir: string, manifest: Manifest): { documents: SourceDocument[]; sources: { repo: string; revision: string } | null } {
  const documents: SourceDocument[] = [];
  const snapshot = manifest.snapshot;
  if (snapshot) {
    for (const entry of snapshot.files) {
      const filePath = path.join(dataDir, "snapshot", "docs", entry.path);
      if (!existsSync(filePath)) {
        fail(`快照缺少正文 ${entry.path}，请重新运行 pnpm knowledge:sync`);
      }
      const content = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
      if (sha256Of(content) !== entry.sha256) {
        fail(`快照正文与清单哈希不一致：${entry.path}（请重新运行 pnpm knowledge:sync 后再建索引）`);
      }
      documents.push({
        path: entry.path,
        title: entry.title,
        visibility: "PUBLIC",
        origin: "snapshot",
        revision: snapshot.revision,
        content,
      });
    }
  }
  for (const entry of manifest.internal) {
    const filePath = path.join(dataDir, entry.path);
    if (!existsSync(filePath)) {
      fail(`缺少内部测试资料 ${entry.path}（随仓库提交，不应缺失）`);
    }
    documents.push({
      path: entry.path,
      title: entry.title,
      visibility: "STAFF",
      origin: "internal",
      revision: null,
      content: readFileSync(filePath, "utf8").replace(/\r\n/g, "\n"),
    });
  }
  return { documents, sources: snapshot ? { repo: snapshot.repo, revision: snapshot.revision } : null };
}

async function main(): Promise<void> {
  const dataDir = knowledgeDataDir();
  const indexPath = knowledgeIndexPath();
  const manifest = loadManifest(dataDir);
  const { documents, sources } = loadDocuments(dataDir, manifest);
  console.log(`[knowledge:index] 语料：${documents.length} 篇（快照 ${documents.filter((d) => d.origin === "snapshot").length}，内部 ${documents.filter((d) => d.origin === "internal").length}）`);

  const embedding = readEmbeddingConfig();
  const indexDir = path.dirname(indexPath);
  mkdirSync(indexDir, { recursive: true });
  const cachePath = path.join(indexDir, "embedding-cache.json");

  // 先分段，确定需要哪些向量。
  const draft = assembleIndex({ documents, embeddings: new Map(), embeddingFingerprint: null, sources });
  const contentShas = [...new Set(draft.chunks.map((chunk) => chunk.contentSha))];
  console.log(`[knowledge:index] 分段：${draft.chunks.length} 块（去重后 ${contentShas.length} 个内容哈希）`);

  const embeddings = new Map<string, number[]>();
  let fingerprint: EmbeddingFingerprint | null = null;
  if (!embedding) {
    console.warn("[knowledge:index] 未配置 EMBEDDING_API_KEY：本次生成**关键词索引**（无向量）。");
    console.warn("[knowledge:index] 配置 embedding 后重新执行本命令即可升级为混合检索索引。");
  } else {
    const textBySha = new Map<string, string>();
    for (const chunk of draft.chunks) {
      if (!textBySha.has(chunk.contentSha)) textBySha.set(chunk.contentSha, chunk.content);
    }
    console.log(`[knowledge:index] 向量批次：每批 16，超时 ${embedding.timeoutMs}ms，成功后立即落盘可续用`);
    try {
      const generated = await generateEmbeddingsWithCache({
        contentShas,
        textForSha: (sha) => textBySha.get(sha) ?? "",
        embedding,
        cachePath,
        onCacheInfo: (hits, total, dimensions) =>
          console.log(
            `[knowledge:index] 缓存命中 ${hits}/${total} 块（provider=${providerLabelFromUrl(embedding.baseUrl)} model=${embedding.model} dims=${dimensions}）`,
          ),
        onBatch: (done, total) =>
          console.log(`[knowledge:index] 已生成并保存向量：${done}/${total} 块`),
      });
      embeddings.clear();
      for (const [sha, vector] of generated.embeddings) embeddings.set(sha, vector);
      fingerprint = generated.fingerprint;
    } catch (error) {
      const kind = error instanceof EmbeddingError ? `${error.kind}${error.status ? ` HTTP ${error.status}` : ""}` : String(error);
      fail(`embedding 生成失败（${kind}）；已成功的批次向量已落盘可续用，已有索引未被覆盖，排查后重跑本命令`);
    }
    if (embeddings.size !== contentShas.length) {
      fail(`向量缺失（${embeddings.size}/${contentShas.length}），已中止，未覆盖旧索引`);
    }
  }

  const result = assembleIndex({ documents, embeddings, embeddingFingerprint: fingerprint, sources });
  const output = `${JSON.stringify(result.file)}\n`;
  const tempPath = `${indexPath}.tmp`;
  rmSync(tempPath, { force: true });
  writeFileSync(tempPath, output, "utf8");
  renameSync(tempPath, indexPath);

  const summary = {
    indexPath: path.relative(process.cwd(), indexPath),
    indexVersion: result.file.indexVersion,
    builtAt: result.file.builtAt,
    retrieval: fingerprint ? "hybrid" : "keyword-only",
    embedding: fingerprint,
    documents: result.stats.documentCount,
    chunks: result.stats.chunkCount,
    chunksWithEmbedding: result.stats.withEmbedding,
    chunksWithoutEmbedding: result.stats.missingEmbedding,
  };
  console.log(`[knowledge:index] ${JSON.stringify(summary)}`);
  if (!fingerprint) {
    console.warn("[knowledge:index] 注意：当前索引不含向量，检索将以关键词模式运行（接口会返回真实 retrievalMode）。");
  }
}

main().catch((error) => {
  console.error(`[knowledge:index] 未处理异常：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
