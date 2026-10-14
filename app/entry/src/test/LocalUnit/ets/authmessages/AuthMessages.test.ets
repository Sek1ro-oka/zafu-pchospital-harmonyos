import { describe, expect, it } from '@ohos/hypium';

import { customerRegisterErrorText, passwordChangeErrorText, staffRegisterErrorText } from '../../../../main/ets/core/auth/AuthMessages';
import { ApiRequestError } from '../../../../main/ets/core/network/ApiClient';

function error(code: string, message: string): ApiRequestError {
  return new ApiRequestError(code, message, 400, 'test-request');
}

/**
 * 注册 / 改密错误码 → 界面文案映射的回归用例（Issue #60 第三批）。
 *
 * 只覆盖**契约里逐条列明、且客户端必须给出下一步动作**的错误码：
 * 文案拼装规则变了会让用户拿到没有引导的裸错误，这几条就是防这个的。
 * 服务端文案优先的原则也在用例里钉住（业务错误不加工、不翻译）。
 *
 * 导出为函数供 `List.test` 汇总（hvigor 的测试入口只认这个形状）。
 */
export default function authMessagesSuite(): void {
  describe('AuthMessages', () => {
    it('客户注册：QQ 已占用时引导去登录', 0, (): void => {
      const text: string = customerRegisterErrorText(error('ACCOUNT_IDENTITY_TAKEN', '该 QQ 号已注册，请直接登录'));
      expect(text).assertEqual('该 QQ 号已注册，请直接登录，请直接登录');
    });

    it('客户注册：两次密码不一致给本地文案', 0, (): void => {
      const text: string = customerRegisterErrorText(error('PASSWORD_CONFIRMATION_MISMATCH', '两次输入的密码不一致'));
      expect(text).assertEqual('两次输入的密码不一致，请重新输入');
    });

    it('客户注册：429 限流提示稍后再试', 0, (): void => {
      const text: string = customerRegisterErrorText(error('RATE_LIMITED', '请求过于频繁'));
      expect(text).assertEqual('请求过于频繁，请稍后再试');
    });

    it('工作人员注册：幂等键冲突提示更换注册信息', 0, (): void => {
      const text: string = staffRegisterErrorText(error('IDEMPOTENCY_CONFLICT', '幂等键已用于另一项注册请求'));
      expect(text).assertEqual('幂等键已用于另一项注册请求，请更换注册信息后重试');
    });

    it('工作人员注册：既有账号身份冲突引导登录', 0, (): void => {
      const text: string = staffRegisterErrorText(error('ACCOUNT_IDENTITY_CONFLICT', '账号身份信息存在冲突，需要管理员处理'));
      expect(text).assertEqual('账号身份信息存在冲突，需要管理员处理，请使用已有账号登录');
    });

    it('工作人员注册：邀请码已用尽提示找管理员', 0, (): void => {
      const text: string = staffRegisterErrorText(error('INVITE_CODE_EXHAUSTED', '邀请码已用尽'));
      expect(text).assertEqual('邀请码已用尽，请联系管理员获取新的邀请码');
    });

    it('改密：当前密码错误说明可重试', 0, (): void => {
      const text: string = passwordChangeErrorText(error('PASSWORD_CURRENT_INVALID', '当前密码错误'));
      expect(text).assertEqual('当前密码错误，请重新输入当前密码');
    });

    it('改密：长度不合规时说明口令未改动', 0, (): void => {
      const text: string = passwordChangeErrorText(error('VALIDATION_FAILED', '密码长度必须为 6–128 个字符'));
      expect(text).assertEqual('密码长度必须为 6–128 个字符（当前密码未改动）');
    });

    it('改密：未列明的错误码原样透传服务端文案', 0, (): void => {
      const text: string = passwordChangeErrorText(error('SOME_NEW_CODE', '服务端原文'));
      expect(text).assertEqual('服务端原文');
    });
  });
}
