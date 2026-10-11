import assert from "node:assert/strict";
import test from "node:test";

import { EmbeddingError } from "../../src/features/knowledge/embedding";
import { Bm25Index, tokenize } from "../../src/features/knowledge/tokenize";
import { cosineSimilarity, fuseRankings, retrieveKnowledge, VECTOR_MIN_SIMILARITY } from "../../src/features/knowledge/retrieval";
import type { EmbeddingConfig } from "../../src/features/knowledge/config";
import type { KnowledgeChunk, KnowledgeIndex } from "../../src/features/knowledge/types";

/**
 * 检索核心：精确词、排名融合、可见性、降级与维度不匹配。
 * 全部离线：embedding 用注入的假函数，不调用收费模型。
 */

function makeChunk(overrides: Partial<KnowledgeChunk> & { id: string; content: string }): KnowledgeChunk {
  return {
    sourcePath: "Test.md",
    origin: "snapshot",
    docTitle: "测试文档",
    headingPath: [],
    heading: "",
    anchor: "",
    startLine: 1,
    endLine: 1,
    partIndex: null,
    partTotal: null,
    visibility: "PUBLIC",
    revision: "abcdef1234567890abcdef1234567890abcdef12",
    contentSha: "sha",
    embedding: null,
    ...overrides,
  };
}

function makeIndex(chunks: KnowledgeChunk[], embedding: KnowledgeIndex["embedding"]): KnowledgeIndex {
  return {
    indexVersion: "k1.test.00000000",
    builtAt: new Date(0).toISOString(),
    chunkerVersion: "chunker@1",
    embedding,
    sources: { repo: "https://github.com/ZAFU-PCHospital/ZAFU-PCHospital-Doc.git", revision: "abcdef1234567890abcdef1234567890abcdef12" },
    documents: [],
    chunks,
    byId: new Map(chunks.map((chunk) => [chunk.id, chunk])),
  };
}

const embeddingConfig: EmbeddingConfig = {
  baseUrl: "https://api.siliconflow.cn/v1",
  model: "BAAI/bge-m3",
  apiKey: "test",
  timeoutMs: 1000,
};

test("分词：英文/错误码保持整体，CJK 取二元组", () => {
  assert.deepEqual(tokenize("KZ-900"), ["kz-900"]);
  assert.deepEqual(tokenize("0x0000007b"), ["0x0000007b"]);
  assert.deepEqual(tokenize("蓝屏"), ["蓝屏"]);
  const tokens = tokenize("开机蓝屏怎么办");
  assert.ok(tokens.includes("开机") && tokens.includes("蓝屏") && tokens.includes("么办"));
  assert.deepEqual(tokenize("ＣＴＦ－１"), ["ctf-1"]);
});

test("BM25：精确型号命中排第一，不相关的低分块被区分开", () => {
  const index = new Bm25Index([
    { id: "a", text: "暗影精灵 OMEN 17-ck2000 风扇停转的排查方法" },
    { id: "b", text: "开机蓝屏的常规排查步骤，先检查内存" },
    { id: "c", text: "校园网认证失败时重新登录即可" },
  ]);
  const hits = index.search("OMEN 17-ck2000 风扇停转", 3);
  assert.equal(hits[0]?.id, "a");
  assert.ok(!hits.some((hit) => hit.id === "c"));
});

test("RRF 融合：两个排名都靠前的块胜出，分数与排名一致", () => {
  const fused = fuseRankings([
    [{ id: "x", score: 9 }, { id: "y", score: 8 }],
    [{ id: "y", score: 0.9 }, { id: "z", score: 0.8 }],
  ]);
  assert.equal(fused[0].id, "y", "同时出现在两个列表且都靠前的块应第一");
  assert.ok(fused[0].score > fused[1].score);
});

test("相似度：余弦计算与零向量保护", () => {
  assert.equal(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([1, 0])), 1);
  assert.equal(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([0, 1])), 0);
  assert.equal(cosineSimilarity(Float32Array.from([0, 0]), Float32Array.from([1, 0])), 0);
});

test("检索：未配置 embedding 时明确降级关键词并说明原因", async () => {
  const index = makeIndex([makeChunk({ id: "kch_1", content: "开机黑屏怎么排查" })], null);
  const outcome = await retrieveKnowledge({
    index,
    query: "开机黑屏",
    includeStaff: false,
    embedding: null,
    topK: 3,
  });
  assert.equal(outcome.mode, "keyword");
  assert.equal(outcome.degradation?.reason, "EMBEDDING_NOT_CONFIGURED");
  assert.equal(outcome.candidates.length, 1);
  assert.equal(outcome.candidates[0].ranks.vectorRank, null);
});

test("检索：索引无向量或模型不匹配时降级，不混用新旧向量", async () => {
  const chunk = makeChunk({ id: "kch_1", content: "开机黑屏怎么排查" });
  const noVectors = makeIndex([chunk], null);
  const planA = await retrieveKnowledge({ index: noVectors, query: "开机黑屏", includeStaff: false, embedding: embeddingConfig, topK: 3 });
  assert.equal(planA.degradation?.reason, "INDEX_WITHOUT_EMBEDDING");

  const wrongModel = makeIndex([{ ...chunk, embedding: Float32Array.from([1, 0]) }], {
    provider: "siliconflow",
    model: "other-model",
    dimensions: 2,
  });
  const planB = await retrieveKnowledge({
    index: wrongModel,
    query: "开机黑屏",
    includeStaff: false,
    embedding: embeddingConfig,
    topK: 3,
  });
  assert.equal(planB.degradation?.reason, "INDEX_EMBEDDING_MISMATCH");
  assert.equal(planB.mode, "keyword");
});

test("检索：向量请求失败或维度不匹配时降级，关键词结果保留", async () => {
  const index = makeIndex(
    [makeChunk({ id: "kch_1", content: "开机黑屏怎么排查", embedding: Float32Array.from([1, 0, 0]) })],
    { provider: "siliconflow", model: "BAAI/bge-m3", dimensions: 3 },
  );
  const failing = await retrieveKnowledge({
    index,
    query: "开机黑屏",
    includeStaff: false,
    embedding: embeddingConfig,
    topK: 3,
    embedFn: async () => {
      throw new EmbeddingError("timeout", "超时");
    },
  });
  assert.equal(failing.mode, "keyword");
  assert.equal(failing.degradation?.reason, "EMBEDDING_REQUEST_FAILED");
  assert.ok(failing.degradation?.message.includes("timeout"));
  assert.equal(failing.candidates.length, 1, "降级时关键词候选仍应返回");

  const wrongDims = await retrieveKnowledge({
    index,
    query: "开机黑屏",
    includeStaff: false,
    embedding: embeddingConfig,
    topK: 3,
    embedFn: async () => [new Array(8).fill(0.1)],
  });
  assert.equal(wrongDims.degradation?.reason, "INDEX_EMBEDDING_MISMATCH");
});

test("检索：混合模式按 RRF 融合，低于相似度阈值的向量不参与", async () => {
  const aligned = makeChunk({ id: "kch_aligned", content: "磁盘健康 CrystalDiskInfo", embedding: Float32Array.from([1, 0]) });
  const unrelated = makeChunk({ id: "kch_other", content: "校园网认证登录流程", embedding: Float32Array.from([0, 1]) });
  const index = makeIndex([aligned, unrelated], { provider: "siliconflow", model: "BAAI/bge-m3", dimensions: 2 });
  const outcome = await retrieveKnowledge({
    index,
    query: "硬盘工具",
    includeStaff: false,
    embedding: embeddingConfig,
    topK: 2,
    embedFn: async () => [[0.95, 0.05]],
  });
  assert.equal(outcome.mode, "hybrid");
  assert.equal(outcome.degradation, null);
  assert.equal(outcome.candidates.length, 1, "低于相似度阈值的块不得进入候选");
  assert.equal(outcome.candidates[0].chunk.id, "kch_aligned");
  assert.equal(outcome.candidates[0].ranks.vectorRank, 1);
  assert.ok(0.05 < VECTOR_MIN_SIMILARITY);
});

test("检索：STAFF 资料只对工作人员可见", () => {
  const publicChunk = makeChunk({ id: "kch_pub", content: "开机黑屏排查" });
  const staffChunk = makeChunk({ id: "kch_staff", content: "内部备件柜点位登记", visibility: "STAFF" });
  const index = makeIndex([publicChunk, staffChunk], null);

  return (async () => {
    const customer = await retrieveKnowledge({ index, query: "内部备件柜", includeStaff: false, embedding: null, topK: 5 });
    assert.ok(!customer.candidates.some((candidate) => candidate.chunk.id === "kch_staff"), "客户不应检索到内部资料");
    const staff = await retrieveKnowledge({ index, query: "内部备件柜", includeStaff: true, embedding: null, topK: 5 });
    assert.equal(staff.candidates[0]?.chunk.id, "kch_staff");
  })();
});
