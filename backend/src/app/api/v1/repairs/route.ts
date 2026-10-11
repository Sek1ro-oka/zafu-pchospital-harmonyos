import { repairListInput, draftInput, idempotencyKey } from "@/features/repairs/repair-http";
import { repairQueryService } from "@/features/repairs/repair-query-service";
import { repairService } from "@/features/repairs/repair-service";
import { parsePagination } from "@/lib/api/pagination";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const params = new URL(request.url).searchParams;
    const pagination = parsePagination(params);
    const result = await repairQueryService.list(
      repairListInput(params, pagination.page, pagination.pageSize),
      actor,
    );
    return apiSuccess(result.items, requestId, { pagination: result.pagination });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    // 原生 App 建档草稿（Bearer + X-Client-Type: native）与 Web（Cookie + 同源）各自校验。
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await repairService.createDraft(
        { ...draftInput(body), idempotencyKey: idempotencyKey(request) },
        actor,
      ),
      requestId,
      { status: 201 },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
