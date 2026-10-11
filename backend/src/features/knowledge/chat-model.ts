import type { ChatModelConfig } from "./config";

/**
 * 回答模型适配（OpenAI 兼容 /chat/completions，本轮 DeepSeek `deepseek-flash`）。
 *
 * - 非流式、`temperature 0.2`、JSON 输出；
 * - `thinking: {type: "disabled"}`：首轮问答不做长思考（实测该参数在 deepseek-flash 有效，
 *   详见 backend/docs/knowledge-ai.md 的验证记录）；
 * - 每次请求带超时；超时 / 限流 / HTTP / 坏响应区分为不同的错误类型，便于路由映射错误码，
 *   不允许把 provider 故障伪装成「知识库没有答案」。
 */

export type ChatModelErrorKind = "timeout" | "rate_limited" | "http" | "bad_response";

export class ChatModelError extends Error {
  readonly kind: ChatModelErrorKind;
  readonly status: number | null;

  constructor(kind: ChatModelErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "ChatModelError";
    this.kind = kind;
    this.status = status;
  }
}

export type ChatModelMessage = { role: "system" | "user" | "assistant"; content: string };

export async function callChatModel(config: ChatModelConfig, messages: ChatModelMessage[]): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        max_tokens: config.maxOutputTokens,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ChatModelError("timeout", `回答模型请求超时（${config.timeoutMs}ms）`);
    }
    throw new ChatModelError("http", `回答模型请求失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    throw new ChatModelError("rate_limited", "回答模型限流（HTTP 429）", 429);
  }
  if (!response.ok) {
    throw new ChatModelError("http", `回答模型返回 HTTP ${response.status}`, response.status);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ChatModelError("bad_response", "回答模型响应不是合法 JSON", response.status);
  }
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new ChatModelError("bad_response", "回答模型响应缺少正文", response.status);
  }
  return content;
}
