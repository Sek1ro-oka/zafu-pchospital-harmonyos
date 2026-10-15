import { AppError } from "@/lib/api/errors";
import { getDb } from "@/lib/db/client";
import { getCaseCitationDetail } from "@/features/knowledge/case-blocks";
import { materialHashOf, materialOf } from "@/features/knowledge-cases/case-material";

/** 公开浏览复用 #40 的状态/版本/可见范围与客户裁剪；不调用工作人员详情。 */
export async function publicCaseDetail(id: string) {
  return readBrowsableCaseDetail(id, false);
}

/** 浏览搜索复用同一套来源有效性检查；includeStaff 仅由服务端权限决定。 */
export async function readBrowsableCaseDetail(id: string, includeStaff: boolean) {
  const row = await getDb().knowledgeCase.findUnique({
    where: { id },
    include: { sources: { include: { record: { include: { category: true } } } } },
  });
  if (!row || row.status !== "PUBLISHED" || (!includeStaff && row.visibility !== "PUBLIC")) throw notFound();
  const sources = row.sources.filter((source) => source.status === "PUBLISHED");
  // 即使外部尚未重整完成也不暴露不再有效的正文；每份参与生成的材料必须仍有效。
  if (
    sources.length === 0 ||
    sources.some(
      (source) =>
        source.record.deletedAt ||
        source.record.status !== "APPROVED" ||
        !source.record.isTypical ||
        source.contentHash !== materialHashOf(materialOf(source.record)),
    )
  )
    throw notFound();
  const detail = await getCaseCitationDetail(id, row.contentVersion, {
    includeStaff,
    userId: null,
  });
  if (!detail) throw notFound();
  return detail;
}
export async function listPublicCases(page: number, pageSize: number) {
  const rows = await getDb().knowledgeCase.findMany({
    where: { status: "PUBLISHED", visibility: "PUBLIC" },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  const valid = [];
  for (const row of rows) {
    try {
      const detail = await publicCaseDetail(row.id);
      valid.push({
        caseId: detail.caseId,
        title: detail.title,
        contentVersion: detail.contentVersion,
        updatedAt: detail.updatedAt,
      });
    } catch (error) {
      if (!(error instanceof AppError && error.code === "CASE_NOT_FOUND")) throw error;
    }
  }
  return {
    items: valid.slice((page - 1) * pageSize, page * pageSize),
    pagination: {
      page,
      pageSize,
      total: valid.length,
      totalPages: Math.ceil(valid.length / pageSize),
    },
  };
}
function notFound() {
  return new AppError("CASE_NOT_FOUND", "公开案例不存在或不可访问");
}
