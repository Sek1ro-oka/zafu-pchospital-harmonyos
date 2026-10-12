import { HOME_STAFF } from '../../core/auth/AuthContract';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { NavPusher, RepairOrderFocusParam, ROUTE_CASE_LIBRARY, ROUTE_KNOWLEDGE, ROUTE_REPAIR_ORDERS, ROUTE_STAFF_ORDERS, ROUTE_STAFF_REVIEW } from '../../core/ui/Routes';
import { EntryCard } from '../../core/ui/EntryCard';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { IconTile } from '../../core/ui/IconTile';
import {
  CARD_GAP,
  CARD_PADDING,
  CARD_PADDING_LG,
  CARD_RADIUS,
  CHIP_RADIUS,
  CONTROL_HEIGHT_MD,
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
import { RepairOrderView, repairOrderStatusLabel } from '../repair/RepairOrderContract';
import { RepairOrderService } from '../repair/RepairOrderService';

/** 设备卡区块的加载状态（四态，与 StatePanel 配套）。 */
const DEVICE_LOADING: number = 0;
const DEVICE_READY: number = 1;
const DEVICE_EMPTY: number = 2;
const DEVICE_ERROR: number = 3;

/** 我的设备列表项：从本人报修单的 deviceModel 派生，附最近一张单的状态。 */
interface DeviceItem {
  model: string;
  orderId: string;
  status: string;
}

interface ServiceEntry {
  title: string;
  note: string;
  icon: string;
  hue: string;
  route: string;
  /** false = 未接入：图标砖灰底，点击提示而不是跳转。 */
  ready: boolean;
}

function serviceEntries(): ServiceEntry[] {
  return [
    { title: '我要报修', note: '提交故障申报', icon: '报', hue: 'orange', route: ROUTE_REPAIR_ORDERS, ready: true },
    { title: '我的进度', note: '查看处理进度', icon: '进', hue: 'teal', route: ROUTE_REPAIR_ORDERS, ready: true },
    { title: '知识问答', note: '有出处的 AI 咨询', icon: '问', hue: 'blue', route: ROUTE_KNOWLEDGE, ready: true },
    { title: '预约服务', note: '待接口确定后接入', icon: '约', hue: 'gold', route: '', ready: false }
  ];
}

/**
 * 服务 tab（本轮重设计，主参考 docs/reference/my-huawei/service-my-products-repair-entry.jpg）。
 *
 * 布局对照参考图「我的产品 → 功能卡网格 → 快捷服务」分区：
 * - 我的设备卡：从客户本人报修单的 deviceModel 派生去重（真实数据，
 *   左侧图标砖 + 右侧设备名 + 最近一张单的状态 chip），点击进对应报修单；
 *   无报修数据时显示诚实空态卡。不伪造「我的产品(9)」这类假数据。
 * - 功能卡 2×2 白卡网格（左彩色图标砖 + 右标题与说明）。
 * 设备归属完全由服务端按令牌判定，这里不传任何用户标识。
 */
@Component
export struct ServicePage {
  @Prop home: string = '';
  @Prop permissions: string[] = [];
  /** 由 HomePage 注入的导航栈：真实入口统一从这里压栈。 */
  pathStack: NavPathStack = new NavPathStack();
  onSessionExpired: () => void = () => {
  };
  private pusher: NavPusher = new NavPusher();
  @State deviceState: number = DEVICE_LOADING;
  @State devices: DeviceItem[] = [];
  @State deviceErrorText: string = '';
  /** 列表请求进行中标记：防止重试按钮连点触发并发请求。 */
  private requesting: boolean = false;

  aboutToAppear(): void {
    if (this.home !== HOME_STAFF) {
      this.loadDevices();
    }
  }

  private entries(): ServiceEntry[] {
    if (this.home !== HOME_STAFF) {
      return serviceEntries();
    }
    const entries: ServiceEntry[] = [
      { title: '报修工作台', note: '待受理与我的处理', icon: '单', hue: 'purple', route: ROUTE_STAFF_ORDERS, ready: true },
      { title: '知识问答', note: '有出处的 AI 咨询', icon: '问', hue: 'blue', route: ROUTE_KNOWLEDGE, ready: true },
      { title: '典型案例库', note: '已发布的典型案例', icon: '例', hue: 'gold', route: ROUTE_CASE_LIBRARY, ready: true }
    ];
    if (this.permissions.includes('repair:review')) {
      entries.push({ title: '备案审核', note: '审核维修备案', icon: '审', hue: 'red', route: ROUTE_STAFF_REVIEW, ready: true });
    }
    return entries;
  }

  private handleLoadError(error: Object): void {
    if (error instanceof ApiRequestError) {
      if (isSessionExpiredCode(error.code)) {
        this.onSessionExpired();
        return;
      }
      this.deviceErrorText = isNetworkErrorCode(error.code)
        ? `${error.message}（请检查服务器地址、网络与后端是否已启动）`
        : error.message;
    } else {
      this.deviceErrorText = '加载失败，请重试';
    }
  }

  /** 拉本人报修单并派生去重设备列表：同一机型只保留最近一张单的状态。 */
  private async loadDevices(): Promise<void> {
    if (this.requesting) {
      return;
    }
    this.requesting = true;
    this.deviceState = DEVICE_LOADING;
    this.deviceErrorText = '';
    try {
      const items = await RepairOrderService.listMine('', 1);
      const derived: DeviceItem[] = [];
      for (const order of items) {
        if (order.deviceModel === '') {
          continue;
        }
        let seen: boolean = false;
        for (const device of derived) {
          if (device.model === order.deviceModel) {
            seen = true;
            break;
          }
        }
        if (!seen) {
          derived.push({ model: order.deviceModel, orderId: order.id, status: order.status });
        }
      }
      this.devices = derived;
      this.deviceState = derived.length === 0 ? DEVICE_EMPTY : DEVICE_READY;
    } catch (error) {
      this.deviceState = DEVICE_ERROR;
      this.handleLoadError(error);
    } finally {
      this.requesting = false;
    }
  }

  private openEntry(entry: ServiceEntry): void {
    if (entry.route === '') {
      this.getUIContext().getPromptAction().showToast({ message: `${entry.title}未接入，接口确定后开放` });
      return;
    }
    this.pusher.push(this.pathStack, entry.route, null);
  }

  private openOrder(orderId: string): void {
    const focus: RepairOrderFocusParam = { orderId: orderId };
    this.pusher.push(this.pathStack, ROUTE_REPAIR_ORDERS, focus);
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
  deviceCard(device: DeviceItem) {
    Row({ space: CARD_GAP }) {
      IconTile({ icon: '备', hue: 'blue' })
      Column({ space: GAP_SM }) {
        Text(device.model)
          .fontSize(FONT_SUBTITLE)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(repairOrderStatusLabel(device.status))
          .fontSize(FONT_NOTE)
          .fontColor($r('app.color.brand'))
          .padding({ left: GAP_SM, right: GAP_SM, top: 2, bottom: 2 })
          .backgroundColor($r('app.color.brand_soft'))
          .borderRadius(CHIP_RADIUS)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      Text('>')
        .fontSize(FONT_SUBTITLE)
        .fontColor($r('app.color.text_secondary'))
    }
    .width('100%')
    .padding(CARD_PADDING)
    .alignItems(VerticalAlign.Center)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .onClick(() => {
      this.openOrder(device.orderId);
    })
  }

  @Builder
  deviceSection() {
    if (this.deviceState === DEVICE_LOADING) {
      LoadingPanel({ text: '正在加载设备记录…' })
    } else if (this.deviceState === DEVICE_ERROR) {
      Column() {
        ErrorPanel({
          message: this.deviceErrorText,
          onRetry: (): void => {
            this.loadDevices();
          }
        })
      }
      .width('100%')
      .backgroundColor($r('app.color.surface'))
      .borderRadius(CARD_RADIUS)
    } else if (this.deviceState === DEVICE_EMPTY) {
      // 诚实空态：没有报修单就没有设备记录，给出去报修的出口而不是假数据。
      Column({ space: GAP_SM }) {
        Text('暂无设备记录，提交报修后展示')
          .fontSize(FONT_SUBTITLE)
          .fontColor($r('app.color.text_primary'))
        Text('设备列表来自你的报修单，不单独绑定设备。')
          .fontSize(FONT_NOTE)
          .fontColor($r('app.color.text_secondary'))
        Button('去报修')
          .fontSize(FONT_NOTE)
          .height(CONTROL_HEIGHT_MD)
          .backgroundColor($r('app.color.brand'))
          .fontColor(Color.White)
          .onClick(() => {
            this.pusher.push(this.pathStack, ROUTE_REPAIR_ORDERS, null);
          })
      }
      .width('100%')
      .padding(CARD_PADDING_LG)
      .backgroundColor($r('app.color.surface'))
      .borderRadius(CARD_RADIUS)
      .alignItems(HorizontalAlign.Center)
    } else {
      ForEach(this.devices, (device: DeviceItem) => {
        this.deviceCard(device);
      }, (device: DeviceItem) => device.orderId)
    }
  }

  @Builder
  recordRow() {
    Row({ space: CARD_GAP }) {
      IconTile({ icon: '录', hue: 'green' })
      Column({ space: GAP_SM }) {
        Text('服务记录')
          .fontSize(FONT_SUBTITLE)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
        Text('全部报修单与处理记录 · 已接入')
          .fontSize(FONT_NOTE)
          .fontColor($r('app.color.text_secondary'))
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      Text('>')
        .fontSize(FONT_SUBTITLE)
        .fontColor($r('app.color.text_secondary'))
    }
    .width('100%')
    .padding(CARD_PADDING)
    .alignItems(VerticalAlign.Center)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .onClick(() => {
      this.pusher.push(this.pathStack, ROUTE_REPAIR_ORDERS, null);
    })
  }

  build() {
    Scroll() {
      Column({ space: GAP_LG }) {
        // 服务 tab 自带大标题（不再作为 NavDestination 子页）。
        Text(this.home === HOME_STAFF ? '工作人员服务' : '客户服务')
          .fontSize(FONT_TITLE)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.text_primary'))
          .width('100%')
          .textAlign(TextAlign.Start)

        if (this.home !== HOME_STAFF) {
          this.sectionTitle('报修中的设备')
          this.deviceSection()
          Text('按最近 20 条本人报修单的机型合并展示，不代表全部设备或独立设备绑定。')
            .fontSize(FONT_NOTE)
            .fontColor($r('app.color.text_secondary'))
          Button('刷新设备记录')
            .enabled(!this.requesting)
            .onClick(() => { this.loadDevices(); })
        }

        this.sectionTitle('常用服务')
        Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
          ForEach(this.entries(), (entry: ServiceEntry) => {
            EntryCard({
              icon: entry.icon,
              title: entry.title,
              note: entry.note,
              hue: entry.hue,
              ready: entry.ready,
              onSelect: (): void => {
                this.openEntry(entry);
              }
            });
          }, (entry: ServiceEntry) => entry.title + entry.route)
        }
        .width('100%')

        if (this.home !== HOME_STAFF) {
          this.sectionTitle('服务记录')
          this.recordRow()
        }
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
