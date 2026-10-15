import { readBrowsableCaseDetail } from "@/features/customer-community/customer-case-service";
import { customerUser } from "@/features/customer-profile/customer-profile-service";
import { AppError } from "@/lib/api/errors";
import { getDb } from "@/lib/db/client";
import type { AuthorizedActor } from "@/types/contracts";

export function parseBrowseQuery(value: string | null): string {
  const query = (value ?? "").trim();
  if (query.length === 0 || query.length > 100) {
    throw new AppError("VALIDATION_FAILED", "搜索词须为 1–100 个字符");
  }
  return query;
}

export function matchesBrowseQuery(title: string, text: string, query: string): boolean {
  const needle = query.toLowerCase();
  return title.toLowerCase().includes(needle) || text.toLowerCase().includes(needle);
}

/** 摘要来自实际正文；正文命中时从附近截取，保留可核对的上下文。 */
export function browseExcerpt(text: string, query: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const hit = normalized.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, hit - 35);
  return (start > 0 ? "…" : "") + normalized.slice(start, start + 160) +
    (normalized.length > start + 160 ? "…" : "");
}

export async function searchBrowsableCases(actor: AuthorizedActor, query: string, page: number, pageSize: number, caseId?: string) {
  const includeStaff = actor.permissions.includes("repair:read");
  if (!includeStaff) await customerUser(actor);
  // 课设规模沿用公开目录的完整扫描方式，过滤与有效性复核后再分页。
  // 不把第一页/最近 20 条当全库，也不改变 AI 检索、向量和证据复核逻辑。
  const rows = await getDb().knowledgeCase.findMany({
    where: { status: "PUBLISHED", ...(includeStaff ? {} : { visibility: "PUBLIC" }), ...(caseId ? { id: caseId } : {}) },
    select: { id: true, structured: true, displayText: true },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  const items = [];
  for (const row of rows) {
    const title = (row.structured as { title?: unknown } | null)?.title;
    if (!matchesBrowseQuery(typeof title === "string" ? title : "未命名案例", row.displayText, query)) continue;
    try {
      const detail = await readBrowsableCaseDetail(row.id, includeStaff);
      if (!matchesBrowseQuery(detail.title, detail.displayText, query)) continue;
      items.push({
        caseId: detail.caseId, title: detail.title, excerpt: browseExcerpt(detail.displayText, query),
        contentVersion: detail.contentVersion, visibility: detail.visibility,
        sourceCount: detail.sources.length, updatedAt: detail.updatedAt,
      });
    } catch (error) {
      if (!(error instanceof AppError && error.code === "CASE_NOT_FOUND")) throw error;
    }
  }
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    page, pageSize, total: items.length, hasMore: page * pageSize < items.length,
  };
}
