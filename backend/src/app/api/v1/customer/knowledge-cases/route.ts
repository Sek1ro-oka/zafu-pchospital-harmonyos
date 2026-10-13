import { listPublicCases } from "@/features/customer-community/customer-case-service";
import { customerUser } from "@/features/customer-profile/customer-profile-service";
import { parsePagination } from "@/lib/api/pagination";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    await customerUser(actor);
    const input = parsePagination(new URL(request.url).searchParams),
      result = await listPublicCases(input.page, input.pageSize);
    return apiSuccess(result.items, requestId, {
      pagination: result.pagination,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
