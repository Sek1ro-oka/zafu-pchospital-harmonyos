import { AppError } from "@/lib/api/errors";
import { authenticateRequest, SESSION_COOKIE_NAME } from "@/lib/auth/request";
import type { AuthorizedActor } from "@/types/contracts";
import {
  isProductCategory,
  isShoppingOrderStatus,
  type ProductCategory,
} from "./shopping-types";
import {
  normalizeReason,
  shoppingLimits,
  type ProductDraft,
  type ProductPatch,
  type ShoppingOrderDraft,
} from "./shopping-validation";

/** 请求体里的必填字符串。缺字段、非字符串、纯空白一律 400。 */
function requiredString(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string" || !value.trim())
    throw new AppError("VALIDATION_FAILED", `${name} 不能为空`, {
      fieldErrors: { [name]: ["不能为空"] },
    });
  return value;
}

/** 选填字符串；缺字段与 null 都归一为 undefined。 */
function optionalString(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string")
    throw new AppError("VALIDATION_FAILED", `${name} 必须是字符串`, {
      fieldErrors: { [name]: ["必须是字符串"] },
    });
  return value;
}

/** 必填整数（金额分、库存、数量都用它）。字符串数字不接受，避免 "10" 与 10 的歧义。 */
function requiredInteger(body: Record<string, unknown>, name: string): number {
  const value = body[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new AppError("VALIDATION_FAILED", `${name} 必须是整数`, {
      fieldErrors: { [name]: ["必须是整数"] },
    });
  return value;
}

/** 商品创建入参。`sellerId` 不在这里：它只能由服务端从登录态取。 */
export function productCreateInput(body: Record<string, unknown>): ProductDraft {
  const category = requiredString(body, "category").trim().toUpperCase();
  const consumable = category === "CONSUMABLE";
  return {
    title: requiredString(body, "title"),
    description: requiredString(body, "description"),
    priceCents: requiredInteger(body, "priceCents"),
    category,
    // 耗材可不填成色/规格；二手必须描述成色。
    condition: consumable ? (optionalString(body, "condition") ?? "") : requiredString(body, "condition"),
    // 二手是单件交易，缺省补 1；显式传其他值交给校验层拒绝，不静默修正。
    stock: body.stock === undefined && !consumable ? 1 : requiredInteger(body, "stock"),
    pickupNote: optionalString(body, "pickupNote"),
  };
}

/**
 * 商品更新入参：只读取可修改字段。
 *
 * 刻意忽略 `category`、`status`、`sellerId`：分类决定权限链路，状态走独立下架接口，
 * 归属永远取登录用户 —— 即使客户端传了也不生效，而不是报错暴露内部字段。
 */
export function productPatchInput(body: Record<string, unknown>): ProductPatch {
  const patch: ProductPatch = {};
  if ("title" in body) patch.title = requiredString(body, "title");
  if ("description" in body) patch.description = requiredString(body, "description");
  if ("priceCents" in body) patch.priceCents = requiredInteger(body, "priceCents");
  if ("condition" in body)
    patch.condition = body.condition === null ? "" : (optionalString(body, "condition") ?? "");
  if ("stock" in body) patch.stock = requiredInteger(body, "stock");
  if ("stockBase" in body) patch.stockBase = requiredInteger(body, "stockBase");
  if ("pickupNote" in body) {
    patch.pickupNote = body.pickupNote === null ? null : optionalString(body, "pickupNote");
  }
  if (Object.keys(patch).length === 0)
    throw new AppError("VALIDATION_FAILED", "没有可修改的字段");
  return patch;
}

/** 下单入参：`idempotencyKey` 必填（客户端每次尝试生成一次，重试沿用）。 */
export function orderCreateInput(body: Record<string, unknown>): ShoppingOrderDraft {
  return {
    productId: requiredString(body, "productId"),
    quantity: requiredInteger(body, "quantity"),
    idempotencyKey: requiredString(body, "idempotencyKey"),
  };
}

/** 取消入参：买家可不填原因，卖家必填由 service 按角色校验。 */
export function orderCancelInput(body: Record<string, unknown>): { reason?: string } {
  const reason = normalizeReason(optionalString(body, "reason"));
  return reason === undefined ? {} : { reason };
}

/** 下架入参：本人可不填原因，管理员必填由 service 校验。 */
export function productDelistInput(body: Record<string, unknown>): { reason?: string } {
  const reason = normalizeReason(optionalString(body, "reason"));
  return reason === undefined ? {} : { reason };
}

/**
 * 读 JSON 对象请求体。空体/非对象/非法 JSON 统一 400，而不是让 SyntaxError
 * 冒泡成 500；写接口要求真的有请求体，取消/下架这类可选体用下面的 helper。
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new AppError("VALIDATION_FAILED", "请求体必须是合法的 JSON 对象");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new AppError("VALIDATION_FAILED", "请求体必须是 JSON 对象");
  return parsed as Record<string, unknown>;
}

/** 可选 JSON 体：空体返回 {}（取消订单只带 reason 时也可省略整个 body）。 */
export async function readOptionalJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new AppError("VALIDATION_FAILED", "请求体必须是 JSON 对象");
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("VALIDATION_FAILED", "请求体必须是合法的 JSON 对象");
  }
}

/** 公开列表筛选：非法 category 直接 400，不静默忽略；`q` 折叠空白并限长。 */
export function productListQuery(params: URLSearchParams): {
  category?: ProductCategory;
  q?: string;
} {
  const category = params.get("category")?.trim().toUpperCase();
  if (category && !isProductCategory(category))
    throw new AppError("VALIDATION_FAILED", "category 参数无效", {
      fieldErrors: { category: ["必须是 SECONDHAND 或 CONSUMABLE"] },
    });
  const q = params.get("q")?.replace(/\s+/g, " ").trim();
  if (q && q.length > shoppingLimits.maxQueryLength)
    throw new AppError("VALIDATION_FAILED", "q 参数过长", {
      fieldErrors: { q: [`不能超过 ${shoppingLimits.maxQueryLength} 字`] },
    });
  return {
    ...(category ? { category: category as ProductCategory } : {}),
    ...(q ? { q } : {}),
  };
}

export const shoppingOrderRoles = ["buyer", "seller"] as const;
export type ShoppingOrderRole = (typeof shoppingOrderRoles)[number];

/** 订单列表筛选：role 缺省 buyer；status 走白名单。 */
export function orderListQuery(params: URLSearchParams): {
  role: ShoppingOrderRole;
  status?: string;
} {
  const role = params.get("role") ?? "buyer";
  if (!(shoppingOrderRoles as readonly string[]).includes(role))
    throw new AppError("VALIDATION_FAILED", "role 参数无效", {
      fieldErrors: { role: ["必须是 buyer 或 seller"] },
    });
  const status = params.get("status") ?? undefined;
  if (status !== undefined && !isShoppingOrderStatus(status))
    throw new AppError("VALIDATION_FAILED", "status 参数无效", {
      fieldErrors: { status: ["不是有效的订单状态"] },
    });
  return {
    role: role as ShoppingOrderRole,
    ...(status ? { status } : {}),
  };
}

/**
 * 公开读接口的「可选登录」：带了凭据就解析出 actor（用于下发 canBuy/canEdit 等
 * 动作），没带或凭据无效则按游客处理，不因过期 Cookie 把公开页变成 401。
 * 写接口仍走 `authenticateRequest` 的严格校验。
 */
export async function optionalActor(
  request: Request,
  requestId: string,
): Promise<AuthorizedActor | null> {
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie") ?? "";
  const presented =
    authorization?.startsWith("Bearer ") || cookie.includes(`${SESSION_COOKIE_NAME}=`);
  if (!presented) return null;
  try {
    return (await authenticateRequest(request, requestId)).actor;
  } catch {
    return null;
  }
}
