import { HOME_STAFF } from '../../core/auth/AuthContract';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { NavPusher, RepairOrderFocusParam, ROUTE_CASE_LIBRARY, ROUTE_KNOWLEDGE, ROUTE_REPAIR_ORDERS, ROUTE_STAFF_ORDERS, ROUTE_STAFF_REVIEW } from '../../core/ui/Routes';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { QuickEntry } from '../../core/ui/QuickEntry';
import { HomeQuickCard, HomeReferenceHeader } from './HomeReferenceVisuals';
import { IconTile } from '../../core/ui/IconTile';
import {
  CARD_GAP,
  CARD_PADDING,
  CARD_PADDING_LG,
  CARD_RADIUS,
  CHIP_RADIUS,
  FONT_NOTE,
  FONT_SUBTITLE,
  GAP_SM,
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

function isPendingStatus(status: string): boolean {
  return status === REPAIR_ORDER_SUBMITTED || status === REPAIR_ORDER_ACCEPTED || status === REPAIR_ORDER_REPAIRING;
}

/**
 * 首页 tab（对照 docs/reference/my-huawei/home-navigation.jpg 的信息层级）。
 *
 * 金色主视觉、搜索入口、频道胶囊和四列快捷服务对照参考图。
 * 客户进度来自本人报修接口；工作人员入口仍按服务端权限展示。
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

  private openKnowledge(): void {
    this.pusher.push(this.pathStack, ROUTE_KNOWLEDGE, null);
  }

  private openRepairs(): void {
    this.pusher.push(this.pathStack, this.home === HOME_STAFF ? ROUTE_STAFF_ORDERS : ROUTE_REPAIR_ORDERS, null);
  }

  private showActivities(): void {
    this.getUIContext().getPromptAction().showToast({ message: '活动模块暂未接入' });
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
      .fontSize(18)
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

  @Builder
  channel(title: string, selected: boolean, action: () => void) {
    Button(title, { type: ButtonType.Capsule })
      .layoutWeight(1)
      .height(40)
      .fontSize(14)
      .fontWeight(FontWeight.Medium)
      .fontColor(selected ? '#FFFFFF' : '#202626')
      .backgroundColor(selected ? '#2D3433' : '#FFFFFF')
      .onClick(action)
  }

  build() {
    Scroll() {
      Column() {
        HomeReferenceHeader({
          onConsult: (): void => { this.openKnowledge(); },
          onRepair: (): void => { this.openRepairs(); },
          onRecords: (): void => { this.openRepairs(); }
        })

        Column() {
          Row({ space: 8 }) {
            this.channel('★ 推荐', true, (): void => {})
            this.channel('问诊', false, (): void => { this.openKnowledge(); })
            this.channel('维修', false, (): void => { this.openRepairs(); })
            this.channel('活动', false, (): void => { this.showActivities(); })
          }
          .width('100%')
          .margin({ top: 16, bottom: 36 })

          this.sectionTitle('快捷服务')
          Row() {
            HomeQuickCard({ title: 'AI 问诊', icon: $r('app.media.home_consult'),
              onSelect: (): void => { this.openKnowledge(); } })
            HomeQuickCard({ title: '我要报修', icon: $r('app.media.home_repair'),
              onSelect: (): void => { this.openRepairs(); } })
            HomeQuickCard({ title: '进度查询', icon: $r('app.media.home_progress'),
              onSelect: (): void => { this.openRepairs(); } })
            HomeQuickCard({ title: '近期活动', icon: $r('app.media.home_activity'),
              onSelect: (): void => { this.showActivities(); } })
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)
          .margin({ top: 14, bottom: 36 })

          if (this.home === HOME_STAFF) {
            this.sectionTitle('工作台')
            Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
              ForEach(this.staffEntries(), (entry: TabEntry) => {
                QuickEntry({ icon: entry.icon, title: entry.title, hue: entry.hue, ready: entry.ready,
                  onSelect: (): void => { this.pusher.push(this.pathStack, entry.route, null); } })
              }, (entry: TabEntry) => entry.title + entry.route)
            }
            .width('100%')
            .margin({ top: 14 })
          } else {
            Row() {
              Text('进行中的报修')
                .fontSize(18)
                .fontWeight(FontWeight.Bold)
                .fontColor($r('app.color.text_primary'))
                .layoutWeight(1)
              Button('更多 ›', { type: ButtonType.Normal })
                .fontSize(14)
                .fontColor('#697071')
                .backgroundColor(Color.Transparent)
                .onClick(() => { this.openRepairs(); })
            }
            .width('100%')
            .margin({ bottom: 14 })
            this.pendingSection()
            Button('刷新报修进度', { type: ButtonType.Capsule })
              .enabled(!this.requesting)
              .fontSize(13)
              .fontColor('#697071')
              .backgroundColor(Color.Transparent)
              .margin({ top: 12 })
              .onClick(() => { this.loadPending(); })
          }
        }
        .width('100%')
        .padding({ left: 18, right: 18, bottom: TAB_PAGE_BOTTOM_INSET + 12 })
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
    }
    .scrollable(ScrollDirection.Vertical)
    .scrollBar(BarState.Off)
    .width('100%')
    .height('100%')
    .align(Alignment.Top)
    .backgroundColor('#F0F5F8')
  }
}
