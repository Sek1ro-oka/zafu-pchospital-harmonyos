import { parseBrowseQuery, searchBrowsableCases } from "@/features/knowledge/case-search";
import { parsePagination } from "@/lib/api/pagination";
import { getRequestId } from "@/lib/api/request-id";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { authenticateRequest } from "@/lib/auth/request";
import { AppError } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const params = new URL(request.url).searchParams;
    const { page, pageSize } = parsePagination(params);
    const caseId = params.get("caseId");
    if (caseId !== null && (caseId.trim() === "" || caseId.length > 100)) throw new AppError("VALIDATION_FAILED", "案例编号无效");
    const result = await searchBrowsableCases(actor, parseBrowseQuery(params.get("q")), page, pageSize, caseId ?? undefined);
    return apiSuccess(result, requestId, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
