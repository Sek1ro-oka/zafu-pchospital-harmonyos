import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { answerKnowledgeQuestion } from "../../src/features/knowledge/chat";
import {
  caseChunkOf,
  citationIndexVersionOf,
  withCaseChunks,
  type CaseSourceProvider,
} from "../../src/features/knowledge/case-blocks";
import { assembleIndex } from "../../src/features/knowledge/index-builder";
import { loadKnowledgeIndex, resetKnowledgeIndexCacheForTests } from "../../src/features/knowledge/index-store";
import { retrieveKnowledge } from "../../src/features/knowledge/retrieval";
import { searchKnowledge } from "../../src/features/knowledge/service";
import type { KnowledgeChunk, KnowledgeIndex } from "../../src/features/knowledge/types";
import { caseChunkId } from "../../src/features/knowledge-cases/case-types";
import { encodeVector } from "../../src/features/knowledge-cases/case-vector";

/**
 * 案例块装配与检索（Issue #40 §6）：数据库案例以运行时块参与同一检索，
 * 可见性在装配时过滤；向量指纹不匹配时绝不同维度硬混。
 */

const FINGERPRINT = { provider: "siliconflow", model: "BAAI/bge-m3", dimensions: 3 };

function caseRow(overrides: Partial<Parameters<typeof caseChunkOf>[0]> = {}): Parameters<typeof caseChunkOf>[0] {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    visibility: "STAFF",
    contentVersion: 2,
    displayText: "ThinkPad E14 花屏处理\n故障现象：外接显示器后花屏消失",
    contentHash: "cafe".repeat(16),
    structured: { title: "ThinkPad E14 花屏处理" },
    embedding: encodeVector([0.1, 0.2, 0.3]),
    embeddingFingerprint: "siliconflow:BAAI/bge-m3",
    ...overrides,
  };
}

test("案例块：字段映射与版本化 ID；指纹不匹配时不带向量，绝不同维度硬混", () => {
  const chunk = caseChunkOf(caseRow(), FINGERPRINT);
  assert.equal(chunk.id, caseChunkId("11111111-2222-4333-8444-555555555555", 2));
  assert.equal(chunk.origin, "case");
  assert.equal(chunk.docTitle, "维修案例");
  assert.equal(chunk.heading, "ThinkPad E14 花屏处理");
  assert.equal(chunk.revision, "v2");
  assert.equal(chunk.visibility, "STAFF");
  assert.ok(chunk.embedding, "指纹一致时应带向量");

  const wrongProvider = caseChunkOf(caseRow({ embeddingFingerprint: "deepseek:deepseek-flash" }), FINGERPRINT);
  assert.equal(wrongProvider.embedding, null, "provider/model 不一致的向量不得参与检索");
  const wrongDimension = caseChunkOf(
    caseRow({ embedding: encodeVector([0.1, 0.2]) }),
    FINGERPRINT,
  );
  assert.equal(wrongDimension.embedding, null, "维度不一致的向量不得参与检索");
  const noIndexEmbedding = caseChunkOf(caseRow(), null);
  assert.equal(noIndexEmbedding.embedding, null, "文档索引无向量时案例向量同样不参与");
});

test("装配：案例块合并进运行时索引，文档索引版本保持不变", () => {
  const docChunk: KnowledgeChunk = {
    id: "kch_doc1",
    sourcePath: "a.md",
    origin: "snapshot",
    docTitle: "文档",
    headingPath: ["文档"],
    heading: "文档",
    anchor: "",
    startLine: 1,
    endLine: 1,
    partIndex: null,
    partTotal: null,
    visibility: "PUBLIC",
    revision: "abc",
    content: "开机黑屏检查电源。",
    contentSha: "sha",
    embedding: null,
  };
  const index: KnowledgeIndex = {
    indexVersion: "k1.abc.def",
    builtAt: "2026-10-11T00:00:00.000Z",
    chunkerVersion: "chunker@1",
    embedding: null,
    sources: null,
    documents: [],
    chunks: [docChunk],
    byId: new Map([[docChunk.id, docChunk]]),
  };
  const caseChunk = caseChunkOf(caseRow(), null);
  const merged = withCaseChunks(index, [caseChunk]);
  assert.equal(merged.indexVersion, index.indexVersion, "顶层索引版本保持文档索引口径");
  assert.equal(merged.chunks.length, 2);
  assert.ok(merged.byId.has(caseChunk.id) && merged.byId.has(docChunk.id));
  assert.equal(withCaseChunks(index, []), index, "没有案例时不做多余装配");
  assert.equal(citationIndexVersionOf(caseChunk, merged), "case.v2");
  assert.equal(citationIndexVersionOf(docChunk, merged), "k1.abc.def");
});

test("检索：客户看不到 STAFF 案例块，工作人员可命中；案例正文参与关键词排序", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "knowledge-cases-retrieval-"));
  const indexPath = path.join(tempDir, "index.json");
  const savedPath = process.env.KNOWLEDGE_INDEX_PATH;
  try {
    const documents = [
      {
        path: "Power.md",
        title: "供电检查",
        visibility: "PUBLIC" as const,
        origin: "snapshot" as const,
        revision: "abcdef1234567890abcdef1234567890abcdef12",
        content: "# 供电检查\n\n先确认电源适配器指示灯是否亮起。",
      },
    ];
    process.env.KNOWLEDGE_INDEX_PATH = indexPath;
    const { file } = assembleIndex({
      documents,
      embeddings: new Map(),
      embeddingFingerprint: null,
      sources: null,
      builtAt: "2026-10-11T00:00:00.000Z",
    });
    writeFileSync(indexPath, JSON.stringify(file));
    resetKnowledgeIndexCacheForTests();
    const base = loadKnowledgeIndex();
    const caseChunk = caseChunkOf(
      caseRow({
        structured: { title: "显卡驱动回滚案例" },
        displayText: "显卡驱动回滚案例\n故障现象：外接显示器后花屏消失，回滚驱动后恢复正常。",
      }),
      null,
    );
    const merged = withCaseChunks(base, [caseChunk]);
    const asCustomer = await retrieveKnowledge({
      index: merged,
      query: "外接显示器后花屏消失 回滚驱动",
      includeStaff: false,
      embedding: null,
      topK: 5,
      forceKeyword: true,
    });
    assert.equal(
      asCustomer.candidates.some((candidate) => candidate.chunk.origin === "case"),
      false,
      "客户请求的候选里不得出现 STAFF 案例块",
    );
    const asStaff = await retrieveKnowledge({
      index: merged,
      query: "外接显示器后花屏消失 回滚驱动",
      includeStaff: true,
      embedding: null,
      topK: 5,
      forceKeyword: true,
    });
    assert.ok(
      asStaff.candidates.some((candidate) => candidate.chunk.origin === "case"),
      "工作人员应能命中案例块",
    );
  } finally {
    if (savedPath === undefined) delete process.env.KNOWLEDGE_INDEX_PATH;
    else process.env.KNOWLEDGE_INDEX_PATH = savedPath;
    resetKnowledgeIndexCacheForTests();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

/** 临时索引 + 桩案例源：验证问答/搜索对案例块的引用与返回前复核。 */
async function withTempIndexAndCase(
  run: (caseSource: CaseSourceProvider) => Promise<void>,
): Promise<void> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "knowledge-cases-chat-"));
  const indexPath = path.join(tempDir, "index.json");
  const documents = [
    {
      path: "Power.md",
      title: "供电检查",
      visibility: "PUBLIC" as const,
      origin: "snapshot" as const,
      revision: "abcdef1234567890abcdef1234567890abcdef12",
      content: "# 供电检查\n\n先确认电源适配器指示灯是否亮起。",
    },
  ];
  const { file } = assembleIndex({
    documents,
    embeddings: new Map(),
    embeddingFingerprint: null,
    sources: null,
    builtAt: "2026-10-11T00:00:00.000Z",
  });
  writeFileSync(indexPath, JSON.stringify(file));
  const savedPath = process.env.KNOWLEDGE_INDEX_PATH;
  const savedKey = process.env.AI_API_KEY;
  const savedEmbeddingKey = process.env.EMBEDDING_API_KEY;
  process.env.KNOWLEDGE_INDEX_PATH = indexPath;
  process.env.AI_API_KEY = "test-key";
  process.env.EMBEDDING_API_KEY = "";
  resetKnowledgeIndexCacheForTests();
  const caseChunk = caseChunkOf(caseRow(), null);
  const caseSource: CaseSourceProvider = {
    loadChunks: async () => [caseChunk],
    revalidate: async (chunkIds) => new Set(chunkIds),
  };
  return run(caseSource).finally(() => {
    if (savedPath === undefined) delete process.env.KNOWLEDGE_INDEX_PATH;
    else process.env.KNOWLEDGE_INDEX_PATH = savedPath;
    if (savedKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = savedKey;
    if (savedEmbeddingKey === undefined) delete process.env.EMBEDDING_API_KEY;
    else process.env.EMBEDDING_API_KEY = savedEmbeddingKey;
    resetKnowledgeIndexCacheForTests();
    rmSync(tempDir, { recursive: true, force: true });
  });
}

test("问答：数据库案例块进入候选并被引用，引用版本为案例内容版本", async () => {
  await withTempIndexAndCase(async (caseSource) => {
    const data = await answerKnowledgeQuestion({
      input: { question: "外接显示器后花屏消失 回滚驱动 案例", history: [] },
      includeStaff: true,
      caseSource,
      callModelFn: async () =>
        JSON.stringify({ status: "answer", answer: "可参考 [S1] 的现场处理。", citations: ["S1"] }),
    });
    assert.equal(data.status, "answer");
    assert.equal(data.citations.length, 1);
    assert.equal(data.citations[0].sourceId, caseChunkId("11111111-2222-4333-8444-555555555555", 2));
    assert.equal(data.citations[0].indexVersion, "case.v2");
    assert.equal(data.citations[0].docTitle, "维修案例");
    assert.equal(data.citations[0].originalUrl, null, "案例不生成伪造的原文链接");
  });
});

test("问答：返回前复核发现案例引用失效时，不提供失效证据（按证据不足处理）", async () => {
  await withTempIndexAndCase(async (caseSource) => {
    const data = await answerKnowledgeQuestion({
      input: { question: "外接显示器后花屏消失 回滚驱动 案例", history: [] },
      includeStaff: true,
      caseSource: {
        ...caseSource,
        revalidate: async () => new Set<string>(),
      },
      callModelFn: async () =>
        JSON.stringify({ status: "answer", answer: "可参考 [S1]。", citations: ["S1"] }),
    });
    assert.equal(data.status, "insufficient_evidence");
    assert.equal(data.citations.length, 0);
    assert.ok(data.notes.some((note) => note.includes("失效")));
  });
});

test("搜索：案例块参与结果并带案例版本", async () => {
  await withTempIndexAndCase(async (caseSource) => {
    const searched = await searchKnowledge({
      input: { query: "外接显示器后花屏消失 回滚驱动 案例", topK: 5, retrieval: "keyword" },
      includeStaff: true,
      caseSource,
    });
    const caseHit = searched.results.find((hit) => hit.sourceId.startsWith("kcase_"));
    assert.ok(caseHit, "案例块应出现在搜索命中中");
    assert.equal(caseHit?.indexVersion, "case.v2");
  });
});
