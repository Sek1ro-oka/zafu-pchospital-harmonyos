import { createCommentInput } from "@/features/community/community-http";
import { repairCommentService } from "@/features/community/comment-service";
import { parsePagination } from "@/lib/api/pagination";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const pagination = parsePagination(new URL(request.url).searchParams);
    const result = await repairCommentService.list((await params).id, pagination, actor);
    return apiSuccess(result.items, requestId, { pagination: result.pagination, headers: PRIVATE });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

export async function POST(request: Request, { params }: Context) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await repairCommentService.create((await params).id, createCommentInput(body), actor),
      requestId,
      { status: 201, headers: PRIVATE },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
