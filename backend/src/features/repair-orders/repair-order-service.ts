import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { paginationMeta } from "@/lib/api/pagination";
import { repairOrderRepository } from "@/features/repair-orders/repair-order-repository";
import { assertCanReadRepairOrder } from "@/features/repair-orders/repair-order-policy";
import { normalizeRepairOrderInput, validateRepairOrderInput } from "@/features/repair-orders/repair-order-validation";
import { toRepairOrderView } from "@/features/repair-orders/repair-order-view";
import type { AuthorizedActor, PaginationInput, RepairOrderStatus } from "@/types/contracts";

/** 新建单据一律从 SUBMITTED 起步；#38 的受理/维修中/完成由工作人员侧推进。 */
const INITIAL_ORDER_STATUS: RepairOrderStatus = "SUBMITTED";

/** 幂等键上限，与 schema 的 VarChar(128) 对齐。 */
const MAX_REQUEST_KEY_LENGTH = 128;

export type RepairOrderSubmitPayload = {
  deviceModel: string;
  deviceSerial?: string;
  faultDescription: string;
  contactPhone: string;
};

export const repairOrderService = {
  /**
   * 客户提交报修。
   *
   * 幂等语义：带 `Idempotency-Key` 且该键已存在时**返回原单**（HTTP 仍为 201），
   * 不新建、不报错 —— 网络抖动导致的重复提交不该让用户看到失败，
   * 也不该产生两张单。键为空串时不走幂等（允许同一账号提交多张不同内容的单）。
   */
  async submit(
    payload: RepairOrderSubmitPayload,
    options: { createRequestKey: string },
    actor: AuthorizedActor,
  ) {
    requirePermission(actor, "repair.order:create");
    if (!actor.userId) throw new AppError("UNAUTHENTICATED", "登录状态无效");

    const normalized = normalizeRepairOrderInput(payload);
    validateRepairOrderInput(normalized);

    const requestKey = options.createRequestKey.trim();
    if (requestKey.length > MAX_REQUEST_KEY_LENGTH)
      throw new AppError("VALIDATION_FAILED", "幂等键过长");

    if (requestKey !== "") {
      const existing = await repairOrderRepository.findByCreateRequestKey(requestKey);
      if (existing && !existing.deletedAt) {
        // 幂等命中：只允许原提交人拿回自己的单，否则等于用别人的键读出别人的数据。
        assertCanReadRepairOrder(actor, existing);
        return toRepairOrderView(existing);
      }
    }

    const now = new Date();
    const created = await repairOrderRepository.createWithEvent({
      id: randomUUID(),
      eventId: randomUUID(),
      submittedByUserId: actor.userId,
      deviceModel: normalized.deviceModel,
      deviceSerial: normalized.deviceSerial ?? null,
      faultDescription: normalized.faultDescription,
      contactPhone: normalized.contactPhone,
      status: INITIAL_ORDER_STATUS,
      // 无幂等键时用随机值占位，满足唯一约束的同时不与任何客户端键冲突。
      createRequestKey: requestKey === "" ? `auto:${randomUUID()}` : requestKey,
      now,
    });
    return toRepairOrderView(created);
  },

  /** 本人报修列表。归属由仓储的 `submittedByUserId` 过滤保证，不依赖上层传参。 */
  async listMine(
    input: { status?: string },
    pagination: PaginationInput,
    actor: AuthorizedActor,
  ) {
    requirePermission(actor, "repair.order:read");
    if (!actor.userId) throw new AppError("UNAUTHENTICATED", "登录状态无效");

    const { items, total } = await repairOrderRepository.listBySubmitter(actor.userId, {
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      status: input.status,
    });
    return {
      items: items.map(toRepairOrderView),
      pagination: paginationMeta(pagination, total),
    };
  },

  /**
   * 详情 + 进度。
   *
   * 非本人（且非工作人员）抛 `REPAIR_ORDER_NOT_FOUND`：
   * 用 404 而非 403，避免通过状态码差异探测出「某个 ID 是否存在」。
   */
  async detail(id: string, actor: AuthorizedActor) {
    requirePermission(actor, "repair.order:read");
    const order = await repairOrderRepository.findById(id);
    if (!order) throw new AppError("REPAIR_ORDER_NOT_FOUND", "报修单不存在");
    assertCanReadRepairOrder(actor, order);
    return toRepairOrderView(order);
  },
};
