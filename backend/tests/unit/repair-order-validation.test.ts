import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../src/lib/api/errors";
import {
  assertRepairOrderTransition,
  isRepairOrderTransitionAllowed,
} from "../../src/features/repair-orders/repair-order-policy";
import {
  normalizeRepairOrderInput,
  repairOrderFieldLimits,
  validateRepairOrderInput,
} from "../../src/features/repair-orders/repair-order-validation";
import { repairOrderSubmitInput } from "../../src/features/repair-orders/repair-order-http";

function fieldErrors(error: unknown): Record<string, string[]> | undefined {
  return error instanceof AppError
    ? (error.fieldErrors as Record<string, string[]> | undefined)
    : undefined;
}

const validInput = {
  deviceModel: "ThinkPad X1 Carbon",
  deviceSerial: "PF2ABCDE",
  faultDescription: "开机后风扇狂转，屏幕无显示",
  contactPhone: "13800138000",
};

test("合法输入通过校验", () => {
  assert.doesNotThrow(() => validateRepairOrderInput(normalizeRepairOrderInput(validInput)));
});

test("选填序列号可以为空，归一为 undefined 而不是空串", () => {
  const normalized = normalizeRepairOrderInput({ ...validInput, deviceSerial: "   " });
  assert.equal(normalized.deviceSerial, undefined);
  assert.doesNotThrow(() => validateRepairOrderInput(normalized));
});

test("必填项缺失时一次性报出全部字段错误", () => {
  try {
    validateRepairOrderInput(
      normalizeRepairOrderInput({
        deviceModel: "",
        faultDescription: "",
        contactPhone: "",
      }),
    );
    assert.fail("应当抛出校验错误");
  } catch (error) {
    const errors = fieldErrors(error);
    assert.ok(errors, "应带 fieldErrors");
    assert.ok(errors.deviceModel, "缺 deviceModel 错误");
    assert.ok(errors.faultDescription, "缺 faultDescription 错误");
    assert.ok(errors.contactPhone, "缺 contactPhone 错误");
  }
});

test("超长字段被拒，长度上限与 schema 对齐", () => {
  const limits = repairOrderFieldLimits;
  try {
    validateRepairOrderInput(
      normalizeRepairOrderInput({
        ...validInput,
        deviceModel: "x".repeat(limits.deviceModelMaxLength + 1),
        deviceSerial: "y".repeat(limits.deviceSerialMaxLength + 1),
        faultDescription: "z".repeat(limits.faultDescriptionMaxLength + 1),
      }),
    );
    assert.fail("应当抛出校验错误");
  } catch (error) {
    const errors = fieldErrors(error);
    assert.ok(errors?.deviceModel);
    assert.ok(errors?.deviceSerial);
    assert.ok(errors?.faultDescription);
  }
});

test("电话格式非法被拒", () => {
  for (const bad of ["abc", "1", "电话13800138000"]) {
    try {
      validateRepairOrderInput(normalizeRepairOrderInput({ ...validInput, contactPhone: bad }));
      assert.fail(`应拒绝电话 ${bad}`);
    } catch (error) {
      assert.ok(fieldErrors(error)?.contactPhone, `电话 ${bad} 应报错`);
    }
  }
});

test("合法电话形态通过：数字与 + - 空格 括号", () => {
  for (const phone of ["13800138000", "+86 138-0013-8000", "(0571) 6374 1234"]) {
    assert.doesNotThrow(
      () => validateRepairOrderInput(normalizeRepairOrderInput({ ...validInput, contactPhone: phone })),
      `应接受电话 ${phone}`,
    );
  }
});

test("请求体解析：缺字段与空串都按校验失败处理", () => {
  assert.throws(() => repairOrderSubmitInput({ deviceModel: "A", faultDescription: "x".repeat(10) }), AppError);
  assert.throws(() => repairOrderSubmitInput({ deviceModel: "   ", faultDescription: "b", contactPhone: "c" }), AppError);
  const ok = repairOrderSubmitInput({ ...validInput });
  assert.equal(ok.deviceModel, validInput.deviceModel);
  assert.equal(ok.deviceSerial, validInput.deviceSerial);
});

test("请求体解析：序列号可缺省", () => {
  const withoutSerial: Record<string, unknown> = { ...validInput };
  delete withoutSerial.deviceSerial;
  const parsed = repairOrderSubmitInput(withoutSerial);
  assert.equal(parsed.deviceSerial, undefined);
});

/**
 * 报修单状态机独立于备案：备案允许 DRAFT→PENDING 等审核流转，
 * 报修单不允许出现这些状态 —— 这是 #38「两种状态分别维护」的直接体现。
 */
test("报修单状态机：只放行处理流，不放行备案审核流", () => {
  assert.equal(isRepairOrderTransitionAllowed("SUBMITTED", "ACCEPTED"), true);
  assert.equal(isRepairOrderTransitionAllowed("ACCEPTED", "REPAIRING"), true);
  assert.equal(isRepairOrderTransitionAllowed("REPAIRING", "COMPLETED"), true);
  assert.equal(isRepairOrderTransitionAllowed("SUBMITTED", "CANCELLED"), true);

  // 备案的审核流转不应在报修单上成立
  assert.equal(isRepairOrderTransitionAllowed("SUBMITTED", "PENDING" as never), false);
  assert.equal(isRepairOrderTransitionAllowed("SUBMITTED", "APPROVED" as never), false);
  // 跳步与回退不允许
  assert.equal(isRepairOrderTransitionAllowed("SUBMITTED", "REPAIRING"), false);
  assert.equal(isRepairOrderTransitionAllowed("SUBMITTED", "COMPLETED"), false);
  assert.equal(isRepairOrderTransitionAllowed("COMPLETED", "REPAIRING"), false);
});

test("非法状态转换抛出 REPAIR_ORDER_STATE_INVALID（非备案错误码）", () => {
  assert.throws(
    () => assertRepairOrderTransition("SUBMITTED", "COMPLETED"),
    (error: unknown) => error instanceof AppError && error.code === "REPAIR_ORDER_STATE_INVALID",
  );
});
