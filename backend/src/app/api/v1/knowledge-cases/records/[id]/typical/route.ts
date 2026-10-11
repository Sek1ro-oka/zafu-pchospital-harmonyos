import { knowledgeCaseService } from "@/features/knowledge-cases/case-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * POST /api/v1/knowledge-cases/records/[id]/typical
 * 标记备案为典型案例并自动整理（作者本人 APPROVED 备案，或审核权限）。
 * 已标记且内容未变时取回现状，不重复调用模型；结果为真实终态（含失败信息）。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const { id } = await params;
    const state = await knowledgeCaseService.markTypical(actor, id);
    return apiSuccess(state, requestId, { headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

/**
 * DELETE /api/v1/knowledge-cases/records/[id]/typical
 * 取消典型标记：立即移除来源贡献，受影响案例按剩余来源自动重整/撤下。
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const { id } = await params;
    const state = await knowledgeCaseService.unmarkTypical(actor, id);
    return apiSuccess(state, requestId, { headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
