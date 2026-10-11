import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { Prisma } from "@/generated/prisma/client";

/** 详情与列表共用的关联加载：进度事件按时间正序，便于客户端直接渲染时间线。 */
export const repairOrderDetailInclude = {
  events: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.RepairOrderInclude;

/** 工作人员视角：在客户形状上补受理人（含显示名）与关联备案摘要（#38）。 */
export const repairOrderStaffInclude = {
  events: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  },
  assignee: { include: { user: true } },
  repairRecord: true,
} satisfies Prisma.RepairOrderInclude;

export type RepairOrderStaffRow = Prisma.RepairOrderGetPayload<{
  include: typeof repairOrderStaffInclude;
}>;

export const repairOrderRepository = {
  /** 按 ID 取单（含软删），由 policy 决定可见性；不在这里替调用方判归属。 */
  async findById(id: string) {
    return getDb().repairOrder.findUnique({
      where: { id },
      include: repairOrderDetailInclude,
    });
  },

  /**
   * 本人报修列表分页。
   * 只按 `submittedByUserId` 过滤 —— 归属在此处就收口，不依赖上层传参正确。
   */
  async listBySubmitter(
    userId: string,
    options: { skip: number; take: number; status?: string },
  ) {
    const where: Prisma.RepairOrderWhereInput = {
      submittedByUserId: userId,
      deletedAt: null,
      ...(options.status ? { status: options.status } : {}),
    };
    const db = getDb();
    const [items, total] = await Promise.all([
      db.repairOrder.findMany({
        where,
        include: repairOrderDetailInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: options.skip,
        take: options.take,
      }),
      db.repairOrder.count({ where }),
    ]);
    return { items, total };
  },

  /** 幂等命中：同一 `createRequestKey` 已提交过则直接取回原单，不再新建。 */
  async findByCreateRequestKey(createRequestKey: string) {
    return getDb().repairOrder.findUnique({
      where: { createRequestKey },
      include: repairOrderDetailInclude,
    });
  },

  /**
   * 创建报修单并写入首条进度事件。
   *
   * 两者必须在同一事务里：只建单不写事件，进度时间线会缺掉「已提交」这一段。
   *
   * **用数组式（批量）事务，不用交互式回调事务**：后者要独占一条连接并保持
   * 双向往返，在本机 MariaDB 适配器下实测会抛
   * `Transaction API error: Unable to start a transaction in the given time.`
   * —— 单据已写入却让调用方拿到异常，接口返回的 id 与库里的行对不上。
   * 数组式事务把两条语句一次提交，没有交互往返，规避了这个问题。
   *
   * 回读放在事务**之外**：事务返回的是各语句的结果，取关联对象最省事的方式是
   * 提交后按 id 再查一次；这一步失败不影响已提交的数据。
   */
  async createWithEvent(input: {
    id: string;
    eventId: string;
    submittedByUserId: string;
    deviceModel: string;
    deviceSerial: string | null;
    faultDescription: string;
    contactPhone: string;
    status: string;
    createRequestKey: string;
    now: Date;
  }) {
    const db = getDb();
    await db.$transaction([
      db.repairOrder.create({
        data: {
          id: input.id,
          submittedByUserId: input.submittedByUserId,
          deviceModel: input.deviceModel,
          deviceSerial: input.deviceSerial,
          faultDescription: input.faultDescription,
          contactPhone: input.contactPhone,
          status: input.status,
          lastProgressAt: input.now,
          createRequestKey: input.createRequestKey,
          createdAt: input.now,
          updatedAt: input.now,
        },
      }),
      db.repairOrderEvent.create({
        data: {
          id: input.eventId,
          repairOrderId: input.id,
          fromStatus: null,
          toStatus: input.status,
          note: null,
          actorUserId: input.submittedByUserId,
          createdAt: input.now,
        },
      }),
    ]);
    return db.repairOrder.findUniqueOrThrow({
      where: { id: input.id },
      include: repairOrderDetailInclude,
    });
  },

  // -------------------------------------------------------------------------
  // Issue #38：工作人员队列与状态推进
  // -------------------------------------------------------------------------

  /** 工作人员详情：含受理人、关联备案与进度事件；由 policy 决定可见性。 */
  async findByIdForStaff(id: string) {
    return getDb().repairOrder.findUnique({
      where: { id },
      include: repairOrderStaffInclude,
    });
  },

  /**
   * 工作人员队列分页。
   *
   * `scope` 组合条件放进 `AND` 数组而不是对象字段：对象里 `status` 键会被
   * 「待受理固定 SUBMITTED」与「用户状态筛选」两处互相覆盖，`AND` 让两者真正取交集
   * （矛盾组合自然得到空列表）。
   */
  async listForStaff(options: {
    scope: "unassigned" | "mine" | "all";
    status?: string;
    memberProfileId: string | null;
    skip: number;
    take: number;
  }) {
    const conditions: Prisma.RepairOrderWhereInput[] = [{ deletedAt: null }];
    if (options.scope === "unassigned")
      conditions.push({ status: "SUBMITTED", assigneeMemberProfileId: null });
    if (options.scope === "mine") conditions.push({ assigneeMemberProfileId: options.memberProfileId });
    if (options.status) conditions.push({ status: options.status });
    const where: Prisma.RepairOrderWhereInput = { AND: conditions };
    const db = getDb();
    const [items, total] = await Promise.all([
      db.repairOrder.findMany({
        where,
        include: repairOrderStaffInclude,
        orderBy: [{ lastProgressAt: "desc" }, { id: "desc" }],
        skip: options.skip,
        take: options.take,
      }),
      db.repairOrder.count({ where }),
    ]);
    return { items, total };
  },

  /**
   * 条件状态推进 + 进度事件，同一事务提交（#38：状态与事件必须一致，不能只改一半）。
   *
   * `where` 里带「当前状态 + 受理归属」等条件，`updateMany` 命中 0 行即说明
   * 并发请求已抢先改掉了状态 —— 调用方据此区分「幂等重放」与「冲突」。
   * 用一个 Serializble 事务包住「条件更新 + 事件」，避免两个人同时受理时
   * 各自更新成功却写出两条受理事件。
   */
  async transitionWithEvent(input: {
    orderId: string;
    where: Prisma.RepairOrderWhereInput;
    data: Prisma.RepairOrderUncheckedUpdateManyInput;
    event: {
      id: string;
      fromStatus: string;
      toStatus: string;
      note: string | null;
      actorUserId: string;
    };
    now: Date;
  }): Promise<{ updated: boolean; order: RepairOrderStaffRow | null }> {
    return inSerializableTransaction(async (tx) => {
      const result = await tx.repairOrder.updateMany({ where: input.where, data: input.data });
      if (result.count !== 1) return { updated: false, order: null };
      await tx.repairOrderEvent.create({
        data: {
          id: input.event.id,
          repairOrderId: input.orderId,
          fromStatus: input.event.fromStatus,
          toStatus: input.event.toStatus,
          note: input.event.note,
          actorUserId: input.event.actorUserId,
          createdAt: input.now,
        },
      });
      const order = await tx.repairOrder.findUniqueOrThrow({
        where: { id: input.orderId },
        include: repairOrderStaffInclude,
      });
      return { updated: true, order };
    });
  },
};
