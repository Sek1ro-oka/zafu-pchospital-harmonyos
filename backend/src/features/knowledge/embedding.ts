import type { EmbeddingConfig } from "./config";

/**
 * Embedding 适配（OpenAI 兼容 /embeddings，本轮对接硅基流动 BAAI/bge-m3）。
 *
 * - 批次上限 16，逐批请求；
 * - 每次请求带超时（AbortController），失败抛出带 kind 的错误，由调用方决定降级或中止；
 * - 严格校验响应：数组非空、数值有限、批内维度一致——不合格视为坏响应，绝不复用。
 */

export type EmbeddingErrorKind = "timeout" | "http" | "bad_response";

export class EmbeddingError extends Error {
  readonly kind: EmbeddingErrorKind;
  readonly status: number | null;

  constructor(kind: EmbeddingErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "EmbeddingError";
    this.kind = kind;
    this.status = status;
  }
}

const BATCH_SIZE = 16;

async function requestBatch(config: EmbeddingConfig, texts: string[]): Promise<number[][]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  // 定时器覆盖到响应体读取完成：只覆盖 fetch 时，「先发头、慢发正文」会绕过超时。
  try {
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model: config.model, input: texts }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new EmbeddingError("timeout", `embedding 请求超时（${config.timeoutMs}ms）`);
      }
      throw new EmbeddingError("http", `embedding 请求失败：${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.ok) {
      throw new EmbeddingError("http", `embedding 服务返回 HTTP ${response.status}`, response.status);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (controller.signal.aborted) {
        throw new EmbeddingError("timeout", `embedding 响应读取超时（${config.timeoutMs}ms）`);
      }
      throw new EmbeddingError("bad_response", "embedding 响应不是合法 JSON", response.status);
    }
    const data = (payload as { data?: unknown }).data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new EmbeddingError("bad_response", "embedding 响应条目数量与请求不一致", response.status);
    }
    const vectors = data
      .map((entry) => (entry as { embedding?: unknown }).embedding)
      .map((embedding) => {
        if (!Array.isArray(embedding) || embedding.length === 0) {
          throw new EmbeddingError("bad_response", "embedding 响应包含空向量", response.status);
        }
        const vector = embedding.map((value) => {
          if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new EmbeddingError("bad_response", "embedding 响应包含非有限数值", response.status);
          }
          return value;
        });
        return vector;
      });
    const dimensions = vectors[0].length;
    if (vectors.some((vector) => vector.length !== dimensions)) {
      throw new EmbeddingError("bad_response", "同一响应内 embedding 维度不一致", response.status);
    }
    return vectors;
  } finally {
    clearTimeout(timer);
  }
}

/** 批量生成向量；任何一批失败即整体失败（调用方降级为关键词检索或中止建索引）。 */
export async function embedTexts(config: EmbeddingConfig, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const results: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
    const batch = texts.slice(offset, offset + BATCH_SIZE);
    results.push(...(await requestBatch(config, batch)));
  }
  return results;
}
