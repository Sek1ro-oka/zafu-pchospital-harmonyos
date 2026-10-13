import { notificationStatusFilter } from "@/features/community/community-http";
import { notificationService } from "@/features/community/notification-service";
import { parsePagination } from "@/lib/api/pagination";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const params = new URL(request.url).searchParams;
    const pagination = parsePagination(params);
    const result = await notificationService.list(
      { ...pagination, status: notificationStatusFilter(params) },
      actor,
    );
    return apiSuccess({ items: result.items, unreadCount: result.unreadCount }, requestId, {
      pagination: result.pagination,
      headers: PRIVATE,
    });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
