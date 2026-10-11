import { knowledgeCaseService } from "@/features/knowledge-cases/case-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * POST /api/v1/knowledge-cases/records/[id]/retry
 * 失败/中断后的单条重试；案例层面失败时改为重整案例。
 * 不可重试（仍在处理中、已入库、被撤回）时返回真实状态冲突。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const { id } = await params;
    const result = await knowledgeCaseService.retryProcessing(actor, id);
    return apiSuccess(result, requestId, { headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
