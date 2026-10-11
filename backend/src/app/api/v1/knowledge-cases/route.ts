import { caseListQuery, knowledgeCaseService } from "@/features/knowledge-cases/case-service";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * GET /api/v1/knowledge-cases?status=&visibility=&page=&pageSize=
 * 工作台案例列表（工作人员/管理员）：按状态与可见范围筛选，分页返回真实数据。
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const params = new URL(request.url).searchParams;
    const page = parsePagination(params);
    const result = await knowledgeCaseService.listCases(
      actor,
      caseListQuery(params, page.page, page.pageSize),
    );
    return apiSuccess(result.items, requestId, {
      headers: PRIVATE,
      pagination: paginationMeta(page, result.total),
    });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
