import { AppError } from "@/lib/api/errors";
import { loadKnowledgeIndex } from "./index-store";
import type { KnowledgeIndex } from "./types";

/** 游客只读社团公开文档快照，不接入内部资料、案例或模型调用。 */
export function publicGuides(index: KnowledgeIndex, id: string | null) {
  const chunks = index.chunks.filter((chunk) => chunk.origin === "snapshot" && chunk.visibility === "PUBLIC");
  if (id !== null) {
    const selected = chunks.find((chunk) => chunk.id === id);
    if (!selected) throw new AppError("KNOWLEDGE_SOURCE_NOT_FOUND", "公开指南不存在或已更新", { status: 404 });
    return {
      title: selected.docTitle,
      revision: selected.revision,
      sections: chunks.filter((chunk) => chunk.sourcePath === selected.sourcePath)
        .sort((a, b) => a.startLine - b.startLine)
        .map((chunk) => ({ title: chunk.heading || chunk.docTitle, content: chunk.content })),
    };
  }
  const seen = new Set<string>();
  return { guides: chunks.filter((chunk) => {
    if (seen.has(chunk.sourcePath)) return false;
    seen.add(chunk.sourcePath);
    return true;
  }).map((chunk) => ({ id: chunk.id, title: chunk.docTitle, revision: chunk.revision })) };
}

export function readPublicGuides(id: string | null) {
  return publicGuides(loadKnowledgeIndex(), id);
}
