import { repairFieldLimits } from "@/config/repairs";
import { AppError } from "@/lib/api/errors";
import type { RepairDraftFields, RepairResult } from "@/types/contracts";

export function normalizeDraftFields(input: RepairDraftFields): RepairDraftFields {
  return {
    deviceModel: input.deviceModel === undefined ? undefined : clean(input.deviceModel),
    ownerName: input.ownerName === undefined ? undefined : clean(input.ownerName),
    ownerPhone: input.ownerPhone === undefined ? undefined : clean(input.ownerPhone),
    repairDate: input.repairDate === undefined ? undefined : input.repairDate || null,
    durationMinutes: input.durationMinutes,
    categoryId: input.categoryId === undefined ? undefined : input.categoryId || null,
    content: input.content === undefined ? undefined : clean(input.content),
    result: input.result,
    remark: input.remark === undefined ? undefined : clean(input.remark),
  };
}

export function validateDraftFields(input: RepairDraftFields): void {
  const errors: Record<string, string[]> = {};
  if (input.deviceModel != null && input.deviceModel.length > 60)
    errors.deviceModel = ["设备机型不能超过 60 字"];
  if (input.ownerName != null && input.ownerName.length > 40)
    errors.ownerName = ["机主姓名不能超过 40 字"];
  // 2026-10-13 用户确认：沿用课设报修电话口径，保持旧座机/区号联系快照可建档。
  if (
    input.ownerPhone != null &&
    (input.ownerPhone.length > 32 ||
      !/^[0-9+\-\s()]*$/.test(input.ownerPhone) ||
      input.ownerPhone.replace(/\D/g, "").length < 7)
  )
    errors.ownerPhone = ["机主电话需至少 7 位数字，只允许数字、+、-、空格和括号，最多 32 字符"];
  if (input.repairDate != null && !isDate(input.repairDate)) {
    errors.repairDate = ["维修日期格式无效"];
  } else if (input.repairDate) {
    // 日期范围在草稿阶段就拦：等到提交才报错，用户早就离开了这一页（issue #62 后端3）。
    if (input.repairDate < repairFieldLimits.repairDateMin)
      errors.repairDate = [`维修日期不得早于 ${repairFieldLimits.repairDateMin}`];
    else if (input.repairDate > currentShanghaiDate()) errors.repairDate = ["维修日期不能晚于今天"];
  }
  if (
    input.durationMinutes != null &&
    (!Number.isInteger(input.durationMinutes) ||
      input.durationMinutes < repairFieldLimits.durationMinutesMin ||
      input.durationMinutes > repairFieldLimits.durationMinutesMax)
  )
    errors.durationMinutes = [
      `维修时长须为 ${repairFieldLimits.durationMinutesMin}–${repairFieldLimits.durationMinutesMax} 分钟`,
    ];
  if (input.content != null && input.content.length > repairFieldLimits.contentMaxLength)
    errors.content = [`维修内容不能超过 ${repairFieldLimits.contentMaxLength} 字`];
  if (input.remark != null && input.remark.length > repairFieldLimits.remarkMaxLength)
    errors.remark = [`备注不能超过 ${repairFieldLimits.remarkMaxLength} 字`];
  if (input.result != null && !isRepairResult(input.result)) errors.result = ["维修结果无效"];
  if (Object.keys(errors).length)
    throw new AppError("VALIDATION_FAILED", "维修记录字段无效", { fieldErrors: errors });
}

export function validateSubmission(record: {
  repairDate: Date | null;
  categoryId: string | null;
  content: string | null;
  result: string | null;
  photoCount: number;
}): void {
  const errors: Record<string, string[]> = {};
  if (!record.repairDate) errors.repairDate = ["请填写维修日期"];
  else {
    const repairDate = formatShanghaiDate(record.repairDate);
    if (repairDate > currentShanghaiDate()) errors.repairDate = ["维修日期不能晚于今天"];
    else if (repairDate < repairFieldLimits.repairDateMin)
      errors.repairDate = [`维修日期不得早于 ${repairFieldLimits.repairDateMin}`];
  }
  if (!record.categoryId) errors.categoryId = ["请选择故障分类"];
  const content = record.content?.trim() ?? "";
  if (!content) errors.content = ["请填写维修内容"];
  else if (content.length > repairFieldLimits.contentMaxLength)
    errors.content = [`维修内容不能超过 ${repairFieldLimits.contentMaxLength} 字`];
  if (!isRepairResult(record.result)) errors.result = ["维修结果缺失"];
  if (record.photoCount < 1) errors.photos = ["至少上传一张维修照片"];
  if (Object.keys(errors).length)
    throw new AppError("REPAIR_SUBMISSION_INCOMPLETE", "请补全维修记录后再提交", {
      fieldErrors: errors,
    });
}

export function parseRepairDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (!isDate(value)) throw new AppError("VALIDATION_FAILED", "维修日期格式无效");
  return new Date(`${value}T00:00:00.000Z`);
}

function clean(value: string | null): string | null {
  const result = value?.trim() ?? "";
  return result || null;
}
function isDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).valueOf())
  );
}
function isRepairResult(value: unknown): value is RepairResult {
  return value === "COMPLETED" || value === "NOT_COMPLETED";
}
function currentShanghaiDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function formatShanghaiDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
