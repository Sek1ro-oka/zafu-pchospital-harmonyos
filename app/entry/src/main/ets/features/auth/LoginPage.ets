import { common } from '@kit.AbilityKit';
import { SessionIdentity } from '../../core/auth/AuthContract';
import { SessionService } from '../../core/auth/SessionService';
import { ApiRequestError } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { IconTile } from '../../core/ui/IconTile';
import {
  CARD_GAP,
  CARD_PADDING,
  CARD_RADIUS,
  CONTROL_HEIGHT,
  CONTROL_HEIGHT_MD,
  CONTROL_RADIUS,
  FONT_BODY,
  FONT_DISPLAY,
  FONT_NOTE,
  FONT_SUBTITLE,
  FONT_TEXT,
  GAP_LG,
  GAP_SM,
  PAGE_PADDING,
} from '../../core/ui/Theme';

/** 登录页：服务器地址 + QQ + 密码；登录成功把服务端身份交给上层。 */
@Component
export struct LoginPage {
  onLoggedIn: (identity: SessionIdentity) => void = () => {
  };
  @State serverUrl: string = '';
  @State qq: string = '';
  @State password: string = '';
  @State busy: boolean = false;
  /** 地址检测进行中：覆盖「保存地址 + 连接检测」全程，期间按钮禁用防连点。 */
  @State checking: boolean = false;
  @State errorText: string = '';
  @State healthText: string = '';
  @State healthOk: boolean = false;

  aboutToAppear(): void {
    this.serverUrl = ApiConfig.getBaseUrl();
    this.refreshHealth();
  }

  private async applyServerUrl(): Promise<boolean> {
    const context = this.getUIContext().getHostContext() as common.Context;
    const saved = await ApiConfig.save(context, this.serverUrl);
    if (saved === '') {
      this.errorText = '服务器地址无效，请填写如 http://192.168.1.20:13080';
      return false;
    }
    if (this.serverUrl !== saved) {
      this.serverUrl = saved;
    }
    return true;
  }

  private async refreshHealth(): Promise<void> {
    try {
      this.healthText = await SessionService.checkHealth();
      this.healthOk = true;
    } catch (error) {
      this.healthText = error instanceof ApiRequestError ? error.message : '连接检测失败';
      this.healthOk = false;
    }
  }

  private async onServerUrlSubmitted(): Promise<void> {
    if (this.busy || this.checking) {
      return;
    }
    // checking 覆盖保存与检测全程：快速双击只会发出一次检测请求。
    this.checking = true;
    this.errorText = '';
    try {
      if (await this.applyServerUrl()) {
        await this.refreshHealth();
      }
    } finally {
      this.checking = false;
    }
  }

  private async doLogin(): Promise<void> {
    if (this.busy) {
      return;
    }
    const qq = this.qq.trim();
    if (!/^\d{5,11}$/.test(qq)) {
      this.errorText = 'QQ 号应为 5–11 位数字';
      return;
    }
    if (this.password === '') {
      this.errorText = '请输入密码';
      return;
    }
    this.errorText = '';
    this.busy = true;
    try {
      if (!(await this.applyServerUrl())) {
        return;
      }
      const identity = await SessionService.login(qq, this.password);
      this.onLoggedIn(identity);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        // 网络错误补一句排查引导；业务错误（密码错误/账号停用等）直接用后端信封文案。
        if (error.code === 'NETWORK_ERROR') {
          this.errorText = `${error.message}（请检查服务器地址与网络）`;
          this.healthOk = false;
          this.healthText = '连接不可用，请检查服务器地址与网络';
        } else {
          this.errorText = error.message;
        }
      } else {
        this.errorText = '登录失败，请重试';
      }
    } finally {
      this.busy = false;
    }
  }

  @Builder
  fieldLabel(text: string) {
    Text(text)
      .fontSize(FONT_TEXT)
      .fontColor($r('app.color.text_secondary'))
      .width('100%')
      .textAlign(TextAlign.Start)
  }

  build() {
    Column({ space: GAP_LG }) {
      Column({ space: GAP_SM }) {
        // 品牌图标砖：与全局彩色图标系统同一套令牌（纯视觉，不改布局与状态逻辑）。
        IconTile({ icon: '医', hue: 'blue' })
        Text('鸿蒙电脑医院')
          .fontSize(FONT_DISPLAY)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.text_primary'))
        Text('课程实验 · 登录')
          .fontSize(FONT_BODY)
          .fontColor($r('app.color.text_secondary'))
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Column({ space: CARD_GAP }) {
        this.fieldLabel('QQ 号')
        TextInput({ text: $$this.qq, placeholder: '5–11 位数字' })
          .type(InputType.Number)
          .height(CONTROL_HEIGHT)
          .backgroundColor($r('app.color.field_bg'))
          .borderRadius(CONTROL_RADIUS)
        this.fieldLabel('密码')
        TextInput({ text: $$this.password, placeholder: '密码' })
          .type(InputType.Password)
          .height(CONTROL_HEIGHT)
          .backgroundColor($r('app.color.field_bg'))
          .borderRadius(CONTROL_RADIUS)
        if (this.errorText !== '') {
          Text(this.errorText)
            .fontSize(FONT_TEXT)
            .fontColor($r('app.color.danger'))
            .width('100%')
            .textAlign(TextAlign.Start)
        }
        Button() {
          Row({ space: GAP_SM }) {
            if (this.busy) {
              LoadingProgress()
                .width(18)
                .height(18)
                .color(Color.White)
            }
            Text(this.busy ? '登录中…' : (this.errorText !== '' ? '重试登录' : '登录'))
              .fontSize(FONT_SUBTITLE)
              .fontColor(Color.White)
          }
        }
        .width('100%')
        .height(CONTROL_HEIGHT)
        .backgroundColor($r('app.color.brand'))
        .enabled(!this.busy)
        .onClick(() => {
          this.doLogin();
        })
      }
      .width('100%')
      .padding(CARD_PADDING)
      .backgroundColor($r('app.color.surface'))
      .borderRadius(CARD_RADIUS)

      Column({ space: GAP_SM }) {
        this.fieldLabel('服务器地址（手机填电脑局域网 IP:端口）')
        TextInput({ text: $$this.serverUrl, placeholder: 'http://192.168.1.20:13080' })
          .height(CONTROL_HEIGHT)
          .backgroundColor($r('app.color.field_bg'))
          .borderRadius(CONTROL_RADIUS)
          .onSubmit(() => {
            this.onServerUrlSubmitted();
          })
        Row({ space: GAP_SM }) {
          Text('●')
            .fontSize(10)
            .fontColor(this.healthOk && !this.checking ? $r('app.color.ok') : $r('app.color.text_secondary'))
          Text(this.checking || this.healthText === '' ? '正在检测后端连接…' : this.healthText)
            .fontSize(FONT_NOTE)
            .fontColor(this.healthOk && !this.checking ? $r('app.color.ok') : $r('app.color.text_secondary'))
            .layoutWeight(1)
        }
        .width('100%')
        Button(this.checking ? '检测中…' : '保存地址并检测')
          .fontSize(FONT_TEXT)
          .height(CONTROL_HEIGHT_MD)
          .backgroundColor($r('app.color.brand_soft'))
          .fontColor($r('app.color.brand'))
          .enabled(!this.busy && !this.checking)
          .onClick(() => {
            this.onServerUrlSubmitted();
          })
      }
      .width('100%')
      .padding(CARD_PADDING)
      .backgroundColor($r('app.color.surface'))
      .borderRadius(CARD_RADIUS)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .height('100%')
    .padding(PAGE_PADDING)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.start_window_background'))
  }
}
