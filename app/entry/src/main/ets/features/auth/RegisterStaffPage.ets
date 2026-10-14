import { util } from '@kit.ArkTS';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { SessionIdentity, StaffRegisterRequest } from '../../core/auth/AuthContract';
import { SessionService } from '../../core/auth/SessionService';
import { rememberMeHint, staffRegisterErrorText } from '../../core/auth/AuthMessages';
import {
  CARD_GAP,
  CARD_PADDING,
  CARD_RADIUS,
  CONTROL_HEIGHT,
  FONT_NOTE,
  FONT_SUBTITLE,
  FONT_TEXT,
  GAP_LG,
  GAP_SM,
  PAGE_PADDING,
} from '../../core/ui/Theme';
import { LabeledInput, RememberMeSwitch, SubmitButton } from '../../core/ui/FormControls';

/**
 * 邀请码注册工作人员页（Issue #60 第三批）：`POST /api/v1/auth/register/staff`。
 *
 * 与客户自主注册页**刻意分开的两个入口**（契约表格逐条列过）：
 * - 必须带有效邀请码，成功产生 `MEMBER` 角色 + 成员档案，进入工作人员入口；
 * - 使用次数 / 生效失效 / QQ 与手机绑定 / 并发与幂等全部由服务端在同一事务内判定，
 *   失败不扣名额，也不会留下账号（整体回滚），重试是安全的；
 * - 命中既有账号身份 → `409 ACCOUNT_IDENTITY_CONFLICT`：不覆盖、不发会话，
 *   引导改用已有账号登录。
 *
 * 幂等键：同一份表单的重试复用同一个键（服务端据此去重），成功后才换新的；
 * 若拿到 `IDEMPOTENCY_CONFLICT`（键已用于另一项注册），提示用户更换注册信息。
 *
 * 字段：邀请码、姓名、QQ、手机号、密码 + 确认密码 + 保持登录；
 * `studentId` / `className` 选填，留空时**不提交这两个键**。
 */
@Component
export struct RegisterStaffPage {
  onRegistered: (identity: SessionIdentity) => void = () => {};
  onCancel: () => void = () => {};
  /**
   * 上报「注册写请求进行中」给上层（HomePage 据此拦截系统返回键）。
   * 上层必须知道这个时刻：注册请求已发出但用户按返回离开后，迟到的成功响应
   * 仍会保存令牌并写全局身份，而界面已经在登录别的账号 —— 变成账号串用。
   */
  onBusyChange: (busy: boolean) => void = () => {};
  onSessionExpired: () => void = () => {};
  @State code: string = '';
  @State realName: string = '';
  @State qq: string = '';
  @State phone: string = '';
  @State studentId: string = '';
  @State className: string = '';
  @State password: string = '';
  @State passwordConfirmation: string = '';
  @State rememberMe: boolean = false;
  @State busy: boolean = false;
  @State errorText: string = '';
  @State failed: boolean = false;
  @State fieldErrors: Record<string, string> = {};
  /** 幂等键：同一份表单的重试复用，成功后才换新的（与报修单提交同一约定）。 */
  private idempotencyKey: string = '';
  private generation: number = 0;

  aboutToAppear(): void {
    this.idempotencyKey = `app-${util.generateRandomUUID(true)}`;
  }

  aboutToDisappear(): void {
    this.generation += 1;
  }

  private fieldError(name: string): string {
    const value: string | undefined = this.fieldErrors[name];
    return value === undefined ? '' : value;
  }

  private readServerFieldErrors(error: ApiRequestError): Record<string, string> {
    const result: Record<string, string> = {};
    const raw: Record<string, string[]> | undefined = error.fieldErrors;
    if (raw === undefined) {
      return result;
    }
    const keys: string[] = Object.keys(raw);
    for (const key of keys) {
      const messages: string[] = raw[key];
      if (messages.length > 0) {
        result[key] = messages[0];
      }
    }
    return result;
  }

  private async submit(): Promise<void> {
    if (this.busy) {
      return;
    }
    const code: string = this.code.trim().toUpperCase();
    const realName: string = this.realName.trim();
    const qq: string = this.qq.trim();
    const phone: string = this.phone.trim();
    const studentId: string = this.studentId.trim();
    const className: string = this.className.trim();
    const password: string = this.password;
    const confirmation: string = this.passwordConfirmation;
    this.fieldErrors = {};
    this.errorText = '';
    if (code === '' || realName === '' || qq === '' || phone === '' || password === '' || confirmation === '') {
      this.errorText = '请填写邀请码、姓名、QQ、手机号与密码';
      return;
    }
    if (password !== confirmation) {
      // ArkTS 不允许未加标注的对象字面量：字段级错误用显式声明的 map 承载。
      const errors: Record<string, string> = {};
      errors.passwordConfirmation = '两次输入的密码不一致';
      this.fieldErrors = errors;
      return;
    }
    if (password.length < 6) {
      const errors: Record<string, string> = {};
      errors.password = '密码至少 6 位';
      this.fieldErrors = errors;
      return;
    }
    this.busy = true;
    this.onBusyChange(true);
    const generation: number = this.generation;
    try {
      // 显式声明类型：ArkTS 不允许未加标注的对象字面量（arkts-no-untyped-obj-literals）。
      const request: StaffRegisterRequest = {
        code: code,
        idempotencyKey: this.idempotencyKey,
        realName: realName,
        qq: qq,
        phone: phone,
        password: password,
        passwordConfirmation: confirmation,
        rememberMe: this.rememberMe
      };
      // 选填字段留空时不带键：避免把「没填」提交成「填了一个空值」。
      if (studentId !== '') {
        request.studentId = studentId;
      }
      if (className !== '') {
        request.className = className;
      }
      const identity = await SessionService.registerStaff(request);
      if (generation !== this.generation) return;
      // 成功：换一个新键，让下一次注册是新的一份表单。
      this.idempotencyKey = `app-${util.generateRandomUUID(true)}`;
      this.onRegistered(identity);
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof ApiRequestError) {
        if (isSessionExpiredCode(error.code)) {
          this.onSessionExpired();
          return;
        }
        if (error.code === 'VALIDATION_FAILED') {
          this.fieldErrors = this.readServerFieldErrors(error);
        }
        this.errorText = staffRegisterErrorText(error);
      } else {
        this.errorText = '注册失败，请重试';
      }
      this.failed = true;
    } finally {
      if (generation === this.generation) {
        this.busy = false;
      }
      // 对父级的上报刻意**无条件**：注册成功后本页会被 pop，aboutToDisappear 已递增 generation，
      // 上面受 generation 保护的 this.busy = false 会被跳过；但父级的 registerBusy 必须复位，
      // 否则下一个注册页（乃至下一次进入本页）的返回键会被永久错误拦截。
      this.onBusyChange(false);
    }
  }

  build() {
    Scroll() {
      Column({ space: GAP_LG }) {
        Column({ space: GAP_SM }) {
          Text('工作人员注册')
            .fontSize(FONT_SUBTITLE)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.text_primary'))
          Text('需有效邀请码；注册成功即成为工作人员（MEMBER）并进入工作人员入口。')
            .fontSize(FONT_NOTE)
            .fontColor($r('app.color.text_secondary'))
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)

        Column({ space: CARD_GAP }) {
          LabeledInput({
            label: '邀请码',
            placeholder: '管理员发放的邀请码',
            text: $$this.code,
            disabled: this.busy,
            maxLength: 64,
            errorText: this.fieldError('code'),
            onChange: (value: string): void => { this.code = value; }
          })
          LabeledInput({
            label: '姓名',
            placeholder: '真实姓名（2–64 字）',
            text: $$this.realName,
            disabled: this.busy,
            errorText: this.fieldError('realName'),
            onChange: (value: string): void => { this.realName = value; }
          })
          LabeledInput({
            label: 'QQ 号',
            placeholder: '5–11 位数字',
            text: $$this.qq,
            inputType: InputType.Number,
            maxLength: 11,
            disabled: this.busy,
            errorText: this.fieldError('qq'),
            onChange: (value: string): void => { this.qq = value; }
          })
          LabeledInput({
            label: '手机号',
            placeholder: '11 位手机号',
            text: $$this.phone,
            inputType: InputType.Number,
            maxLength: 11,
            disabled: this.busy,
            errorText: this.fieldError('phone'),
            onChange: (value: string): void => { this.phone = value; }
          })
          LabeledInput({
            label: '密码',
            placeholder: '至少 6 位',
            text: $$this.password,
            inputType: InputType.Password,
            disabled: this.busy,
            errorText: this.fieldError('password'),
            onChange: (value: string): void => { this.password = value; }
          })
          LabeledInput({
            label: '确认密码',
            placeholder: '再输入一次密码',
            text: $$this.passwordConfirmation,
            inputType: InputType.Password,
            disabled: this.busy,
            errorText: this.fieldError('passwordConfirmation'),
            onChange: (value: string): void => { this.passwordConfirmation = value; }
          })
          LabeledInput({
            label: '学号（选填）',
            placeholder: '成员档案信息',
            text: $$this.studentId,
            disabled: this.busy,
            maxLength: 32,
            onChange: (value: string): void => { this.studentId = value; }
          })
          LabeledInput({
            label: '班级（选填）',
            placeholder: '成员档案信息',
            text: $$this.className,
            disabled: this.busy,
            maxLength: 64,
            onChange: (value: string): void => { this.className = value; }
          })
          RememberMeSwitch({
            isOn: this.rememberMe,
            disabled: this.busy,
            hint: rememberMeHint(this.rememberMe),
            onChange: (value: boolean): void => { this.rememberMe = value; }
          })
          if (this.errorText !== '') {
            Text(this.errorText)
              .fontSize(FONT_TEXT)
              .fontColor($r('app.color.danger'))
              .width('100%')
              .textAlign(TextAlign.Start)
          }
          SubmitButton({
            text: '注册并进入',
            busyText: '注册中…',
            busy: this.busy,
            failed: this.failed,
            onSubmit: (): void => { this.submit(); }
          })
        }
        .width('100%')
        .padding(CARD_PADDING)
        .backgroundColor($r('app.color.surface'))
        .borderRadius(CARD_RADIUS)

        Column({ space: GAP_SM }) {
          Text('没有邀请码？')
            .fontSize(FONT_NOTE)
            .fontColor($r('app.color.text_secondary'))
          Button('返回登录', { type: ButtonType.Normal })
            .width('100%')
            .height(CONTROL_HEIGHT)
            .backgroundColor(Color.Transparent)
            .fontColor($r('app.color.brand'))
            .enabled(!this.busy)
            .onClick((): void => { this.onCancel(); })
          Text('普通客户请使用「注册账号」入口（无需邀请码），两个入口互不通用。')
            .fontSize(FONT_NOTE)
            .fontColor($r('app.color.text_secondary'))
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .padding(PAGE_PADDING)
      .alignItems(HorizontalAlign.Start)
      .backgroundColor($r('app.color.start_window_background'))
    }
    .width('100%').height('100%').align(Alignment.Top)
    .backgroundColor($r('app.color.start_window_background'))
  }
}
