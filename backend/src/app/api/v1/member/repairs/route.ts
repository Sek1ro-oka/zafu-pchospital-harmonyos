import { repairListInput } from "@/features/repairs/repair-http";
import { repairQueryService } from "@/features/repairs/repair-query-service";
import { repairRepository } from "@/features/repairs/repair-repository";
import { parsePagination } from "@/lib/api/pagination";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 本人列表由服务端定位作者，忽略客户端 memberId。 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const member = await repairRepository.activeMemberForUser(actor.userId);
    const params = new URL(request.url).searchParams;
    const pagination = parsePagination(params);
    const result = await repairQueryService.list(
      { ...repairListInput(params, pagination.page, pagination.pageSize), memberId: member.id },
      actor,
    );
    return apiSuccess(result.items, requestId, {
      pagination: result.pagination,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
