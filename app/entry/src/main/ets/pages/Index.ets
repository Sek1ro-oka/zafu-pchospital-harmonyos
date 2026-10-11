import { common } from '@kit.AbilityKit';
import { roleLabelFor, SessionIdentity } from '../core/auth/AuthContract';
import { SessionService } from '../core/auth/SessionService';
import { ApiRequestError } from '../core/network/ApiClient';
import { ApiConfig } from '../core/network/ApiConfig';
import { CONTROL_HEIGHT_MD, FONT_BODY, FONT_DISPLAY, FONT_TEXT, GAP_LG, PAGE_PADDING } from '../core/ui/Theme';
import { LoginPage } from '../features/auth/LoginPage';
import { HomePage } from '../features/home/HomePage';

const PHASE_BOOT: number = 0;
const PHASE_LOGIN: number = 1;
const PHASE_HOME: number = 2;

/**
 * 应用根页面：启动恢复会话 → 登录页 / 主页。
 * 启动时用本地令牌向服务器验证身份；失效回登录页，网络不可达可重试。
 */
@Entry
@Component
struct Index {
  @State phase: number = PHASE_BOOT;
  @State displayName: string = '';
  @State roleText: string = '';
  @State home: string = '';
  @State bootText: string = '正在恢复登录状态…';
  @State bootFailed: boolean = false;

  aboutToAppear(): void {
    this.boot();
  }

  private async boot(): Promise<void> {
    this.phase = PHASE_BOOT;
    this.bootFailed = false;
    this.bootText = '正在恢复登录状态…';
    try {
      const context = this.getUIContext().getHostContext() as common.Context;
      await ApiConfig.loadSaved(context);
      const result = await SessionService.restore();
      if (result.unavailableReason !== '') {
        this.bootFailed = true;
        this.bootText = result.unavailableReason;
        return;
      }
      const identity = result.identity;
      if (identity === null) {
        this.phase = PHASE_LOGIN;
        return;
      }
      this.applyIdentity(identity);
    } catch (error) {
      this.bootFailed = true;
      this.bootText = error instanceof ApiRequestError ? error.message : '启动失败，请重试';
    }
  }

  private applyIdentity(identity: SessionIdentity): void {
    const name = identity.displayName === null || identity.displayName === '' ? identity.userId : identity.displayName;
    this.displayName = name;
    this.roleText = roleLabelFor(identity.roles);
    this.home = identity.home;
    this.phase = PHASE_HOME;
  }

  private async handleLogout(): Promise<void> {
    await SessionService.logout();
    this.phase = PHASE_LOGIN;
  }

  /**
   * 子页面发现会话失效（401 类错误码）时回登录页。
   * 走 `logout()` 而不是直接改 phase：让服务端令牌与本地存储一起清干净，
   * 否则本地残留的失效令牌会让下次启动又白跑一次恢复流程。
   */
  private async handleSessionExpired(): Promise<void> {
    await SessionService.logout();
    this.phase = PHASE_LOGIN;
  }

  private async resetToLogin(): Promise<void> {
    await SessionService.logout();
    this.bootFailed = false;
    this.phase = PHASE_LOGIN;
  }

  @Builder
  bootView() {
    Column({ space: GAP_LG }) {
      Text('鸿蒙电脑医院')
        .fontSize(FONT_DISPLAY)
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.text_primary'))
      if (this.bootFailed) {
        Text(this.bootText)
          .fontSize(FONT_BODY)
          .fontColor($r('app.color.danger'))
          .width('100%')
          .textAlign(TextAlign.Start)
        Button('重试')
          .height(CONTROL_HEIGHT_MD)
          .backgroundColor($r('app.color.brand'))
          .fontColor(Color.White)
          .onClick(() => {
            this.boot();
          })
        Text('清除本地登录状态并重新登录')
          .fontSize(FONT_TEXT)
          .fontColor($r('app.color.brand'))
          .onClick(() => {
            this.resetToLogin();
          })
      } else {
        LoadingProgress()
          .width(36)
          .height(36)
          .color($r('app.color.brand'))
        Text(this.bootText)
          .fontSize(FONT_BODY)
          .fontColor($r('app.color.text_secondary'))
      }
    }
    .width('100%')
    .height('100%')
    .padding(PAGE_PADDING)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.start_window_background'))
  }

  build() {
    if (this.phase === PHASE_BOOT) {
      this.bootView();
    } else if (this.phase === PHASE_LOGIN) {
      LoginPage({
        onLoggedIn: (identity: SessionIdentity) => {
          this.applyIdentity(identity);
        }
      })
    } else {
      HomePage({
        displayName: this.displayName,
        roleText: this.roleText,
        home: this.home,
        onLogout: () => this.handleLogout(),
        onSessionExpired: () => this.handleSessionExpired()
      })
    }
  }
}
