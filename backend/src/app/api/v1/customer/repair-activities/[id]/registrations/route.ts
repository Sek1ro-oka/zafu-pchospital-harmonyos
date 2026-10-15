import { activityAccountService } from "@/features/repair-activities/activity-account-service";
import {
  repairActivityIpRateLimitKey,
  repairActivityPhoneRateLimitKey,
} from "@/features/repair-activities/repair-activity-rate-limit";
import { AppError } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";
import { normalizePhone } from "@/lib/security/normalization";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    enforceRateLimit(repairActivityIpRateLimitKey(actor.ipAddress ?? "unknown"), 10, 60_000);
    const body = (await request.json()) as Record<string, unknown>;
    const phone = normalizePhone(String(body.phone ?? ""));
    enforceRateLimit(repairActivityPhoneRateLimitKey(phone), 5, 60_000);
    const { id } = await params;
    if (!id || id.length > 36) throw new AppError("VALIDATION_FAILED", "活动 ID 无效");
    const result = await activityAccountService.register(
      id,
      {
        name: String(body.name ?? ""),
        phone,
        issueType: body.issueType,
        deviceModel: body.deviceModel,
        consentAccepted: body.consentAccepted === true,
        consentVersion: body.consentVersion,
      },
      actor,
    );
    return apiSuccess(result, requestId, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
