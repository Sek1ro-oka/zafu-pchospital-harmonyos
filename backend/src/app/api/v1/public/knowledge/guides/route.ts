import { readPublicGuides } from "@/features/knowledge/public-guides";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 无登录的只读端点；原知识问答、案例和业务接口仍要求鉴权。 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    return apiSuccess(readPublicGuides(new URL(request.url).searchParams.get("id")), requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
