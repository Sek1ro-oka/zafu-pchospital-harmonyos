import { AppError } from "@/lib/api/errors";

/** 报修单字段上限，与 schema 的 VarChar/Text 长度对齐。 */
export const repairOrderFieldLimits = {
  deviceModelMaxLength: 60,
  deviceSerialMaxLength: 120,
  faultDescriptionMinLength: 5,
  faultDescriptionMaxLength: 2000,
  contactPhoneMinLength: 5,
  contactPhoneMaxLength: 32,
  createRequestKeyMaxLength: 128,
} as const;

/** 允许的电话字符：数字、`+`、`-`、空格、括号。 */
const PHONE_PATTERN = /^[0-9+\-\s()]{5,32}$/;

export type RepairOrderDraftInput = {
  deviceModel: string;
  deviceSerial?: string;
  faultDescription: string;
  contactPhone: string;
};

function clean(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** 归一化：去多余空白；空串与未填视为同一件事（可选字段存 null）。 */
export function normalizeRepairOrderInput(input: RepairOrderDraftInput): RepairOrderDraftInput {
  const serial = clean(input.deviceSerial);
  return {
    deviceModel: clean(input.deviceModel),
    deviceSerial: serial === "" ? undefined : serial,
    faultDescription: (input.faultDescription ?? "").trim(),
    contactPhone: clean(input.contactPhone),
  };
}

/**
 * 校验必填与长度。一次性收集全部字段错误再抛，
 * 让客户端一次就能标出所有问题，而不是修一个报一个。
 */
export function validateRepairOrderInput(input: RepairOrderDraftInput): void {
  const errors: Record<string, string[]> = {};
  const limits = repairOrderFieldLimits;

  if (input.deviceModel === "") errors.deviceModel = ["请填写设备机型"];
  else if (input.deviceModel.length > limits.deviceModelMaxLength)
    errors.deviceModel = [`机型不能超过 ${limits.deviceModelMaxLength} 字`];

  if (input.deviceSerial !== undefined && input.deviceSerial.length > limits.deviceSerialMaxLength)
    errors.deviceSerial = [`序列号不能超过 ${limits.deviceSerialMaxLength} 字`];

  if (input.faultDescription === "") errors.faultDescription = ["请描述故障现象"];
  else if (input.faultDescription.length < limits.faultDescriptionMinLength)
    errors.faultDescription = [`故障描述至少 ${limits.faultDescriptionMinLength} 字`];
  else if (input.faultDescription.length > limits.faultDescriptionMaxLength)
    errors.faultDescription = [`故障描述不能超过 ${limits.faultDescriptionMaxLength} 字`];

  if (input.contactPhone === "") errors.contactPhone = ["请填写联系电话"];
  else if (!PHONE_PATTERN.test(input.contactPhone))
    errors.contactPhone = ["联系电话格式无效"];

  if (Object.keys(errors).length)
    throw new AppError("VALIDATION_FAILED", "报修信息填写不完整", { fieldErrors: errors });
}
