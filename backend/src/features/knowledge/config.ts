import path from "node:path";

/**
 * 知识问答的配置读取（全部可选）：读取不到时保持功能可用，
 * 由调用方按 null 处理（问答报 AI_NOT_CONFIGURED，检索降级关键词）。
 *
 * 这些 Key 只放在后端本地 `.env`，不进入 App、仓库、示例与日志。
 */

export type ChatModelConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  maxOutputTokens: number;
};

export type EmbeddingConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
};

const DEFAULT_AI_BASE_URL = "https://api.deepseek.com";
const DEFAULT_AI_MODEL = "deepseek-flash";
const DEFAULT_AI_TIMEOUT_MS = 45_000;
const DEFAULT_AI_MAX_OUTPUT_TOKENS = 1000;
const DEFAULT_EMBEDDING_BASE_URL = "https://api.siliconflow.cn/v1";
const DEFAULT_EMBEDDING_MODEL = "BAAI/bge-m3";
const DEFAULT_EMBEDDING_TIMEOUT_MS = 30_000;
const DEFAULT_INDEX_PATH = path.join("data", "knowledge", "index", "knowledge-index.json");

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** provider 标识用于索引指纹与展示：按已知域名归类，其余用主机名。 */
export function providerLabelFromUrl(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host.endsWith("deepseek.com")) return "deepseek";
    if (host.endsWith("siliconflow.cn")) return "siliconflow";
    return host;
  } catch {
    return "unknown";
  }
}

/** 回答模型配置；缺 Key 返回 null（不代表接口可用，仅代表已配置）。 */
export function readChatModelConfig(env: NodeJS.ProcessEnv = process.env): ChatModelConfig | null {
  const apiKey = (env.AI_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const baseUrl = trimTrailingSlash((env.AI_BASE_URL ?? "").trim() || DEFAULT_AI_BASE_URL);
  const model = (env.AI_MODEL ?? "").trim() || DEFAULT_AI_MODEL;
  return {
    baseUrl,
    model,
    apiKey,
    timeoutMs: positiveInt(env.AI_TIMEOUT_MS, DEFAULT_AI_TIMEOUT_MS),
    maxOutputTokens: positiveInt(env.AI_MAX_OUTPUT_TOKENS, DEFAULT_AI_MAX_OUTPUT_TOKENS),
  };
}

/** Embedding 配置；缺 Key 返回 null（此时检索自动降级关键词，绝不伪造向量）。 */
export function readEmbeddingConfig(env: NodeJS.ProcessEnv = process.env): EmbeddingConfig | null {
  const apiKey = (env.EMBEDDING_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const baseUrl = trimTrailingSlash((env.EMBEDDING_BASE_URL ?? "").trim() || DEFAULT_EMBEDDING_BASE_URL);
  const model = (env.EMBEDDING_MODEL ?? "").trim() || DEFAULT_EMBEDDING_MODEL;
  return {
    baseUrl,
    model,
    apiKey,
    timeoutMs: positiveInt(env.EMBEDDING_TIMEOUT_MS, DEFAULT_EMBEDDING_TIMEOUT_MS),
  };
}

/** 生成索引文件路径（相对 backend/ 的 cwd 解析）。 */
export function knowledgeIndexPath(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.KNOWLEDGE_INDEX_PATH ?? "").trim() || DEFAULT_INDEX_PATH;
  return path.resolve(process.cwd(), raw);
}

/** 数据目录（快照与清单所在）。 */
export function knowledgeDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.KNOWLEDGE_DATA_DIR ?? "").trim() || path.join("data", "knowledge");
  return path.resolve(process.cwd(), raw);
}
