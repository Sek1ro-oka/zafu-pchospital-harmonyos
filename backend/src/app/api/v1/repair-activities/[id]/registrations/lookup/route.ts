import {
  repairActivityIpRateLimitKey,
  repairActivityPhoneRateLimitKey,
} from "@/features/repair-activities/repair-activity-rate-limit";
import { repairActivityService } from "@/features/repair-activities/repair-activity-service";
import { AppError } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertPublicWriteAccess, requestContext } from "@/lib/auth/request";
import { normalizePhone } from "@/lib/security/normalization";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  const context = requestContext(request, requestId);
  try {
    assertPublicWriteAccess(request);
    const ip = context.ipAddress ?? "unknown";
    enforceRateLimit(repairActivityIpRateLimitKey(ip), 10, 60_000);
    const body = (await request.json()) as Record<string, unknown>;
    const phoneRaw = String(body.phone ?? "");
    try {
      const phone = normalizePhone(phoneRaw);
      enforceRateLimit(repairActivityPhoneRateLimitKey(phone), 5, 60_000);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "VALIDATION_FAILED") throw error;
    }
    const id = (await params).id;
    if (!id) throw new AppError("VALIDATION_FAILED", "活动 ID 无效");
    const result = await repairActivityService.lookup(id, phoneRaw, context);
    return apiSuccess(result, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
