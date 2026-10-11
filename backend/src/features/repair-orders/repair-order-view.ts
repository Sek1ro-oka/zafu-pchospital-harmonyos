import type { AuthorizedActor, RepairOrderStatus } from "@/types/contracts";
import { repairOrderStaffActions, type RepairOrderStaffActions } from "./repair-order-policy";
import type { RepairOrderStaffRow } from "./repair-order-repository";

/** 进度事件对外形状：客户端只读，不含内部字段。 */
export type RepairOrderEventView = {
  id: string;
  fromStatus: RepairOrderStatus | null;
  toStatus: RepairOrderStatus;
  note: string | null;
  createdAt: string;
};

/**
 * 报修单对外形状（列表与详情共用）。
 *
 * 刻意**不返回** `createRequestKey`、`assigneeMemberProfileId`、`repairRecordId`：
 * 幂等键是客户端内部约定，另两个字段属于 #38 的工作人员侧，
 * 本 Issue 阶段对外暴露没有意义，还会让客户端误以为可以自行指定归属。
 */
export type RepairOrderView = {
  id: string;
  deviceModel: string;
  deviceSerial: string | null;
  faultDescription: string;
  contactPhone: string;
  status: RepairOrderStatus;
  createdAt: string;
  updatedAt: string;
  lastProgressAt: string | null;
  events: RepairOrderEventView[];
};

type RepairOrderRow = {
  id: string;
  deviceModel: string;
  deviceSerial: string | null;
  faultDescription: string;
  contactPhone: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lastProgressAt: Date | null;
  events: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    createdAt: Date;
  }>;
};

/** 把数据库行映射为对外视图。时间统一为 ISO 字符串，避免客户端各自解析时区。 */
export function toRepairOrderView(row: RepairOrderRow): RepairOrderView {
  return {
    id: row.id,
    deviceModel: row.deviceModel,
    deviceSerial: row.deviceSerial,
    faultDescription: row.faultDescription,
    contactPhone: row.contactPhone,
    status: row.status as RepairOrderStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastProgressAt: row.lastProgressAt === null ? null : row.lastProgressAt.toISOString(),
    events: row.events.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus === null ? null : (event.fromStatus as RepairOrderStatus),
      toStatus: event.toStatus as RepairOrderStatus,
      note: event.note,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

/** 关联备案摘要：只带工作人员处理需要的状态位，不返回备注、照片与内部时间线。 */
export type StaffRepairOrderRecordSummary = {
  id: string;
  status: string;
  result: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
};

/**
 * 工作人员视角的报修单（详情与队列共用）。
 *
 * 在客户形状上追加：受理人、关联备案摘要与**服务端计算的允许动作**。
 * 客户端据此渲染按钮，但不作为授权依据 —— 每个写接口都会重新校验。
 */
export type StaffRepairOrderView = RepairOrderView & {
  assignee: { memberProfileId: string; name: string } | null;
  record: StaffRepairOrderRecordSummary | null;
  actions: RepairOrderStaffActions;
};

/** 受理人 / 成员显示名，与 `repair-view.ts` 的成员名解析保持同一优先级。 */
function memberDisplayName(row: { nickname: string | null; realName: string; user: { displayName: string | null } }): string {
  return row.nickname || row.realName || row.user.displayName || "成员";
}

export function toStaffRepairOrderView(
  row: RepairOrderStaffRow,
  actor: AuthorizedActor,
  memberProfileId: string | null,
): StaffRepairOrderView {
  return {
    ...toRepairOrderView(row),
    assignee: row.assignee
      ? { memberProfileId: row.assignee.id, name: memberDisplayName(row.assignee) }
      : null,
    record: row.repairRecord
      ? {
          id: row.repairRecord.id,
          status: row.repairRecord.status,
          result: row.repairRecord.result,
          submittedAt: row.repairRecord.submittedAt?.toISOString() ?? null,
          reviewedAt: row.repairRecord.reviewedAt?.toISOString() ?? null,
        }
      : null,
    actions: repairOrderStaffActions(actor, row, memberProfileId),
  };
}
