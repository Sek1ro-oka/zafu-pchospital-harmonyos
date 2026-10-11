import assert from "node:assert/strict";
import test from "node:test";

import { chunkMarkdown, githubAnchor } from "../../src/features/knowledge/chunking";

/**
 * 分段与来源定位（Issue #39 §4/§8）：
 * 真实风险在「行号定位错了、代码段被标题误切、超长内容没拆但配置了硬上限」这类问题，
 * 用小型固定 fixture 覆盖，不依赖真实语料。
 */

const FIXTURE = [
  "# 测试文档", // 1
  "", // 2
  "开头说明段落，包含 `KZ-900` 型号。", // 3
  "", // 4
  "## 操作步骤", // 5
  "", // 6
  "1. 第一步：断电。", // 7
  "2. 第二步：拆开后盖。", // 8
  "3. 第三步：检查内存条。", // 9
  "", // 10
  "```bash", // 11
  "## 这不是标题", // 12
  "echo hello", // 13
  "```", // 14
  "", // 15
  "| 项目 | 值 |", // 16
  "| --- | --- |", // 17
  "| 型号 | KZ-900 |", // 18
  "", // 19
  "## 注意事项", // 20
  "", // 21
  "拆机前请先释放静电，注意保修贴纸。", // 22
].join("\n");

test("分段：标题层级、行范围与内容一致", () => {
  const chunks = chunkMarkdown(FIXTURE, { sourcePath: "Test.md", title: "测试" });
  const steps = chunks.find((chunk) => chunk.heading === "操作步骤");
  assert.ok(steps, "应存在“操作步骤”分块");
  assert.deepEqual(steps.headingPath, ["测试文档", "操作步骤"]);
  // 同一小节内的列表、代码段与表格在软上限内合并为一个块，行范围覆盖 7–18
  assert.equal(steps.startLine, 7);
  assert.equal(steps.endLine, 18);
  const sourceLines = FIXTURE.split("\n");
  for (const line of steps.content.split("\n")) {
    if (line === "") continue;
    assert.ok(
      sourceLines.slice(steps.startLine - 1, steps.endLine).includes(line),
      `内容行应来自声明的行范围：${line}`,
    );
  }
  const notes = chunks.find((chunk) => chunk.heading === "注意事项");
  assert.ok(notes);
  assert.equal(notes.startLine, 22);
  assert.equal(notes.endLine, 22);
});

test("代码段内的 ## 行不会被当成标题", () => {
  const chunks = chunkMarkdown(FIXTURE, { sourcePath: "Test.md", title: "测试" });
  assert.ok(!chunks.some((chunk) => chunk.heading.includes("这不是标题")));
});

test("锚点：与 GitHub 标题锚点一致的清洗规则，同文件重名追加 -1", () => {
  assert.equal(githubAnchor("开机黑屏怎么排查？"), "开机黑屏怎么排查");
  assert.equal(githubAnchor("Windows Update 自动装"), "windows-update-自动装");
  assert.equal(githubAnchor("**粗体**与`代码`"), "粗体与代码");
  const duplicated = ["## 常见问题", "", "内容一。", "", "## 常见问题", "", "内容二。"].join("\n");
  const chunks = chunkMarkdown(duplicated, { sourcePath: "Dup.md", title: "重复" });
  const anchors = chunks.map((chunk) => chunk.anchor);
  assert.deepEqual(anchors, ["常见问题", "常见问题-1"]);
});

test("块 ID 稳定：内容不变则跨重建一致，内容变化产生新 ID", () => {
  const source = { sourcePath: "Test.md", title: "测试" };
  const first = chunkMarkdown(FIXTURE, source);
  const second = chunkMarkdown(FIXTURE, source);
  assert.deepEqual(first.map((chunk) => chunk.id), second.map((chunk) => chunk.id));
  const changed = chunkMarkdown(FIXTURE.replace("检查内存条", "重新插拔内存条"), source);
  assert.notDeepEqual(first.map((chunk) => chunk.id), changed.map((chunk) => chunk.id));
});

test("超长段落按行拆分并带 partIndex/partTotal，拆分块不与其他块合并", () => {
  const longLines: string[] = [];
  for (let index = 0; index < 60; index += 1) {
    longLines.push(`第 ${index + 1} 行：${"测试内容".repeat(20)}`);
  }
  const markdown = ["# 超长", "", ...longLines, "", "收尾段落。"].join("\n");
  const chunks = chunkMarkdown(markdown, { sourcePath: "Long.md", title: "超长" });
  const parts = chunks.filter((chunk) => chunk.partIndex !== null);
  assert.ok(parts.length >= 2, "超长段落应被拆成多段");
  assert.deepEqual(
    parts.map((chunk) => chunk.partIndex),
    parts.map((_, index) => index + 1),
  );
  for (const part of parts) {
    assert.equal(part.partTotal, parts.length);
    // 拆分段各自独占一块，且内容不超硬上限（单行本身超限情况除外）
    assert.ok(part.content.length <= 2400 + 1);
  }
  const lines = markdown.split("\n");
  for (const part of parts) {
    for (const line of part.content.split("\n")) {
      if (line === "") continue;
      assert.ok(lines.slice(part.startLine - 1, part.endLine).includes(line));
    }
  }
});

test("超长表格按行拆分且首段保留表头", () => {
  const rows = Array.from({ length: 80 }, (_, index) => `| 行${index + 1} | ${"数据".repeat(30)} |`);
  const markdown = ["# 表", "", "| 列A | 列B |", "| --- | --- |", ...rows].join("\n");
  const chunks = chunkMarkdown(markdown, { sourcePath: "Table.md", title: "表" });
  const parts = chunks.filter((chunk) => chunk.partIndex !== null);
  assert.ok(parts.length >= 2);
  assert.match(parts[0].content, /^\| 列A \| 列B \|/);
});
