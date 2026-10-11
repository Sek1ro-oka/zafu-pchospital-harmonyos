import { knowledgeCaseService } from "@/features/knowledge-cases/case-service";
import { parseCaseVisibilityInput } from "@/features/knowledge-cases/case-http";
import { AppError } from "@/lib/api/errors";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * POST /api/v1/knowledge-cases/[id]/visibility
 * 管理员调整案例可见范围（STAFF/PUBLIC）；下一次发布与检索都按新范围收口。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const { id } = await params;
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new AppError("VALIDATION_FAILED", "请求体不是合法 JSON");
    }
    const detail = await knowledgeCaseService.setCaseVisibility(actor, id, parseCaseVisibilityInput(body));
    return apiSuccess(detail, requestId, { headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
