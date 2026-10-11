import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { AppError } from "@/lib/api/errors";

import { knowledgeIndexPath } from "./config";
import { decodeEmbedding } from "./index-builder";
import {
  INDEX_FORMAT_VERSION,
  type KnowledgeChunk,
  type KnowledgeIndex,
  type KnowledgeIndexFile,
} from "./types";

/**
 * 索引加载：从 KNOWLEDGE_INDEX_PATH 读取 JSON，按 mtime 缓存；
 * 文件缺失、格式不兼容或内容损坏都抛出明确错误（映射 503 KNOWLEDGE_INDEX_UNAVAILABLE），
 * 绝不用空索引兜底。
 */

let cached: { path: string; mtimeMs: number; index: KnowledgeIndex } | null = null;

function unavailable(message: string, cause?: unknown): AppError {
  return new AppError("KNOWLEDGE_INDEX_UNAVAILABLE", message, { status: 503, cause });
}

function toRuntimeIndex(file: KnowledgeIndexFile): KnowledgeIndex {
  if (file.formatVersion !== INDEX_FORMAT_VERSION) {
    throw unavailable(`索引格式版本不兼容（文件 v${file.formatVersion}，当前 v${INDEX_FORMAT_VERSION}），请重新运行 pnpm knowledge:index`);
  }
  if (!Array.isArray(file.chunks) || !Array.isArray(file.documents)) {
    throw unavailable("索引缺少 chunks/documents 字段，请重新运行 pnpm knowledge:index");
  }
  const byId = new Map<string, KnowledgeChunk>();
  const chunks: KnowledgeChunk[] = [];
  const declaredDimensions = file.embedding?.dimensions ?? null;
  let vectorCount = 0;
  for (const stored of file.chunks) {
    if (byId.has(stored.id)) {
      throw unavailable(`索引包含重复块 ID：${stored.id}，请重新运行 pnpm knowledge:index`);
    }
    let embedding: Float32Array | null = null;
    if (stored.embeddingBase64 !== null) {
      embedding = decodeEmbedding(stored.embeddingBase64);
      if (declaredDimensions !== null && embedding.length !== declaredDimensions) {
        throw unavailable(`块 ${stored.id} 向量维度为 ${embedding.length}，与索引声明 ${declaredDimensions} 不一致；请重建索引，不混用新旧向量`);
      }
      if (!embedding.every((value) => Number.isFinite(value))) {
        throw unavailable(`块 ${stored.id} 向量包含非有限数值，索引已损坏`);
      }
      vectorCount += 1;
    }
    const chunk: KnowledgeChunk = { ...stored, embedding };
    byId.set(chunk.id, chunk);
    chunks.push(chunk);
  }
  if (file.embedding !== null && vectorCount === 0) {
    throw unavailable("索引声明包含向量但没有任何向量，请重新运行 pnpm knowledge:index");
  }
  if (file.embedding === null && vectorCount > 0) {
    throw unavailable("索引未声明向量指纹却包含向量，请重新运行 pnpm knowledge:index");
  }
  if (chunks.length === 0) {
    throw unavailable("索引没有任何内容块，请检查快照后重新运行 pnpm knowledge:index");
  }
  return {
    indexVersion: file.indexVersion,
    builtAt: file.builtAt,
    chunkerVersion: file.chunkerVersion,
    embedding: file.embedding,
    sources: file.sources,
    documents: file.documents,
    chunks,
    byId,
  };
}

export function loadKnowledgeIndex(): KnowledgeIndex {
  const indexPath = knowledgeIndexPath();
  let mtimeMs: number;
  try {
    mtimeMs = statSync(indexPath).mtimeMs;
  } catch {
    throw unavailable(
      `知识索引尚未构建（未找到 ${path.relative(process.cwd(), indexPath)}）。请在后端目录运行 pnpm knowledge:index`,
    );
  }
  if (cached && cached.path === indexPath && cached.mtimeMs === mtimeMs) return cached.index;

  let parsed: KnowledgeIndexFile;
  try {
    parsed = JSON.parse(readFileSync(indexPath, "utf8")) as KnowledgeIndexFile;
  } catch (error) {
    throw unavailable(`索引文件无法解析（${path.relative(process.cwd(), indexPath)}），请重新运行 pnpm knowledge:index`, error);
  }
  const index = toRuntimeIndex(parsed);
  cached = { path: indexPath, mtimeMs, index };
  return index;
}

export function resetKnowledgeIndexCacheForTests(): void {
  cached = null;
}
