import { createHash } from "node:crypto";

/**
 * Markdown 分段（对应任务书 §4.3）：
 * 按标题与段落分块，保留标题层级、正文、源路径、行范围、内容哈希与块 ID。
 *
 * - 代码段、表格、列表是原子块：优先整体保留；超过硬上限才在安全边界（行 / 表格行 / 列表项）拆开，
 *   拆分块以 partIndex/partTotal 标注，其余块不会被并入拆分块；
 * - 块 ID 只由源路径、标题路径、段号与正文决定：正文不变则跨重建稳定，
 *   正文变化会生成新 ID（旧引用因此表现为“已过期”，而不是悄悄指向新内容）。
 */

export const CHUNK_SOFT_MAX_CHARS = 1200;
export const CHUNK_HARD_MAX_CHARS = 2400;

export type ChunkSource = {
  sourcePath: string;
  title: string;
};

export type ChunkDraft = {
  id: string;
  headingPath: string[];
  heading: string;
  anchor: string;
  startLine: number;
  endLine: number;
  partIndex: number | null;
  partTotal: number | null;
  content: string;
};

type Heading = {
  lineIndex: number;
  level: number;
  text: string;
  anchor: string;
};

type BlockKind = "fence" | "table" | "list" | "quote" | "paragraph";

type Block = {
  kind: BlockKind;
  lines: string[];
  startLine: number;
  endLine: number;
};

type BlockPiece = {
  text: string;
  startLine: number;
  endLine: number;
  partIndex: number | null;
  partTotal: number | null;
  /** 拆分块的一部分：不与其他块合并，避免段号语义混乱。 */
  isolated: boolean;
};

/** GitHub 标题锚点：去除格式标记与标点，空格转连字符；同一文件内重名依次加 -1、-2。 */
export function githubAnchor(headingText: string): string {
  let text = headingText
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .toLowerCase();
  text = text.replace(/[^\p{L}\p{N}\s\-_]/gu, "");
  return text.trim().replace(/\s+/g, "-");
}

/** 标题展示文本：去掉强调/代码/链接标记，保留原文字。 */
function cleanHeadingText(raw: string): string {
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
}

function isFenceStart(line: string): { marker: string; length: number } | null {
  const match = /^\s*(`{3,}|~{3,})/.exec(line);
  if (!match) return null;
  return { marker: match[1][0], length: match[1].length };
}

/** 标记每个源行是否位于围栏代码块内（含起止行）。 */
function fenceMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let open: { marker: string; length: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (open === null) {
      const start = isFenceStart(line);
      if (start) {
        open = start;
        mask[index] = true;
      }
    } else {
      mask[index] = true;
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === open.marker && close[1].length >= open.length) {
        open = null;
      }
    }
  }
  return mask;
}

function parseHeadings(lines: string[], inFence: boolean[]): Heading[] {
  const headings: Heading[] = [];
  const anchors = new Map<string, number>();
  for (let index = 0; index < lines.length; index += 1) {
    if (inFence[index]) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[index]);
    if (!match) continue;
    const text = cleanHeadingText(match[2]);
    if (text === "") continue;
    const base = githubAnchor(text);
    const seen = anchors.get(base) ?? 0;
    anchors.set(base, seen + 1);
    headings.push({
      lineIndex: index,
      level: match[1].length,
      text,
      anchor: seen === 0 ? base : `${base}-${seen}`,
    });
  }
  return headings;
}

/** 把一段行区间切成块（代码段/表格/列表/引用/段落）。 */
function splitBlocks(lines: string[], start: number, end: number, inFence: boolean[]): Block[] {
  const blocks: Block[] = [];
  let index = start;
  while (index < end) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const blockStart = index;
    if (inFence[index]) {
      while (index < end && inFence[index]) index += 1;
      blocks.push({ kind: "fence", lines: lines.slice(blockStart, index), startLine: blockStart + 1, endLine: index });
      continue;
    }
    if (line.trim().startsWith("|")) {
      while (index < end && lines[index].trim().startsWith("|")) index += 1;
      blocks.push({ kind: "table", lines: lines.slice(blockStart, index), startLine: blockStart + 1, endLine: index });
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      index += 1;
      while (index < end) {
        const current = lines[index];
        if (/^\s*([-*+]|\d+[.)])\s+/.test(current)) {
          index += 1;
          continue;
        }
        if (current.trim() === "") {
          const next = lines[index + 1] ?? "";
          if (/^\s*([-*+]|\d+[.)])\s+/.test(next) || /^\s{2,}\S/.test(next)) {
            index += 1;
            continue;
          }
          break;
        }
        if (/^\s{2,}\S/.test(current)) {
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: "list", lines: lines.slice(blockStart, index), startLine: blockStart + 1, endLine: index });
      continue;
    }
    if (line.trim().startsWith(">")) {
      while (index < end && lines[index].trim().startsWith(">")) index += 1;
      blocks.push({ kind: "quote", lines: lines.slice(blockStart, index), startLine: blockStart + 1, endLine: index });
      continue;
    }
    while (index < end && lines[index].trim() !== "") index += 1;
    blocks.push({ kind: "paragraph", lines: lines.slice(blockStart, index), startLine: blockStart + 1, endLine: index });
  }
  return blocks;
}

function blockText(lines: string[]): string {
  return lines.join("\n").replace(/\s+$/, "");
}

type Unit = { text: string; startLine: number; endLine: number };

function splitUnitLines(unit: Unit, softMax: number): Unit[] {
  const lines = unit.text.split("\n");
  if (lines.length <= 1) {
    const slices: Unit[] = [];
    for (let offset = 0; offset < unit.text.length; offset += softMax) {
      slices.push({ text: unit.text.slice(offset, offset + softMax), startLine: unit.startLine, endLine: unit.endLine });
    }
    return slices;
  }
  const slices: Unit[] = [];
  let buffer: string[] = [];
  let length = 0;
  let lineCursor = unit.startLine;
  const flush = () => {
    if (buffer.length === 0) return;
    slices.push({ text: buffer.join("\n"), startLine: lineCursor, endLine: lineCursor + buffer.length - 1 });
    lineCursor += buffer.length;
    buffer = [];
    length = 0;
  };
  for (const line of lines) {
    if (length > 0 && length + line.length + 1 > softMax) flush();
    buffer.push(line);
    length += line.length + 1;
  }
  flush();
  return slices;
}

/** 把超长块拆成“单元”（段落行 / 表格行 / 列表项），再把单元装进不超过软上限的小块。 */
function splitOversizedBlock(block: Block): BlockPiece[] {
  const text = blockText(block.lines);
  if (text.length <= CHUNK_HARD_MAX_CHARS) {
    return [{ text, startLine: block.startLine, endLine: block.endLine, partIndex: null, partTotal: null, isolated: false }];
  }

  let units: Unit[];
  let header: Unit | null = null;
  if (block.kind === "table") {
    const lines = block.lines;
    const hasSeparator = lines.length > 1 && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[1]);
    const headerCount = hasSeparator ? 2 : 0;
    if (headerCount > 0) {
      header = { text: lines.slice(0, headerCount).join("\n"), startLine: block.startLine, endLine: block.startLine + headerCount - 1 };
    }
    units = lines.slice(headerCount).map((line, index) => ({
      text: line,
      startLine: block.startLine + headerCount + index,
      endLine: block.startLine + headerCount + index,
    }));
  } else if (block.kind === "list") {
    const items: Unit[] = [];
    let cursor = block.startLine;
    for (const line of block.lines) {
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line) || items.length === 0) {
        items.push({ text: line, startLine: cursor, endLine: cursor });
      } else {
        const last = items[items.length - 1];
        last.text = `${last.text}\n${line}`;
        last.endLine = cursor;
      }
      cursor += 1;
    }
    units = items;
  } else {
    units = block.lines.map((line, index) => ({ text: line, startLine: block.startLine + index, endLine: block.startLine + index }));
  }

  const packed: Array<Unit[]> = [];
  let current: Unit[] = [];
  let currentLength = 0;
  const flush = () => {
    if (current.length === 0) return;
    packed.push(current);
    current = [];
    currentLength = 0;
  };
  for (const unit of units) {
    if (unit.text.length > CHUNK_HARD_MAX_CHARS) {
      flush();
      packed.push(splitUnitLines(unit, CHUNK_SOFT_MAX_CHARS));
      continue;
    }
    if (currentLength > 0 && currentLength + unit.text.length + 1 > CHUNK_SOFT_MAX_CHARS) flush();
    current.push(unit);
    currentLength += unit.text.length + 1;
  }
  flush();

  const flat: Array<Unit[]> = packed.length > 0 ? packed : [[{ text, startLine: block.startLine, endLine: block.endLine }]];
  const total = flat.length;
  return flat.map((unitsInPart, index) => {
    const partUnits = index === 0 && header ? [header, ...unitsInPart] : unitsInPart;
    return {
      text: partUnits.map((unit) => unit.text).join("\n"),
      startLine: partUnits[0].startLine,
      endLine: partUnits[partUnits.length - 1].endLine,
      partIndex: index + 1,
      partTotal: total,
      isolated: true,
    };
  });
}

function chunkId(source: ChunkSource, headingPath: string[], partIndex: number | null, content: string): string {
  const digest = createHash("sha256")
    .update(source.sourcePath)
    .update("\u0000")
    .update(headingPath.join("\u0000"))
    .update("\u0000")
    .update(String(partIndex ?? 0))
    .update("\u0000")
    .update(content)
    .digest("hex");
  return `kch_${digest.slice(0, 20)}`;
}

export function chunkMarkdown(markdown: string, source: ChunkSource): ChunkDraft[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const inFence = fenceMask(lines);
  const headings = parseHeadings(lines, inFence);

  type Section = { heading: Heading | null; start: number; end: number };
  const sections: Section[] = [];
  if (headings.length === 0 || headings[0].lineIndex > 0) {
    const firstHeadingLine = headings[0]?.lineIndex ?? lines.length;
    const hasPreamble = lines.slice(0, firstHeadingLine).some((line) => line.trim() !== "");
    if (hasPreamble) sections.push({ heading: null, start: 0, end: firstHeadingLine });
  }
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    sections.push({
      heading,
      start: heading.lineIndex + 1,
      end: index + 1 < headings.length ? headings[index + 1].lineIndex : lines.length,
    });
  }

  const trailStack: Heading[] = [];
  const drafts: ChunkDraft[] = [];
  for (const section of sections) {
    let headingPath: string[];
    if (section.heading) {
      while (trailStack.length > 0 && trailStack[trailStack.length - 1].level >= section.heading.level) {
        trailStack.pop();
      }
      trailStack.push(section.heading);
      headingPath = trailStack.map((item) => item.text);
    } else {
      headingPath = [];
    }
    const headingText = section.heading?.text ?? "";
    const anchor = section.heading?.anchor ?? "";

    const blocks = splitBlocks(lines, section.start, section.end, inFence);
    const pieces: BlockPiece[] = [];
    for (const block of blocks) pieces.push(...splitOversizedBlock(block));

    let buffer: BlockPiece[] = [];
    let bufferLength = 0;
    const flush = () => {
      if (buffer.length === 0) return;
      const content = buffer.map((piece) => piece.text).join("\n\n");
      const first = buffer[0];
      const last = buffer[buffer.length - 1];
      const single = buffer.length === 1 && first.partIndex !== null ? first : null;
      drafts.push({
        id: chunkId(source, headingPath, single ? single.partIndex : null, content),
        headingPath,
        heading: headingText,
        anchor,
        startLine: first.startLine,
        endLine: last.endLine,
        partIndex: single ? single.partIndex : null,
        partTotal: single ? single.partTotal : null,
        content,
      });
      buffer = [];
      bufferLength = 0;
    };
    for (const piece of pieces) {
      if (piece.isolated || (buffer.length > 0 && buffer[buffer.length - 1].isolated)) {
        flush();
        buffer.push(piece);
        bufferLength = piece.text.length;
        flush();
        continue;
      }
      if (bufferLength > 0 && bufferLength + piece.text.length + 2 > CHUNK_SOFT_MAX_CHARS) flush();
      buffer.push(piece);
      bufferLength += piece.text.length + 2;
    }
    flush();
  }
  return drafts;
}
