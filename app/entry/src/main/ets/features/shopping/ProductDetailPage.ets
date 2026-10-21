import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { DETAIL_BACKGROUND, DetailHeader, DetailNotice } from '../../core/ui/ReferenceDetail';
import { CARD_RADIUS, GAP_SM } from '../../core/ui/Theme';
import { ROUTE_SHOPPING_GOODS_EDIT, ROUTE_SHOPPING_ORDERS } from '../../core/ui/Routes';
import { ShoppingImage } from './ShoppingImage';
import { ShoppingService } from './ShoppingService';
import {
  PRODUCT_STATUS_DELISTED,
  PRODUCT_STATUS_ON_SALE,
  ShoppingGoodsParam,
  ShoppingProductView,
  shoppingCategoryLabel,
  shoppingMoney,
  shoppingProductStatusLabel,
  shoppingTime,
} from './ShoppingTypes';

/**
 * 商品详情（#84）：游客可读，购买 / 编辑 / 下架按服务端 `actions` 展示。
 *
 * 服务端 actions 只是渲染依据，真正的权限仍由每个写接口校验；
 * 本页不根据 roles 自行推断。
 */
@Component
export struct ProductDetailPage {
  param: ShoppingGoodsParam = { id: '' };
  @Prop authenticated: boolean = false;
  onBack: () => void = () => {};
  onOpen: (route: string, param: Object | null) => void = () => {};
  onLogin: () => void = () => {};
  onSessionExpired: () => void = () => {};
  @Prop @Watch('onRefreshChanged') refreshVersion: number = 0;

  @State detail: ShoppingProductView | null = null;
  @State loading: boolean = false;
  @State errorText: string = '';
  @State buyOpen: boolean = false;
  @State quantity: number = 1;
  @State buying: boolean = false;
  @State buyError: string = '';
  @State orderKey: string = '';
  @State delistOpen: boolean = false;
  @State delistReason: string = '';
  @State delisting: boolean = false;
  @State delistError: string = '';
  private generation: number = 0;

  aboutToAppear(): void {
    this.reload();
  }

  onRefreshChanged(): void {
    this.reload();
  }

  private async reload(): Promise<void> {
    this.generation += 1;
    const generation: number = this.generation;
    this.loading = true;
    this.errorText = '';
    try {
      const detail = await ShoppingService.productDetail(this.param.id);
      if (generation !== this.generation) return;
      this.detail = detail;
    } catch (error) {
      if (generation !== this.generation) return;
      const apiError = error as ApiRequestError;
      if (isSessionExpiredCode(apiError.code)) {
        this.onSessionExpired();
        return;
      }
      this.errorText = apiError.message;
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  private openBuy(): void {
    if (!this.authenticated) {
      this.onLogin();
      return;
    }
    this.quantity = 1;
    this.buyError = '';
    this.orderKey = ShoppingService.newOrderKey();
    this.buyOpen = true;
  }

  private async confirmBuy(): Promise<void> {
    const detail: ShoppingProductView | null = this.detail;
    if (detail === null || this.buying) return;
    this.buying = true;
    this.buyError = '';
    try {
      await ShoppingService.createOrder({
        productId: detail.id,
        quantity: this.quantity,
        idempotencyKey: this.orderKey
      });
      this.orderKey = '';
      this.buyOpen = false;
      this.onOpen(ROUTE_SHOPPING_ORDERS, null);
    } catch (error) {
      const apiError = error as ApiRequestError;
      if (isSessionExpiredCode(apiError.code)) {
        this.onSessionExpired();
        return;
      }
      this.buyError = apiError.message;
    } finally {
      this.buying = false;
    }
  }

  private openDelist(): void {
    if (!this.authenticated) {
      this.onLogin();
      return;
    }
    this.delistReason = '';
    this.delistError = '';
    this.delistOpen = true;
  }

  private async confirmDelist(): Promise<void> {
    const detail: ShoppingProductView | null = this.detail;
    if (detail === null || this.delisting) return;
    this.delisting = true;
    this.delistError = '';
    try {
      const updated = await ShoppingService.delistProduct(detail.id, this.delistReason.trim());
      this.detail = updated;
      this.delistOpen = false;
    } catch (error) {
      const apiError = error as ApiRequestError;
      if (isSessionExpiredCode(apiError.code)) {
        this.onSessionExpired();
        return;
      }
      this.delistError = this.reasonError(apiError);
    } finally {
      this.delisting = false;
    }
  }

  private reasonError(error: ApiRequestError): string {
    if (error.fieldErrors !== undefined) {
      const values: string[] | undefined = error.fieldErrors['reason'];
      if (values !== undefined && values.length > 0) return values.join('；');
    }
    return error.message;
  }

  private addQuantity(): void {
    const detail: ShoppingProductView | null = this.detail;
    if (detail === null) return;
    const limit: number = Math.min(detail.stock, 99);
    if (this.quantity < limit) this.quantity += 1;
  }

  private removeQuantity(): void {
    if (this.quantity > 1) this.quantity -= 1;
  }

  private imageList(): string[] {
    const detail: ShoppingProductView | null = this.detail;
    if (detail === null) return [];
    const urls: string[] = [];
    for (const image of detail.images) urls.push(image.url);
    return urls;
  }

  @Builder
  metaChip(text: string, background: string, color: string) {
    Text(text).fontSize(11).fontColor(color)
      .padding({ left: 9, right: 9, top: 4, bottom: 4 })
      .backgroundColor(background).borderRadius(8)
  }

  @Builder
  buySheet() {
    Column() {
      Column().width('100%').layoutWeight(1).backgroundColor('#66000000').onClick(() => {
        if (!this.buying) this.buyOpen = false;
      })
      Column({ space: 14 }) {
        Text('确认购买').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#101416').width('100%')
        if (this.detail !== null) {
          Text(this.detail.title).fontSize(14).fontColor('#2B343A').maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        }
        Row({ space: 12 }) {
          Text('数量').fontSize(14).fontColor('#4D5860').layoutWeight(1)
          Button('−').width(36).height(36).fontSize(18).backgroundColor('#EEF2F5').fontColor('#1F2933')
            .enabled(!this.buying).onClick(() => {
              this.removeQuantity();
            })
          Text(`${this.quantity}`).fontSize(16).fontWeight(FontWeight.Medium).width(34).textAlign(TextAlign.Center)
          Button('+').width(36).height(36).fontSize(18).backgroundColor('#EEF2F5').fontColor('#1F2933')
            .enabled(!this.buying).onClick(() => {
              this.addQuantity();
            })
        }.width('100%')
        Row() {
          Text('合计').fontSize(14).fontColor('#4D5860').layoutWeight(1)
          Text(shoppingMoney(this.detail === null ? 0 : this.detail.priceCents * this.quantity))
            .fontSize(22).fontWeight(FontWeight.Bold).fontColor('#C0442D')
        }.width('100%')
        Text('线下付款取货，本应用不承诺线上支付；下单后请与卖家约定取货时间。')
          .fontSize(12).fontColor('#6B7780').lineHeight(18).width('100%')
        if (this.buyError !== '') {
          Text(this.buyError).fontSize(12).fontColor($r('app.color.danger')).width('100%')
        }
        Button(this.buying ? '提交中…' : '确认下单')
          .width('100%').height(46).fontSize(15).fontColor(Color.White)
          .backgroundColor($r('app.color.brand')).enabled(!this.buying)
          .onClick(() => {
            this.confirmBuy();
          })
        Text('再想想').fontSize(13).fontColor('#6B7780').padding({ top: 2, bottom: 6 })
          .onClick(() => {
            if (!this.buying) this.buyOpen = false;
          })
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 20, bottom: 24 })
      .backgroundColor(Color.White)
      .borderRadius({ topLeft: 24, topRight: 24 })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.End)
  }

  @Builder
  delistSheet() {
    Column() {
      Column().width('100%').layoutWeight(1).backgroundColor('#66000000').onClick(() => {
        if (!this.delisting) this.delistOpen = false;
      })
      Column({ space: 14 }) {
        Text('下架商品').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#101416').width('100%')
        Text('下架只影响新订单；已产生的订单仍可继续完成或取消。管理员下架必须填写原因。')
          .fontSize(12).fontColor('#6B7780').lineHeight(18).width('100%')
        TextInput({ text: this.delistReason, placeholder: '下架原因（管理员必填）' })
          .height(46).fontSize(14).backgroundColor('#F2F5F7').borderRadius(12)
          .enabled(!this.delisting)
          .onChange((value: string) => {
            this.delistReason = value;
          })
        if (this.delistError !== '') {
          Text(this.delistError).fontSize(12).fontColor($r('app.color.danger')).width('100%')
        }
        Button(this.delisting ? '下架中…' : '确认下架')
          .width('100%').height(46).fontSize(15).fontColor(Color.White)
          .backgroundColor('#B04438').enabled(!this.delisting)
          .onClick(() => {
            this.confirmDelist();
          })
        Text('取消').fontSize(13).fontColor('#6B7780').padding({ top: 2, bottom: 6 })
          .onClick(() => {
            if (!this.delisting) this.delistOpen = false;
          })
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 20, bottom: 24 })
      .backgroundColor(Color.White)
      .borderRadius({ topLeft: 24, topRight: 24 })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.End)
  }

  @Builder
  bottomBar() {
    Row({ space: GAP_SM }) {
      if (this.detail !== null && this.detail.actions.canEdit) {
        Button('编辑').height(44).fontSize(14).fontColor('#1F2933')
          .backgroundColor('#EEF2F5').borderRadius(22)
          .onClick(() => {
            const param: ShoppingGoodsParam = { id: this.detail === null ? '' : this.detail.id };
            this.onOpen(ROUTE_SHOPPING_GOODS_EDIT, param);
          })
      }
      if (this.detail !== null && this.detail.actions.canDelist) {
        Button('下架').height(44).fontSize(14).fontColor('#B04438')
          .backgroundColor('#FBEAE7').borderRadius(22)
          .onClick(() => {
            this.openDelist();
          })
      }
      if (this.detail !== null && this.detail.actions.canBuy) {
        Button('购买').layoutWeight(1).height(46).fontSize(16).fontColor(Color.White)
          .backgroundColor($r('app.color.brand')).borderRadius(23)
          .onClick(() => {
            this.openBuy();
          })
      } else if (this.detail !== null && this.detail.status === PRODUCT_STATUS_DELISTED) {
        Text('该商品已下架，仅支持查看历史信息').fontSize(13).fontColor('#7A858D').layoutWeight(1)
      } else if (this.detail !== null && this.detail.stock === 0) {
        Text('该商品已售罄，等待卖家补货').fontSize(13).fontColor('#7A858D').layoutWeight(1)
      } else if (this.detail !== null && this.detail.status === PRODUCT_STATUS_ON_SALE && !this.authenticated) {
        Button('登录后购买').layoutWeight(1).height(46).fontSize(16).fontColor(Color.White)
          .backgroundColor($r('app.color.brand')).borderRadius(23)
          .onClick(() => {
            this.openBuy();
          })
      }
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 10, bottom: 16 })
    .backgroundColor(Color.White)
    .shadow({ radius: 12, color: '#14000000', offsetY: -2 })
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column() {
        DetailHeader({ title: '商品详情', onBack: this.onBack, refresh: true, onRefresh: () => {
          this.reload();
        } })
        if (this.loading && this.detail === null) {
          Column({ space: 10 }) {
            LoadingProgress().width(28).height(28).color($r('app.color.brand'))
            Text('正在加载商品…').fontSize(12).fontColor('#7A858D')
          }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
        } else if (this.errorText !== '' && this.detail === null) {
          Column({ space: 12 }) {
            Text(this.errorText).fontSize(14).fontColor($r('app.color.danger')).textAlign(TextAlign.Center)
            Button('重试').height(38).fontSize(13).onClick(() => {
              this.reload();
            })
          }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center).padding(24)
        } else if (this.detail !== null) {
          Scroll() {
            Column({ space: 14 }) {
              if (this.imageList().length > 0) {
                Swiper() {
                  ForEach(this.imageList(), (url: string) => {
                    ShoppingImage({ url: url })
                  }, (url: string) => url)
                }
                .width('100%')
                .height(264)
                .autoPlay(false)
                .indicator(this.imageList().length > 1)
                .loop(false)
                .borderRadius(CARD_RADIUS)
                .clip(true)
              } else {
                Stack() {
                  ShoppingImage({ url: '' })
                }.width('100%').height(220).borderRadius(CARD_RADIUS).clip(true)
              }

              Column({ space: 8 }) {
                Row({ space: 8 }) {
                  Text(shoppingMoney(this.detail.priceCents)).fontSize(28).fontWeight(FontWeight.Bold).fontColor('#C0442D')
                  Text(shoppingProductStatusLabel(this.detail.status)).fontSize(11)
                    .fontColor(this.detail.status === PRODUCT_STATUS_DELISTED ? '#8A5A00' : '#1D6B4F')
                    .padding({ left: 8, right: 8, top: 3, bottom: 3 })
                    .backgroundColor(this.detail.status === PRODUCT_STATUS_DELISTED ? '#FFF1D6' : '#E3F4EC')
                    .borderRadius(8)
                }.width('100%')
                Text(this.detail.title).fontSize(20).fontWeight(FontWeight.Bold).fontColor('#101416')
                  .width('100%').lineHeight(27)
                Row({ space: 6 }) {
                  this.metaChip(shoppingCategoryLabel(this.detail.category), '#EEF2F5', '#4D5860')
                  this.metaChip(this.detail.condition, '#EEF2F5', '#4D5860')
                  if (this.detail.stock === 0) {
                    this.metaChip('已售罄', '#FBEAE7', '#B04438')
                  } else {
                    this.metaChip(`库存 ${this.detail.stock}`, '#EEF2F5', '#4D5860')
                  }
                }.width('100%')
              }.width('100%').padding(16).backgroundColor(Color.White).borderRadius(CARD_RADIUS)

              Row({ space: 10 }) {
                Image($r('app.media.profile_avatar')).width(36).height(36).borderRadius(18)
                Column({ space: 3 }) {
                  Text(this.detail.seller.displayName).fontSize(14).fontWeight(FontWeight.Medium).fontColor('#1F2933')
                  Text(`发布于 ${shoppingTime(this.detail.createdAt)}`).fontSize(11).fontColor('#7A858D')
                }.alignItems(HorizontalAlign.Start).layoutWeight(1)
              }.width('100%').padding(14).backgroundColor(Color.White).borderRadius(CARD_RADIUS)

              Column({ space: 8 }) {
                Text('商品描述').fontSize(15).fontWeight(FontWeight.Medium).fontColor('#1F2933').width('100%')
                Text(this.detail.description).fontSize(14).fontColor('#4D5860').lineHeight(22).width('100%')
              }.width('100%').padding(16).backgroundColor(Color.White).borderRadius(CARD_RADIUS)

              if (this.detail.pickupNote !== null && this.detail.pickupNote !== '') {
                DetailNotice({ text: `取货备注：${this.detail.pickupNote}` })
              }

              if (this.detail.status === PRODUCT_STATUS_DELISTED) {
                Column({ space: 6 }) {
                  Text('已下架').fontSize(14).fontWeight(FontWeight.Medium).fontColor('#8A5A00').width('100%')
                  Text(this.detail.delistReason === null || this.detail.delistReason === ''
                    ? '该商品已由卖家或管理员下架，历史订单不受影响。'
                    : `原因：${this.detail.delistReason}`)
                    .fontSize(12).fontColor('#6B7780').lineHeight(18).width('100%')
                }.width('100%').padding(14).backgroundColor('#FFF8E8').borderRadius(CARD_RADIUS)
              }

              Text('线下付款取货，本应用不承诺线上支付；下单前请与卖家确认成色与取货地点。')
                .fontSize(10).fontColor('#8C949A').lineHeight(16).width('100%')
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 4, bottom: 96 })
            .alignItems(HorizontalAlign.Start)
          }
          .layoutWeight(1)
          .scrollBar(BarState.Off)
          .align(Alignment.Top)
        }
      }
      .width('100%')
      .height('100%')

      if (this.detail !== null && !this.buyOpen && !this.delistOpen) {
        this.bottomBar()
      }
      if (this.buyOpen) {
        this.buySheet()
      }
      if (this.delistOpen) {
        this.delistSheet()
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(DETAIL_BACKGROUND)
  }
}
