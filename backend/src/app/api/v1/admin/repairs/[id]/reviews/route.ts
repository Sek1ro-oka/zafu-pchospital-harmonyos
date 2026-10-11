import { repairReviewService } from "@/features/repairs/repair-review-service";
import { AppError } from "@/lib/api/errors";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
/**
 * 单条审核：请求体 `{ decision, note?, idempotencyKey }`。
 *
 * 幂等键取**请求体**而不是 `Idempotency-Key` 头 —— 与它的批量兄弟
 * `POST /api/v1/admin/repairs/batch-reviews` 以及其余管理端写接口一致（成员端
 * 创建草稿/提交仍走头）。此前本路由读头、界面发体，两边对不上，审核必然 400。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    // App 内审核（Bearer + 原生头）与 Web 管理端（Cookie + 同源）各自校验，权限仍要求 repair:review。
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    if (body.decision !== "APPROVED" && body.decision !== "REJECTED")
      throw new AppError("VALIDATION_FAILED", "审核结果无效");
    return apiSuccess(
      await repairReviewService.review(
        (await params).id,
        {
          decision: body.decision,
          note: typeof body.note === "string" ? body.note : undefined,
          idempotencyKey: String(body.idempotencyKey ?? ""),
        },
        actor,
      ),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
