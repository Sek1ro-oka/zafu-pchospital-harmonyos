import { createHash } from "node:crypto";

import { chunkMarkdown } from "./chunking";
import {
  CHUNKER_VERSION,
  INDEX_FORMAT_VERSION,
  type EmbeddingFingerprint,
  type KnowledgeChunk,
  type KnowledgeDocumentRecord,
  type KnowledgeIndexFile,
  type KnowledgeVisibility,
  type StoredChunk,
} from "./types";

/**
 * 索引装配：正文 → 分段 → 附向量与元信息 → 可写入的索引文件。
 * 纯函数，不触网；embedding 由调用方（knowledge:index 工具）提前生成。
 */

export type SourceDocument = {
  path: string;
  title: string;
  visibility: KnowledgeVisibility;
  origin: "snapshot" | "internal";
  revision: string | null;
  content: string;
};

export type AssembleInput = {
  documents: SourceDocument[];
  /** contentSha → 向量。相同内容只存一份，多个块复用同一向量。 */
  embeddings: Map<string, number[]>;
  embeddingFingerprint: EmbeddingFingerprint | null;
  sources: { repo: string; revision: string } | null;
  builtAt?: string;
};

export type AssembleResult = {
  file: KnowledgeIndexFile;
  chunks: KnowledgeChunk[];
  stats: {
    documentCount: number;
    chunkCount: number;
    withEmbedding: number;
    missingEmbedding: number;
  };
};

export function sha256Of(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** base64 编码 Float32 小端字节（本课设环境中 x64 / arm64 均为小端）。 */
export function encodeEmbedding(vector: number[] | Float32Array): string {
  const floats = vector instanceof Float32Array ? vector : Float32Array.from(vector);
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength).toString("base64");
}

export function decodeEmbedding(encoded: string): Float32Array {
  const buffer = Buffer.from(encoded, "base64");
  return new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
}

/** 索引版本：内容身份（不随 embedding 模型变化），用于引用定位与过期判断。 */
export function computeIndexVersion(chunks: KnowledgeChunk[], revision: string | null): string {
  const hash = createHash("sha256");
  hash.update(CHUNKER_VERSION).update("\u0000").update(revision ?? "local");
  for (const chunk of [...chunks].sort((a, b) => a.id.localeCompare(b.id))) {
    hash.update("\u0000").update(`${chunk.id}:${chunk.contentSha}`);
  }
  const revisionLabel = (revision ?? "local").slice(0, 8);
  return `k1.${revisionLabel}.${hash.digest("hex").slice(0, 8)}`;
}

export function assembleIndex(input: AssembleInput): AssembleResult {
  const documents: KnowledgeDocumentRecord[] = [];
  const chunks: KnowledgeChunk[] = [];
  let missingEmbedding = 0;

  for (const document of input.documents) {
    const drafts = chunkMarkdown(document.content, { sourcePath: document.path, title: document.title });
    const contentSha = sha256Of(document.content);
    for (const draft of drafts) {
      const chunkSha = sha256Of(draft.content);
      const vector = input.embeddings.get(chunkSha) ?? null;
      if (vector === null) missingEmbedding += 1;
      chunks.push({
        id: draft.id,
        sourcePath: document.path,
        origin: document.origin,
        docTitle: document.title,
        headingPath: draft.headingPath,
        heading: draft.heading,
        anchor: draft.anchor,
        startLine: draft.startLine,
        endLine: draft.endLine,
        partIndex: draft.partIndex,
        partTotal: draft.partTotal,
        visibility: document.visibility,
        revision: document.revision,
        content: draft.content,
        contentSha: chunkSha,
        embedding: vector === null ? null : Float32Array.from(vector),
      });
    }
    documents.push({
      path: document.path,
      title: document.title,
      visibility: document.visibility,
      origin: document.origin,
      revision: document.revision,
      contentSha,
      chunkCount: drafts.length,
    });
  }

  const revision = input.sources?.revision ?? null;
  const storedChunks: StoredChunk[] = chunks.map((chunk) => ({
    id: chunk.id,
    sourcePath: chunk.sourcePath,
    origin: chunk.origin,
    docTitle: chunk.docTitle,
    headingPath: chunk.headingPath,
    heading: chunk.heading,
    anchor: chunk.anchor,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    partIndex: chunk.partIndex,
    partTotal: chunk.partTotal,
    visibility: chunk.visibility,
    revision: chunk.revision,
    content: chunk.content,
    contentSha: chunk.contentSha,
    embeddingBase64: chunk.embedding ? encodeEmbedding(chunk.embedding) : null,
  }));

  return {
    file: {
      formatVersion: INDEX_FORMAT_VERSION,
      indexVersion: computeIndexVersion(chunks, revision),
      builtAt: input.builtAt ?? new Date().toISOString(),
      chunkerVersion: CHUNKER_VERSION,
      embedding: input.embeddingFingerprint,
      sources: input.sources,
      documents,
      chunks: storedChunks,
    },
    chunks,
    stats: {
      documentCount: documents.length,
      chunkCount: chunks.length,
      withEmbedding: chunks.length - missingEmbedding,
      missingEmbedding,
    },
  };
}
