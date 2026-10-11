import { knowledgeCaseService } from "@/features/knowledge-cases/case-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * POST /api/v1/knowledge-cases/[id]/reprocess
 * 管理员重整动作：失败重试 / 撤回后的显式恢复（重新整理发布）。
 * 这是撤回案例恢复的唯一入口；无有效来源时返回 CASE_NO_VALID_SOURCES。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const { id } = await params;
    const result = await knowledgeCaseService.reprocessCaseByAdmin(actor, id);
    return apiSuccess(result, requestId, { headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
