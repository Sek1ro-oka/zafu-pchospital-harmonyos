import { idempotencyKey } from "@/features/repairs/repair-http";
import { repairService } from "@/features/repairs/repair-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    // 提交审核双通道：App 走 Bearer + 原生头，Web 走 Cookie + 同源。
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await repairService.submit(
        (await params).id,
        { version: Number(body.version), idempotencyKey: idempotencyKey(request) },
        actor,
      ),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
