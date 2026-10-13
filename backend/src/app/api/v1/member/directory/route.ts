import { memberProfileService } from "@/features/member-profile/member-profile-service";
import { AppError } from "@/lib/api/errors";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") ?? "1");
    const query = (params.get("query") ?? "").trim();
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || query.length > 64)
      throw new AppError("VALIDATION_FAILED", "分页或搜索条件无效");
    return apiSuccess(await memberProfileService.directory(query, page, actor), requestId, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
