import { parseSearchRequest, searchKnowledge } from "@/features/knowledge/service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertNativeClient, authenticateRequest } from "@/lib/auth/request";
import { sessionHomeForRoles } from "@/lib/auth/session-home";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * POST /api/v1/knowledge/search
 * 返回实际检索模式（hybrid/keyword）、降级说明与候选证据；retrieval=keyword 供验收对比。
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertNativeClient(request);
    const { principal } = await authenticateRequest(request, requestId);
    const input = parseSearchRequest(await request.text());
    const data = await searchKnowledge({
      input,
      includeStaff: sessionHomeForRoles(principal.roles) === "STAFF",
    });
    return apiSuccess(data, requestId, { headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
