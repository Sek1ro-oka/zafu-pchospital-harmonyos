import { getKnowledgeSource } from "@/features/knowledge/service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertNativeClient, authenticateRequest } from "@/lib/auth/request";
import { sessionHomeForRoles } from "@/lib/auth/session-home";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * GET /api/v1/knowledge/sources/[id]
 * 只按索引 ID（文档块 kch_* 或案例块 kcase_*）返回可读内容与定位；
 * 不存在、已过期（内容更新导致 ID 失效）、案例已撤回/重整中或越权不可见统一 404，
 * 不泄露内部资料与未公开案例的存在性。
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertNativeClient(request);
    const { principal } = await authenticateRequest(request, requestId);
    const { id } = await params;
    const data = await getKnowledgeSource(id, {
      includeStaff: sessionHomeForRoles(principal.roles) === "STAFF",
      userId: principal.userId,
    });
    return apiSuccess(data, requestId, { headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
