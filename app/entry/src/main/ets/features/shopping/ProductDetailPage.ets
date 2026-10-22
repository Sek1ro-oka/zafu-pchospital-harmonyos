import { common } from '@kit.AbilityKit';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { SessionService } from '../../core/auth/SessionService';
import { DETAIL_BACKGROUND, DetailHeader, DetailNotice } from '../../core/ui/ReferenceDetail';
import { CARD_RADIUS, GAP_SM } from '../../core/ui/Theme';
import { ROUTE_SHOPPING_GOODS_EDIT, ROUTE_SHOPPING_ORDERS } from '../../core/ui/Routes';
import { PendingOrderRecord, PendingOrderStore } from './PendingOrderStore';
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
 * 结果未知的下单请求快照：网络错误 / 超时时服务端可能已建单，
 * 重试必须复用同一把幂等键与数量；结果确认（成功或明确拒绝）后清空。
 *
 * 内存 `@State` 只覆盖同一详情实例；跨实例（详情出栈销毁后重进）由
 * `PendingOrderStore` 按 账号 + 服务器 + 商品 持久化恢复（#84 审查第三轮）。
 */
interface PendingOrderIntent {
  key: string;
  productId: string;
  quantity: number;
}

/**
 * 商品详情（#84）：游客可读，购买 / 编辑 / 下架按服务端 `actions` 展示。
 *
 * 服务端 actions 只是渲染依据，真正的权限仍由每个写接口校验；
 * 本页不根据 roles 自行推断。
 *
 * 页面离开（aboutToDisappear）后迟到的异步回调静默作废：不导航、不触发
 * expireSession、不更新状态；未决下单意图的持久化写入 / 清除是唯一例外 ——
 * 它独立于 UI 生命周期，销毁后仍要执行（#84 审查第三轮）。
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
  @State pendingIntent: PendingOrderIntent | null = null;
  @State delistOpen: boolean = false;
  @State delistReason: string = '';
  @State delisting: boolean = false;
  @State delistError: string = '';
  private generation: number = 0;
  /** 页面已离开：迟到的异步回调不得导航、失效会话或更新状态（持久化意图读写除外）。 */
  private disposed: boolean = false;
  /**
   * aboutToAppear 时缓存的宿主 Context：preferences 读写要在请求回调里进行，
   * 页面销毁后 `getUIContext()` 不再可靠，缓存保证「清除意图」仍能执行。
   */
  private hostContext: common.Context | null = null;

  aboutToAppear(): void {
    try {
      const context: common.Context | undefined = this.getUIContext().getHostContext();
      this.hostContext = context === undefined ? null : context;
    } catch (error) {
      // 拿不到 Context 时降级为仅内存快照（同实例仍复用幂等键），不阻塞详情加载。
      this.hostContext = null;
    }
    this.restorePendingIntent();
    this.reload();
  }

  aboutToDisappear(): void {
    this.disposed = true;
  }

  onRefreshChanged(): void {
    // 页面重新可见（如登录返回、订单页返回）时同步重读持久化意图：
    // 游客进入时没有账号标识读不到，登录回来后要能恢复未决下单。
    this.restorePendingIntent();
    this.reload();
  }

  private async reload(): Promise<void> {
    this.generation += 1;
    const generation: number = this.generation;
    const sessionStamp: string = SessionService.sessionStamp();
    this.loading = true;
    this.errorText = '';
    try {
      const detail = await ShoppingService.productDetail(this.param.id);
      if (generation !== this.generation || this.disposed) return;
      this.detail = detail;
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      const apiError = error as ApiRequestError;
      if (isSessionExpiredCode(apiError.code)) {
        // 迟到的会话失效错误不得在会话已被替换（换账号 / 重新登录）后触发 expireSession。
        if (SessionService.sessionStamp() !== sessionStamp) return;
        this.onSessionExpired();
        return;
      }
      this.errorText = apiError.message;
    } finally {
      if (generation === this.generation && !this.disposed) this.loading = false;
    }
  }

  /**
   * 恢复当前 账号 + 服务器 + 商品 的未决下单意图（跨详情实例，#84 审查第三轮）。
   *
   * 命中记录则复用原幂等键与原数量（弹层据此锁步进器、改「重试同一请求」）；
   * 其他账号 / 服务器 / 商品的记录整份忽略。读取失败或身份不全（游客、
   * 服务器地址为空）按无记录处理，不阻塞详情加载。
   */
  private async restorePendingIntent(): Promise<void> {
    const context: common.Context | null = this.hostContext;
    const identity = SessionService.current();
    const userId: string = identity === null ? '' : identity.userId;
    const baseUrl: string = ApiConfig.getBaseUrl();
    if (context === null || userId === '' || baseUrl === '') return;
    const record: PendingOrderRecord | null =
      await PendingOrderStore.read(context, userId, baseUrl, this.param.id);
    if (record === null || this.disposed) return;
    // 同实例内存快照优先（结果未知失败刚写入的），不被磁盘记录覆盖。
    if (this.pendingIntent !== null) return;
    const intent: PendingOrderIntent = { key: record.key, productId: record.productId, quantity: record.quantity };
    this.pendingIntent = intent;
  }

  /** 写入持久化未决意图；缺 Context / 账号 / 服务器标识时静默降级（同实例仍有内存快照）。 */
  private async saveIntent(intent: PendingOrderIntent, userId: string, baseUrl: string): Promise<void> {
    const context: common.Context | null = this.hostContext;
    if (context === null || userId === '' || baseUrl === '') return;
    const record: PendingOrderRecord = {
      userId: userId,
      baseUrl: baseUrl,
      productId: intent.productId,
      key: intent.key,
      quantity: intent.quantity,
      savedAt: Date.now()
    };
    await PendingOrderStore.write(context, record);
  }

  /**
   * 结果确认后清除持久化未决意图；只清发起请求时那个账号 + 服务器下本商品的记录。
   * 该操作独立于 UI 生命周期：页面已销毁 / 会话已更换时仍必须执行。
   */
  private async clearIntent(productId: string, userId: string, baseUrl: string): Promise<void> {
    const context: common.Context | null = this.hostContext;
    if (context === null || userId === '' || baseUrl === '') return;
    await PendingOrderStore.clear(context, userId, baseUrl, productId);
  }

  /** 当前商品是否存在结果未知的下单请求（重试须复用原幂等键与数量）。 */
  private retryIntent(): PendingOrderIntent | null {
    const detail: ShoppingProductView | null = this.detail;
    if (detail === null || this.pendingIntent === null) return null;
    if (this.pendingIntent.productId !== detail.id) return null;
    return this.pendingIntent;
  }

  private openBuy(): void {
    if (!this.authenticated) {
      this.onLogin();
      return;
    }
    this.buyError = '';
    const pending: PendingOrderIntent | null = this.retryIntent();
    // 结果未知时锁定原数量，不允许换数量或另起新键。
    this.quantity = pending !== null ? pending.quantity : 1;
    this.buyOpen = true;
  }

  private async confirmBuy(): Promise<void> {
    const detail: ShoppingProductView | null = this.detail;
    if (detail === null || this.buying || this.disposed) return;
    const pending: PendingOrderIntent | null = this.retryIntent();
    const key: string = pending !== null ? pending.key : ShoppingService.newOrderKey();
    const quantity: number = pending !== null ? pending.quantity : this.quantity;
    // 会话快照：发请求前记下归属；回调时代次 / 账号已变（退出、换账号、重新登录）
    // 则整份丢弃 —— 不导航、不触发 expireSession、不更新状态（#84 审查第三轮）。
    const sessionStamp: string = SessionService.sessionStamp();
    const identity = SessionService.current();
    const userId: string = identity === null ? '' : identity.userId;
    const baseUrl: string = ApiConfig.getBaseUrl();
    const intent: PendingOrderIntent = { key: key, productId: detail.id, quantity: quantity };
    this.buying = true;
    this.buyError = '';
    // 发出请求**之前**落持久记录：响应丢失且页面销毁（返回列表、进程被杀）后，
    // 重进同一商品仍能复用这把幂等键，服务端按 (buyerId, key) 去重不会建第二笔。
    await this.saveIntent(intent, userId, baseUrl);
    if (this.disposed || SessionService.sessionStamp() !== sessionStamp) {
      // 请求尚未发出页面就已离开 / 会话已变：不发请求，并回收刚写入的记录。
      await this.clearIntent(detail.id, userId, baseUrl);
      if (!this.disposed) this.buying = false;
      return;
    }
    try {
      await ShoppingService.createOrder({
        productId: detail.id,
        quantity: quantity,
        idempotencyKey: key
      });
      // 下单成功：结果已确认，清除持久记录与内存快照。
      // 清除独立于 UI 生命周期：页面已销毁 / 会话已变时同样要执行。
      await this.clearIntent(detail.id, userId, baseUrl);
      if (this.disposed || SessionService.sessionStamp() !== sessionStamp) return;
      this.pendingIntent = null;
      this.buyOpen = false;
      this.onOpen(ROUTE_SHOPPING_ORDERS, null);
    } catch (error) {
      const apiError = error as ApiRequestError;
      if (isSessionExpiredCode(apiError.code)) {
        // 会话失效是**确定结果**（服务端拒绝或未发出请求），订单没有建立：清除意图。
        // 但迟到的失效错误不得在页面已离开 / 会话已被替换后触发 expireSession。
        await this.clearIntent(detail.id, userId, baseUrl);
        if (this.disposed || SessionService.sessionStamp() !== sessionStamp) return;
        this.pendingIntent = null;
        this.onSessionExpired();
        return;
      }
      if (apiError.code === 'NETWORK_ERROR' || apiError.code === 'UNEXPECTED_RESPONSE') {
        // 网络错误 / 超时 / 无法解析的响应：服务端可能已建单，结果未知。
        // 持久记录发请求前已写入，这里重写一次兜底（写失败降级）；内存快照供同实例复用。
        // 重试继续用同一把幂等键；确认结果前不允许新购买意图。
        await this.saveIntent(intent, userId, baseUrl);
        if (this.disposed || SessionService.sessionStamp() !== sessionStamp) return;
        this.pendingIntent = intent;
        this.buyError = '下单结果未确认，重试将复用同一请求，不会重复建单';
      } else {
        // 服务端明确拒绝（如 OUT_OF_STOCK / 商品已下架）：结果已知、订单未建立，
        // 清除持久记录，允许换新键重新购买。
        await this.clearIntent(detail.id, userId, baseUrl);
        if (this.disposed || SessionService.sessionStamp() !== sessionStamp) return;
        this.pendingIntent = null;
        this.buyError = apiError.message;
      }
    } finally {
      if (!this.disposed) this.buying = false;
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
    if (detail === null || this.delisting || this.disposed) return;
    const sessionStamp: string = SessionService.sessionStamp();
    this.delisting = true;
    this.delistError = '';
    try {
      const updated = await ShoppingService.delistProduct(detail.id, this.delistReason.trim());
      // 页面已离开 / 会话已变的迟到回调静默作废，不再更新本页状态。
      if (this.disposed || SessionService.sessionStamp() !== sessionStamp) return;
      this.detail = updated;
      this.delistOpen = false;
    } catch (error) {
      if (this.disposed || SessionService.sessionStamp() !== sessionStamp) return;
      const apiError = error as ApiRequestError;
      if (isSessionExpiredCode(apiError.code)) {
        this.onSessionExpired();
        return;
      }
      this.delistError = this.reasonError(apiError);
    } finally {
      if (!this.disposed) this.delisting = false;
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
            .enabled(!this.buying && this.retryIntent() === null).onClick(() => {
              this.removeQuantity();
            })
          Text(`${this.quantity}`).fontSize(16).fontWeight(FontWeight.Medium).width(34).textAlign(TextAlign.Center)
          Button('+').width(36).height(36).fontSize(18).backgroundColor('#EEF2F5').fontColor('#1F2933')
            .enabled(!this.buying && this.retryIntent() === null).onClick(() => {
              this.addQuantity();
            })
        }.width('100%')
        if (this.retryIntent() !== null) {
          Text('上一次下单结果未确认：数量与请求已锁定，重试复用同一幂等键；请先重试或到订单列表确认，再发起新的购买。')
            .fontSize(12).fontColor('#8A5A00').lineHeight(18).width('100%')
            .padding({ left: 12, right: 12, top: 8, bottom: 8 })
            .backgroundColor('#FFF8E8').borderRadius(10)
        }
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
        Button(this.buying ? '提交中…' : (this.retryIntent() !== null ? '重试同一请求' : '确认下单'))
          .width('100%').height(46).fontSize(15).fontColor(Color.White)
          .backgroundColor($r('app.color.brand')).enabled(!this.buying)
          .onClick(() => {
            this.confirmBuy();
          })
        if (this.retryIntent() !== null) {
          Text('查看我的订单').fontSize(13).fontColor($r('app.color.brand')).padding({ top: 2 })
            .onClick(() => {
              if (!this.buying) {
                this.buyOpen = false;
                this.onOpen(ROUTE_SHOPPING_ORDERS, null);
              }
            })
        }
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
