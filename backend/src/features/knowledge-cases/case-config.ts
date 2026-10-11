/**
 * 案例处理的配置读取（全部可选，有默认值；不新增必需配置）。
 *
 * 模型与 embedding 直接复用 `features/knowledge/config.ts` 的既有 Key，
 * 这里只放整理/合并流程特有的参数。
 */

export type CaseProcessingConfig = {
  /** 单次处理的总预算（含候选向量、模型调用与案例向量）；默认 60s，对应 App 读取超时 90s。 */
  budgetMs: number;
  /** 案例生成模型输出上限（结构化 JSON 比问答长）。 */
  maxOutputTokens: number;
  /** 处理租约：超过该时长未完成视为可安全接管（服务重启/请求断开后的恢复）。 */
  leaseMs: number;
  /** 相似候选预筛阈值：#39 的 0.6 是「检索相关性」阈值，不是自动合并阈值，这里单独校准。 */
  similarityMin: number;
  /** 交给模型判断的相似候选上限。 */
  maxCandidates: number;
};

const DEFAULT_BUDGET_MS = 60_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1800;
const DEFAULT_LEASE_MS = 120_000;
const DEFAULT_SIMILARITY_MIN = 0.5;
const DEFAULT_MAX_CANDIDATES = 3;

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function unitInterval(raw: string | undefined, fallback: number): number {
  const value = Number.parseFloat(raw ?? "");
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback;
}

export function readCaseProcessingConfig(env: NodeJS.ProcessEnv = process.env): CaseProcessingConfig {
  return {
    budgetMs: positiveInt(env.CASE_PROCESS_BUDGET_MS, DEFAULT_BUDGET_MS),
    maxOutputTokens: positiveInt(env.CASE_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS),
    leaseMs: positiveInt(env.CASE_LEASE_MS, DEFAULT_LEASE_MS),
    similarityMin: unitInterval(env.CASE_SIMILARITY_MIN, DEFAULT_SIMILARITY_MIN),
    maxCandidates: positiveInt(env.CASE_MAX_CANDIDATES, DEFAULT_MAX_CANDIDATES),
  };
}
