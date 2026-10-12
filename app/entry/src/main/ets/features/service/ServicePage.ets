import { HOME_STAFF } from '../../core/auth/AuthContract';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { RepairOrderFocusParam, ROUTE_CASE_LIBRARY, ROUTE_PUBLIC_GUIDES, ROUTE_KNOWLEDGE, ROUTE_REPAIR_ORDERS, ROUTE_STAFF_ORDERS, ROUTE_STAFF_REVIEW } from '../../core/ui/Routes';
import { ReferenceBanner, ReferenceTitle, ReferenceShortcut, REFERENCE_BACKGROUND } from '../../core/ui/ReferencePage';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
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
  icon: Resource;
  hue: string;
  route: string;
  /** false = 未接入：图标砖灰底，点击提示而不是跳转。 */
  ready: boolean;
}

function serviceEntries(): ServiceEntry[] {
  return [
    { title: 'AI 故障问诊', note: '故障定位与排查', icon: $r('app.media.ref_shield'), hue: 'orange', route: ROUTE_KNOWLEDGE, ready: true },
    { title: '我要报修', note: '提交电脑故障', icon: $r('app.media.ref_repair'), hue: 'blue', route: ROUTE_REPAIR_ORDERS, ready: true },
    { title: '报修进度', note: '查看处理进度', icon: $r('app.media.ref_cooling'), hue: 'green', route: ROUTE_REPAIR_ORDERS, ready: true },
    { title: '维修指南', note: '查阅公开维修指南', icon: $r('app.media.ref_system'), hue: 'purple', route: ROUTE_PUBLIC_GUIDES, ready: true }
  ];
}

/** 服务主页面对照④：真实报修设备卡、两列功能卡、主题横幅与快捷入口。
 * 工作人员使用同一外观展示工作台；设备不是独立绑定数据。
 */
@Component
export struct ServicePage {
  @Prop @Watch('authChanged') authenticated: boolean = false;
  onActivities: () => void = () => {};
  onOpen: (route: string, param: Object | null) => void = () => {};
  @Prop home: string = '';
  @Prop permissions: string[] = [];
  /** 由 HomePage 注入的导航栈：真实入口统一从这里压栈。 */
  pathStack: NavPathStack = new NavPathStack();
  onSessionExpired: () => void = () => {
  };
  @State deviceState: number = DEVICE_LOADING;
  @State devices: DeviceItem[] = [];
  @State deviceErrorText: string = '';
  /** 列表请求进行中标记：防止重试按钮连点触发并发请求。 */
  private requesting: boolean = false;
  private deviceGeneration: number = 0;

  aboutToAppear(): void {
    if (this.authenticated && this.home !== HOME_STAFF) {
      this.loadDevices();
    }
  }

  aboutToDisappear(): void {
    this.requesting = false;
    this.deviceGeneration += 1;
  }

  private authChanged(): void {
    this.deviceGeneration += 1;
    this.requesting = false;
    this.devices = [];
    if (this.authenticated && this.home !== HOME_STAFF) this.loadDevices();
  }

  private entries(): ServiceEntry[] {
    if (this.home !== HOME_STAFF) {
      return serviceEntries();
    }
    const entries: ServiceEntry[] = [
      { title: '报修工作台', note: '待受理与我的处理', icon: $r('app.media.ref_repair'), hue: 'purple', route: ROUTE_STAFF_ORDERS, ready: true },
      { title: '知识问答', note: '有出处的 AI 咨询', icon: $r('app.media.ref_shield'), hue: 'blue', route: ROUTE_KNOWLEDGE, ready: true },
      { title: '典型案例库', note: '已发布的典型案例', icon: $r('app.media.ref_system'), hue: 'gold', route: ROUTE_CASE_LIBRARY, ready: true }
    ];
    if (this.permissions.includes('repair:review')) {
      entries.push({ title: '备案审核', note: '审核维修备案', icon: $r('app.media.ref_document'), hue: 'red', route: ROUTE_STAFF_REVIEW, ready: true });
    } else {
      entries.push({ title: '维修备案', note: '在已受理报修中建档', icon: $r('app.media.ref_document'), hue: 'green', route: ROUTE_STAFF_ORDERS, ready: true });
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
    const generation = ++this.deviceGeneration;
    this.requesting = true;
    this.deviceState = DEVICE_LOADING;
    this.deviceErrorText = '';
    try {
      const items = await RepairOrderService.listMine('', 1);
      if (generation !== this.deviceGeneration) return;
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
      if (generation !== this.deviceGeneration) return;
      this.deviceState = DEVICE_ERROR;
      this.handleLoadError(error);
    } finally {
      if (generation === this.deviceGeneration) this.requesting = false;
    }
  }

  private openEntry(entry: ServiceEntry): void {
    if (entry.route === '') {
      this.getUIContext().getPromptAction().showToast({ message: `${entry.title}未接入，接口确定后开放` });
      return;
    }
    this.onOpen(entry.route, null);
  }

  private openOrder(orderId: string): void {
    const focus: RepairOrderFocusParam = { orderId: orderId };
    this.onOpen(ROUTE_REPAIR_ORDERS, focus);
  }


  @Builder
  deviceCard(device: DeviceItem) {
    Row({ space: 18 }) {
      Image($r('app.media.ref_laptop_hero')).width(96).height(106).objectFit(ImageFit.Contain)
      Column({ space: 10 }) {
        Text('最近报修设备').fontSize(11).fontColor('#747A7F')
        Text(device.model).fontSize(19).fontWeight(FontWeight.Bold).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(repairOrderStatusLabel(device.status)).fontSize(12).fontColor('#477886')
          .padding({ left: 9, right: 9, top: 4, bottom: 4 }).backgroundColor('#F2F6F8').borderRadius(16)
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      Text('›').fontSize(26).fontColor('#92989D')
    }.width('100%').height(136).padding(16).backgroundColor(Color.White).borderRadius(20)
      .onClick(() => { this.openOrder(device.orderId); })
  }

  @Builder
  deviceSection() {
    if (this.home === HOME_STAFF) {
      Row({ space: 16 }) {
        Image($r('app.media.ref_repair')).width(70).height(70)
        Column({ space: 8 }) {
          Text('工作人员工作台').fontSize(20).fontWeight(FontWeight.Bold)
          Text('受理报修 · 跟进处理 · 维修备案').fontSize(12).fontColor('#747A7F')
          Button('查看待处理报修').fontSize(12).height(30).fontColor('#2877D9').backgroundColor('#F0F6FD')
            .onClick(() => { this.onOpen(ROUTE_STAFF_ORDERS, null); })
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }.width('100%').height(136).padding(18).backgroundColor(Color.White).borderRadius(20)
    } else if (this.authenticated && this.deviceState === DEVICE_LOADING) {
      Column() { LoadingPanel({ text: '正在加载报修设备…' }) }
        .width('100%').height(136).backgroundColor(Color.White).borderRadius(20)
    } else if (this.authenticated && this.deviceState === DEVICE_ERROR) {
      Column() {
        ErrorPanel({ message: this.deviceErrorText, onRetry: (): void => { this.loadDevices(); } })
      }.width('100%').backgroundColor(Color.White).borderRadius(20)
    } else if (this.authenticated && this.deviceState === DEVICE_READY) {
      Swiper() {
        ForEach(this.devices, (device: DeviceItem) => { this.deviceCard(device); }, (device: DeviceItem) => device.orderId)
      }.height(136).width('100%').loop(false).indicator(false)
    } else {
      Row({ space: 14 }) {
        Image($r('app.media.ref_laptop_hero')).width(98).height(108).objectFit(ImageFit.Contain)
        Column({ space: 8 }) {
          Text(this.authenticated ? '暂无报修设备' : '我的电脑').fontSize(21).fontWeight(FontWeight.Bold)
          Text(this.authenticated ? '提交报修后，这里展示设备与进度' : '登录查看自己的报修设备与进度').fontSize(12).fontColor('#737B81')
          Button(this.authenticated ? '去报修' : '登录查看').fontSize(12).height(30)
            .fontColor('#2877D9').backgroundColor('#F0F6FD')
            .onClick(() => { this.onOpen(ROUTE_REPAIR_ORDERS, null); })
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      }.width('100%').height(136).padding(16).backgroundColor(Color.White).borderRadius(20)
    }
  }

  @Builder
  functionCard(entry: ServiceEntry) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        Image(entry.icon).width(36).height(40).objectFit(ImageFit.Contain)
        Column({ space: 4 }) {
          Text(entry.title).fontSize(14).fontWeight(FontWeight.Bold).fontColor('#191D20').maxLines(1)
          Text(entry.note).fontSize(11).fontColor('#6D757B').maxLines(2)
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      }.width('100%').padding(16)
    }.width('49%').height(76).backgroundColor(Color.White).borderRadius(20).margin({ bottom: 8 })
      .onClick(() => { this.openEntry(entry); })
  }

  build() {
    Scroll() {
      Column({ space: 10 }) {
        ReferenceTitle({
          title: this.home === HOME_STAFF ? '工作台' : '我的电脑',
          onConsult: (): void => { this.onOpen(ROUTE_KNOWLEDGE, null); },
          onRecords: (): void => { this.onOpen(this.home === HOME_STAFF ? ROUTE_STAFF_ORDERS : ROUTE_REPAIR_ORDERS, null); }
        })
        this.deviceSection()
        Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
          ForEach(this.entries(), (entry: ServiceEntry) => { this.functionCard(entry); }, (entry: ServiceEntry) => entry.title)
        }.width('100%')
        Text('精选服务').fontSize(20).fontWeight(FontWeight.Bold).margin({ top: 8 })
        ReferenceBanner({
          title: '电脑医院  校园服务', subtitle: '先排查，再安心维修',
          image: $r('app.media.ref_service_hero'), actionText: '查看维修指南', bannerHeight: 150,
          onSelect: (): void => { this.onOpen(ROUTE_PUBLIC_GUIDES, null); }
        })
        Text('快捷服务').fontSize(20).fontWeight(FontWeight.Bold).margin({ top: 15 })
        Row() {
          ReferenceShortcut({ title: '故障问诊', icon: $r('app.media.ref_shield'), onSelect: (): void => { this.onOpen(ROUTE_KNOWLEDGE, null); } })
          ReferenceShortcut({ title: this.home === HOME_STAFF ? '报修工作台' : '服务进度', icon: $r('app.media.ref_cooling'), onSelect: (): void => { this.onOpen(this.home === HOME_STAFF ? ROUTE_STAFF_ORDERS : ROUTE_REPAIR_ORDERS, null); } })
          ReferenceShortcut({ title: '维修指南', icon: $r('app.media.ref_system'), onSelect: (): void => { this.onOpen(ROUTE_PUBLIC_GUIDES, null); } })
          ReferenceShortcut({ title: '近期活动', icon: $r('app.media.ref_activity'), onSelect: this.onActivities })
        }.width('100%')
        if (this.authenticated && this.home !== HOME_STAFF) {
          Text('设备根据最近一页（最多 20 条）本人报修单的机型展示。').fontSize(10).fontColor('#8C949A')
          Button('刷新设备记录').fontSize(12).backgroundColor('#E9EFF4').fontColor('#596874')
            .enabled(!this.requesting).onClick(() => { this.loadDevices(); })
        }
      }.width('100%').padding({ left: 16, right: 16, bottom: 90 }).alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top).backgroundColor(REFERENCE_BACKGROUND)
  }
}
