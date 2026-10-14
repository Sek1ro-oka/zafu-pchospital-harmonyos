import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { SessionIdentity } from '../../core/auth/AuthContract';
import { SessionService } from '../../core/auth/SessionService';
import { customerRegisterErrorText, rememberMeHint } from '../../core/auth/AuthMessages';
import {
  CARD_GAP,
  CARD_PADDING,
  CARD_RADIUS,
  CONTROL_HEIGHT,
  FONT_BODY,
  FONT_NOTE,
  FONT_SUBTITLE,
  FONT_TEXT,
  GAP_LG,
  GAP_SM,
  PAGE_PADDING,
} from '../../core/ui/Theme';
import { LabeledInput, RememberMeSwitch, SubmitButton } from '../../core/ui/FormControls';

/**
 * 客户自主注册页（Issue #60 第三批）：`POST /api/v1/auth/register/customer`。
 *
 * 契约要点（`backend/docs/native-client-api.md`）：
 * - **只产生客户身份**（无角色、无成员档案）；成功即返回会话（注册即登录），
 *   不存在「账号已建但未登录」的中间态，所以成功后直接进客户入口；
 * - 昵称与联系电话不在本入口接收（由个人资料模块补充），服务端生成 `客户<QQ>` 展示名；
 * - 失败是原子的：任何一步回滚，同一个 QQ 重试是安全的（不会拿到 409）。
 *
 * 错误码处理见 `customerRegisterErrorText`：409 引导去登录、两次密码不一致、
 * 429 稍后重试、403 来源校验（原生客户端不伪造 Origin，正常不会遇到）。
 * 字段级 `VALIDATION_FAILED`（QQ 格式 / 口令长度）落到对应输入框下方。
 *
 * 与邀请码注册工作人员页是**两个入口**：本页不读邀请码，也不产生 MEMBER。
 */
@Component
export struct RegisterCustomerPage {
  /** 注册成功：把服务端身份交给上层（上层负责进客户入口与刷新首页）。 */
  onRegistered: (identity: SessionIdentity) => void = () => {};
  /** 取消注册：返回上一页（登录页或游客首页）。 */
  onCancel: () => void = () => {};
  /**
   * 上报「注册写请求进行中」给上层（HomePage 据此拦截系统返回键）。
   * 上层必须知道这个时刻：注册请求已发出但用户按返回离开后，迟到的成功响应
   * 仍会保存令牌并写全局身份，而界面已经在登录别的账号 —— 变成账号串用。
   */
  onBusyChange: (busy: boolean) => void = () => {};
  /** 会话失效时通知上层走统一登出路径。 */
  onSessionExpired: () => void = () => {};
  @State qq: string = '';
  @State password: string = '';
  @State passwordConfirmation: string = '';
  @State rememberMe: boolean = false;
  @State busy: boolean = false;
  @State errorText: string = '';
  @State failed: boolean = false;
  /** 字段级错误：键与后端 fieldErrors 同名（qq / password）。 */
  @State fieldErrors: Record<string, string> = {};
  /** 代次：关闭/切换页面后，迟到的异步响应不得写回本页状态。 */
  private generation: number = 0;

  aboutToDisappear(): void {
    this.generation += 1;
  }

  private fieldError(name: string): string {
    const value: string | undefined = this.fieldErrors[name];
    return value === undefined ? '' : value;
  }

  /** 把服务端 fieldErrors（`Record<string, string[]>`）安全转成本地 map。 */
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
    const qq: string = this.qq.trim();
    const password: string = this.password;
    const confirmation: string = this.passwordConfirmation;
    this.fieldErrors = {};
    this.errorText = '';
    // 本地只拦「明显不合法」：服务端仍是权威，这里让用户少跑一趟。
    if (qq === '' || password === '' || confirmation === '') {
      this.errorText = '请填写 QQ 号、密码与确认密码';
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
      const identity = await SessionService.registerCustomer(qq, password, confirmation, this.rememberMe);
      if (generation !== this.generation) return;
      // 注册即登录：身份里已带 home = CUSTOMER，上层据此进客户入口。
      this.onRegistered(identity);
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof ApiRequestError) {
        // 401/410 类会话失效码：注册本身不带令牌，出现即视为异常，统一走登出路径。
        if (isSessionExpiredCode(error.code)) {
          this.onSessionExpired();
          return;
        }
        if (error.code === 'VALIDATION_FAILED') {
          this.fieldErrors = this.readServerFieldErrors(error);
        }
        this.errorText = customerRegisterErrorText(error);
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
          Text('注册账号')
            .fontSize(FONT_SUBTITLE)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.text_primary'))
          Text('仅需 QQ 号与自设密码，注册后即可提交报修、使用 AI 问诊。')
            .fontSize(FONT_NOTE)
            .fontColor($r('app.color.text_secondary'))
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)

        Column({ space: CARD_GAP }) {
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
          Text('已有账号？')
            .fontSize(FONT_NOTE)
            .fontColor($r('app.color.text_secondary'))
          Button('返回登录', { type: ButtonType.Normal })
            .width('100%')
            .height(CONTROL_HEIGHT)
            .backgroundColor(Color.Transparent)
            .fontColor($r('app.color.brand'))
            .enabled(!this.busy)
            .onClick((): void => { this.onCancel(); })
          Text('工作人员请使用邀请码注册入口（需邀请码），与客户账号区分。')
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
