import { knowledgeCaseService } from "@/features/knowledge-cases/case-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * GET /api/v1/knowledge-cases/[id]
 * 案例详情（工作人员/管理员）：结构化正文、全部有效来源及逐条证据、
 * 处理/向量状态与管理动作能力；已撤回案例仍可管理查看。
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const { id } = await params;
    const detail = await knowledgeCaseService.getCaseDetail(actor, id);
    return apiSuccess(detail, requestId, { headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
