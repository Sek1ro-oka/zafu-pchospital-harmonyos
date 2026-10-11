import assert from "node:assert/strict";
import test from "node:test";

import { callChatModel, ChatModelError } from "../../src/features/knowledge/chat-model";
import { embedTexts, EmbeddingError } from "../../src/features/knowledge/embedding";
import type { ChatModelConfig, EmbeddingConfig } from "../../src/features/knowledge/config";

/**
 * provider 超时回归：定时器必须覆盖响应体读取，而不只是收到响应头。
 * 上游「立即发响应头、迟迟不发语义正文」时，旧实现会在 fd 收到头后就清除定时器。
 * 这里用本地 fetch 桩复现（不联网、不调用收费服务）。
 */

type FetchStub = {
  abortedCount: () => number;
  restore: () => void;
};

/** 桩 fetch：立即返回响应头（ok/200），json() 延迟 bodyDelayMs 后 resolve，abort 时立即 reject。 */
function installSlowBodyFetch(bodyDelayMs: number, payload: unknown): FetchStub {
  const original = globalThis.fetch;
  let aborted = 0;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal;
    const response = {
      ok: true,
      status: 200,
      json: () =>
        new Promise((resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          const timer = setTimeout(() => resolve(payload), bodyDelayMs);
          signal?.addEventListener("abort", () => {
            aborted += 1;
            clearTimeout(timer);
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    };
    return Promise.resolve(response as unknown as Response);
  }) as typeof fetch;
  return {
    abortedCount: () => aborted,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const CHAT_CONFIG: ChatModelConfig = {
  baseUrl: "https://provider.invalid/v1",
  model: "test-model",
  apiKey: "test-key",
  timeoutMs: 80,
  maxOutputTokens: 100,
  totalBudgetMs: 5_000,
};

const EMBEDDING_CONFIG: EmbeddingConfig = {
  baseUrl: "https://provider.invalid/v1",
  model: "test-embedding",
  apiKey: "test-key",
  timeoutMs: 80,
};

test("回答模型：响应头立即返回、正文延迟时，超时仍覆盖正文读取并中止上游", async () => {
  const stub = installSlowBodyFetch(1_000, { choices: [{ message: { content: "迟到的正文" } }] });
  try {
    const started = Date.now();
    await assert.rejects(
      callChatModel(CHAT_CONFIG, [{ role: "user", content: "你好" }]),
      (error: unknown) => error instanceof ChatModelError && error.kind === "timeout",
      "正文未在超时内到达时必须报 timeout，而不是等待正文成功返回",
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 800, `应在正文到达（1000ms）前超时，实际耗时 ${elapsed}ms`);
    assert.equal(stub.abortedCount(), 1, "超时必须真正 abort 上游请求");
  } finally {
    stub.restore();
  }
});

test("回答模型：正文在超时内到达时正常返回，不误报超时", async () => {
  const content = '{"status":"answer","answer":"先检查电源。"}';
  const stub = installSlowBodyFetch(20, { choices: [{ message: { content } }] });
  try {
    const result = await callChatModel({ ...CHAT_CONFIG, timeoutMs: 500 }, [{ role: "user", content: "你好" }]);
    assert.equal(result, content);
  } finally {
    stub.restore();
  }
});

test("embedding：响应头立即返回、正文延迟时，超时仍覆盖正文读取", async () => {
  const stub = installSlowBodyFetch(1_000, { data: [{ embedding: [0.1, 0.2] }] });
  try {
    const started = Date.now();
    await assert.rejects(
      embedTexts(EMBEDDING_CONFIG, ["开机黑屏"]),
      (error: unknown) => error instanceof EmbeddingError && error.kind === "timeout",
      "正文未在超时内到达时必须报 timeout，而不是等待正文成功返回",
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 800, `应在正文到达（1000ms）前超时，实际耗时 ${elapsed}ms`);
    assert.equal(stub.abortedCount(), 1, "超时必须真正 abort 上游请求");
  } finally {
    stub.restore();
  }
});

test("embedding：正文在超时内到达时正常返回", async () => {
  const stub = installSlowBodyFetch(20, { data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] });
  try {
    const vectors = await embedTexts({ ...EMBEDDING_CONFIG, timeoutMs: 500 }, ["文本一", "文本二"]);
    assert.deepEqual(vectors, [
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  } finally {
    stub.restore();
  }
});
