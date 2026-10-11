/**
 * 中文关键词检索：分词 + BM25。
 *
 * 设计取舍（对应任务书 §5「保留机型、英文软件名、错误码、事件 ID 等精确词，
 * 不只靠整句 includes」）：
 * - ASCII 词按整体切出（含数字、点、下划线、连字符、加号、井号），
 *   `0x0000007b`、`KZ-900`、`OMEN 17` 这类精确串不会被拆碎；
 * - CJK 连续段取二元组（bigram），单字段退化为单字——不引入分词词典依赖；
 * - 全角字符先归一到半角。查询与文档使用完全相同的分词，保证一致性。
 */

/** 全角 ASCII（FF01–FF5E）与全角空格归一。 */
export function normalizeForSearch(text: string): string {
  let result = "";
  for (const char of text.toLowerCase()) {
    const code = char.codePointAt(0)!;
    if (code >= 0xff01 && code <= 0xff5e) {
      result += String.fromCodePoint(code - 0xfee0);
    } else if (code === 0x3000) {
      result += " ";
    } else {
      result += char;
    }
  }
  return result;
}

const TOKEN_PATTERN = /[a-z0-9]+(?:[._+#-][a-z0-9]+)*|[\u3400-\u9fff\uf900-\ufaff]+/g;

/** 分词：ASCII 整体串 + CJK 二元组。 */
export function tokenize(text: string): string[] {
  const normalized = normalizeForSearch(text);
  const tokens: string[] = [];
  for (const match of normalized.matchAll(TOKEN_PATTERN)) {
    const piece = match[0];
    if (/^[a-z0-9]/.test(piece)) {
      tokens.push(piece);
      continue;
    }
    if (piece.length === 1) {
      tokens.push(piece);
      continue;
    }
    for (let index = 0; index + 2 <= piece.length; index += 1) {
      tokens.push(piece.slice(index, index + 2));
    }
  }
  return tokens;
}

export type Bm25Document = {
  id: string;
  text: string;
  /** 需要加权但不参与长度归一化的附加文本（如标题路径）：词频按 boostWeight 计。 */
  boostText?: string;
  /** boostText 的词频权重，默认 2。 */
  boostWeight?: number;
};

const BM25_K1 = 1.2;
const BM25_B = 0.75;

/**
 * 小语料 BM25：倒排索引 + 长度归一。语料只有数百块，内存构建成本可忽略。
 */
export class Bm25Index {
  private readonly termFrequencies = new Map<string, Map<string, number>>();
  private readonly documentLengths = new Map<string, number>();
  private readonly averageLength: number;
  private readonly documentCount: number;

  constructor(documents: readonly Bm25Document[]) {
    let totalLength = 0;
    for (const document of documents) {
      const tokens = tokenize(document.text);
      const frequencies = new Map<string, number>();
      for (const token of tokens) {
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      }
      if (document.boostText) {
        const boostWeight = Math.max(1, document.boostWeight ?? 2);
        for (const token of tokenize(document.boostText)) {
          frequencies.set(token, (frequencies.get(token) ?? 0) + boostWeight);
        }
      }
      this.documentLengths.set(document.id, tokens.length);
      totalLength += tokens.length;
      for (const [token, count] of frequencies) {
        let postings = this.termFrequencies.get(token);
        if (!postings) {
          postings = new Map<string, number>();
          this.termFrequencies.set(token, postings);
        }
        postings.set(document.id, count);
      }
    }
    this.documentCount = documents.length;
    this.averageLength = documents.length > 0 ? totalLength / documents.length : 0;
  }

  /** 返回得分大于 0 的文档，按分数降序；同分按 id 稳定排序。 */
  search(query: string, limit: number): Array<{ id: string; score: number }> {
    if (this.documentCount === 0) return [];
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
    const scores = new Map<string, number>();
    for (const token of queryTokens) {
      const postings = this.termFrequencies.get(token);
      if (!postings) continue;
      const documentFrequency = postings.size;
      const idf = Math.log(1 + (this.documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
      for (const [documentId, frequency] of postings) {
        const length = this.documentLengths.get(documentId) ?? 0;
        const denominator =
          frequency + BM25_K1 * (1 - BM25_B + (BM25_B * length) / (this.averageLength || 1));
        const contribution = idf * ((frequency * (BM25_K1 + 1)) / denominator);
        scores.set(documentId, (scores.get(documentId) ?? 0) + contribution);
      }
    }
    return [...scores.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
  }
}

/** 证据片段：压缩空白后截取前缀。 */
export function snippetOf(content: string, maxChars = 200): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length <= maxChars ? compact : `${compact.slice(0, maxChars)}…`;
}
