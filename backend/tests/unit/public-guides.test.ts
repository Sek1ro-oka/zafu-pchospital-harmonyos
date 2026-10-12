import assert from "node:assert/strict";
import test from "node:test";
import { publicGuides } from "../../src/features/knowledge/public-guides";
import { assembleIndex } from "../../src/features/knowledge/index-builder";

const built = assembleIndex({
  documents: [
    { path: "public.md", title: "公开指南", visibility: "PUBLIC", origin: "snapshot", revision: "abc", content: "# 故障排查\n\n检查设备电源是否连接。\n\n## 系统\n\n检查系统日志和启动信息。" },
    { path: "staff.md", title: "内部指南", visibility: "STAFF", origin: "internal", revision: null, content: "# 内部\n\n工作人员内部资料。" },
    { path: "internal-public.md", title: "内部来源", visibility: "PUBLIC", origin: "internal", revision: null, content: "# 内部来源\n\n即使标为 PUBLIC，也不能通过游客文档快照端点返回。" },
  ], embeddings: new Map(), embeddingFingerprint: null, sources: { repo: "test", revision: "abc" },
});
const index = { ...built.file, chunks: built.chunks, byId: new Map(built.chunks.map((chunk) => [chunk.id, chunk])) };

test("游客目录只返回公开快照，每份文档一次", () => {
  const data = publicGuides(index, null);
  assert.ok("guides" in data);
  assert.deepEqual(data.guides.map((guide) => guide.title), ["公开指南"]);
});
test("公开指南详情包含同文档的真实章节", () => {
  const id = index.chunks.find((chunk) => chunk.sourcePath === "public.md")!.id;
  const data = publicGuides(index, id);
  assert.ok("sections" in data);
  assert.equal(data.title, "公开指南");
  assert.ok(data.sections.some((section) => section.content.includes("设备电源")));
  assert.ok(data.sections.some((section) => section.content.includes("系统日志")));
});
test("内部来源、内部资料、案例及路径猜测统一不存在", () => {
  for (const id of [...index.chunks.filter((chunk) => chunk.origin === "internal").map((chunk) => chunk.id), "kcase_fake", "../../.env", "unknown"]) {
    assert.throws(() => publicGuides(index, id), (error: unknown) => error instanceof Error && "status" in error && error.status === 404);
  }
});
