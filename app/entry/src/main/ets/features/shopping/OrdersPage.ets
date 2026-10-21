import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { DETAIL_BACKGROUND, DetailEmptyOrders, DetailHeader, DetailNotice } from '../../core/ui/ReferenceDetail';
import { CARD_RADIUS, GAP_LG, GAP_SM, PAGE_PADDING } from '../../core/ui/Theme';
import { ShoppingImage } from './ShoppingImage';
import { ShoppingService } from './ShoppingService';
import {
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_PENDING,
  ShoppingOrderView,
  shoppingMoney,
  shoppingOrderStatusLabel,
  shoppingTime
} from './ShoppingTypes';

interface OrderFilter {
  value: string;
  label: string;
}

const FILTERS: OrderFilter[] = [
  { value: '', label: '全部' },
  { value: ORDER_STATUS_PENDING, label: '待取货' },
  { value: ORDER_STATUS_COMPLETED, label: '已完成' },
  { value: ORDER_STATUS_CANCELLED, label: '已取消' }
];

const PAGE_SIZE: number = 20;

/**
 * 购物订单列表（#84）：`role=buyer` 为「我的购物订单」，`role=seller` 为「卖家订单」。
 *
 * 列表展示的是下单快照；操作按钮仍以服务端下发的 `actions` 为准，
 * 客户端不根据角色或状态自行推断权限。
 */
@Component
export struct OrdersPage {
  role: string = 'buyer';
  onBack: () => void = () => {};
  onSessionExpired: () => void = () => {};
  @Prop @Watch('onRefreshChanged') refreshVersion: number = 0;

  @State orders: ShoppingOrderView[] = [];
  @State statusFilter: string = '';
  @State total: number = 0;
  @State page: number = 1;
  @State loading: boolean = false;
  @State loadingMore: boolean = false;
  @State failed: boolean = false;
  @State errorText: string = '';
  @State actionOrder: ShoppingOrderView | null = null;
  @State actionMode: string = '';
  @State cancelReason: string = '';
  @State actionBusy: boolean = false;
  @State actionError: string = '';
  private generation: number = 0;

  aboutToAppear(): void {
    this.reload();
  }

  onRefreshChanged(): void {
    this.reload();
  }

  private title(): string {
    return this.role === 'seller' ? '卖家订单' : '我的购物订单';
  }

  private statusColor(status: string): string {
    if (status === ORDER_STATUS_PENDING) return '#C77A16';
    if (status === ORDER_STATUS_COMPLETED) return '#2C7A56';
    if (status === ORDER_STATUS_CANCELLED) return '#8C949A';
    return '#4D5860';
  }

  private handleError(error: Object): void {
    const failure: ApiRequestError = error as ApiRequestError;
    if (isSessionExpiredCode(failure.code)) {
      this.onSessionExpired();
      return;
    }
    this.failed = true;
    this.errorText = failure.message;
  }

  private async reload(): Promise<void> {
    this.generation += 1;
    const generation: number = this.generation;
    this.loading = true;
    this.loadingMore = false;
    this.failed = false;
    this.errorText = '';
    try {
      const first = await ShoppingService.listOrders(this.role, this.statusFilter, 1, PAGE_SIZE);
      if (generation !== this.generation) return;
      this.orders = first.items;
      this.total = first.pagination.total;
      this.page = 1;
    } catch (error) {
      if (generation !== this.generation) return;
      this.handleError(error);
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  private async loadMore(): Promise<void> {
    if (this.loading || this.loadingMore || this.orders.length >= this.total) return;
    this.loadingMore = true;
    const generation: number = this.generation;
    try {
      const next = await ShoppingService.listOrders(this.role, this.statusFilter, this.page + 1, PAGE_SIZE);
      if (generation !== this.generation) return;
      const merged: ShoppingOrderView[] = [];
      for (const item of this.orders) merged.push(item);
      for (const item of next.items) {
        let exists: boolean = false;
        for (const current of merged) {
          if (current.id === item.id) {
            exists = true;
            break;
          }
        }
        if (!exists) merged.push(item);
      }
      this.orders = merged;
      this.total = next.pagination.total;
      this.page = next.pagination.page;
    } catch (error) {
      if (generation !== this.generation) return;
      this.handleError(error);
    } finally {
      if (generation === this.generation) this.loadingMore = false;
    }
  }

  private selectFilter(value: string): void {
    if (this.statusFilter === value) return;
    this.statusFilter = value;
    this.reload();
  }

  private openAction(order: ShoppingOrderView, mode: string): void {
    if (this.actionBusy) return;
    this.actionOrder = order;
    this.actionMode = mode;
    this.cancelReason = '';
    this.actionError = '';
  }

  private closeAction(): void {
    if (this.actionBusy) return;
    this.actionOrder = null;
    this.actionMode = '';
    this.cancelReason = '';
    this.actionError = '';
  }

  private replaceOrder(updated: ShoppingOrderView): void {
    const next: ShoppingOrderView[] = [];
    for (const current of this.orders) {
      next.push(current.id === updated.id ? updated : current);
    }
    this.orders = next;
  }

  private async confirmAction(): Promise<void> {
    const order: ShoppingOrderView | null = this.actionOrder;
    if (order === null || this.actionBusy) return;
    const mode: string = this.actionMode;
    if (mode === 'cancel' && this.role === 'seller' && this.cancelReason.trim() === '') {
      this.actionError = '卖家取消订单必须填写原因';
      return;
    }
    this.actionBusy = true;
    this.actionError = '';
    try {
      let updated: ShoppingOrderView;
      if (mode === 'cancel') {
        updated = await ShoppingService.cancelOrder(order.id, this.role === 'seller' ? this.cancelReason.trim() : '');
      } else {
        updated = await ShoppingService.completeOrder(order.id);
      }
      this.replaceOrder(updated);
      this.actionBusy = false;
      this.actionOrder = null;
      this.actionMode = '';
      this.cancelReason = '';
      this.getUIContext().getPromptAction().showToast({
        message: mode === 'cancel' ? '订单已取消' : '订单已完成'
      });
      this.reload();
    } catch (error) {
      this.actionBusy = false;
      const failure: ApiRequestError = error as ApiRequestError;
      if (isSessionExpiredCode(failure.code)) {
        this.onSessionExpired();
        return;
      }
      this.actionError = failure.message;
    }
  }

  @Builder
  orderCard(order: ShoppingOrderView) {
    Column({ space: 12 }) {
      Row({ space: 12 }) {
        Stack() {
          ShoppingImage({ url: order.imageSnapshot === null ? '' : order.imageSnapshot, radius: 12 })
        }.width(76).height(76)
        Column({ space: 6 }) {
          Text(order.titleSnapshot).fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.text_primary')).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(`${shoppingMoney(order.unitPriceCents)} × ${order.quantity}`)
            .fontSize(13).fontColor($r('app.color.text_secondary'))
          Text(shoppingTime(order.createdAt)).fontSize(11).fontColor('#8C949A')
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Text(shoppingOrderStatusLabel(order.status)).fontSize(12)
          .fontColor(this.statusColor(order.status))
          .padding({ left: 9, right: 9, top: 5, bottom: 5 })
          .backgroundColor('#EEF2F5').borderRadius(10)
      }.width('100%').alignItems(VerticalAlign.Top)

      Row({ space: 8 }) {
        Text(`合计 ${shoppingMoney(order.totalCents)}`).fontSize(15).fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.text_primary')).layoutWeight(1)
        if (order.actions.canCancel) {
          Button('取消订单', { type: ButtonType.Normal })
            .fontSize(12).fontColor('#4D5860').height(32)
            .backgroundColor('#EEF2F5').borderRadius(16)
            .onClick(() => this.openAction(order, 'cancel'))
        }
        if (order.actions.canComplete) {
          Button('确认完成', { type: ButtonType.Normal })
            .fontSize(12).fontColor(Color.White).height(32)
            .backgroundColor($r('app.color.brand')).borderRadius(16)
            .onClick(() => this.openAction(order, 'complete'))
        }
      }.width('100%')

      if (order.status === ORDER_STATUS_CANCELLED && order.cancelReason !== null) {
        Text(`取消原因：${order.cancelReason}`).fontSize(11).fontColor('#8C949A').width('100%')
      }
      if (order.status === ORDER_STATUS_COMPLETED) {
        Text(`完成时间：${shoppingTime(order.completedAt)}`).fontSize(11).fontColor('#8C949A').width('100%')
      }
    }
    .width('100%')
    .padding(14)
    .backgroundColor(Color.White)
    .borderRadius(CARD_RADIUS)
  }

  @Builder
  actionPanel() {
    Column() {
      Blank().layoutWeight(1).onClick(() => this.closeAction())
      Column({ space: 14 }) {
        Text(this.actionMode === 'cancel' ? '取消订单' : '确认完成')
          .fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.text_primary')).width('100%')
        Text(this.actionMode === 'cancel'
          ? (this.role === 'seller' ? '取消后库存会回补；请填写取消原因，买家会看到。' : '取消后库存会回补，订单不可恢复。')
          : '确认已完成线下付款与取货？完成后不可再取消。')
          .fontSize(13).lineHeight(20).fontColor($r('app.color.text_secondary')).width('100%')
        if (this.actionMode === 'cancel' && this.role === 'seller') {
          TextArea({ text: this.cancelReason, placeholder: '请填写取消原因' })
            .height(80).fontSize(14).backgroundColor('#F2F5F7').borderRadius(12)
            .maxLength(255).onChange((value: string) => {
              this.cancelReason = value;
            })
        }
        if (this.actionError !== '') {
          Text(this.actionError).fontSize(12).fontColor($r('app.color.danger')).width('100%')
        }
        Row({ space: 12 }) {
          Button('再想想', { type: ButtonType.Normal }).layoutWeight(1).height(46)
            .backgroundColor('#EEF2F5').fontColor('#4D5860').borderRadius(14)
            .enabled(!this.actionBusy).onClick(() => this.closeAction())
          Button(this.actionBusy ? '处理中…' : (this.actionMode === 'cancel' ? '确认取消' : '确认完成'),
            { type: ButtonType.Normal }).layoutWeight(1).height(46)
            .backgroundColor($r('app.color.brand')).fontColor(Color.White).borderRadius(14)
            .enabled(!this.actionBusy).onClick(() => this.confirmAction())
        }.width('100%')
      }
      .width('100%')
      .padding(20)
      .backgroundColor(Color.White)
      .borderRadius({ topLeft: 24, topRight: 24 })
    }
    .width('100%').height('100%').backgroundColor('rgba(16,20,22,0.35)')
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column() {
        DetailHeader({ title: this.title(), onBack: this.onBack, onRefresh: () => this.reload(), refresh: true })
        Scroll() {
          Column({ space: 12 }) {
            DetailNotice({ text: '线下付款取货，本应用不承诺线上支付' })
            Row({ space: 8 }) {
              ForEach(FILTERS, (item: OrderFilter) => {
                Text(item.label).fontSize(13)
                  .fontColor(this.statusFilter === item.value ? Color.White : '#4D5860')
                  .padding({ left: 14, right: 14, top: 8, bottom: 8 })
                  .backgroundColor(this.statusFilter === item.value ? $r('app.color.brand') : '#E5EAEE')
                  .borderRadius(16)
                  .onClick(() => this.selectFilter(item.value))
              }, (item: OrderFilter) => item.value)
            }.width('100%')

            if (this.loading) {
              Row() {
                LoadingProgress().width(26).height(26).color($r('app.color.brand'))
              }.width('100%').height(180).justifyContent(FlexAlign.Center)
            } else if (this.failed) {
              Column({ space: 12 }) {
                Text(this.errorText).fontSize(13).fontColor($r('app.color.danger')).textAlign(TextAlign.Center)
                Button('重试', { type: ButtonType.Normal }).height(40)
                  .backgroundColor($r('app.color.brand')).fontColor(Color.White).borderRadius(20)
                  .onClick(() => this.reload())
              }.width('100%').padding({ top: 60 })
            } else if (this.orders.length === 0) {
              DetailEmptyOrders({ text: '您没有商品订单' })
            } else {
              ForEach(this.orders, (order: ShoppingOrderView) => {
                this.orderCard(order)
              }, (order: ShoppingOrderView) => order.id)
              if (this.orders.length < this.total) {
                Button(this.loadingMore ? '加载中…' : '加载更多', { type: ButtonType.Normal })
                  .width('100%').height(42).backgroundColor('#E5EAEE').fontColor('#4D5860')
                  .borderRadius(21).enabled(!this.loadingMore).onClick(() => this.loadMore())
              }
            }
          }
          .width('100%')
          .padding({ left: PAGE_PADDING, right: PAGE_PADDING, bottom: 24, top: GAP_SM })
        }.layoutWeight(1).scrollBar(BarState.Off)
      }.width('100%').height('100%').backgroundColor(DETAIL_BACKGROUND)

      if (this.actionOrder !== null) {
        this.actionPanel()
      }
    }.width('100%').height('100%')
  }
}
