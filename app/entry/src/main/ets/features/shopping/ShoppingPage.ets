import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { REFERENCE_BACKGROUND } from '../../core/ui/ReferencePage';
import { DetailEmptyOrders, DetailNotice } from '../../core/ui/ReferenceDetail';
import { CARD_RADIUS, GAP_LG, GAP_SM, PAGE_PADDING } from '../../core/ui/Theme';
import { ROUTE_SHOPPING_GOODS_DETAIL, ROUTE_SHOPPING_MY_PRODUCTS, ROUTE_SHOPPING_ORDERS } from '../../core/ui/Routes';
import { ShoppingImage } from './ShoppingImage';
import { ShoppingService } from './ShoppingService';
import {
  PRODUCT_CATEGORY_CONSUMABLE,
  PRODUCT_CATEGORY_SECONDHAND,
  ShoppingGoodsParam,
  ShoppingProductView,
  shoppingCategoryLabel,
  shoppingMoney,
} from './ShoppingTypes';

const PAGE_SIZE: number = 20;

/**
 * 选购 tab（#84）。
 *
 * 游客可直接浏览：列表 / 详情 / 商品图都不要求登录。
 * 发布、下单、我的订单等写操作仍由 `HomePage.openRoute` 的登录意图续接，
 * 本页不自己判断角色，也不拿 `roles` 猜权限。
 */
@Component
export struct ShoppingPage {
  onService: () => void = () => {};
  onOpen: (route: string, param: Object | null) => void = () => {};
  onSessionExpired: () => void = () => {};
  @Prop staff: boolean = false;
  @Prop @Watch('onRefreshChanged') refreshVersion: number = 0;

  @State products: ShoppingProductView[] = [];
  @State total: number = 0;
  @State page: number = 1;
  @State keyword: string = '';
  @State category: string = '';
  @State loading: boolean = false;
  @State loadingMore: boolean = false;
  @State failed: boolean = false;
  @State errorText: string = '';
  @State bannerTitle: string = '选购';
  @State bannerSubtitle: string = '真实商品接入后显示在这里，不使用演示商品充数。';
  @State bannerNote: string = '等待第一件商品';
  private scroller: Scroller = new Scroller();
  private requestGeneration: number = 0;

  aboutToAppear(): void {
    this.reload();
  }

  onRefreshChanged(): void {
    this.reload();
  }

  private serviceLabel(): string {
    return this.staff ? '工作台' : '服务';
  }

  private visibleProducts(): ShoppingProductView[] {
    const keyword: string = this.keyword.trim().toLowerCase();
    if (keyword === '') return this.products;
    return this.products.filter((item: ShoppingProductView) =>
      item.title.toLowerCase().includes(keyword) || item.description.toLowerCase().includes(keyword));
  }

  private newest(): ShoppingProductView | null {
    return this.products.length > 0 ? this.products[0] : null;
  }

  private refreshBanner(): void {
    const item: ShoppingProductView | null = this.newest();
    if (item === null) {
      this.bannerTitle = '选购';
      this.bannerSubtitle = '真实商品接入后显示在这里，不使用演示商品充数。';
      this.bannerNote = '等待第一件商品';
      return;
    }
    this.bannerTitle = `新上架 · ${item.title}`;
    this.bannerSubtitle = `${shoppingMoney(item.priceCents)} · ${shoppingCategoryLabel(item.category)} · ${item.condition}`;
    this.bannerNote = `卖家 ${item.seller.displayName}`;
  }

  private async reload(): Promise<void> {
    this.requestGeneration += 1;
    const generation: number = this.requestGeneration;
    this.loading = true;
    this.loadingMore = false;
    this.failed = false;
    this.errorText = '';
    try {
      const first = await ShoppingService.listProducts(this.category, 1, PAGE_SIZE);
      if (generation !== this.requestGeneration) return;
      this.products = first.items;
      this.total = first.pagination.total;
      this.page = 1;
      this.refreshBanner();
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      this.handleError(error);
    } finally {
      if (generation === this.requestGeneration) this.loading = false;
    }
  }

  private async loadMore(): Promise<void> {
    if (this.loading || this.loadingMore || this.products.length >= this.total) return;
    this.loadingMore = true;
    const generation: number = this.requestGeneration;
    try {
      const next = await ShoppingService.listProducts(this.category, this.page + 1, PAGE_SIZE);
      if (generation !== this.requestGeneration) return;
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
      this.refreshBanner();
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      this.errorText = this.errorMessage(error);
    } finally {
      if (generation === this.requestGeneration) this.loadingMore = false;
    }
  }

  private selectCategory(category: string): void {
    this.category = this.category === category ? '' : category;
    this.reload();
  }

  private openProduct(item: ShoppingProductView): void {
    const param: ShoppingGoodsParam = { id: item.id };
    this.onOpen(ROUTE_SHOPPING_GOODS_DETAIL, param);
  }

  private handleError(error: Object): void {
    const apiError = error as ApiRequestError;
    if (isSessionExpiredCode(apiError.code)) {
      this.onSessionExpired();
      return;
    }
    this.failed = true;
    this.errorText = this.errorMessage(error);
  }

  private errorMessage(error: Object): string {
    const apiError = error as ApiRequestError;
    return apiError.message === undefined || apiError.message === '' ? '加载失败，请重试' : apiError.message;
  }

  @Builder
  bannerSlide(title: string, subtitle: string, note: string, background: string) {
    Column({ space: 8 }) {
      Text(title).fontSize(20).fontWeight(FontWeight.Bold).fontColor('#14202A').maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Text(subtitle).fontSize(13).fontColor('#33414D').maxLines(2).lineHeight(19)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Row({ space: 6 }) {
        Text(note).fontSize(11).fontColor('#5D6A75')
      }
    }
    .width('100%')
    .height('100%')
    .padding(18)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor(background)
    .borderRadius(CARD_RADIUS)
  }

  @Builder
  shortcut(icon: Resource, label: string, route: string, category: string) {
    Column({ space: 8 }) {
      Stack({ alignContent: Alignment.Center }) {
        Image(icon).width(28).height(28).objectFit(ImageFit.Contain)
      }
      .width(46).height(46).backgroundColor('#EEF4F8').borderRadius(16)
      Text(label).fontSize(11).fontColor('#3D474F').maxLines(1)
    }
    .layoutWeight(1)
    .onClick(() => {
      if (route !== '') {
        this.onOpen(route, null);
      } else {
        this.selectCategory(category);
      }
    })
  }

  @Builder
  productCard(item: ShoppingProductView) {
    Column({ space: 8 }) {
      Stack() {
        ShoppingImage({ url: item.coverUrl === null ? '' : item.coverUrl, radius: 14 })
      }
      .width('100%')
      .aspectRatio(1)
      Text(item.title).fontSize(14).fontWeight(FontWeight.Medium).fontColor('#171B1E')
        .width('100%').maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).lineHeight(19)
      Row({ space: 6 }) {
        Text(shoppingMoney(item.priceCents)).fontSize(17).fontWeight(FontWeight.Bold).fontColor('#C0442D')
        Text(shoppingCategoryLabel(item.category)).fontSize(10).fontColor('#6B7780')
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
          .backgroundColor('#EEF2F5').borderRadius(6)
      }.width('100%')
      Row({ space: 6 }) {
        Text(item.seller.displayName).fontSize(11).fontColor('#7A858D').layoutWeight(1).maxLines(1)
        Text(item.stock === 0 ? '已售罄' : `库存 ${item.stock}`).fontSize(11)
          .fontColor(item.stock === 0 ? '#B04438' : '#7A858D')
      }.width('100%')
    }
    .width('48%')
    .padding(10)
    .margin({ bottom: 12 })
    .backgroundColor(Color.White)
    .borderRadius(18)
    .onClick(() => {
      this.openProduct(item);
    })
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Scroll(this.scroller) {
        Column({ space: 16 }) {
          Row({ space: 10 }) {
            Text('选购').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#101416').layoutWeight(1)
            Text('校园二手与维修耗材').fontSize(11).fontColor('#6F7A82')
          }.width('100%').height(48)

          // 顶部整宽搜索：只过滤已经加载到本地的商品，避免把搜索词当成服务端全文检索。
          Row({ space: 8 }) {
            Image($r('app.media.home_search')).width(18).height(18).objectFit(ImageFit.Contain)
            TextInput({ text: this.keyword, placeholder: '搜索已加载的商品' })
              .height(42)
              .layoutWeight(1)
              .backgroundColor(Color.Transparent)
              .fontSize(14)
              .onChange((value: string) => {
                this.keyword = value;
              })
            if (this.keyword !== '') {
              Text('清除').fontSize(12).fontColor($r('app.color.brand')).onClick(() => {
                this.keyword = '';
              })
            }
          }
          .width('100%')
          .padding({ left: 12, right: 12 })
          .backgroundColor(Color.White)
          .borderRadius(14)

          // 16:9 横幅：有真实商品时才挂 Swiper，避免 Swiper 缓存空态里的首屏内容。
          if (this.products.length === 0) {
            this.bannerSlide('选购', '真实商品接入后显示在这里，不使用演示商品充数。',
              '等待第一件商品', '#FFE6C7')
          } else {
            Swiper() {
              this.bannerSlide(this.bannerTitle, this.bannerSubtitle, this.bannerNote, '#FFE6C7')
              this.bannerSlide(
                `${this.total} 件在售`,
                '二手电脑配件与维修耗材，线下付款取货；本应用不承诺线上支付。',
                this.category === '' ? '全部分类' : `当前筛选：${shoppingCategoryLabel(this.category)}`,
                '#DCEBFA'
              )
            }
            .width('100%')
            .height(168)
            .autoPlay(false)
            .indicator(true)
            .loop(false)
          }

          Row({ space: 4 }) {
            this.shortcut($r('app.media.ref_laptop_hero'), '二手配件', '', PRODUCT_CATEGORY_SECONDHAND)
            this.shortcut($r('app.media.ref_boot'), '维修耗材', '', PRODUCT_CATEGORY_CONSUMABLE)
            this.shortcut($r('app.media.ref_document'), '我的购物订单', ROUTE_SHOPPING_ORDERS, '')
            this.shortcut($r('app.media.ref_flag'), '发布商品', ROUTE_SHOPPING_MY_PRODUCTS, '')
          }.width('100%')

          Row({ space: 8 }) {
            Text('最新上架').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#101416').layoutWeight(1)
            if (this.category !== '') {
              Text(`${shoppingCategoryLabel(this.category)} ×`).fontSize(11).fontColor('#6F5B35')
                .padding({ left: 9, right: 9, top: 4, bottom: 4 })
                .backgroundColor('#F3E8D0').borderRadius(12)
                .onClick(() => {
                  this.selectCategory(this.category);
                })
            }
          }.width('100%')

          if (this.loading && this.products.length === 0) {
            Column({ space: 10 }) {
              LoadingProgress().width(28).height(28).color($r('app.color.brand'))
              Text('正在加载商品…').fontSize(12).fontColor('#7A858D')
            }.width('100%').height(160).justifyContent(FlexAlign.Center)
          } else if (this.failed) {
            Column({ space: 10 }) {
              Text(this.errorText).fontSize(13).fontColor($r('app.color.danger')).textAlign(TextAlign.Center)
              Button('重试').height(36).fontSize(13).onClick(() => {
                this.reload();
              })
            }.width('100%').height(160).justifyContent(FlexAlign.Center)
          } else if (this.visibleProducts().length === 0) {
            Column() {
              DetailEmptyOrders({ text: this.keyword === '' ? '暂无在售商品' : '没有匹配的在售商品' })
              Button('发布商品').height(40).fontSize(14).fontColor(Color.White)
                .backgroundColor($r('app.color.brand'))
                .onClick(() => {
                  this.onOpen(ROUTE_SHOPPING_MY_PRODUCTS, null);
                })
            }.width('100%')
          } else {
            Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
              ForEach(this.visibleProducts(), (item: ShoppingProductView) => {
                this.productCard(item)
              }, (item: ShoppingProductView) => item.id)
            }.width('100%')
            if (this.products.length < this.total) {
              Text(this.loadingMore ? '加载中…' : '继续上滑加载更多').fontSize(11).fontColor('#8C949A')
                .width('100%').textAlign(TextAlign.Center).padding({ top: 4, bottom: 8 })
            }
          }

          if (this.keyword !== '') {
            Text('搜索只过滤当前已加载的商品；继续上滑可加载更多。').fontSize(10).fontColor('#8C949A')
          }

          if (this.staff) {
            DetailNotice({ text: '去工作台查看维修与知识；选购交易与报修单、维修备案是不同对象。' })
            Button(`去「${this.serviceLabel()}」查看维修与知识`)
              .width('100%').height(42).fontSize(14).fontColor(Color.White)
              .backgroundColor('#0755FF').borderRadius(21)
              .onClick(() => {
                this.onService();
              })
          }

          Text('商品、价格、库存与订单均来自真实接口；交易线下付款取货，不显示支付成功。')
            .fontSize(10).fontColor('#8C949A').lineHeight(16).width('100%')
        }
        .width('100%')
        .padding({ left: PAGE_PADDING, right: PAGE_PADDING, top: 4, bottom: 96 })
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .height('100%')
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
      .onScrollEdge((side: Edge) => {
        if (side === Edge.Bottom) this.loadMore();
      })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(REFERENCE_BACKGROUND)
  }
}
