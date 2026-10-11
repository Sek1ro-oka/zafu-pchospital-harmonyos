import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api/errors";
import { paginationMeta } from "@/lib/api/pagination";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { repairDetailInclude, repairRepository } from "@/features/repairs/repair-repository";
import { timeline } from "@/features/repairs/repair-service";
import { toRepairView } from "@/features/repairs/repair-view";
import { assertCanReadRepairOrder, isRepairOrderManager } from "./repair-order-policy";
import { repairOrderRepository } from "./repair-order-repository";
import { toStaffRepairOrderView } from "./repair-order-view";
import type { StaffProgressTarget, StaffQueueScope } from "./repair-order-http";
import type { AuthorizedActor, PaginationInput } from "@/types/contracts";

/** 说明上限，与 `repair_order_events.note` 的 VarChar(500) 对齐。 */
const NOTE_MAX_LENGTH = 500;
/** 幂等键上限，与 `repair_records.create_request_key` 的 VarChar(128) 对齐。 */
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/** 推进接口只接受这两个目标：受理走 accept，取消走 cancel（说明必填）。 */
const PROGRESS_TARGETS: readonly StaffProgressTarget[] = ["REPAIRING", "COMPLETED"];

/** 建档允许关联的订单状态，与 `repairOrderStaffActions.canCreateRecord` 保持一致。 */
const RECORD_LINKABLE_STATUSES: readonly string[] = ["ACCEPTED", "REPAIRING", "COMPLETED"];

function normalizeNote(note: string | undefined): string | null {
  const trimmed = note?.trim() ?? "";
  if (trimmed === "") return null;
  if (trimmed.length > NOTE_MAX_LENGTH)
    throw new AppError("VALIDATION_FAILED", `说明不能超过 ${NOTE_MAX_LENGTH} 字`);
  return trimmed;
}

/**
 * 工作人员报修处理（Issue #38）。
 *
 * 核心不变量：
 * - 受理人由服务端按当前用户的有效成员档案确定，**不接收客户端自报受理人**；
 * - 状态推进与进度事件在同一事务里落库，并用条件更新挡住并发（先到先得，失败者刷新）；
 * - 重复请求（重复受理、重复推进到同一状态）直接返回当前状态，不重复写事件；
 * - 备案只允许受理人本人从报修单建立，创建与关联原子完成。
 */
export const repairOrderStaffService = {
  /** 队列：待受理（公共池）/ 我负责 / 全部。分页与状态筛选交给仓储的条件组合。 */
  async queue(
    input: { scope: StaffQueueScope; status?: string },
    pagination: PaginationInput,
    actor: AuthorizedActor,
  ) {
    // 工作人员专属入口：客户虽持有 `repair.order:read`（读自己的单），但没有
    // `repair:read`（工作人员标记），不能借此看到公共队列里别人的单据。
    requirePermission(actor, "repair:read");
    const member = await repairRepository.findActiveMemberForUser(actor.userId);
    if (input.scope === "mine" && !member)
      return { items: [], pagination: paginationMeta(pagination, 0) };
    const { items, total } = await repairOrderRepository.listForStaff({
      scope: input.scope,
      status: input.status,
      memberProfileId: member?.id ?? null,
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    });
    return {
      items: items.map((item) => toStaffRepairOrderView(item, actor, member?.id ?? null)),
      pagination: paginationMeta(pagination, total),
    };
  },

  /** 详情：受理信息、时间线、关联备案摘要与允许动作。 */
  async detail(id: string, actor: AuthorizedActor) {
    // 与队列同一道门禁：客户不能通过工作人员接口拿到内部视角（受理人/动作/备案摘要）。
    requirePermission(actor, "repair:read");
    const order = await repairOrderRepository.findByIdForStaff(id);
    if (!order) throw new AppError("REPAIR_ORDER_NOT_FOUND", "报修单不存在");
    assertCanReadRepairOrder(actor, order);
    const member = await repairRepository.findActiveMemberForUser(actor.userId);
    return toStaffRepairOrderView(order, actor, member?.id ?? null);
  },

  /**
   * 受理：SUBMITTED → ACCEPTED，受理人 = 当前用户的有效成员档案。
   *
   * 抢单语义：条件更新（状态仍为 SUBMITTED 且无人受理）命中 0 行即有人抢先；
   * 失败者拿到 409 冲突提示刷新，而不是覆盖他人受理结果。
   * 管理员没有有效成员档案时不能受理（不能凭空成为受理人），但可以管理已有单据。
   */
  async accept(id: string, input: { note?: string }, actor: AuthorizedActor) {
    requirePermission(actor, "repair:update");
    // 无有效成员档案（如纯 ADMIN 账号）会抛 MEMBER_REQUIRED：受理必须有真实处理人。
    const member = await repairRepository.activeMemberForUser(actor.userId);
    const note = normalizeNote(input.note);
    const order = await repairOrderRepository.findByIdForStaff(id);
    if (!order || order.deletedAt) throw new AppError("REPAIR_ORDER_NOT_FOUND", "报修单不存在");
    if (
      order.assigneeMemberProfileId !== null &&
      order.assigneeMemberProfileId !== member.id
    )
      throw new AppError(
        "REPAIR_ORDER_STATE_CONFLICT",
        "该报修单已被其他工作人员受理，请刷新后查看",
      );
    // 幂等重放：本人已是受理人（重复点击或重试）→ 返回当前状态，不重复写事件。
    // 注意：此后状态可能是 ACCEPTED/REPAIRING/COMPLETED/CANCELLED 中的任意值，
    // 都按「重复请求」处理，客户端看到的就是真实状态。
    if (order.assigneeMemberProfileId === member.id) {
      assertCanReadRepairOrder(actor, order);
      return toStaffRepairOrderView(order, actor, member.id);
    }
    if (order.status !== "SUBMITTED")
      throw new AppError("REPAIR_ORDER_STATE_INVALID", `报修单不能从 ${order.status} 受理`);
    const now = new Date();
    const result = await repairOrderRepository.transitionWithEvent({
      orderId: id,
      where: { id, status: "SUBMITTED", assigneeMemberProfileId: null, deletedAt: null },
      data: {
        status: "ACCEPTED",
        assigneeMemberProfileId: member.id,
        lastProgressAt: now,
        updatedAt: now,
      },
      event: {
        id: randomUUID(),
        fromStatus: "SUBMITTED",
        toStatus: "ACCEPTED",
        note,
        actorUserId: actor.userId!,
      },
      now,
    });
    if (!result.updated || !result.order) {
      const fresh = await repairOrderRepository.findByIdForStaff(id);
      if (fresh && fresh.assigneeMemberProfileId === member.id && fresh.status === "ACCEPTED")
        return toStaffRepairOrderView(fresh, actor, member.id);
      throw new AppError(
        "REPAIR_ORDER_STATE_CONFLICT",
        "该报修单已被其他工作人员受理，请刷新后查看",
      );
    }
    return toStaffRepairOrderView(result.order, actor, member.id);
  },

  /**
   * 推进：ACCEPTED → REPAIRING → COMPLETED。受理人本人或管理员可操作。
   *
   * 重复请求（当前状态已是目标状态）直接返回，不重复写进度事件；
   * 非法转换（如跳过受理直接完成）返回 409。
   */
  async progress(
    id: string,
    input: { toStatus: StaffProgressTarget; note?: string },
    actor: AuthorizedActor,
  ) {
    requirePermission(actor, "repair:update");
    if (!PROGRESS_TARGETS.includes(input.toStatus))
      throw new AppError("VALIDATION_FAILED", "toStatus 参数无效");
    const note = normalizeNote(input.note);
    const member = await repairRepository.findActiveMemberForUser(actor.userId);
    const manager = isRepairOrderManager(actor);
    const order = await repairOrderRepository.findByIdForStaff(id);
    if (!order || order.deletedAt) throw new AppError("REPAIR_ORDER_NOT_FOUND", "报修单不存在");
    const assignee = member !== null && order.assigneeMemberProfileId === member.id;
    if (!assignee && !manager)
      throw new AppError("REPAIR_FORBIDDEN", "只有受理人或管理员可以推进该报修单");
    if (order.status === input.toStatus) {
      assertCanReadRepairOrder(actor, order);
      return toStaffRepairOrderView(order, actor, member?.id ?? null);
    }
    if (order.status !== (input.toStatus === "REPAIRING" ? "ACCEPTED" : "REPAIRING"))
      throw new AppError(
        "REPAIR_ORDER_STATE_INVALID",
        `报修单不能从 ${order.status} 变更为 ${input.toStatus}`,
      );
    const now = new Date();
    const result = await repairOrderRepository.transitionWithEvent({
      orderId: id,
      where: {
        id,
        status: order.status,
        deletedAt: null,
        // 受理人推进时额外锁归属；管理员推进不加此条件（管理任何单据）。
        ...(assignee ? { assigneeMemberProfileId: member!.id } : {}),
      },
      data: { status: input.toStatus, lastProgressAt: now, updatedAt: now },
      event: {
        id: randomUUID(),
        fromStatus: order.status,
        toStatus: input.toStatus,
        note,
        actorUserId: actor.userId!,
      },
      now,
    });
    if (!result.updated || !result.order)
      throw new AppError("REPAIR_ORDER_STATE_CONFLICT", "报修单状态已变化，请刷新后重试");
    return toStaffRepairOrderView(result.order, actor, member?.id ?? null);
  },

  /** 取消：仅管理员（`repair:review`），SUBMITTED / ACCEPTED 可取消，说明必填，终态不可再动。 */
  async cancel(id: string, input: { note: string }, actor: AuthorizedActor) {
    requirePermission(actor, "repair:review");
    const note = input.note?.trim() ?? "";
    if (note === "") throw new AppError("VALIDATION_FAILED", "取消必须填写说明");
    const normalized = normalizeNote(note);
    const member = await repairRepository.findActiveMemberForUser(actor.userId);
    const order = await repairOrderRepository.findByIdForStaff(id);
    if (!order || order.deletedAt) throw new AppError("REPAIR_ORDER_NOT_FOUND", "报修单不存在");
    if (order.status === "CANCELLED") return toStaffRepairOrderView(order, actor, member?.id ?? null);
    if (order.status !== "SUBMITTED" && order.status !== "ACCEPTED")
      throw new AppError("REPAIR_ORDER_STATE_INVALID", `报修单不能从 ${order.status} 取消`);
    const now = new Date();
    const result = await repairOrderRepository.transitionWithEvent({
      orderId: id,
      where: { id, status: order.status, deletedAt: null },
      data: { status: "CANCELLED", lastProgressAt: now, updatedAt: now },
      event: {
        id: randomUUID(),
        fromStatus: order.status,
        toStatus: "CANCELLED",
        note: normalized,
        actorUserId: actor.userId!,
      },
      now,
    });
    if (!result.updated || !result.order)
      throw new AppError("REPAIR_ORDER_STATE_CONFLICT", "报修单状态已变化，请刷新后重试");
    return toStaffRepairOrderView(result.order, actor, member?.id ?? null);
  },

  /**
   * 从报修单建立关联备案草稿（仅受理人本人，创建与关联原子完成）。
   *
   * - 未受理（无人受理）与已取消的单不新建备案；已关联则在幂等/冲突语义下处理；
   * - 机型从报修单预填；维修经过、结果、日期留给工作人员在备案页人工填写；
   * - 结果**不预置**成功值（留空等人工确认），提交时才要求填齐；
   * - `Idempotency-Key` 重复请求返回同一份草稿，重复/并发点击不会产生多份或孤立记录。
   */
  async createRecord(id: string, input: { idempotencyKey: string }, actor: AuthorizedActor) {
    requirePermission(actor, "repair:update");
    const member = await repairRepository.activeMemberForUser(actor.userId);
    const key = input.idempotencyKey.trim();
    if (!key || key.length > IDEMPOTENCY_KEY_MAX_LENGTH)
      throw new AppError("VALIDATION_FAILED", "Idempotency-Key 无效");
    const order = await repairOrderRepository.findByIdForStaff(id);
    if (!order || order.deletedAt) throw new AppError("REPAIR_ORDER_NOT_FOUND", "报修单不存在");

    // 已关联：本人受理人直接取回原备案（重复点击「建档/继续备案」）；其他人不可见也不可建。
    if (order.repairRecordId) {
      const linked = await getDb().repairRecord.findUnique({
        where: { id: order.repairRecordId },
        include: repairDetailInclude,
      });
      if (linked && !linked.deletedAt && linked.memberProfileId === member.id)
        return toRepairView(linked);
      throw new AppError("REPAIR_ORDER_STATE_CONFLICT", "该报修单已关联维修备案");
    }
    if (order.assigneeMemberProfileId !== member.id)
      throw new AppError("REPAIR_FORBIDDEN", "只有受理人可以为该报修单建立备案");
    if (order.status === "CANCELLED")
      throw new AppError("REPAIR_ORDER_STATE_INVALID", "已取消的报修单不能建立备案");

    const now = new Date();
    const record = await inSerializableTransaction(async (tx) => {
      const existing = await tx.repairRecord.findUnique({
        where: { createRequestKey: key },
        include: repairDetailInclude,
      });
      if (existing) {
        if (existing.memberProfileId !== member.id || existing.deletedAt)
          throw new AppError("IDEMPOTENCY_CONFLICT", "幂等键已被使用");
        // 幂等回放必须属于当前报修单：同一键曾被其他报修单用来建档时，
        // 直接返回那份备案会把调用者带到另一台机器的记录上，且本单仍无关联。
        const replayOrder = await tx.repairOrder.findUnique({
          where: { id },
          select: { repairRecordId: true, deletedAt: true },
        });
        if (!replayOrder || replayOrder.deletedAt)
          throw new AppError("REPAIR_ORDER_NOT_FOUND", "报修单不存在");
        if (replayOrder.repairRecordId !== existing.id)
          throw new AppError("IDEMPOTENCY_CONFLICT", "幂等键已被其他报修单使用");
        return existing;
      }
      // 事务内重读订单：外层检查之后管理员可能已取消、归属可能已变化。
      // 这里给出准确错误，下面的条件更新再做原子兜底。
      const fresh = await tx.repairOrder.findUnique({
        where: { id },
        select: { status: true, assigneeMemberProfileId: true, repairRecordId: true, deletedAt: true },
      });
      if (!fresh || fresh.deletedAt)
        throw new AppError("REPAIR_ORDER_NOT_FOUND", "报修单不存在");
      if (fresh.repairRecordId)
        throw new AppError("REPAIR_ORDER_STATE_CONFLICT", "该报修单已关联维修备案");
      if (fresh.assigneeMemberProfileId !== member.id)
        throw new AppError("REPAIR_FORBIDDEN", "只有受理人可以为该报修单建立备案");
      if (fresh.status === "CANCELLED")
        throw new AppError("REPAIR_ORDER_STATE_INVALID", "已取消的报修单不能建立备案");
      const recordId = randomUUID();
      await tx.repairRecord.create({
        data: {
          id: recordId,
          memberProfileId: member.id,
          status: "DRAFT",
          createRequestKey: key,
          // 机型可从报修单预填；其余字段留空由工作人员填写（结果不预置成功值）。
          deviceModel: order.deviceModel,
          repairDate: null,
          durationMinutes: null,
          categoryId: null,
          content: null,
          result: null,
          remark: null,
          createdAt: now,
        },
      });
      // 只允许受理人本人的可处理状态订单建立关联：事务取消后状态不匹配即回滚，
      // 不会给已取消的订单新建备案，也不留孤立记录。
      const linked = await tx.repairOrder.updateMany({
        where: {
          id,
          repairRecordId: null,
          deletedAt: null,
          assigneeMemberProfileId: member.id,
          status: { in: [...RECORD_LINKABLE_STATUSES] },
        },
        data: { repairRecordId: recordId, updatedAt: now },
      });
      if (linked.count !== 1)
        throw new AppError("REPAIR_ORDER_STATE_CONFLICT", "报修单状态已变化，请刷新后重试");
      await timeline(tx, recordId, actor.userId, "CREATED", { status: "DRAFT", source: "repair_order" }, now);
      return tx.repairRecord.findUniqueOrThrow({
        where: { id: recordId },
        include: repairDetailInclude,
      });
    });
    return toRepairView(record);
  },
};
