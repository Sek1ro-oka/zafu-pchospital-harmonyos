import { customerNotificationService } from "@/features/customer-community/customer-notification-service";
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
    const result = await customerNotificationService.list(
      parsePagination(new URL(request.url).searchParams),
      actor,
    );
    return apiSuccess({ items: result.items, unreadCount: result.unreadCount }, requestId, {
      pagination: result.pagination,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
