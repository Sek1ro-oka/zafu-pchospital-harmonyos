import { window } from '@kit.ArkUI';
import { NavigationDemo } from '../features/navigationDemo/NavigationDemo';
/**
 * 隔离 Demo 入口页；生产入口 pages/Index.ets 保持上游原样，由 EntryAbility 加载本页。
 * 系统状态栏配色由 Demo 主动同步：首页金色 Hero 用同色带，其余页面用页面底色，
 * 避免状态栏区域与页面顶部出现白色断层。只调用系统栏配置能力，不涉及业务数据。
 */
@Entry
@Component
struct NavigationDemoEntry {
  @StorageLink('demoBarTone') @Watch('applyStatusBar') barTone: string = 'gold';
  private mainWindow: window.Window | undefined = undefined;

  aboutToAppear(): void {
    const ctx = this.getUIContext().getHostContext();
    if (ctx === undefined) { return; }
    window.getLastWindow(ctx).then((win: window.Window) => {
      this.mainWindow = win;
      this.applyStatusBar();
    }).catch((): void => {
      // 系统栏不可用时保持默认外观，不影响 Demo 其他功能
    });
  }

  applyStatusBar(): void {
    if (this.mainWindow === undefined) { return; }
    this.mainWindow.setWindowSystemBarProperties({
      statusBarColor: this.barTone === 'gold' ? '#FFDD8F' : '#F0F4F7',
      statusBarContentColor: '#000000'
    }).catch((): void => {
    });
  }

  build() {
    Column() { NavigationDemo() }.width('100%').height('100%')
  }
}
