import { AppError } from "@/lib/api/errors";

/** 对外五态。优先级：ENDED > CLOSED > FULL/OPEN > UPCOMING。 */
export const RepairActivityStatus = ["UPCOMING", "OPEN", "FULL", "CLOSED", "ENDED"] as const;
export type RepairActivityStatus = (typeof RepairActivityStatus)[number];

export const RepairActivityIssueType = [
  "CLEAN_PASTE",
  "CLEAN_ONLY",
  "SOFTWARE_SYSTEM",
  "OTHER",
] as const;
export type RepairActivityIssueType = (typeof RepairActivityIssueType)[number];

/** Capacity lower bound shared by server validation and admin form HTML min. */
export const REPAIR_ACTIVITY_CAPACITY_MIN = 1;

export const RepairActivityRegistrationStatus = ["REGISTERED", "CHECKED_IN", "SERVED"] as const;
export type RepairActivityRegistrationStatus = (typeof RepairActivityRegistrationStatus)[number];

/** 占用名额的有效报名状态（撤回排队不减名额；仅软删释放）。 */
export const EFFECTIVE_REGISTRATION_STATUSES: readonly RepairActivityRegistrationStatus[] = [
  "REGISTERED",
  "CHECKED_IN",
  "SERVED",
];

export const repairActivityStatusLabels: Record<RepairActivityStatus, string> = {
  UPCOMING: "未开始",
  OPEN: "报名中",
  FULL: "已报满",
  CLOSED: "报名截止",
  ENDED: "已结束",
};

/** 管理列表短标签（UX R3 / C8）：将开 / 开放 / 已满 / 截止 / 结束 */
export const repairActivityStatusShortLabels: Record<RepairActivityStatus, string> = {
  UPCOMING: "将开",
  OPEN: "开放",
  FULL: "已满",
  CLOSED: "截止",
  ENDED: "结束",
};

export const repairActivityIssueTypeLabels: Record<RepairActivityIssueType, string> = {
  CLEAN_PASTE: "清灰换硅脂",
  CLEAN_ONLY: "清灰",
  SOFTWARE_SYSTEM: "软件 / 系统问题",
  OTHER: "其他故障",
};

export type ActivityTimeFields = {
  activityAt: Date;
  signupOpensAt: Date;
  signupClosesAt: Date;
};

/**
 * 写入时强制的时间规则：
 * 1. signupOpensAt < signupClosesAt
 * 2. signupClosesAt <= activityAt
 */
export function assertActivityTimeRules(fields: ActivityTimeFields): void {
  const { activityAt, signupOpensAt, signupClosesAt } = fields;
  if (
    Number.isNaN(activityAt.getTime()) ||
    Number.isNaN(signupOpensAt.getTime()) ||
    Number.isNaN(signupClosesAt.getTime())
  ) {
    throw new AppError("VALIDATION_FAILED", "活动时间无效");
  }
  if (!(signupOpensAt.getTime() < signupClosesAt.getTime())) {
    throw new AppError("VALIDATION_FAILED", "报名开始时间必须早于报名截止时间", {
      fieldErrors: {
        signupOpensAt: ["报名开始必须早于截止"],
        signupClosesAt: ["报名截止必须晚于开始"],
      },
    });
  }
  if (!(signupClosesAt.getTime() <= activityAt.getTime())) {
    throw new AppError("VALIDATION_FAILED", "报名截止时间不得晚于活动开始时间", {
      fieldErrors: {
        signupClosesAt: ["报名截止不得晚于活动开始"],
        activityAt: ["活动开始不得早于报名截止"],
      },
    });
  }
}

export type DeriveStatusInput = {
  now: Date;
  activityAt: Date;
  signupOpensAt: Date;
  signupClosesAt: Date;
  /** 有效报名数（deletedAt IS NULL 且 status ∈ REGISTERED|CHECKED_IN|SERVED）。 */
  effectiveRegistrationCount: number;
  capacity: number;
};

/**
 * 派生状态（不落库）。优先级从上到下：
 * ENDED → CLOSED → FULL → OPEN → UPCOMING
 */
export function deriveRepairActivityStatus(input: DeriveStatusInput): RepairActivityStatus {
  const now = input.now.getTime();
  if (now >= input.activityAt.getTime()) return "ENDED";
  if (now >= input.signupClosesAt.getTime()) return "CLOSED";
  if (now < input.signupOpensAt.getTime()) return "UPCOMING";
  // 报名窗口内
  if (input.effectiveRegistrationCount >= input.capacity) return "FULL";
  return "OPEN";
}

/** 仅 OPEN 可新报；UPCOMING / CLOSED / FULL / ENDED 均不可。 */
export function canAcceptNewRegistration(status: RepairActivityStatus): boolean {
  return status === "OPEN";
}

/**
 * 公开改类型：仅 REGISTERED 且活动未 ENDED。
 * 报名截止后、活动开始前仍可改。
 */
export function canEditIssueType(params: {
  registrationStatus: string;
  activityStatus: RepairActivityStatus;
}): boolean {
  return params.registrationStatus === "REGISTERED" && params.activityStatus !== "ENDED";
}

export function assertValidCapacity(capacity: number): void {
  if (!Number.isInteger(capacity) || capacity < REPAIR_ACTIVITY_CAPACITY_MIN || capacity > 10_000) {
    throw new AppError("VALIDATION_FAILED", "人数上限须为 1–10000 的整数", {
      fieldErrors: { capacity: ["请输入 1–10000 的整数"] },
    });
  }
}

export function assertValidTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < 2 || trimmed.length > 120) {
    throw new AppError("VALIDATION_FAILED", "活动标题须为 2–120 个字符", {
      fieldErrors: { title: ["请输入 2–120 个字符"] },
    });
  }
  return trimmed;
}

export function assertValidLocation(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > 200) {
    throw new AppError("VALIDATION_FAILED", "地点须为不超过 200 字的文本");
  }
  return value.trim() || null;
}

export type StaffCheckInIssueTypeUpdate = {
  registrationId: string;
  issueType: RepairActivityIssueType;
};

/** Route 与 Service 共用的签到类型校验；先限制数组长度再遍历。 */
export function validateCheckInIssueTypeUpdates(
  value: unknown,
  registrationIds: string[],
): StaffCheckInIssueTypeUpdate[] {
  const ids = new Set(registrationIds.map((id) => id.trim()).filter(Boolean));
  if (ids.size === 0 || ids.size > 100) {
    throw new AppError("VALIDATION_FAILED", "单次请选择 1–100 条报名记录");
  }
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > ids.size) {
    throw new AppError("VALIDATION_FAILED", "issueTypeUpdates 必须是数组且不能超过本批客户数量");
  }
  const seen = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AppError("VALIDATION_FAILED", "故障类型更新项无效");
    }
    const entry = item as Record<string, unknown>;
    const id = typeof entry.registrationId === "string" ? entry.registrationId.trim() : "";
    if (!id || id.length > 36 || !ids.has(id) || seen.has(id)) {
      throw new AppError("VALIDATION_FAILED", "更新 ID 必须属于本批客户且不能重复");
    }
    seen.add(id);
    return { registrationId: id, issueType: assertValidIssueType(entry.issueType) };
  });
}

/** 报名截止后才开放成员出勤、客户签到与接待；报满不代表报名截止。 */
export function canOperateActivityStaff(signupClosesAt: Date | string, now = new Date()): boolean {
  return now.getTime() >= new Date(signupClosesAt).getTime();
}

export function assertActivityStaffOpen(signupClosesAt: Date, now = new Date()): void {
  if (!canOperateActivityStaff(signupClosesAt, now)) {
    throw new AppError("ACTIVITY_NOT_OPEN", "报名尚未截止，暂不可出勤、签到或接待");
  }
}

export function assertValidRegistrantName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 40) {
    throw new AppError("VALIDATION_FAILED", "姓名须为 2–40 个字符", {
      fieldErrors: { name: ["请输入 2–40 个字符"] },
    });
  }
  return trimmed;
}

/** 机型上限（issue #68）：与列宽一致（`VarChar(60)`），前端 HTML `maxLength` 也用它。 */
export const REPAIR_ACTIVITY_DEVICE_MODEL_MAX_LENGTH = 60;

/** 机型选填：缺省、空串都算「没填」，落库统一为 null。 */
export function assertValidDeviceModel(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new AppError("VALIDATION_FAILED", "机型格式无效", {
      fieldErrors: { deviceModel: ["机型格式无效"] },
    });
  }
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > REPAIR_ACTIVITY_DEVICE_MODEL_MAX_LENGTH) {
    throw new AppError(
      "VALIDATION_FAILED",
      `机型不超过 ${REPAIR_ACTIVITY_DEVICE_MODEL_MAX_LENGTH} 个字符`,
      {
        fieldErrors: { deviceModel: [`不超过 ${REPAIR_ACTIVITY_DEVICE_MODEL_MAX_LENGTH} 个字符`] },
      },
    );
  }
  return trimmed;
}

export function assertValidIssueType(value: unknown): RepairActivityIssueType {
  if (
    typeof value !== "string" ||
    !(RepairActivityIssueType as readonly string[]).includes(value)
  ) {
    throw new AppError("VALIDATION_FAILED", "故障类型无效", {
      fieldErrors: { issueType: ["请选择有效的故障类型"] },
    });
  }
  return value as RepairActivityIssueType;
}

export function remainingCapacity(capacity: number, effectiveCount: number): number {
  return Math.max(0, capacity - effectiveCount);
}

/** 接待落单的故障分类 code 映射（seed 已有）。 */
export const ISSUE_TYPE_CATEGORY_CODE: Record<RepairActivityIssueType, string> = {
  CLEAN_PASTE: "COOLING_CLEANING",
  CLEAN_ONLY: "COOLING_CLEANING",
  SOFTWARE_SYSTEM: "SYSTEM",
  OTHER: "OTHER_FAULT",
};

export function mapIssueTypeToCategoryCode(issueType: RepairActivityIssueType): string {
  return ISSUE_TYPE_CATEGORY_CODE[issueType];
}

/** 仅 REGISTERED 可签到入队。 */
export function canCheckInRegistration(status: string): boolean {
  return status === "REGISTERED";
}

/** 仅 CHECKED_IN 可撤回；SERVED 不可撤回。 */
export function canWithdrawRegistration(status: string): boolean {
  return status === "CHECKED_IN";
}

/** 仅 CHECKED_IN 可接待落单。 */
export function canServeRegistration(status: string): boolean {
  return status === "CHECKED_IN";
}

/**
 * 排队序：CHECKED_IN 按 checkedInAt ASC；null 排最后（防御）。
 * 返回新数组，不改原数组。
 */
export function sortQueueByCheckedInAt<T extends { checkedInAt: Date | string | null }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const ta = a.checkedInAt ? new Date(a.checkedInAt).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.checkedInAt ? new Date(b.checkedInAt).getTime() : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
}

/** activityAt → Asia/Shanghai 日历日 `YYYY-MM-DD`（与 repairDate 存储约定一致）。 */
export function shanghaiCalendarDay(activityAt: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(activityAt);
}

/** 活动接待自动落单的维修内容模板。 */
export function buildActivityServeContent(input: {
  activityTitle: string;
  customerName: string;
  phoneMasked: string;
  issueTypeLabel: string;
}): string {
  return [
    `【维修活动接待】${input.activityTitle}`,
    `客户：${input.customerName}`,
    `电话：${input.phoneMasked}`,
    `故障类型：${input.issueTypeLabel}`,
  ].join("\n");
}

export const ACTIVITY_SERVE_REMARK = "活动接待自动落单";
export const ACTIVITY_SERVE_DURATION_MINUTES = 1;
