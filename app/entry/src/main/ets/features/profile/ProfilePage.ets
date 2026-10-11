import { HOME_STAFF } from '../../core/auth/AuthContract';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { NavPusher, ROUTE_CASE_LIBRARY, ROUTE_KNOWLEDGE, ROUTE_REPAIR_ORDERS, ROUTE_STAFF_ORDERS, ROUTE_STAFF_REVIEW } from '../../core/ui/Routes';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { QuickEntry } from '../../core/ui/QuickEntry';
import {
  CARD_GAP,
  CARD_PADDING,
  CARD_PADDING_LG,
  CARD_RADIUS,
  CHIP_RADIUS,
  CONTROL_HEIGHT_SM,
  FONT_CHIP,
  FONT_HEADING,
  FONT_NOTE,
  FONT_TEXT,
  FONT_TITLE,
  GAP_LG,
  GAP_SM,
  PAGE_PADDING,
  TAB_PAGE_BOTTOM_INSET,
} from '../../core/ui/Theme';
import { isNetworkErrorCode } from '../knowledge/KnowledgeFlow';
import { RepairOrderView, REPAIR_ORDER_COMPLETED, REPAIR_ORDER_ACCEPTED, REPAIR_ORDER_REPAIRING, REPAIR_ORDER_SUBMITTED } from '../repair/RepairOrderContract';
import { RepairOrderService } from '../repair/RepairOrderService';

/** 统计区块的加载状态（与 StatePanel 配套）。 */
const STATS_LOADING: number = 0;
const STATS_READY: number = 1;
const STATS_ERROR: number = 2;

interface ProfileEntry {
  title: string;
  icon: string;
  hue: string;
  route: string;
}

/** 后端默认页大小（与 RepairOrdersPage 一致），用于统计口径说明。 */
const PAGE_SIZE: number = 20;

/**
 * 我的 tab（本轮重设计，参考 docs/reference/my-huawei/my-account-service-record-entry.jpg）。
 *
 * - 白色个人卡：圆形头像取姓名首字符（UI 元素，非业务数据），
 *   姓名与角色 chip 来自 SessionService 传递的真实身份，退出按钮逻辑与原 SessionHeader 相同。
 * - 统计行：报修单计数来自 RepairOrderService 本人列表（最近一页），
 *   加载失败如实显示，不用假数字。
 * - 「我的信息」入口网格：四列图标卡，样式对照参考图；
 *   工作人员登录时换成工作人员工作台等入口，双角色保持。
 */
@Component
export struct ProfilePage {
  @Prop displayName: string = '';
  @Prop roleText: string = '';
  @Prop home: string = '';
  @Prop permissions: string[] = [];
  pathStack: NavPathStack = new NavPathStack();
  onLogout: () => Promise<void> = async () => {
  };
  onSessionExpired: () => void = () => {
  };
  private pusher: NavPusher = new NavPusher();
  @State statsState: number = STATS_LOADING;
  @State totalCount: number = 0;
  @State pendingCount: number = 0;
  @State completedCount: number = 0;
  @State statsErrorText: string = '';
  @State logoutBusy: boolean = false;
  private requesting: boolean = false;

  aboutToAppear(): void {
    if (this.home !== HOME_STAFF) {
      this.loadStats();
    }
  }

  private handleError(error: Object): void {
    if (error instanceof ApiRequestError) {
      if (isSessionExpiredCode(error.code)) {
        this.onSessionExpired();
        return;
      }
      this.statsErrorText = isNetworkErrorCode(error.code)
        ? `${error.message}（请检查服务器地址、网络与后端是否已启动）`
        : error.message;
    } else {
      this.statsErrorText = '加载失败，请重试';
    }
  }

  private async loadStats(): Promise<void> {
    if (this.requesting) {
      return;
    }
    this.requesting = true;
    this.statsState = STATS_LOADING;
    this.statsErrorText = '';
    try {
      const items = await RepairOrderService.listMine('', 1);
      this.totalCount = items.length;
      this.completedCount = items.filter((order: RepairOrderView) => order.status === REPAIR_ORDER_COMPLETED).length;
      this.pendingCount = items.filter((order: RepairOrderView) =>
        order.status === REPAIR_ORDER_SUBMITTED || order.status === REPAIR_ORDER_ACCEPTED || order.status === REPAIR_ORDER_REPAIRING).length;
      this.statsState = STATS_READY;
    } catch (error) {
      this.statsState = STATS_ERROR;
      this.handleError(error);
    } finally {
      this.requesting = false;
    }
  }

  private customerEntries(): ProfileEntry[] {
    return [
      { title: '我的报修', icon: '修', hue: 'orange', route: ROUTE_REPAIR_ORDERS },
      { title: '知识问答', icon: '问', hue: 'blue', route: ROUTE_KNOWLEDGE },
      { title: '服务记录', icon: '录', hue: 'green', route: ROUTE_REPAIR_ORDERS }
    ];
  }

  /** 审核入口按服务器权限展示，实际业务权限仍由服务端检查。 */
  private staffEntries(): ProfileEntry[] {
    const entries: ProfileEntry[] = [
      { title: '工作人员工作台', icon: '单', hue: 'purple', route: ROUTE_STAFF_ORDERS }
    ];
    if (this.permissions.includes('repair:review')) {
      entries.push({ title: '备案审核', icon: '审', hue: 'red', route: ROUTE_STAFF_REVIEW });
    }
    entries.push({ title: '典型案例库', icon: '例', hue: 'gold', route: ROUTE_CASE_LIBRARY });
    entries.push({ title: '知识问答', icon: '问', hue: 'blue', route: ROUTE_KNOWLEDGE });
    return entries;
  }

  private async handleLogout(): Promise<void> {
    if (this.logoutBusy) {
      return;
    }
    this.logoutBusy = true;
    try {
      await this.onLogout();
    } finally {
      this.logoutBusy = false;
    }
  }

  @Builder
  sectionTitle(text: string) {
    Text(text)
      .fontSize(FONT_HEADING)
      .fontWeight(FontWeight.Bold)
      .fontColor($r('app.color.text_primary'))
      .width('100%')
      .textAlign(TextAlign.Start)
  }

  @Builder
  statCell(label: string, value: number) {
    Column({ space: GAP_SM }) {
      Text(`${value}`)
        .fontSize(FONT_HEADING)
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.text_primary'))
      Text(label)
        .fontSize(FONT_NOTE)
        .fontColor($r('app.color.text_secondary'))
    }
    .layoutWeight(1)
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  profileCard() {
    Row({ space: CARD_GAP }) {
      // 圆形头像：取姓名首字符，是界面元素而不是服务端数据。
      Text(this.displayName === '' ? '客' : this.displayName.substring(0, 1))
        .fontSize(FONT_TITLE)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.brand'))
        .width(64)
        .height(64)
        .textAlign(TextAlign.Center)
        .backgroundColor($r('app.color.brand_soft'))
        .borderRadius(32)
      Column({ space: GAP_SM }) {
        Text(this.displayName === '' ? '未命名用户' : this.displayName)
          .fontSize(FONT_HEADING)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(this.roleText)
          .fontSize(FONT_CHIP)
          .fontColor($r('app.color.brand'))
          .padding({ left: GAP_SM, right: GAP_SM, top: 2, bottom: 2 })
          .backgroundColor($r('app.color.brand_soft'))
          .borderRadius(CHIP_RADIUS)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Button(this.logoutBusy ? '退出中…' : '退出')
        .fontSize(FONT_TEXT)
        .height(CONTROL_HEIGHT_SM)
        .backgroundColor($r('app.color.brand_soft'))
        .fontColor($r('app.color.brand'))
        .enabled(!this.logoutBusy)
        .onClick(() => {
          this.handleLogout();
        })
    }
    .width('100%')
    .padding(CARD_PADDING)
    .alignItems(VerticalAlign.Center)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
  }

  @Builder
  statsSection() {
    if (this.statsState === STATS_LOADING) {
      LoadingPanel({ text: '正在加载报修统计…' })
    } else if (this.statsState === STATS_ERROR) {
      ErrorPanel({
        message: this.statsErrorText,
        onRetry: (): void => {
          this.loadStats();
        }
      })
    } else {
      if (this.totalCount === 0) {
        Text('最近一页暂无报修记录，可从下方「我的报修」提交。')
          .fontSize(FONT_NOTE)
          .fontColor($r('app.color.text_secondary'))
      }
      Row({ space: CARD_GAP }) {
        this.statCell('报修单', this.totalCount)
        this.statCell('已完结', this.completedCount)
        this.statCell('处理中', this.pendingCount)
      }
      .width('100%')
      .padding(CARD_PADDING)
      .backgroundColor($r('app.color.surface'))
      .borderRadius(CARD_RADIUS)
      .alignItems(VerticalAlign.Center)
    }
  }

  build() {
    Scroll() {
      Column({ space: GAP_LG }) {
        // 我的 tab 自带大标题（不再作为 NavDestination 子页）。
        Text('我的')
          .fontSize(FONT_TITLE)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.text_primary'))
          .width('100%')
          .textAlign(TextAlign.Start)

        this.profileCard()

        if (this.home !== HOME_STAFF) {
        this.sectionTitle('最近报修统计')
        this.statsSection()
        Text(`统计口径：最近一页本人报修单（最多 ${PAGE_SIZE} 条），不是全部报修总数；已取消单不计入处理中。`)
          .fontSize(FONT_NOTE)
          .fontColor($r('app.color.text_secondary'))
          .width('100%')
          .textAlign(TextAlign.Start)
        Button('刷新统计')
          .enabled(!this.requesting)
          .onClick(() => { this.loadStats(); })
        }

        this.sectionTitle('我的信息')
        Column({ space: GAP_LG }) {
          Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
            ForEach(this.home === HOME_STAFF ? this.staffEntries() : this.customerEntries(), (entry: ProfileEntry) => {
              QuickEntry({
                icon: entry.icon,
                title: entry.title,
                hue: entry.hue,
                onSelect: (): void => {
                  this.pusher.push(this.pathStack, entry.route, null);
                }
              });
            }, (entry: ProfileEntry) => entry.title + entry.route)
          }
          .width('100%')
          Text(this.home === HOME_STAFF
            ? '工作人员入口：工作台处理待受理与推进，审核入口按服务器权限展示。'
            : '服务记录与我的报修进入同一页：列表、进度与提交都在「我的报修」。')
            .fontSize(FONT_NOTE)
            .fontColor($r('app.color.text_secondary'))
            .width('100%')
            .textAlign(TextAlign.Start)
        }
        .width('100%')
        .padding(CARD_PADDING)
        .backgroundColor($r('app.color.surface'))
        .borderRadius(CARD_RADIUS)
      }
      .width('100%')
      .padding({
        left: PAGE_PADDING,
        right: PAGE_PADDING,
        top: PAGE_PADDING,
        bottom: TAB_PAGE_BOTTOM_INSET
      })
      .alignItems(HorizontalAlign.Start)
    }
    .scrollable(ScrollDirection.Vertical)
    .scrollBar(BarState.Off)
    .width('100%')
    .height('100%')
    .align(Alignment.Top)
    .backgroundColor($r('app.color.start_window_background'))
  }
}
