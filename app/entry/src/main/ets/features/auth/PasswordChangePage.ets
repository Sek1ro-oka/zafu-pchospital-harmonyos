import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { SessionService } from '../../core/auth/SessionService';
import { passwordChangeErrorText, passwordLifetimeHint } from '../../core/auth/AuthMessages';
import {
  PASSWORD_LIFETIME_KEEP,
  PASSWORD_LIFETIME_SHORT,
  PASSWORD_LIFETIME_LONG,
  PasswordChangeData,
  PasswordChangeRequest,
} from '../../core/auth/AuthContract';
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
import { LabeledInput, SubmitButton } from '../../core/ui/FormControls';

/**
 * 原生修改密码页（Issue #60 第三批）：`POST /api/v1/auth/native/password/change`。
 *
 * 契约要点：
 * - 普通改密与**首次/强制改密共用这一个入口**；强制改密账号（`mustChangePassword = true`）
 *   进主页时会被引导到这里，因为其它业务接口对它一律 `403 PASSWORD_CHANGE_REQUIRED`；
 * - 成功即**轮换令牌**：旧令牌失效，本页通过 `SessionService.changePassword`
 *   把新令牌覆盖写回本地存储（保存失败走 `LOCAL_STORAGE_ERROR`，不展示成功）；
 * - 失败不含令牌、不产生新会话、不改动当前口令，用户可以原样重试；
 * - **没有**「新密码不得与当前密码相同」这条规则（Web 端也没有），
 *   因此这里不做该限制，也不为它发明错误码 —— 客户端不比服务端更严。
 *
 * 档位开关三态：`keep` = 省略 `rememberMe`，沿用当前会话档位（不升不降）；
 * `short` / `long` = 显式提交 24 小时 / 30 天。缺省 `keep`，
 * 这样 30 天账号不会因为一次改密被偷偷降成 24 小时。
 */
@Component
export struct PasswordChangePage {
  /** 改密成功（新令牌已保存）：上层据此刷新页面状态并离开本页。 */
  onChanged: (data: PasswordChangeData) => void = () => {};
  /** 取消：非强制改密账号可以返回；强制改密账号由上层禁用返回。 */
  onCancel: () => void = () => {};
  /** 会话失效（401 类）时通知上层走统一登出路径。 */
  onSessionExpired: () => void = () => {};
  /**
   * 请求中状态上报（与 `LoginPage` / 两个注册页同一契约）。
   *
   * 为什么必须有：普通改密（非强制）在途时用户本来可以用返回键离开本页，而迟到的
   * 响应会把令牌写成这个被放弃的账号（账号串用）。`SessionService` 侧现在有代次
   * 校验兜底，页面侧再拦一次返回键是代价最小的一道防线 —— 页面还在，迟到的响应
   * 写的正是它自己。
   */
  onBusyChange: (busy: boolean) => void = () => {};
  /** 强制改密账号：true 时不允许跳过（契约：必须先改密才能用业务接口）。 */
  @Prop forced: boolean = false;
  @State currentPassword: string = '';
  @State newPassword: string = '';
  @State newPasswordConfirmation: string = '';
  /** 档位开关：缺省沿用当前会话档位。 */
  @State lifetime: string = PASSWORD_LIFETIME_KEEP;
  @State busy: boolean = false;
  @State errorText: string = '';
  @State failed: boolean = false;
  @State fieldErrors: Record<string, string> = {};
  private generation: number = 0;

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
    const current: string = this.currentPassword;
    const next: string = this.newPassword;
    const confirmation: string = this.newPasswordConfirmation;
    this.fieldErrors = {};
    this.errorText = '';
    if (current === '' || next === '' || confirmation === '') {
      this.errorText = '请填写当前密码、新密码与确认新密码';
      return;
    }
    if (next !== confirmation) {
      // ArkTS 不允许未加标注的对象字面量：字段级错误用显式声明的 map 承载。
      const errors: Record<string, string> = {};
      errors.newPasswordConfirmation = '两次输入的新密码不一致';
      this.fieldErrors = errors;
      return;
    }
    if (next.length < 6) {
      const errors: Record<string, string> = {};
      errors.newPassword = '新密码至少 6 位';
      this.fieldErrors = errors;
      return;
    }
    this.busy = true;
    this.onBusyChange(true);
    const generation: number = this.generation;
    try {
      // 显式声明类型：ArkTS 不允许未加标注的对象字面量（arkts-no-untyped-obj-literals）。
      const request: PasswordChangeRequest = {
        currentPassword: current,
        newPassword: next,
        newPasswordConfirmation: confirmation
      };
      // 三态档位：keep 时**不带这个键**，服务端沿用当前会话的选择。
      if (this.lifetime === PASSWORD_LIFETIME_SHORT) {
        request.rememberMe = false;
      } else if (this.lifetime === PASSWORD_LIFETIME_LONG) {
        request.rememberMe = true;
      }
      const data = await SessionService.changePassword(request);
      if (generation !== this.generation) return;
      // 新令牌已由 SessionService 覆盖写回本地；清空输入框，避免旧口令残留在界面上。
      this.currentPassword = '';
      this.newPassword = '';
      this.newPasswordConfirmation = '';
      this.onChanged(data);
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof ApiRequestError) {
        if (isSessionExpiredCode(error.code)) {
          this.onSessionExpired();
          return;
        }
        // `LOCAL_STORAGE_ERROR`：密码**已经改成功**、新令牌只是本地没存下（SessionService 已撤销
        // 新会话并清空本地令牌）。此时停在原页让用户「原样重试」是错的 —— 当前口令已失效、
        // 也没有会话可用。它不在 isSessionExpiredCode 里（那是服务端会话失效码），
        // 所以必须显式分支，交给上层导回登录页，这才是唯一正确的终态。
        if (error.code === 'LOCAL_STORAGE_ERROR') {
          this.onSessionExpired();
          return;
        }
        // `SESSION_CHANGED`：响应本身没错，是**归属**变了（请求在途期间退出 / 换账号 /
        // 恢复了会话），SessionService 因此丢弃了这份响应里的令牌。但服务端在返回之前
        // 就已经提交了改密：**密码已经是新的**，旧口令在服务端不复存在，本地也不再持有
        // 属于当前会话的令牌。所以它和 `LOCAL_STORAGE_ERROR` 是同一类终态 —— 停在原页让
        // 用户「原样重试」或者拿旧密码重登都是错的，必须导回登录页用**新**密码登录。
        // 它刻意不进 `isSessionExpiredCode`（那是「令牌失效」语义，与「归属已变」不同），
        // 故这里显式分支。注意仍然不得走 onChanged：否则会收起登录栈、续接到别人的意图上。
        if (error.code === 'SESSION_CHANGED') {
          this.onSessionExpired();
          return;
        }
        if (error.code === 'VALIDATION_FAILED') {
          this.fieldErrors = this.readServerFieldErrors(error);
        }
        this.errorText = passwordChangeErrorText(error);
      } else {
        this.errorText = '修改失败，请重试';
      }
      this.failed = true;
    } finally {
      if (generation === this.generation) {
        this.busy = false;
      }
      // 对父级的上报刻意**无条件**（与两个注册页一致）：改密成功后本页会被 pop，
      // aboutToDisappear 已递增 generation，上面受代次保护的 this.busy = false 会被跳过；
      // 但父级的 passwordChangeBusy 必须复位，否则下一个改密页的返回键会被永久错误拦截。
      this.onBusyChange(false);
    }
  }

  /**
   * 档位单选：只在**选中**时写回。
   *
   * Radio 的 `onChange` 会带 `isChecked`，切换单选时旧项也会触发一次 `onChange(false)`（取消选中）；
   * 若不看这个参数就把 `value` 写回，旧档位会被「取消选中」事件重新选中，
   * 最终档位取决于两个回调的先后顺序（不确定）。
   *
   * 抽成普通方法而不是写在 @Builder 的内联箭头里：@Builder 不被后端 eval 回归覆盖，
   * 抽出来才能测到这条竞态。
   */
  private selectLifetime(value: string, isChecked: boolean): void {
    if (isChecked) {
      this.lifetime = value;
    }
  }

  @Builder
  lifetimeRow(value: string, label: string) {
    Row({ space: GAP_SM }) {
      Radio({ value: value, group: 'password-lifetime' })
        .checked(this.lifetime === value)
        .enabled(!this.busy)
        .onChange((isChecked: boolean): void => { this.selectLifetime(value, isChecked); })
      Text(label)
        .fontSize(FONT_NOTE)
        .fontColor($r('app.color.text_primary'))
        .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
  }

  build() {
    Scroll() {
      Column({ space: GAP_LG }) {
        Column({ space: GAP_SM }) {
          Text(this.forced ? '请先修改初始密码' : '修改密码')
            .fontSize(FONT_SUBTITLE)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.text_primary'))
          Text(this.forced
            ? '当前账号使用初始密码，必须先修改才能使用报修、知识问答等业务功能。'
            : '修改成功后当前所有设备的登录都会失效，需要用新密码重新登录。')
            .fontSize(FONT_NOTE)
            .fontColor($r('app.color.text_secondary'))
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)

        Column({ space: CARD_GAP }) {
          LabeledInput({
            label: '当前密码',
            placeholder: '当前登录密码',
            text: this.currentPassword,
            inputType: InputType.Password,
            disabled: this.busy,
            onChange: (value: string): void => { this.currentPassword = value; }
          })
          LabeledInput({
            label: '新密码',
            placeholder: '至少 6 位',
            text: this.newPassword,
            inputType: InputType.Password,
            disabled: this.busy,
            errorText: this.fieldError('newPassword'),
            onChange: (value: string): void => { this.newPassword = value; }
          })
          LabeledInput({
            label: '确认新密码',
            placeholder: '再输入一次新密码',
            text: this.newPasswordConfirmation,
            inputType: InputType.Password,
            disabled: this.busy,
            errorText: this.fieldError('newPasswordConfirmation'),
            onChange: (value: string): void => { this.newPasswordConfirmation = value; }
          })

          Column({ space: GAP_SM }) {
            Text('会话有效期')
              .fontSize(FONT_NOTE)
              .fontColor($r('app.color.text_secondary'))
              .width('100%')
              .textAlign(TextAlign.Start)
            this.lifetimeRow(PASSWORD_LIFETIME_KEEP, '沿用当前会话有效期')
            this.lifetimeRow(PASSWORD_LIFETIME_SHORT, '普通档位（24 小时）')
            this.lifetimeRow(PASSWORD_LIFETIME_LONG, '保持登录（30 天）')
            Text(passwordLifetimeHint(this.lifetime))
              .fontSize(FONT_NOTE)
              .fontColor($r('app.color.text_secondary'))
              .width('100%')
              .textAlign(TextAlign.Start)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)

          if (this.errorText !== '') {
            Text(this.errorText)
              .fontSize(FONT_TEXT)
              .fontColor($r('app.color.danger'))
              .width('100%')
              .textAlign(TextAlign.Start)
          }
          SubmitButton({
            text: '确认修改',
            busyText: '修改中…',
            busy: this.busy,
            failed: this.failed,
            onSubmit: (): void => { this.submit(); }
          })
          if (!this.forced) {
            Button('暂不修改', { type: ButtonType.Normal })
              .width('100%')
              .height(CONTROL_HEIGHT)
              .backgroundColor(Color.Transparent)
              .fontColor($r('app.color.text_secondary'))
              .enabled(!this.busy)
              .onClick((): void => { this.onCancel(); })
          }
        }
        .width('100%')
        .padding(CARD_PADDING)
        .backgroundColor($r('app.color.surface'))
        .borderRadius(CARD_RADIUS)
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
