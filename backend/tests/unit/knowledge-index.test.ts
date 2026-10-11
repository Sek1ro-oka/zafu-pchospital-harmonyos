import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AppError } from "../../src/lib/api/errors";
import { assembleIndex, decodeEmbedding, encodeEmbedding, sha256Of } from "../../src/features/knowledge/index-builder";
import { loadKnowledgeIndex, resetKnowledgeIndexCacheForTests } from "../../src/features/knowledge/index-store";
import type { KnowledgeIndexFile } from "../../src/features/knowledge/types";

/**
 * 索引装配与加载：确定性、向量编解码、删除正文后旧块移除、
 * 维度不匹配 / 损坏 / 缺失索引都必须给出明确错误（不悄悄兜底）。
 */

const REVISION = "abcdef1234567890abcdef1234567890abcdef12";
const SOURCES = { repo: "https://github.com/ZAFU-PCHospital/ZAFU-PCHospital-Doc.git", revision: REVISION };

function document(content: string) {
  return {
    path: "Test.md",
    title: "测试文档",
    visibility: "PUBLIC" as const,
    origin: "snapshot" as const,
    revision: REVISION,
    content,
  };
}

function writeIndexFile(file: KnowledgeIndexFile): { dir: string; indexPath: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "knowledge-index-test-"));
  const indexPath = path.join(dir, "index.json");
  writeFileSync(indexPath, JSON.stringify(file));
  return { dir, indexPath };
}

test("索引装配：版本由内容决定，同输入稳定、内容变化即变化", () => {
  const first = assembleIndex({ documents: [document("# 标题\n\n正文 A")], embeddings: new Map(), embeddingFingerprint: null, sources: SOURCES });
  const second = assembleIndex({ documents: [document("# 标题\n\n正文 A")], embeddings: new Map(), embeddingFingerprint: null, sources: SOURCES });
  assert.equal(first.file.indexVersion, second.file.indexVersion);
  assert.ok(first.file.indexVersion.startsWith("k1.abcdef12."));
  const changed = assembleIndex({ documents: [document("# 标题\n\n正文 B")], embeddings: new Map(), embeddingFingerprint: null, sources: SOURCES });
  assert.notEqual(first.file.indexVersion, changed.file.indexVersion);
});

test("删除的正文从新索引移除，旧块 ID 不再出现", () => {
  const before = assembleIndex({
    documents: [document("# 标题\n\n正文 A"), { ...document("# 旧章节\n\n将被删除的内容"), path: "Old.md" }],
    embeddings: new Map(),
    embeddingFingerprint: null,
    sources: SOURCES,
  });
  const oldIds = new Set(before.file.chunks.map((chunk) => chunk.id));
  const after = assembleIndex({ documents: [document("# 标题\n\n正文 A")], embeddings: new Map(), embeddingFingerprint: null, sources: SOURCES });
  assert.ok(after.file.chunks.every((chunk) => oldIds.has(chunk.id) || chunk.content.includes("标题")));
  assert.ok(!after.file.chunks.some((chunk) => chunk.content.includes("将被删除")), "被删除正文不得残留");
  assert.ok(after.file.documents.length === 1);
});

test("向量编解码：base64 往返一致，缺失向量的块记数正确", () => {
  const vector = [0.5, -1.25, 3];
  const decoded = decodeEmbedding(encodeEmbedding(vector));
  assert.deepEqual([...decoded], vector);

  const content = "# 标题\n\n正文";
  const sha = sha256Of(content.split("\n")[2]);
  const built = assembleIndex({
    documents: [document(content)],
    embeddings: new Map([[sha, [0.1, 0.2]]]),
    embeddingFingerprint: { provider: "siliconflow", model: "BAAI/bge-m3", dimensions: 2 },
    sources: SOURCES,
  });
  assert.equal(built.stats.chunkCount, 1);
  assert.equal(built.stats.withEmbedding, 1);

  const withoutVector = assembleIndex({ documents: [document(content)], embeddings: new Map(), embeddingFingerprint: null, sources: SOURCES });
  assert.equal(withoutVector.stats.missingEmbedding, 1);
  assert.equal(withoutVector.file.chunks[0].embeddingBase64, null);
});

test("加载：索引文件缺失/损坏/维度不一致都会抛 503 明确错误", () => {
  const savedPath = process.env.KNOWLEDGE_INDEX_PATH;
  try {
    process.env.KNOWLEDGE_INDEX_PATH = path.join(os.tmpdir(), "does-not-exist-knowledge-index.json");
    resetKnowledgeIndexCacheForTests();
    assert.throws(
      () => loadKnowledgeIndex(),
      (error: unknown) => error instanceof AppError && error.code === "KNOWLEDGE_INDEX_UNAVAILABLE",
    );

    const valid = assembleIndex({
      documents: [document("# 标题\n\n正文 A")],
      embeddings: new Map([[sha256Of("正文 A"), [0.1, 0.2]]]),
      embeddingFingerprint: { provider: "siliconflow", model: "BAAI/bge-m3", dimensions: 2 },
      sources: SOURCES,
    });
    const corrupted = structuredClone(valid.file);
    corrupted.chunks[0].embeddingBase64 = encodeEmbedding([0.1, 0.2, 0.3, 0.4]);
    const { dir, indexPath } = writeIndexFile(corrupted);
    process.env.KNOWLEDGE_INDEX_PATH = indexPath;
    resetKnowledgeIndexCacheForTests();
    assert.throws(
      () => loadKnowledgeIndex(),
      (error: unknown) => error instanceof AppError && error.code === "KNOWLEDGE_INDEX_UNAVAILABLE" && /维度/.test(error.message),
      "声明 2 维却出现 4 维向量应报错而不是混用",
    );

    corrupted.chunks[0].embeddingBase64 = encodeEmbedding([0.1, 0.2]);
    corrupted.formatVersion = 99;
    writeFileSync(indexPath, JSON.stringify(corrupted));
    resetKnowledgeIndexCacheForTests();
    assert.throws(
      () => loadKnowledgeIndex(),
      (error: unknown) => error instanceof AppError && error.code === "KNOWLEDGE_INDEX_UNAVAILABLE",
    );
    rmSync(dir, { recursive: true, force: true });
  } finally {
    if (savedPath === undefined) delete process.env.KNOWLEDGE_INDEX_PATH;
    else process.env.KNOWLEDGE_INDEX_PATH = savedPath;
    resetKnowledgeIndexCacheForTests();
  }
});

test("加载：正常索引可读且按 mtime 缓存", () => {
  const built = assembleIndex({ documents: [document("# 标题\n\n正文 A")], embeddings: new Map(), embeddingFingerprint: null, sources: SOURCES });
  const { dir, indexPath } = writeIndexFile(built.file);
  const savedPath = process.env.KNOWLEDGE_INDEX_PATH;
  try {
    process.env.KNOWLEDGE_INDEX_PATH = indexPath;
    resetKnowledgeIndexCacheForTests();
    const first = loadKnowledgeIndex();
    const second = loadKnowledgeIndex();
    assert.equal(first, second, "命中缓存应返回同一实例");
    assert.equal(first.chunks.length, 1);
    assert.equal(first.sources?.revision, REVISION);
  } finally {
    if (savedPath === undefined) delete process.env.KNOWLEDGE_INDEX_PATH;
    else process.env.KNOWLEDGE_INDEX_PATH = savedPath;
    resetKnowledgeIndexCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});
