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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; regId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const context = requestContext(request, requestId);
  try {
    assertPublicWriteAccess(request);
    const ip = context.ipAddress ?? "unknown";
    enforceRateLimit(repairActivityIpRateLimitKey(ip), 10, 60_000);
    const { id, regId } = await params;
    if (!id || !regId) throw new AppError("VALIDATION_FAILED", "参数无效");
    const body = (await request.json()) as Record<string, unknown>;
    const phoneRaw = String(body.phone ?? "");
    // 改类型沿用报名/查号的手机号限流；格式错误交由 service 统一校验。
    try {
      const phone = normalizePhone(phoneRaw);
      enforceRateLimit(repairActivityPhoneRateLimitKey(phone), 5, 60_000);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "VALIDATION_FAILED") throw error;
    }
    const result = await repairActivityService.updateIssueType(
      id,
      regId,
      {
        issueType: body.issueType,
        phone: phoneRaw,
        editToken: String(body.editToken ?? ""),
      },
      context,
    );
    return apiSuccess(result, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

// ArkTS http has no PATCH; both methods execute the same handler.
export const POST = PATCH;
