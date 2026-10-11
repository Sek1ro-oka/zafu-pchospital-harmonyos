import { getKnowledgeSource } from "@/features/knowledge/service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertNativeClient, authenticateRequest } from "@/lib/auth/request";
import { sessionHomeForRoles } from "@/lib/auth/session-home";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * GET /api/v1/knowledge/sources/[id]
 * 只按索引 ID 返回已导入正文、定位与固定提交原文链接；
 * 不存在、已过期（内容更新导致 ID 失效）或越权不可见统一 404，不泄露内部资料存在性。
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertNativeClient(request);
    const { principal } = await authenticateRequest(request, requestId);
    const { id } = await params;
    const data = getKnowledgeSource(id, sessionHomeForRoles(principal.roles) === "STAFF");
    return apiSuccess(data, requestId, { headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
