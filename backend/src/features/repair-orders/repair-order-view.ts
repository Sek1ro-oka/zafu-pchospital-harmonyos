import type { RepairOrderStatus } from "@/types/contracts";

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
