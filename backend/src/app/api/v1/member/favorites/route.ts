import { createFavoriteInput } from "@/features/community/community-http";
import { repairFavoriteService } from "@/features/community/favorite-service";
import { parsePagination } from "@/lib/api/pagination";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const pagination = parsePagination(new URL(request.url).searchParams);
    const result = await repairFavoriteService.list(pagination, actor);
    return apiSuccess(result.items, requestId, { pagination: result.pagination, headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    const { repairRecordId } = createFavoriteInput(body);
    return apiSuccess(await repairFavoriteService.add(repairRecordId, actor), requestId, {
      status: 201,
      headers: PRIVATE,
    });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
