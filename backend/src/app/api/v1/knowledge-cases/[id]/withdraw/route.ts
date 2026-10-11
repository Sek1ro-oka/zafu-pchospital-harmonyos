import { knowledgeCaseService } from "@/features/knowledge-cases/case-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * POST /api/v1/knowledge-cases/[id]/withdraw
 * 管理员撤回：立即阻止新的检索命中与来源读取；普通重试/索引重建不会自动恢复。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const { id } = await params;
    const detail = await knowledgeCaseService.withdrawCase(actor, id);
    return apiSuccess(detail, requestId, { headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
