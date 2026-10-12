import { common } from '@kit.AbilityKit';
import { roleLabelFor, SessionIdentity } from '../core/auth/AuthContract';
import { SessionService } from '../core/auth/SessionService';
import { ApiConfig } from '../core/network/ApiConfig';
import { FONT_BODY, FONT_DISPLAY, GAP_LG, PAGE_PADDING } from '../core/ui/Theme';
import { HomePage } from '../features/home/HomePage';

const PHASE_BOOT: number = 0;
const PHASE_HOME: number = 2;

/**
 * 应用根页面：启动恢复会话 → 已登录主页 / 游客主页。
 * 启动时用本地令牌向服务器验证身份；失效进入游客主页，网络不可达也不阻止公共浏览。
 */
@Entry
@Component
struct Index {
  @State phase: number = PHASE_BOOT;
  @State authenticated: boolean = false;
  @State displayName: string = '';
  @State roleText: string = '';
  @State home: string = '';
  @State permissions: string[] = [];
  @State bootText: string = '正在启动…';

  aboutToAppear(): void {
    this.boot();
  }

  private async boot(): Promise<void> {
    this.phase = PHASE_BOOT;
    this.bootText = '正在启动…';
    try {
      const context = this.getUIContext().getHostContext() as common.Context;
      await ApiConfig.loadSaved(context);
      const result = await SessionService.restore();
      if (result.unavailableReason !== '') {
        this.applyGuest();
        return;
      }
      const identity = result.identity;
      if (identity === null) {
        this.applyGuest();
        return;
      }
      this.applyIdentity(identity);
    } catch (error) {
      // 网络或本地存储故障不应把公共首页锁住；不把未验证身份当作已登录。
      this.applyGuest();
    }
  }

  private applyGuest(): void {
    this.authenticated = false;
    this.displayName = '';
    this.roleText = '';
    this.home = '';
    this.permissions = [];
    this.phase = PHASE_HOME;
  }

  private applyIdentity(identity: SessionIdentity): void {
    const name = identity.displayName === null || identity.displayName === '' ? identity.userId : identity.displayName;
    this.displayName = name;
    this.roleText = roleLabelFor(identity.roles);
    this.home = identity.home;
    this.permissions = identity.permissions;
    this.authenticated = true;
    this.phase = PHASE_HOME;
  }

  private async handleLogout(): Promise<void> {
    await SessionService.logout();
    this.applyGuest();
  }

  /**
   * 子页面发现会话失效（401 类错误码）时清除身份。
   * 走 `logout()` 而不是直接改 phase：让服务端令牌与本地存储一起清干净，
   * 否则本地残留的失效令牌会让下次启动又白跑一次恢复流程。
   */
  private async handleSessionExpired(): Promise<void> {
    await SessionService.logout();
    this.applyGuest();
  }

  @Builder
  bootView() {
    Column({ space: GAP_LG }) {
      Text('鸿蒙电脑医院')
        .fontSize(FONT_DISPLAY)
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.text_primary'))
      LoadingProgress().width(36).height(36).color($r('app.color.brand'))
      Text(this.bootText).fontSize(FONT_BODY).fontColor($r('app.color.text_secondary'))
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
    } else {
      HomePage({
        authenticated: this.authenticated,
        onLoggedIn: (identity: SessionIdentity): void => { this.applyIdentity(identity); },
        displayName: this.displayName,
        roleText: this.roleText,
        home: this.home,
        permissions: this.permissions,
        onLogout: () => this.handleLogout(),
        onSessionExpired: () => this.handleSessionExpired()
      })
    }
  }
}
