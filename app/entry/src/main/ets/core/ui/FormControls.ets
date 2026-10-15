import {
  CARD_GAP,
  CONTROL_RADIUS,
  FONT_NOTE,
  GAP_SM,
} from './Theme';

/**
 * 表单原语（Issue #60 第三批：注册与改密页共用）。
 *
 * 单独抽出来是因为三张新页面（客户注册 / 邀请码注册工作人员 / 原生改密）的
 * 输入框、保持登录开关与提交按钮是同一套视觉与同一套状态语义：
 * - 输入框统一样式（field_bg + CONTROL_RADIUS），标签在上、错误在下；
 * - 提交按钮请求中禁用 + 转圈，防重复提交；
 * - 保持登录开关三处共用同一份文案与说明（见 AuthContract 的常量）。
 *
 * 只放「纯展示 + 回调」的组件，不在这里写任何请求逻辑。
 */

/** 带标签的输入框：label 在上，placeholder 提示，errorText 非空时在框下显示错误。 */
@Component
export struct LabeledInput {
  @Prop label: string = '';
  @Prop placeholder: string = '';
  /** Parent state is passed one way; onChange writes edits back to the parent. */
  @Prop text: string = '';
  /** 输入类型：密码 / 数字等，默认普通文本。 */
  inputType: InputType = InputType.Normal;
  /** 禁用：请求进行中时输入框一并禁用，避免用户在等待期间改动已提交的内容。 */
  @Prop disabled: boolean = false;
  @Prop errorText: string = '';
  /** 键盘类型：数字键盘用于 QQ / 手机号。 */
  @Prop maxLength: number = 64;
  onChange: (value: string) => void = (value: string): void => {
  };

  build() {
    Column({ space: GAP_SM }) {
      Text(this.label)
        .fontSize(FONT_NOTE)
        .fontColor($r('app.color.text_secondary'))
        .width('100%')
        .textAlign(TextAlign.Start)
      TextInput({ text: this.text, placeholder: this.placeholder })
        .type(this.inputType)
        .maxLength(this.maxLength)
        .enabled(!this.disabled)
        .height(48)
        .backgroundColor($r('app.color.field_bg'))
        .borderRadius(CONTROL_RADIUS)
        .onChange((value: string) => {
          this.onChange(value);
        })
      if (this.errorText !== '') {
        Text(this.errorText)
          .fontSize(FONT_NOTE)
          .fontColor($r('app.color.danger'))
          .width('100%')
          .textAlign(TextAlign.Start)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}

/**
 * 保持登录开关（rememberMe）。
 *
 * 缺省不勾选 = 普通档位（24 小时），勾选 = 30 天 —— 与登录 / 注册 / 改密
 * 三处完全一致（契约：`false` / 缺省都是 24 小时，只有显式 `true` 才是 30 天）。
 * 说明文案按勾选状态切换，让用户在提交前就知道这次会话能撑多久。
 *
 * 注意：这里用普通 `@Prop` + 回调而不是 `@Link`。父组件多是 `@State`，
 * 把 `@State` 直接传给 `@Link` 会触发「'regular' property cannot be assigned
 * to the '@Link' property」警告； ArkTS 的双向绑定要求父侧也用 `$$` 传递，
 * 表单里统一走回调更直白，也避免为一个小开关把父字段改成 `@Link`。
 */
@Component
export struct RememberMeSwitch {
  /** 当前是否勾选。 */
  @Prop isOn: boolean = false;
  @Prop disabled: boolean = false;
  /** 说明文字：调用方传入（登录/注册/改密的措辞不同）。 */
  @Prop hint: string = '';
  onChange: (value: boolean) => void = (value: boolean): void => {
  };

  build() {
    Row({ space: GAP_SM }) {
      Toggle({ type: ToggleType.Switch, isOn: this.isOn })
        .selectedColor($r('app.color.brand'))
        .enabled(!this.disabled)
        .onChange((value: boolean) => {
          this.onChange(value);
        })
      Column({ space: 2 }) {
        Text('保持登录（30 天）')
          .fontSize(FONT_NOTE)
          .fontColor($r('app.color.text_primary'))
        if (this.hint !== '') {
          Text(this.hint)
            .fontSize(FONT_NOTE)
            .fontColor($r('app.color.text_secondary'))
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
  }
}

/**
 * 表单提交按钮：请求中禁用 + 转圈，文案在「提交 / 重试 / 提交中」之间切换。
 *
 * 与既有页面同一套约定：失败后按钮文案变成「重试…」，用户一眼能看到重试入口。
 */
@Component
export struct SubmitButton {
  /** 主文案，如「注册账号」。 */
  @Prop text: string = '';
  @Prop busyText: string = '';
  @Prop busy: boolean = false;
  /** 失败过一次：文案切成「重试…」。 */
  @Prop failed: boolean = false;
  onSubmit: () => void = () => {
  };

  build() {
    Button() {
      Row({ space: CARD_GAP }) {
        if (this.busy) {
          LoadingProgress()
            .width(18)
            .height(18)
            .color(Color.White)
        }
        Text(this.busy ? this.busyText : (this.failed ? `重试${this.text}` : this.text))
          .fontSize(16)
          .fontColor(Color.White)
      }
    }
    .width('100%')
    .height(48)
    .backgroundColor($r('app.color.brand'))
    .enabled(!this.busy)
    .onClick(() => {
      this.onSubmit();
    })
  }
}
