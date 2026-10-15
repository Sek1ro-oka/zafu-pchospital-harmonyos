import { activityAccountService } from "@/features/repair-activities/activity-account-service";
import { AppError } from "@/lib/api/errors";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ regId: string }> };
function id(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 36)
    throw new AppError("VALIDATION_FAILED", "活动或报名 ID 无效");
  return value;
}
export async function GET(request: Request, { params }: Context) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(
      await activityAccountService.get(
        id(new URL(request.url).searchParams.get("activityId")),
        id((await params).regId),
        actor,
      ),
      requestId,
      { headers: { "Cache-Control": "private, no-store" } },
    );
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
      await activityAccountService.update(
        id(body.activityId),
        id((await params).regId),
        body.issueType,
        actor,
      ),
      requestId,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
