import { readOptionalJsonBody, repairOrderIdempotencyKey } from "@/features/repair-orders/repair-order-http";
import { repairOrderStaffService } from "@/features/repair-orders/repair-order-staff-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * 从报修单建立关联备案草稿（仅受理人本人）。
 *
 * 幂等键走 `Idempotency-Key` 头（与成员端创建草稿一致）；
 * 重复点击或网络重试返回同一份草稿，不会产生多份备案或孤立记录。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    await readOptionalJsonBody(request);
    const { id } = await context.params;
    return apiSuccess(
      await repairOrderStaffService.createRecord(
        id,
        { idempotencyKey: repairOrderIdempotencyKey(request) },
        actor,
      ),
      requestId,
      { status: 201 },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
