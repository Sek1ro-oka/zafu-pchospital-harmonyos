import { knowledgeCaseService } from "@/features/knowledge-cases/case-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * GET /api/v1/knowledge-cases/records/[id]/status
 * 备案的真实典型案例处理状态（NONE/PENDING/PROCESSING/PUBLISHED/FAILED）、
 * 能力标记（canMark/canUnmark/canRetry）与关联案例入口。
 * 历史标记但从未整理的备案会在此触发一次后台补处理。
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const { id } = await params;
    const state = await knowledgeCaseService.getRecordCaseStatus(actor, id);
    return apiSuccess(state, requestId, { headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
