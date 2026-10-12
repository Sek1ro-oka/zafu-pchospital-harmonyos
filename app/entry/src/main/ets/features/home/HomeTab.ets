import { HOME_STAFF } from '../../core/auth/AuthContract';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { NavPusher, RepairOrderFocusParam, ROUTE_CASE_LIBRARY, ROUTE_KNOWLEDGE, ROUTE_REPAIR_ORDERS, ROUTE_STAFF_ORDERS, ROUTE_STAFF_REVIEW } from '../../core/ui/Routes';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { QuickEntry } from '../../core/ui/QuickEntry';
import { IconTile } from '../../core/ui/IconTile';
import {
  CARD_GAP,
  CARD_PADDING,
  CARD_PADDING_LG,
  CARD_RADIUS,
  CHIP_RADIUS,
  FONT_HEADING,
  FONT_NOTE,
  FONT_SUBTITLE,
  FONT_TITLE,
  GAP_LG,
  GAP_SM,
  PAGE_PADDING,
  TAB_PAGE_BOTTOM_INSET,
} from '../../core/ui/Theme';
import { isNetworkErrorCode } from '../knowledge/KnowledgeFlow';
import { RepairOrderView, REPAIR_ORDER_ACCEPTED, REPAIR_ORDER_REPAIRING, REPAIR_ORDER_SUBMITTED, repairOrderStatusLabel } from '../repair/RepairOrderContract';
import { RepairOrderService } from '../repair/RepairOrderService';

/** 进行中报修区块的加载状态（与 RepairOrdersPage 的四态一致）。 */
const PROGRESS_LOADING: number = 0;
const PROGRESS_READY: number = 1;
const PROGRESS_EMPTY: number = 2;
const PROGRESS_ERROR: number = 3;

interface TabEntry {
  title: string;
  icon: string;
  hue: string;
  route: string;
  ready: boolean;
}

/** 按当前时段返回问候语（取本机时间，纯 UI 文案）。 */
function greetingForNow(): string {
  const hour: number = new Date().getHours();
  if (hour >= 5 && hour < 11) {
    return '上午好';
  }
  if (hour >= 11 && hour < 13) {
    return '中午好';
  }
  if (hour >= 13 && hour < 18) {
    return '下午好';
  }
  return '晚上好';
}

function isPendingStatus(status: string): boolean {
  return status === REPAIR_ORDER_SUBMITTED || status === REPAIR_ORDER_ACCEPTED || status === REPAIR_ORDER_REPAIRING;
}

/**
 * 首页 tab（对照 docs/reference/my-huawei/home-navigation.jpg 的信息层级）。
 *
 * 顶部大标题问候 + 身份 chip；「常用功能」四列白卡网格（图标在上、文字在下，
 * 对照参考图快捷服务区）；客户角色下方用真实报修单展示「进行中的报修」
 * 横向预览卡（RepairOrderService 本人列表数据，点击进我的报修），
 * 无数据如实空态；不放假搜索框、不放假 banner。
 * 工作人员登录时，快捷入口换成工作台入口，双角色保持。
 */
@Component
export struct HomeTab {
  @Prop displayName: string = '';
  @Prop roleText: string = '';
  @Prop home: string = '';
  @Prop permissions: string[] = [];
  /** 由 HomePage 注入的导航栈：统一走 NavPusher 压栈。 */
  pathStack: NavPathStack = new NavPathStack();
  onSessionExpired: () => void = () => {
  };
  private pusher: NavPusher = new NavPusher();
  @State progressState: number = PROGRESS_LOADING;
  @State pendingOrders: RepairOrderView[] = [];
  @State progressErrorText: string = '';
  /** 列表请求进行中标记：防止重试按钮连点触发并发请求。 */
  private requesting: boolean = false;

  aboutToAppear(): void {
    // 工作人员首页不放客户报修数据区，避免把两种对象混在一页。
    if (this.home !== HOME_STAFF) {
      this.loadPending();
    }
  }

  private handleError(error: Object): void {
    if (error instanceof ApiRequestError) {
      if (isSessionExpiredCode(error.code)) {
        this.onSessionExpired();
        return;
      }
      this.progressErrorText = isNetworkErrorCode(error.code)
        ? `${error.message}（请检查服务器地址、网络与后端是否已启动）`
        : error.message;
    } else {
      this.progressErrorText = '加载失败，请重试';
    }
  }

  private async loadPending(): Promise<void> {
    if (this.requesting) {
      return;
    }
    this.requesting = true;
    this.progressState = PROGRESS_LOADING;
    this.progressErrorText = '';
    try {
      const items = await RepairOrderService.listMine('', 1);
      this.pendingOrders = items.filter((order: RepairOrderView) => isPendingStatus(order.status));
      this.progressState = this.pendingOrders.length === 0 ? PROGRESS_EMPTY : PROGRESS_READY;
    } catch (error) {
      this.progressState = PROGRESS_ERROR;
      this.handleError(error);
    } finally {
      this.requesting = false;
    }
  }

  private customerEntries(): TabEntry[] {
    return [
      { title: '我要报修', icon: '报', hue: 'orange', route: ROUTE_REPAIR_ORDERS, ready: true },
      { title: '我的进度', icon: '进', hue: 'teal', route: ROUTE_REPAIR_ORDERS, ready: true },
      { title: '知识问答', icon: '问', hue: 'blue', route: ROUTE_KNOWLEDGE, ready: true },
      { title: '服务记录', icon: '录', hue: 'green', route: ROUTE_REPAIR_ORDERS, ready: true }
    ];
  }

  /** 审核入口按服务器权限展示，实际业务权限仍由服务端检查。 */
  private staffEntries(): TabEntry[] {
    const entries: TabEntry[] = [
      { title: '报修工作台', icon: '单', hue: 'purple', route: ROUTE_STAFF_ORDERS, ready: true }
    ];
    if (this.permissions.includes('repair:review')) {
      entries.push({ title: '备案审核', icon: '审', hue: 'red', route: ROUTE_STAFF_REVIEW, ready: true });
    }
    entries.push({ title: '典型案例库', icon: '例', hue: 'gold', route: ROUTE_CASE_LIBRARY, ready: true });
    entries.push({ title: '知识问答', icon: '问', hue: 'blue', route: ROUTE_KNOWLEDGE, ready: true });
    return entries;
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
  pendingCard(order: RepairOrderView) {
    Row({ space: CARD_GAP }) {
      IconTile({ icon: '备', hue: 'blue' })
      Column({ space: GAP_SM }) {
        Text(order.deviceModel)
          .fontSize(FONT_SUBTITLE)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
          .textAlign(TextAlign.Start)
        Text(repairOrderStatusLabel(order.status))
          .fontSize(FONT_NOTE)
          .fontColor($r('app.color.brand'))
          .padding({ left: GAP_SM, right: GAP_SM, top: 2, bottom: 2 })
          .backgroundColor($r('app.color.brand_soft'))
          .borderRadius(CHIP_RADIUS)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width(240)
    .padding(CARD_PADDING)
    .alignItems(VerticalAlign.Center)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .onClick(() => {
      // 带订单 ID 压栈：我的报修页打开后直接展开该单的详情进度。
      const focus: RepairOrderFocusParam = { orderId: order.id };
      this.pusher.push(this.pathStack, ROUTE_REPAIR_ORDERS, focus);
    })
  }

  @Builder
  pendingSection() {
    if (this.progressState === PROGRESS_LOADING) {
      LoadingPanel({ text: '正在加载进行中的报修…' })
    } else if (this.progressState === PROGRESS_ERROR) {
      ErrorPanel({
        message: this.progressErrorText,
        onRetry: (): void => {
          this.loadPending();
        }
      })
    } else if (this.progressState === PROGRESS_EMPTY) {
      // 如实空态：没有进行中的单就说没有，不放假卡片。
      Text('最近 20 条报修中暂无进行中的记录，全部进度可从「我的进度」查看。')
        .fontSize(FONT_NOTE)
        .fontColor($r('app.color.text_secondary'))
        .width('100%')
        .padding(CARD_PADDING_LG)
        .textAlign(TextAlign.Center)
        .backgroundColor($r('app.color.surface'))
        .borderRadius(CARD_RADIUS)
    } else {
      Scroll() {
        Row({ space: CARD_GAP }) {
          ForEach(this.pendingOrders, (order: RepairOrderView) => {
            this.pendingCard(order);
          }, (order: RepairOrderView) => order.id)
        }
        .alignItems(VerticalAlign.Center)
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
      .align(Alignment.Start)
    }
  }

  build() {
    Scroll() {
      Column({ space: GAP_LG }) {
        // 顶部大标题问候 + 身份简要显示（不做假搜索框）。
        Column({ space: GAP_SM }) {
          Text(`${greetingForNow()}，${this.displayName === '' ? '用户' : this.displayName}`)
            .fontSize(FONT_TITLE)
            .fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.text_primary'))
            .width('100%')
            .textAlign(TextAlign.Start)
          Row({ space: GAP_SM }) {
            Text(this.roleText)
              .fontSize(FONT_NOTE)
              .fontColor($r('app.color.brand'))
              .padding({ left: GAP_SM, right: GAP_SM, top: 2, bottom: 2 })
              .backgroundColor($r('app.color.brand_soft'))
              .borderRadius(CHIP_RADIUS)
            Text('鸿蒙电脑医院')
              .fontSize(FONT_NOTE)
              .fontColor($r('app.color.text_secondary'))
          }
          .width('100%')
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)

        this.sectionTitle(this.home === HOME_STAFF ? '工作台入口' : '常用功能')
        Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
          ForEach(this.home === HOME_STAFF ? this.staffEntries() : this.customerEntries(), (entry: TabEntry) => {
            QuickEntry({
              icon: entry.icon,
              title: entry.title,
              hue: entry.hue,
              ready: entry.ready,
              onSelect: (): void => {
                this.pusher.push(this.pathStack, entry.route, null);
              }
            });
          }, (entry: TabEntry) => entry.title + entry.route)
        }
        .width('100%')

        if (this.home !== HOME_STAFF) {
          this.sectionTitle('进行中的报修')
          Text('仅展示最近 20 条本人报修中的进行中记录。')
            .fontSize(FONT_NOTE)
            .fontColor($r('app.color.text_secondary'))
          this.pendingSection()
          Button('刷新报修进度')
            .enabled(!this.requesting)
            .onClick(() => { this.loadPending(); })
        }

        Text(this.home === HOME_STAFF
          ? '已接入：真实登录与会话、报修处理与维修备案（受理 / 推进 / 建档 / 审核）、典型案例库（备案标记自动整理、知识回流）、知识问答（回答带可打开的引用）。'
          : '已接入：真实登录与会话、我的报修（提交与进度查询）、知识问答（回答带可打开的引用）。未标注「已接入」的能力为骨架，不接入业务数据。')
          .fontSize(FONT_NOTE)
          .fontColor($r('app.color.text_secondary'))
          .width('100%')
          .textAlign(TextAlign.Start)
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
