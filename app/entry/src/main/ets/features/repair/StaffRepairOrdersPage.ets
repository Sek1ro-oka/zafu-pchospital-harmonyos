import { DetailHeader, DetailNotice, DetailEmptyOrders, DETAIL_BACKGROUND } from '../../core/ui/ReferenceDetail';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ROUTE_STAFF_ORDER_DETAIL } from '../../core/ui/Routes';
import { CARD_RADIUS, PAGE_PADDING } from '../../core/ui/Theme';
import { formatOrderTime, repairOrderStatusLabel } from './RepairOrderContract';
import { StaffOrderParam, StaffRepairOrderView, recordSummaryLabel } from './StaffRepairContract';
import { StaffRepairOrderService } from './StaffRepairOrderService';

/** 列表四态：加载中 / 有数据 / 空数据 / 失败。 */
const STATE_LOADING: number = 0;
const STATE_READY: number = 1;
const STATE_EMPTY: number = 2;
const STATE_ERROR: number = 3;

const PAGE_SIZE: number = 20;

interface ScopeTab {
  scope: string;
  label: string;
}

const SCOPE_TABS: ScopeTab[] = [
  { scope: 'unassigned', label: '待受理' },
  { scope: 'mine', label: '我负责' },
  { scope: 'all', label: '全部' }
];

/**
 * 工作人员报修工作台（Issue #38）。
 *
 * - 队列与归属由服务端判定；「待受理」是公共池，先受理成功的人负责后续处理；
 * - 分页加载「加载更多」，支持下拉式刷新按钮与空态/失败态；
 * - 快速切换范围或重试时用请求代次作废迟到的旧响应，旧数据不会覆盖新范围。
 */
@Component
export struct StaffRepairOrdersPage {
  onBack: () => void = () => {};
  pathStack: NavPathStack = new NavPathStack();
  onSessionExpired: () => void = () => {
  };
  @State scope: string = 'unassigned';
  @State state: number = STATE_LOADING;
  @State orders: StaffRepairOrderView[] = [];
  @State errorText: string = '';
  @State currentPage: number = 1;
  @State loadingMore: boolean = false;
  @State hasMore: boolean = false;
  @State loadMoreErrorText: string = '';
  private generation: number = 0;

  aboutToAppear(): void {
    this.load();
  }

  private handleExpired(error: Object): boolean {
    if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) {
      this.onSessionExpired();
      return true;
    }
    return false;
  }

  private async load(): Promise<void> {
    this.generation = this.generation + 1;
    const generation = this.generation;
    this.state = STATE_LOADING;
    this.errorText = '';
    this.loadMoreErrorText = '';
    this.currentPage = 1;
    // 新列表代重置分页状态：旧代的 loadMore 在 finally 里不再回写本代，
    // 若这里不清掉，刷新/切换范围后按钮会永远停在「加载中…」。
    this.loadingMore = false;
    try {
      const items = await StaffRepairOrderService.queue(this.scope, '', 1);
      if (generation !== this.generation) {
        return;
      }
      this.orders = items;
      this.hasMore = items.length >= PAGE_SIZE;
      this.state = items.length === 0 ? STATE_EMPTY : STATE_READY;
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      if (this.handleExpired(error)) {
        return;
      }
      this.state = STATE_ERROR;
      this.errorText = error instanceof ApiRequestError ? error.message : '加载失败，请重试';
    }
  }

  private async loadMore(): Promise<void> {
    if (this.loadingMore || !this.hasMore) {
      return;
    }
    const generation = this.generation;
    this.loadingMore = true;
    this.loadMoreErrorText = '';
    try {
      const nextPage = this.currentPage + 1;
      const items = await StaffRepairOrderService.queue(this.scope, '', nextPage);
      if (generation !== this.generation) {
        return;
      }
      if (items.length > 0) {
        this.orders = this.orders.concat(items);
        this.currentPage = nextPage;
      }
      this.hasMore = items.length >= PAGE_SIZE;
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      if (this.handleExpired(error)) {
        return;
      }
      this.loadMoreErrorText = error instanceof ApiRequestError ? error.message : '加载更多失败，请重试';
    } finally {
      if (generation === this.generation) {
        this.loadingMore = false;
      }
    }
  }

  private switchScope(next: string): void {
    if (this.scope === next) {
      return;
    }
    this.scope = next;
    this.load();
  }

  @Builder
  statusChip(status: string) {
    Text(repairOrderStatusLabel(status))
      .fontSize(12)
      .fontColor($r('app.color.brand'))
      .padding({ left: 8, right: 8, top: 3, bottom: 3 })
      .backgroundColor($r('app.color.brand_soft'))
      .borderRadius(8)
  }

  @Builder
  recordChip(order: StaffRepairOrderView) {
    Text(`备案：${recordSummaryLabel(order.record)}`)
      .fontSize(12)
      .fontColor($r('app.color.text_secondary'))
      .padding({ left: 8, right: 8, top: 3, bottom: 3 })
      .backgroundColor($r('app.color.field_bg'))
      .borderRadius(8)
  }

  @Builder
  scopeTab(tab: ScopeTab) {
    Column({ space: 7 }) {
      Text(tab.label).fontSize(17).fontColor(this.scope === tab.scope ? '#0764E9' : '#666D72')
        .fontWeight(this.scope === tab.scope ? FontWeight.Medium : FontWeight.Normal)
      Rect().width(30).height(2).fill(this.scope === tab.scope ? '#0764E9' : Color.Transparent).borderRadius(1)
    }.height(46).justifyContent(FlexAlign.End).padding({ left: 12, right: 12 })
      .onClick(() => { this.switchScope(tab.scope); })
  }

  @Builder
  orderCard(order: StaffRepairOrderView) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Text(order.deviceModel)
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        this.statusChip(order.status)
      }
      .width('100%')

      Text(order.faultDescription)
        .fontSize(14)
        .fontColor($r('app.color.text_secondary'))
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
        .textAlign(TextAlign.Start)

      Row({ space: 8 }) {
        Text(order.assignee === null ? '待受理' : `受理人：${order.assignee.name}`)
          .fontSize(12)
          .fontColor(order.assignee === null ? $r('app.color.brand') : $r('app.color.text_secondary'))
          .layoutWeight(1)
          .textAlign(TextAlign.Start)
        this.recordChip(order)
      }
      .width('100%')

      Text(`提交时间 ${formatOrderTime(order.createdAt)}`)
        .fontSize(12)
        .fontColor($r('app.color.text_secondary'))
        .width('100%')
        .textAlign(TextAlign.Start)
    }
    .width('100%')
    .padding(16)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Start)
    .onClick(() => {
      const param: StaffOrderParam = { orderId: order.id };
      this.pathStack.pushPathByName(ROUTE_STAFF_ORDER_DETAIL, param);
    })
  }

  @Builder
  loadingView() {
    Column({ space: 12 }) {
      LoadingProgress()
        .width(36)
        .height(36)
        .color($r('app.color.brand'))
      Text('正在加载报修队列…')
        .fontSize(14)
        .fontColor($r('app.color.text_secondary'))
    }
    .width('100%')
    .padding(32)
    .justifyContent(FlexAlign.Center)
  }

  @Builder
  emptyView() {
    Column({ space: 8 }) {
      Text(this.scope === 'mine' ? '你还没有受理中的报修' : '暂无报修单')
        .fontSize(16)
        .fontColor($r('app.color.text_primary'))
      Text(this.scope === 'unassigned' ? '客户提交的新报修会出现在这里。' : '换一个范围或稍后刷新。')
        .fontSize(13)
        .fontColor($r('app.color.text_secondary'))
    }
    .width('100%')
    .padding(32)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  errorView() {
    Column({ space: 12 }) {
      Text(this.errorText === '' ? '加载失败，请重试' : this.errorText)
        .fontSize(14)
        .fontColor($r('app.color.danger'))
        .width('100%')
        .textAlign(TextAlign.Center)
      Button('重试')
        .fontSize(14)
        .height(40)
        .backgroundColor($r('app.color.brand'))
        .fontColor(Color.White)
        .onClick(() => {
          this.load();
        })
    }
    .width('100%')
    .padding(32)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Center)
  }

  build() {
    Column({ space: 0 }) {
      DetailHeader({ title: '报修工作台', onBack: this.onBack, refresh: true,
        onRefresh: (): void => { this.load(); } })
      Row() {
        ForEach(SCOPE_TABS, (tab: ScopeTab) => { this.scopeTab(tab); }, (tab: ScopeTab) => tab.scope)
      }.width('100%').height(56).padding({ left: 16, right: 16 })
      Column() {
        DetailNotice({ text: '待受理为公共队列，受理后由负责人员处理。报修进度与维修备案审核分别记录。' })
      }.width('100%').padding({ left: 18, right: 18, top: 14, bottom: 14 })
      if (this.state === STATE_EMPTY) {
        Column() { DetailEmptyOrders({ text: this.scope === 'mine' ? '您还没有负责的报修单' : '暂无报修单' }) }
          .width('100%').layoutWeight(1)
      } else {
        Scroll() {
          Column({ space: 16 }) {
            if (this.state === STATE_LOADING) { this.loadingView() }
            else if (this.state === STATE_ERROR) { this.errorView() }
            else {
              ForEach(this.orders, (order: StaffRepairOrderView) => { this.orderCard(order); }, (order: StaffRepairOrderView) => order.id)
              if (this.loadMoreErrorText !== '') { Text(this.loadMoreErrorText).fontSize(13).fontColor($r('app.color.danger')) }
              if (this.hasMore) {
                Button(this.loadingMore ? '加载中…' : '加载更多').width('100%').height(42).fontSize(14)
                  .backgroundColor(Color.White).fontColor('#0755FF').enabled(!this.loadingMore)
                  .onClick(() => { this.loadMore(); })
              }
            }
          }.width('100%').padding({ left: 18, right: 18, bottom: 18 }).alignItems(HorizontalAlign.Start)
        }.width('100%').layoutWeight(1).scrollBar(BarState.Off).align(Alignment.Top)
      }
    }.width('100%').height('100%').backgroundColor(DETAIL_BACKGROUND)
  }
}
