import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { isNetworkErrorCode } from '../knowledge/KnowledgeFlow';
import {
  CARD_GAP,
  CARD_PADDING,
  CARD_PADDING_LG,
  CARD_RADIUS,
  CHIP_RADIUS,
  CONTROL_HEIGHT_MD,
  CONTROL_HEIGHT_SM,
  FONT_BODY,
  FONT_CHIP,
  FONT_HEADING,
  FONT_NOTE,
  FONT_SUBTITLE,
  FONT_TEXT,
  GAP_LG,
  GAP_SM,
  GAP_XS,
  PAGE_PADDING,
} from '../../core/ui/Theme';
import {
  RepairOrderEventView,
  RepairOrderSubmitRequest,
  RepairOrderView,
  formatOrderTime,
  repairOrderStatusLabel,
} from './RepairOrderContract';
import { RepairOrderForm } from './RepairOrderForm';
import { RepairOrderService } from './RepairOrderService';

/** 列表加载状态：加载中 / 有数据 / 空数据 / 失败（四态，Issue 原文要求）。 */
const STATE_LOADING: number = 0;
const STATE_READY: number = 1;
const STATE_EMPTY: number = 2;
const STATE_ERROR: number = 3;

/** 后端默认页大小，用于判断"加载更多"是否还有下一页。 */
const PAGE_SIZE: number = 20;

/** 提交成功后的即时反馈文案，避免用户以为「点了一下没反应」。 */
const SUBMIT_OK_TEXT: string = '报修已提交，工作人员受理后可在此查看进度。';

/**
 * 客户报修页：本人报修列表 + 提交表单 + 详情进度。
 *
 * 归属完全由服务端按令牌判定 —— 这里不传任何用户标识，
 * 也无法通过界面参数切换到别人的单据（改 ID 查详情会被服务端 404）。
 */
@Component
export struct RepairOrdersPage {
  /**
   * 深链参数（本轮 Tab 化新增）：从首页「进行中的报修」预览卡进入时带上订单 ID，
   * 页面打开后直接展开该单的详情进度；普通入口传空串，行为与原来完全一致。
   */
  initialDetailId: string = '';
  /** 会话失效时通知上层回登录页；由 Navigation 调用方注入。 */
  onSessionExpired: () => void = () => {
  };
  @State state: number = STATE_LOADING;
  @State orders: RepairOrderView[] = [];
  @State errorText: string = '';
  @State noticeText: string = '';
  @State showForm: boolean = false;
  @State selected: RepairOrderView | null = null;
  /** 详情面板是否打开：与 selected 解耦，首次请求失败时面板也能渲染出加载/错误提示。 */
  @State detailOpen: boolean = false;
  /** 当前详情目标订单 ID：加载、错误、重试都围绕它，避免"重试请求错单"。 */
  @State detailTargetId: string = '';
  /**
   * 详情请求序号（请求令牌）：每次发起详情请求自增并捕获快照，
   * 响应到达时只有序号仍是当前值才允许写入状态。
   * 用于让「收起面板 / 切换目标」后仍在飞行的旧请求失效，
   * 防止旧响应覆盖当前订单（A 未返回就收起、再开 B 后 A 的响应迟到）。
   */
  @State detailRequestSeq: number = 0;
  @State detailLoading: boolean = false;
  @State detailErrorText: string = '';
  @State currentPage: number = 1;
  @State loadingMore: boolean = false;
  @State hasMore: boolean = false;
  /** 「加载更多」失败提示：保留列表原样，仅就地提示失败原因。 */
  @State loadMoreErrorText: string = '';
  /** 列表请求进行中（与 state 分开的私有标记）：防止重试按钮连点触发并发请求。 */
  private requesting: boolean = false;
  /** 提交成功后的刷新不可被普通请求防重丢弃，等当前请求结束后执行。 */
  private refreshPending: boolean = false;

  aboutToAppear(): void {
    this.load();
    if (this.initialDetailId !== '') {
      this.openDetailById(this.initialDetailId);
    }
  }

  /**
   * 按订单 ID 直接打开详情面板（深链入口）：
   * 与 askDetail 走同一套 detailTargetId / 请求序号机制，
   * 加载、错误与重试行为完全一致，只是列表里还没有对应的订单对象。
   */
  private openDetailById(id: string): void {
    this.detailOpen = true;
    this.detailTargetId = id;
    this.fetchDetail(id);
  }

  /**
   * 统一处理会话失效：清掉本地展示状态并让上层回登录页。
   * 网络错误补一句排查引导，业务错误直接用后端信封文案，两类提示可区分。
   */
  private handleError(error: Object): void {
    if (error instanceof ApiRequestError) {
      if (isSessionExpiredCode(error.code)) {
        this.refreshPending = false;
        this.onSessionExpired();
        return;
      }
      this.errorText = isNetworkErrorCode(error.code)
        ? `${error.message}（请检查服务器地址、网络与后端是否已启动）`
        : error.message;
    } else {
      this.errorText = '加载失败，请重试';
    }
  }

  private async load(refreshAfterSubmit: boolean = false): Promise<void> {
    if (this.requesting) {
      if (refreshAfterSubmit) {
        this.refreshPending = true;
      }
      return;
    }
    this.requesting = true;
    this.state = STATE_LOADING;
    this.errorText = '';
    this.currentPage = 1;
    try {
      const items = await RepairOrderService.listMine('', 1);
      this.orders = items;
      this.hasMore = items.length >= PAGE_SIZE;
      this.state = items.length === 0 ? STATE_EMPTY : STATE_READY;
    } catch (error) {
      this.state = STATE_ERROR;
      this.handleError(error);
    } finally {
      this.requesting = false;
      if (this.refreshPending) {
        this.refreshPending = false;
        await this.load();
      }
    }
  }

  /** 加载下一页，追加到列表尾部。 */
  private async loadMore(): Promise<void> {
    if (this.loadingMore || !this.hasMore) {
      return;
    }
    this.loadingMore = true;
    this.loadMoreErrorText = '';
    try {
      const nextPage: number = this.currentPage + 1;
      const items = await RepairOrderService.listMine('', nextPage);
      if (items.length > 0) {
        this.orders = this.orders.concat(items);
        this.currentPage = nextPage;
      }
      this.hasMore = items.length >= PAGE_SIZE;
    } catch (error) {
      // 加载更多失败保留现有列表，就地提示失败原因，用户可再点一次重试。
      if (error instanceof ApiRequestError) {
        if (isSessionExpiredCode(error.code)) {
          this.onSessionExpired();
          return;
        }
        this.loadMoreErrorText = isNetworkErrorCode(error.code)
          ? `${error.message}（请检查网络后重试）`
          : error.message;
      } else {
        this.loadMoreErrorText = '加载更多失败，请重试';
      }
    } finally {
      this.loadingMore = false;
    }
  }

  private askDetail(order: RepairOrderView): void {
    if (this.detailLoading) {
      return;
    }
    this.detailOpen = true;
    this.detailTargetId = order.id;
    this.fetchDetail(order.id);
  }

  /**
   * 按订单 ID 拉取详情：加载、错误与重试统一围绕同一个 ID，避免错单。
   *
   * 用请求序号做失效判定：发出前自增并捕获，回到主线程后只有
   * `seq === this.detailRequestSeq` 才允许更新页面。这样「收起面板」
   * 或「切换到另一单」之后迟到的旧响应会被直接丢弃，不会覆盖当前订单。
   */
  private async fetchDetail(id: string): Promise<void> {
    this.detailRequestSeq = this.detailRequestSeq + 1;
    const seq: number = this.detailRequestSeq;
    this.detailLoading = true;
    this.detailErrorText = '';
    try {
      const detail = await RepairOrderService.detail(id);
      if (seq !== this.detailRequestSeq) {
        return;
      }
      // 重新取一次详情而不是复用列表项：列表与详情虽同形状，但进度事件可能已更新。
      this.selected = detail;
    } catch (error) {
      if (seq !== this.detailRequestSeq) {
        return;
      }
      if (error instanceof ApiRequestError) {
        if (isSessionExpiredCode(error.code)) {
          this.onSessionExpired();
          return;
        }
        this.detailErrorText = error.message;
      } else {
        this.detailErrorText = '加载详情失败';
      }
    } finally {
      if (seq === this.detailRequestSeq) {
        this.detailLoading = false;
      }
    }
  }

  /** 重试当前目标订单的详情请求，而非重试上一次成功的旧订单。 */
  private retryDetail(): void {
    if (this.detailTargetId !== '') {
      this.fetchDetail(this.detailTargetId);
    }
  }

  private closeDetail(): void {
    // 自增序号使仍在飞行的请求失效，其响应到达后不再写入页面状态。
    this.detailRequestSeq = this.detailRequestSeq + 1;
    this.detailOpen = false;
    this.selected = null;
    this.detailTargetId = '';
    this.detailErrorText = '';
    this.detailLoading = false;
  }

  private async submitOrder(request: RepairOrderSubmitRequest, idempotencyKey: string): Promise<void> {
    await RepairOrderService.submit(request, idempotencyKey);
    this.noticeText = SUBMIT_OK_TEXT;
  }

  private async afterSubmit(): Promise<void> {
    this.showForm = false;
    await this.load(true);
  }

  @Builder
  statusChip(status: string) {
    Text(repairOrderStatusLabel(status))
      .fontSize(FONT_CHIP)
      .fontColor($r('app.color.brand'))
      .padding({ left: GAP_SM, right: GAP_SM, top: 3, bottom: 3 })
      .backgroundColor($r('app.color.brand_soft'))
      .borderRadius(CHIP_RADIUS)
  }

  @Builder
  orderCard(order: RepairOrderView) {
    Column({ space: GAP_SM }) {
      Row({ space: GAP_SM }) {
        Text(order.deviceModel)
          .fontSize(FONT_SUBTITLE)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        this.statusChip(order.status)
      }
      .width('100%')

      Text(order.faultDescription)
        .fontSize(FONT_TEXT)
        .fontColor($r('app.color.text_secondary'))
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
        .textAlign(TextAlign.Start)

      Text(`提交时间 ${formatOrderTime(order.createdAt)}`)
        .fontSize(FONT_CHIP)
        .fontColor($r('app.color.text_secondary'))
        .width('100%')
        .textAlign(TextAlign.Start)
    }
    .width('100%')
    .padding(CARD_PADDING)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Start)
    .onClick(() => {
      this.askDetail(order);
    })
  }

  @Builder
  timelineEvent(event: RepairOrderEventView) {
    Row({ space: GAP_SM }) {
      Text('●')
        .fontSize(10)
        .fontColor($r('app.color.brand'))
      Column({ space: GAP_XS }) {
        Text(repairOrderStatusLabel(event.toStatus))
          .fontSize(FONT_TEXT)
          .fontColor($r('app.color.text_primary'))
          .width('100%')
          .textAlign(TextAlign.Start)
        if (event.note !== null && event.note !== '') {
          Text(event.note)
            .fontSize(FONT_NOTE)
            .fontColor($r('app.color.text_secondary'))
            .width('100%')
            .textAlign(TextAlign.Start)
        }
        Text(formatOrderTime(event.createdAt))
          .fontSize(FONT_CHIP)
          .fontColor($r('app.color.text_secondary'))
          .width('100%')
          .textAlign(TextAlign.Start)
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  @Builder
  detailPanel(order: RepairOrderView | null) {
    Column({ space: GAP_SM }) {
      Row({ space: GAP_SM }) {
        Text('报修详情')
          .fontSize(FONT_HEADING)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .layoutWeight(1)
        Text('收起')
          .fontSize(FONT_TEXT)
          .fontColor($r('app.color.brand'))
          .onClick(() => {
            this.closeDetail();
          })
      }
      .width('100%')

      if (this.detailLoading) {
        // 嵌在详情卡内：不再包卡片底色，只给统一的转圈与文案。
        LoadingPanel({ text: '正在加载详情…' })
      } else if (this.detailErrorText !== '') {
        ErrorPanel({
          message: this.detailErrorText,
          onRetry: (): void => {
            this.retryDetail();
          }
        })
      } else if (order !== null) {
        this.detailRow('设备机型', order.deviceModel)
        this.detailRow('设备序列号', order.deviceSerial === null || order.deviceSerial === '' ? '未填写' : order.deviceSerial)
        this.detailRow('联系电话', order.contactPhone)
        this.detailRow('当前状态', repairOrderStatusLabel(order.status))
        this.detailRow('故障描述', order.faultDescription)

        Text('进度')
          .fontSize(FONT_BODY)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .width('100%')
          .textAlign(TextAlign.Start)

        if (order.events.length === 0) {
          Text('暂无进度记录')
            .fontSize(FONT_NOTE)
            .fontColor($r('app.color.text_secondary'))
            .width('100%')
            .textAlign(TextAlign.Start)
        } else {
          ForEach(order.events, (event: RepairOrderEventView) => {
            this.timelineEvent(event);
          }, (event: RepairOrderEventView) => event.id)
        }
      }
    }
    .width('100%')
    .padding(CARD_PADDING)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  detailRow(label: string, value: string) {
    Row({ space: CARD_GAP }) {
      Text(label)
        .fontSize(FONT_NOTE)
        .fontColor($r('app.color.text_secondary'))
        .width(88)
        .textAlign(TextAlign.Start)
      Text(value)
        .fontSize(FONT_TEXT)
        .fontColor($r('app.color.text_primary'))
        .layoutWeight(1)
        .textAlign(TextAlign.Start)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  @Builder
  loadingView() {
    LoadingPanel({ text: '正在加载报修记录…' })
  }

  @Builder
  emptyView() {
    Column({ space: GAP_SM }) {
      Text('还没有报修记录')
        .fontSize(FONT_SUBTITLE)
        .fontColor($r('app.color.text_primary'))
      Text('点击上方「我要报修」提交第一条。')
        .fontSize(FONT_NOTE)
        .fontColor($r('app.color.text_secondary'))
    }
    .width('100%')
    .padding(CARD_PADDING_LG)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  errorView() {
    // 复用统一错误面板，外面补回整块卡片的底色（与前手列表错误态外观一致）。
    Column() {
      ErrorPanel({
        message: this.errorText === '' ? '加载失败，请重试' : this.errorText,
        onRetry: (): void => {
          this.load();
        }
      })
    }
    .width('100%')
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
  }

  @Builder
  loadMoreButton() {
    if (this.hasMore) {
      Button(this.loadingMore ? '加载中…' : '加载更多')
        .width('100%')
        .height(CONTROL_HEIGHT_MD)
        .fontSize(FONT_TEXT)
        .backgroundColor($r('app.color.surface'))
        .fontColor($r('app.color.brand'))
        .enabled(!this.loadingMore)
        .onClick(() => {
          this.loadMore();
        })
    }
  }

  build() {
    Column({ space: GAP_LG }) {
      // 工具栏：页面标题在 NavDestination 标题栏，这里只放报修入口，固定不随列表滚动。
      Row({ space: CARD_GAP }) {
        Blank()
        Button(this.showForm ? '取消' : '我要报修')
          .fontSize(FONT_TEXT)
          .height(CONTROL_HEIGHT_SM)
          .backgroundColor($r('app.color.brand_soft'))
          .fontColor($r('app.color.brand'))
          .onClick(() => {
            this.showForm = !this.showForm;
            this.noticeText = '';
          })
      }
      .width('100%')

      if (this.noticeText !== '') {
        Text(this.noticeText)
          .fontSize(FONT_NOTE)
          .fontColor($r('app.color.ok'))
          .width('100%')
          .textAlign(TextAlign.Start)
      }

      // 可滚动内容区：表单、详情、列表都在这里
      Scroll() {
        Column({ space: GAP_LG }) {
          if (this.showForm) {
            RepairOrderForm({
              onSubmitted: () => this.afterSubmit(),
              submit: (request: RepairOrderSubmitRequest, idempotencyKey: string) => this.submitOrder(request, idempotencyKey),
              onSessionExpired: () => this.onSessionExpired()
            })
          }

          if (this.detailOpen) {
            this.detailPanel(this.selected)
          }

          if (this.state === STATE_LOADING) {
            this.loadingView();
          } else if (this.state === STATE_ERROR) {
            this.errorView();
          } else if (this.state === STATE_EMPTY) {
            this.emptyView();
          } else {
            ForEach(this.orders, (order: RepairOrderView) => {
              this.orderCard(order);
            }, (order: RepairOrderView) => order.id)

            if (this.loadMoreErrorText !== '') {
              Text(this.loadMoreErrorText)
                .fontSize(FONT_NOTE)
                .fontColor($r('app.color.danger'))
                .width('100%')
                .textAlign(TextAlign.Center)
            }

            this.loadMoreButton();
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Auto)
      .align(Alignment.Top)
    }
    .width('100%')
    .height('100%')
    .padding(PAGE_PADDING)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.start_window_background'))
  }
}
