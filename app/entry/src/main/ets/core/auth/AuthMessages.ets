import { ApiRequestError } from '../network/ApiClient';
import { isNetworkErrorCode } from '../../features/knowledge/KnowledgeFlow';
import { REMEMBER_ME_HINT, REMEMBER_ME_LABEL } from './AuthContract';

/**
 * 注册 / 改密两个表单共用的错误码 → 界面文案映射（Issue #60 App 侧第三批）。
 *
 * 设计原则与既有页面一致：
 * - **服务端信封文案优先**：后端 `message` 已经是面向用户的话，直接展示，
 *   客户端不翻译、不加工（`AUTH_INVALID_CREDENTIALS` 这类提示尤其如此）；
 * - 只对**契约里已列明、且客户端必须给出下一步动作**的错误码补引导，
 *   例如 `ACCOUNT_IDENTITY_TAKEN` 引导去登录、`IDEMPOTENCY_CONFLICT` 提示换键；
 * - 网络类错误补一句排查引导，与其它页面同一套句式；
 * - 未列明的错误码**不猜**：原样展示服务端文案，宁可保守也不要编一个规则。
 *
 * 这个模块只依赖错误码字符串与文案，不依赖 ArkUI / 网络，可被回归用例直接执行。
 */

/** 客户自主注册（`/auth/register/customer`）的补充引导。 */
export function customerRegisterErrorText(error: ApiRequestError): string {
  if (error.code === 'ACCOUNT_IDENTITY_TAKEN') {
    // 契约：QQ 已被任何账号占用（含软删除身份），不认领、不合并。
    // 引导用户回登录页，而不是让他换个 QQ 反复重试。
    return `${error.message}，请直接登录`;
  }
  if (error.code === 'PASSWORD_CONFIRMATION_MISMATCH') {
    return '两次输入的密码不一致，请重新输入';
  }
  if (error.code === 'VALIDATION_FAILED') {
    // 字段级提示（QQ / 密码）由服务端 fieldErrors 落到对应输入框，这里只兜底。
    return error.message;
  }
  if (error.code === 'RATE_LIMITED') {
    return `${error.message}，请稍后再试`;
  }
  if (isNetworkErrorCode(error.code)) {
    return `${error.message}（请检查网络与服务器地址后重试）`;
  }
  return error.message;
}

/** 邀请码注册工作人员（`/auth/register/staff`）的补充引导。 */
export function staffRegisterErrorText(error: ApiRequestError): string {
  if (error.code === 'IDEMPOTENCY_CONFLICT') {
    // 幂等键已用于另一项注册请求：提示用户换一份资料重试，而不是原样再点。
    return `${error.message}，请更换注册信息后重试`;
  }
  if (error.code === 'ACCOUNT_IDENTITY_CONFLICT') {
    // 既有账号身份（整体回滚）：不覆盖、不发会话，引导改用已有账号登录。
    return `${error.message}，请使用已有账号登录`;
  }
  if (error.code === 'AUTH_INVALID_CREDENTIALS') {
    // 幂等重放时密码与账号当前口令不一致（契约把这种情形按认证失败处理）。
    return `${error.message}，请使用该账号当前的密码重试，或更换注册信息`;
  }
  if (error.code === 'INVITE_CODE_BINDING_MISMATCH') {
    return `${error.message}，请核对邀请码绑定的 QQ 与手机号`;
  }
  if (error.code === 'INVITE_CODE_EXHAUSTED') {
    return `${error.message}，请联系管理员获取新的邀请码`;
  }
  if (error.code === 'INVITE_CODE_NOT_ACTIVE' ||
    error.code === 'INVITE_CODE_EXPIRED' ||
    error.code === 'INVITE_CODE_REVOKED' ||
    error.code === 'INVITE_CODE_INVALID') {
    return `${error.message}，请核对邀请码后重试`;
  }
  if (error.code === 'PASSWORD_CONFIRMATION_MISMATCH') {
    return '两次输入的密码不一致，请重新输入';
  }
  if (error.code === 'RATE_LIMITED') {
    return `${error.message}，请稍后再试`;
  }
  if (isNetworkErrorCode(error.code)) {
    return `${error.message}（请检查网络与服务器地址后重试）`;
  }
  return error.message;
}

/** 原生改密（`/auth/native/password/change`）的补充引导。 */
export function passwordChangeErrorText(error: ApiRequestError): string {
  if (error.code === 'PASSWORD_CURRENT_INVALID') {
    // 契约：当前密码错误。旧会话仍然有效，用户可以直接重试。
    return `${error.message}，请重新输入当前密码`;
  }
  if (error.code === 'PASSWORD_CONFIRMATION_MISMATCH') {
    return '两次输入的新密码不一致，请重新输入';
  }
  if (error.code === 'VALIDATION_FAILED') {
    // 长度 6–128；服务端文案已含区间，这里只补一句「本次未改动任何口令」。
    return `${error.message}（当前密码未改动）`;
  }
  if (isNetworkErrorCode(error.code)) {
    return `${error.message}（请检查网络与服务器地址后重试）`;
  }
  return error.message;
}

/**
 * 改密档位开关的说明文案（三态，与 `PasswordChangeRequest.rememberMe` 对应）。
 * 沿用档位时明确告诉用户「不会改变当前有效期」，避免误以为提交即续期。
 */
export function passwordLifetimeHint(mode: string): string {
  if (mode === 'keep') {
    return '沿用当前会话的有效期（不升档也不降档）';
  }
  if (mode === 'long') {
    return `已选择 ${REMEMBER_ME_LABEL}`;
  }
  return `已选择普通档位：${REMEMBER_ME_HINT}`;
}

/** 保持登录开关的说明文案（登录 / 注册共用）。 */
export function rememberMeHint(checked: boolean): string {
  return checked ? `${REMEMBER_ME_LABEL}，适合个人设备` : REMEMBER_ME_HINT;
}

/**
 * 登录 / 注册成功后是否要引导去改密页（强制改密账号边界）。
 *
 * 契约：`mustChangePassword = true` 的账号只能访问 session / logout / 原生改密 / Web 改密，
 * 其余业务接口一律 `403 PASSWORD_CHANGE_REQUIRED`。因此**必须**先把它送到改密页，
 * 否则一进主页就会被业务接口拒绝，用户看到的是满屏 403。
 */
export function needsPasswordChange(mustChangePassword: boolean): boolean {
  return mustChangePassword;
}
