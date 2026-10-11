import { answerKnowledgeQuestion, parseChatRequest } from "@/features/knowledge/chat";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertNativeClient, authenticateRequest } from "@/lib/auth/request";
import { sessionHomeForRoles } from "@/lib/auth/session-home";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * POST /api/v1/knowledge/chat
 * 已登录客户与工作人员共用；资料范围由服务端按角色过滤，客户端提交的任何角色字段一律忽略。
 * 请求：{ question, history: [{role, content}] }（history 仅 user/assistant，上限见契约）。
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertNativeClient(request);
    const { principal } = await authenticateRequest(request, requestId);
    const rawBody = await request.text();
    const input = parseChatRequest(rawBody);
    const data = await answerKnowledgeQuestion({
      input,
      includeStaff: sessionHomeForRoles(principal.roles) === "STAFF",
    });
    return apiSuccess(data, requestId, { headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
