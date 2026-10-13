import { randomUUID } from "node:crypto";
import { customerUser } from "@/features/customer-profile/customer-profile-service";
import { loadKnowledgeIndex } from "@/features/knowledge/index-store";
import { AppError } from "@/lib/api/errors";
import { paginationMeta } from "@/lib/api/pagination";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import type { AuthorizedActor, PaginationInput } from "@/types/contracts";
import { publicCaseDetail } from "./customer-case-service";

type FavoriteSource = { kind: string; sourceId: string };
/** 指南以 sourcePath 为稳定键；客户端当前 chunk ID 只用于解析路径，不储存旧正文。 */
function guide(pathOrId: string) {
  const index = loadKnowledgeIndex();
  const chunk = index.chunks.find(
    (chunk) =>
      chunk.origin === "snapshot" &&
      chunk.visibility === "PUBLIC" &&
      (chunk.id === pathOrId || chunk.sourcePath === pathOrId),
  );
  if (!chunk) throw new AppError("KNOWLEDGE_SOURCE_NOT_FOUND", "公开指南不存在或不可访问");
  return chunk;
}
async function resolve(source: FavoriteSource) {
  if (source.kind === "GUIDE") {
    const chunk = guide(source.sourceId);
    return { sourceId: chunk.sourcePath, title: chunk.docTitle, targetId: chunk.id };
  }
  if (source.kind === "CASE") {
    const detail = await publicCaseDetail(source.sourceId);
    return { sourceId: detail.caseId, title: detail.title, targetId: detail.caseId };
  }
  throw new AppError("VALIDATION_FAILED", "收藏类型必须为 GUIDE 或 CASE");
}
function input(body: unknown): FavoriteSource {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AppError("VALIDATION_FAILED", "收藏参数无效");
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !["kind", "sourceId"].includes(key)) ||
    typeof value.kind !== "string" ||
    typeof value.sourceId !== "string" ||
    !value.sourceId ||
    value.sourceId.length > 512
  )
    throw new AppError("VALIDATION_FAILED", "收藏参数无效");
  return { kind: value.kind, sourceId: value.sourceId };
}
export const customerFavoriteService = {
  async list(pagination: PaginationInput, actor: AuthorizedActor) {
    const user = await customerUser(actor),
      db = getDb();
    const where = { userId: user.id, deletedAt: null };
    const [total, rows] = await Promise.all([
      db.customerFavorite.count({ where }),
      db.customerFavorite.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
    ]);
    const items = [];
    for (const row of rows) {
      try {
        const source = await resolve(row);
        items.push({ id: row.id, kind: row.kind, ...source, available: true });
      } catch (error) {
        if (!(
          error instanceof AppError &&
          ["CASE_NOT_FOUND", "KNOWLEDGE_SOURCE_NOT_FOUND"].includes(error.code)
        ))
          throw error;
        items.push({
          id: row.id,
          kind: row.kind,
          sourceId: row.sourceId,
          title: "内容不可访问",
          targetId: null,
          available: false,
        });
      }
    }
    return { items, pagination: paginationMeta(pagination, total) };
  },
  async add(body: unknown, actor: AuthorizedActor) {
    const user = await customerUser(actor),
      source = input(body);
    const target = await resolve(source);
    return inSerializableTransaction(async (tx) => {
      // 使用唯一复合键恢复原行，重复收藏不产生多份。
      const row = await tx.customerFavorite.upsert({
        where: {
          userId_kind_sourceId: { userId: user.id, kind: source.kind, sourceId: target.sourceId },
        },
        create: { id: randomUUID(), userId: user.id, kind: source.kind, sourceId: target.sourceId },
        update: { deletedAt: null },
      });
      const fresh = await resolve({ kind: row.kind, sourceId: row.sourceId });
      return { id: row.id, kind: row.kind, ...fresh, available: true };
    });
  },
  async remove(id: string, actor: AuthorizedActor) {
    const user = await customerUser(actor);
    const result = await getDb().customerFavorite.updateMany({
      where: { id, userId: user.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!result.count) throw new AppError("FAVORITE_NOT_FOUND", "收藏不存在或不可访问");
  },
};
