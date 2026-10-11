import { draftInput } from "@/features/repairs/repair-http";
import { repairQueryService } from "@/features/repairs/repair-query-service";
import { repairService } from "@/features/repairs/repair-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, assertWriteAccess, authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(await repairQueryService.getById((await params).id, actor), requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

/**
 * 编辑（保存草稿）的唯一实现：PATCH 与 POST 共用，保证两条入口没有两套规则。
 *
 * 双通道来源校验：App 走 Bearer + 原生头，Web 走 Cookie + 同源（`assertWriteAccess`）。
 */
async function updateRecord(request: Request, { params }: Context) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await repairService.update(
        (await params).id,
        { ...draftInput(body), version: Number(body.version) },
        actor,
      ),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

export async function PATCH(request: Request, context: Context) {
  return updateRecord(request, context);
}

/**
 * POST 编辑别名（Issue #38）。
 *
 * 鸿蒙 `@ohos.net.http` 的 RequestMethod 枚举没有 PATCH，App 发不出 PATCH 请求；
 * 这里挂一个与 PATCH 逐行同语义的 POST 入口（同一校验、同一服务、同一响应信封），
 * Web 继续使用 PATCH。不是放宽权限，只是同一实现的第二个方法名。
 */
export async function POST(request: Request, context: Context) {
  return updateRecord(request, context);
}

export async function DELETE(request: Request, { params }: Context) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    await repairService.softDelete((await params).id, String(body.reason ?? ""), actor);
    return apiSuccess({ deleted: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
