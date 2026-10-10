import { repairOrderListStatus, repairOrderSubmitInput, repairOrderIdempotencyKey } from "@/features/repair-orders/repair-order-http";
import { repairOrderService } from "@/features/repair-orders/repair-order-service";
import { parsePagination } from "@/lib/api/pagination";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertNativeClient, assertSameOrigin, authenticateRequest, readPresentedToken } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 本人报修列表（分页 + 可选状态筛选）。 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const params = new URL(request.url).searchParams;
    const pagination = parsePagination(params);
    const result = await repairOrderService.listMine(
      { status: repairOrderListStatus(params) },
      pagination,
      actor,
    );
    return apiSuccess(result.items, requestId, { pagination: result.pagination });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

/**
 * 客户提交报修。
 *
 * **两条通道各自校验，不能只留 `assertSameOrigin`**：
 * - Cookie 通道（Web 浏览器）：`assertSameOrigin` 是写接口的 CSRF 防线 —— 浏览器会自动
 *   携带 Cookie，必须确认来源在白名单内。
 * - 原生通道（鸿蒙 App）：凭证是 `Authorization: Bearer`，**浏览器不会自动携带**，
 *   因此没有可被 CSRF 利用的凭证；而 App 的请求**本来就不带 `Origin`**，
 *   硬套 `assertSameOrigin` 会把合法请求全部 403（实测 `{"code":"FORBIDDEN",
 *   "message":"请求来源无效"}`）。改用 `assertNativeClient`：要求显式自定义头
 *   `x-client-type: native`，HTML 表单无法设置、跨站 fetch 设置会触发预检，
 *   浏览器内同样伪造成不了原生请求。
 *
 * 判定依据是**令牌实际来自哪个通道**（`readPresentedToken` 的 `source`），
 * 不是看有没有 Origin 头 —— 后者由请求方控制，不能当准入条件。
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const presented = readPresentedToken(request);
    if (presented?.source === "cookie") {
      // Web：走同源白名单。
      assertSameOrigin(request);
    } else {
      // 原生（或无凭证 → 之后会 401）：要求显式原生头，杜绝浏览器伪造成原生通道。
      assertNativeClient(request);
    }
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await repairOrderService.submit(
        repairOrderSubmitInput(body),
        { createRequestKey: repairOrderIdempotencyKey(request) },
        actor,
      ),
      requestId,
      { status: 201 },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
