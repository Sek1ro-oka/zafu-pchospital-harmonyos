import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { DETAIL_BACKGROUND, DetailEmptyOrders, DetailHeader } from '../../core/ui/ReferenceDetail';
import { CARD_RADIUS, GAP_SM, PAGE_PADDING } from '../../core/ui/Theme';
import { ROUTE_SHOPPING_GOODS_DETAIL, ROUTE_SHOPPING_GOODS_EDIT } from '../../core/ui/Routes';
import { ShoppingImage } from './ShoppingImage';
import { ShoppingService } from './ShoppingService';
import {
  PRODUCT_STATUS_DELISTED,
  ShoppingGoodsParam,
  ShoppingProductView,
  shoppingCategoryLabel,
  shoppingMoney,
  shoppingProductStatusLabel,
  shoppingTime
} from './ShoppingTypes';

const PAGE_SIZE: number = 20;

/**
 * 我发布的商品（#84）：含已下架，作为「发布新商品 / 编辑 / 查看状态」的入口页。
 * 数据归属完全由服务端按令牌判定，本页不传用户标识。
 */
@Component
export struct MyProductsPage {
  onBack: () => void = () => {};
  onOpen: (route: string, param: Object | null) => void = () => {};
  onSessionExpired: () => void = () => {};
  @Prop @Watch('onRefreshChanged') refreshVersion: number = 0;

  @State products: ShoppingProductView[] = [];
  @State total: number = 0;
  @State page: number = 1;
  @State loading: boolean = false;
  @State loadingMore: boolean = false;
  @State failed: boolean = false;
  @State errorText: string = '';
  private generation: number = 0;

  aboutToAppear(): void {
    this.reload();
  }

  onRefreshChanged(): void {
    this.reload();
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
      const first = await ShoppingService.listMine(1, PAGE_SIZE);
      if (generation !== this.generation) return;
      this.products = first.items;
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
    if (this.loading || this.loadingMore || this.products.length >= this.total) return;
    this.loadingMore = true;
    const generation: number = this.generation;
    try {
      const next = await ShoppingService.listMine(this.page + 1, PAGE_SIZE);
      if (generation !== this.generation) return;
      const merged: ShoppingProductView[] = [];
      for (const item of this.products) merged.push(item);
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
      this.products = merged;
      this.total = next.pagination.total;
      this.page = next.pagination.page;
    } catch (error) {
      if (generation !== this.generation) return;
      this.handleError(error);
    } finally {
      if (generation === this.generation) this.loadingMore = false;
    }
  }

  private openDetail(item: ShoppingProductView): void {
    const param: ShoppingGoodsParam = { id: item.id };
    this.onOpen(ROUTE_SHOPPING_GOODS_DETAIL, param);
  }

  private openCreate(): void {
    this.onOpen(ROUTE_SHOPPING_GOODS_EDIT, null);
  }

  @Builder
  productRow(item: ShoppingProductView) {
    Row({ space: 12 }) {
      Stack() {
        ShoppingImage({ url: item.coverUrl === null ? '' : item.coverUrl, radius: 12 })
      }.width(86).height(86)
      Column({ space: 6 }) {
        Row({ space: 6 }) {
          Text(item.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary'))
            .layoutWeight(1).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(shoppingProductStatusLabel(item.status)).fontSize(10)
            .fontColor(item.status === PRODUCT_STATUS_DELISTED ? '#8A5A00' : '#1D6B4F')
            .padding({ left: 7, right: 7, top: 3, bottom: 3 })
            .backgroundColor(item.status === PRODUCT_STATUS_DELISTED ? '#FFF1D6' : '#E3F4EC')
            .borderRadius(8)
        }.width('100%')
        Text(`${shoppingMoney(item.priceCents)} · ${shoppingCategoryLabel(item.category)} · 库存 ${item.stock}`)
          .fontSize(12).fontColor('#6B7780').width('100%')
        Row() {
          Text(`发布于 ${shoppingTime(item.createdAt)}`).fontSize(11).fontColor('#8C949A').layoutWeight(1)
          Text('查看 ›').fontSize(12).fontColor($r('app.color.brand'))
        }.width('100%')
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .padding(14)
    .backgroundColor(Color.White)
    .borderRadius(CARD_RADIUS)
    .onClick(() => this.openDetail(item))
  }

  build() {
    Column() {
      DetailHeader({ title: '我发布的商品', onBack: this.onBack, onRefresh: () => this.reload(), refresh: true })
      Scroll() {
        Column({ space: 12 }) {
          Button('发布新商品', { type: ButtonType.Normal })
            .width('100%').height(46).fontSize(15).fontColor(Color.White)
            .backgroundColor($r('app.color.brand')).borderRadius(23)
            .onClick(() => this.openCreate())
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
          } else if (this.products.length === 0) {
            DetailEmptyOrders({ text: '还没有发布商品' })
            Text('点击上方按钮发布第一件商品；发布后在这里查看编辑与下架状态。')
              .fontSize(12).fontColor('#8C949A').width('100%').textAlign(TextAlign.Center)
          } else {
            ForEach(this.products, (item: ShoppingProductView) => {
              this.productRow(item)
            }, (item: ShoppingProductView) => item.id)
            if (this.products.length < this.total) {
              Button(this.loadingMore ? '加载中…' : '加载更多', { type: ButtonType.Normal })
                .width('100%').height(42).backgroundColor('#E5EAEE').fontColor('#4D5860')
                .borderRadius(21).enabled(!this.loadingMore).onClick(() => this.loadMore())
            }
          }
        }
        .width('100%')
        .padding({ left: PAGE_PADDING, right: PAGE_PADDING, top: GAP_SM, bottom: 24 })
        .alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).scrollBar(BarState.Off).align(Alignment.Top)
    }
    .width('100%').height('100%').backgroundColor(DETAIL_BACKGROUND)
  }
}
