import assert from "node:assert/strict";
import test from "node:test";

import type { KnowledgeChatData } from "../../../app/entry/src/main/ets/features/knowledge/KnowledgeContract";
import {
  appendMessage,
  ChatMessage,
  failedMessage,
  insertAfterUser,
  pendingMessage,
  removeMessageById,
  replaceMessageById,
  responseMessage,
  retryUserIndex,
  ROLE_USER,
  STATUS_FAILED,
  userMessage,
} from "../../../app/entry/src/main/ets/features/knowledge/KnowledgeFlow";

/**
 * 问答页消息状态回归（对应审查问题 4）：
 * - 回答必须紧跟它所回答的问题，重试旧问题不得打乱后续问答顺序；
 * - 重试再失败后按钮仍可用（失败卡前一条永远是它的用户问题）；
 * - 结构不符合不变量时拒绝重试（不发送请求）。
 *
 * 复用页面使用的 KnowledgeFlow 纯函数，与 KnowledgePage.dispatch/retry 保持同一实现。
 */

function answerData(answer: string, label: string): KnowledgeChatData {
  return {
    status: "answer",
    answer,
    clarifyingQuestion: null,
    citations: [
      {
        sourceId: "kch_test",
        label,
        title: "供电检查",
        docTitle: "开机黑屏",
        headingPath: ["开机黑屏", "供电检查"],
        snippet: "先确认电源适配器指示灯是否亮起。",
        originalUrl: null,
        revision: null,
        visibility: "PUBLIC",
        indexVersion: "k1.test",
      },
    ],
    retrievalMode: "keyword",
    degradation: null,
    indexVersion: "k1.test",
    evidenceCount: 1,
    notes: [],
  };
}

/** 与 KnowledgePage 相同的发送流程；返回新消息列表并记录是否真正发出请求。 */
class PageFlow {
  messages: ChatMessage[] = [];
  nextId = 1;
  sent = 0;

  ask(question: string): number {
    this.messages = appendMessage(this.messages, userMessage(this.nextId++, question));
    return this.messages.length - 1;
  }

  /** 成功：回答替换 pending；失败：失败卡替换 pending。 */
  dispatch(userMessageIndex: number, result: { ok: true; answer: string } | { ok: false }): void {
    const pendingId = this.nextId++;
    this.messages = insertAfterUser(this.messages, userMessageIndex, pendingMessage(pendingId));
    this.sent += 1;
    if (result.ok) {
      this.messages = replaceMessageById(this.messages, pendingId, responseMessage(pendingId, answerData(result.answer, "S1")));
    } else {
      this.messages = replaceMessageById(this.messages, pendingId, failedMessage(pendingId, "AI_PROVIDER_TIMEOUT", "超时"));
    }
  }

  /** 与 KnowledgePage.retry 相同：定位原问题 → 删除失败卡 → 重发。 */
  retry(failedId: number, result: { ok: true; answer: string } | { ok: false }): void {
    const userIndex = retryUserIndex(this.messages, failedId);
    if (userIndex < 0) {
      return;
    }
    this.messages = removeMessageById(this.messages, failedId);
    this.dispatch(userIndex, result);
  }

  summarize(): string[] {
    return this.messages.map((message) => {
      if (message.role === ROLE_USER) {
        return `user(${message.text})`;
      }
      if (message.status === STATUS_FAILED) {
        return "assistant(失败)";
      }
      return `assistant(${message.text})`;
    });
  }
}

test("页面状态：失败问题在后续问答完成后重试，回答插入原位置而不追加到末尾", () => {
  const page = new PageFlow();
  const indexA = page.ask("问题A");
  page.dispatch(indexA, { ok: false });

  const indexB = page.ask("问题B");
  page.dispatch(indexB, { ok: true, answer: "回答B" });

  // 重试之前：问题A 的回答缺席，失败卡在问题B 之前。
  assert.deepEqual(page.summarize(), ["user(问题A)", "assistant(失败)", "user(问题B)", "assistant(回答B)"]);

  const failedA = page.messages[1].id;
  page.retry(failedA, { ok: true, answer: "回答A" });
  assert.deepEqual(
    page.summarize(),
    ["user(问题A)", "assistant(回答A)", "user(问题B)", "assistant(回答B)"],
    "回答A 必须紧跟问题A，而不是跑到问题B 的回答之后",
  );
  const answerA = page.messages[1];
  assert.equal(answerA.citations[0].label, "S1", "回答卡必须带上后端返回的原始引用编号");
  assert.equal(page.messages[2].role, ROLE_USER);
});

test("页面状态：重试再次失败后，失败卡前一条仍是它的用户问题，可再次重试", () => {
  const page = new PageFlow();
  const indexA = page.ask("问题A");
  page.dispatch(indexA, { ok: false });
  const indexB = page.ask("问题B");
  page.dispatch(indexB, { ok: true, answer: "回答B" });

  const failedA = page.messages[1].id;
  page.retry(failedA, { ok: false });
  assert.deepEqual(
    page.summarize(),
    ["user(问题A)", "assistant(失败)", "user(问题B)", "assistant(回答B)"],
    "第二次失败后失败卡仍应紧跟问题A（修复前会被追加到末尾）",
  );

  const failedA2 = page.messages[1].id;
  const sentBefore = page.sent;
  page.retry(failedA2, { ok: true, answer: "回答A" });
  assert.equal(page.sent, sentBefore + 1, "失败卡前一条是用户问题时重试必须真正发送请求");
  assert.deepEqual(page.summarize(), ["user(问题A)", "assistant(回答A)", "user(问题B)", "assistant(回答B)"]);
});

test("页面状态：失败卡前一条不是用户问题时拒绝重试，不发送请求", () => {
  const page = new PageFlow();
  const indexA = page.ask("问题A");
  page.dispatch(indexA, { ok: false });
  const failedA = page.messages[1].id;
  // 人为构造损坏结构：失败卡前一条是助手消息。
  page.messages = [page.messages[1], page.messages[0]];
  const sentBefore = page.sent;
  page.retry(failedA, { ok: true, answer: "不该出现" });
  assert.equal(page.sent, sentBefore, "结构不符合不变量时不得发送请求");
  assert.deepEqual(page.summarize(), ["assistant(失败)", "user(问题A)"]);
  assert.equal(retryUserIndex(page.messages, failedA), -1);
  assert.equal(retryUserIndex(page.messages, page.messages[1].id), -1, "非失败卡不能作为重试入口");
});
