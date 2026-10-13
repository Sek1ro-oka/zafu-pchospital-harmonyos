import assert from "node:assert/strict";
import { test } from "node:test";
import { customerProfileInput } from "../../src/features/customer-profile/customer-profile-input";

test("客户资料规范化、可清空且不接受目标账号/角色", () => {
  assert.deepEqual(
    customerProfileInput({ nickname: " 测试 ", phone: " 13800000000 ", version: 0 }),
    { nickname: "测试", phone: "13800000000", version: 0 },
  );
  assert.deepEqual(customerProfileInput({ nickname: "", phone: null, version: 1 }), {
    nickname: null,
    phone: null,
    version: 1,
  });
  for (const extra of [{ userId: "someone" }, { roles: ["ADMIN"] }, { realName: "姓名" }]) {
    assert.throws(() =>
      customerProfileInput({ nickname: null, phone: null, version: 0, ...extra }),
    );
  }
});
test("客户资料拒绝错误手机号、版本和不可见昵称", () => {
  for (const phone of ["123", "abcdefghijk", 13800000000, undefined])
    assert.throws(() => customerProfileInput({ nickname: null, phone, version: 0 }));
  for (const version of [-1, 0.5, "1", undefined])
    assert.throws(() => customerProfileInput({ nickname: null, phone: null, version }));
  assert.throws(() => customerProfileInput({ nickname: "ab\u200b", phone: null, version: 0 }));
  assert.throws(() => customerProfileInput(null));
});
