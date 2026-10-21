import { ROUTE_REPAIR_RECORDS } from '../../core/ui/Routes';
import { ROUTE_MY_REGISTRATIONS, ROUTE_STAFF_ACTIVITIES, ROUTE_MANAGEMENT } from '../../core/ui/Routes';
import { RecordListParam } from '../repair/RepairRecordsPage';
import { HOME_STAFF } from '../../core/auth/AuthContract';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ROUTE_CASE_LIBRARY, ROUTE_PUBLIC_GUIDES, ROUTE_KNOWLEDGE, ROUTE_PASSWORD_CHANGE, ROUTE_REPAIR_ORDERS, ROUTE_STAFF_ORDERS, ROUTE_STAFF_REVIEW } from '../../core/ui/Routes';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { ReferenceRoundAction, ReferenceShortcut, REFERENCE_BACKGROUND } from '../../core/ui/ReferencePage';
import { isNetworkErrorCode } from '../knowledge/KnowledgeFlow';
import { RepairOrderView, REPAIR_ORDER_COMPLETED, REPAIR_ORDER_ACCEPTED, REPAIR_ORDER_REPAIRING, REPAIR_ORDER_SUBMITTED } from '../repair/RepairOrderContract';
import { RepairOrderService } from '../repair/RepairOrderService';
import { ROUTE_PERSONAL_PROFILE } from '../../core/ui/Routes';
import { PersonalProfileService } from './PersonalProfileService';
import { ROUTE_FAVORITES, ROUTE_MESSAGES } from '../../core/ui/Routes';
import { ROUTE_SHOPPING_MY_PRODUCTS, ROUTE_SHOPPING_ORDERS, ROUTE_SHOPPING_SELLER_ORDERS } from '../../core/ui/Routes';

/** 统计区块的加载状态（与 StatePanel 配套）。 */
const STATS_LOADING: number = 0;
const STATS_READY: number = 1;
const STATS_ERROR: number = 2;

interface ProfileEntry {
  title: string;
  icon: Resource;
  note: string;
  route: string;
}

/** 我的主页面对照②：真实会话卡、最近一页统计、信息宫格与常用服务。
 * 未接入功能直接标注；维修记录不复用报修列表冒充 RepairRecord。
 */
@Component
export struct ProfilePage {
  @Prop @Watch('loadCardProfile') displayName: string = '';
  @Prop roleText: string = '';
  @Prop home: string = '';
  @Prop permissions: string[] = [];
  pathStack: NavPathStack = new NavPathStack();
  onLogout: () => Promise<void> = async () => {
  };
  onSessionExpired: () => void = () => {
  };
  @State statsState: number = STATS_LOADING;
  @State totalCount: number = 0;
  @State pendingCount: number = 0;
  @State completedCount: number = 0;
  @State statsErrorText: string = '';
  @State logoutBusy: boolean = false;
  @State cardName: string = '';
  private cardGeneration: number = 0;
  private requesting: boolean = false;
  private generation: number = 0;
  onOpen: (route: string, param: Object | null) => void = () => {};

  aboutToAppear(): void {
    this.loadCardProfile();
    if (this.home !== HOME_STAFF) {
      this.loadStats();
    }
  }

  aboutToDisappear(): void { this.generation += 1; this.cardGeneration += 1; this.requesting = false; }

  /** 会话展示名可能早于成员昵称修改；从本人资料读取卡片名称，不改写成员账号字段。 */
  private async loadCardProfile(): Promise<void> {
    const generation = ++this.cardGeneration;
    this.cardName = '';
    if (this.home === HOME_STAFF && !this.permissions.includes('member.profile.read_self')) return;
    try {
      const name = this.home === HOME_STAFF
        ? (await PersonalProfileService.member()).profile.displayName
        : (await PersonalProfileService.customer()).displayName;
      if (generation === this.cardGeneration) this.cardName = name;
    } catch (error) {
      if (generation === this.cardGeneration && error instanceof ApiRequestError && isSessionExpiredCode(error.code)) this.onSessionExpired();
      // 网络失败时仍显示当前会话身份；编辑页提供完整错误与重试，不使用假资料。
    }
  }

  private handleError(error: Object): void {
    if (error instanceof ApiRequestError) {
      if (isSessionExpiredCode(error.code)) {
        this.onSessionExpired();
        return;
      }
      this.statsErrorText = isNetworkErrorCode(error.code)
        ? `${error.message}（请检查服务器地址、网络与后端是否已启动）`
        : error.message;
    } else {
      this.statsErrorText = '加载失败，请重试';
    }
  }

  private async loadStats(): Promise<void> {
    if (this.requesting) {
      return;
    }
    const generation = ++this.generation;
    this.requesting = true;
    this.statsState = STATS_LOADING;
    this.statsErrorText = '';
    try {
      const items = await RepairOrderService.listMine('', 1);
      if (generation !== this.generation) return;
      this.totalCount = items.length;
      this.completedCount = items.filter((order: RepairOrderView) => order.status === REPAIR_ORDER_COMPLETED).length;
      this.pendingCount = items.filter((order: RepairOrderView) =>
        order.status === REPAIR_ORDER_SUBMITTED || order.status === REPAIR_ORDER_ACCEPTED || order.status === REPAIR_ORDER_REPAIRING).length;
      this.statsState = STATS_READY;
    } catch (error) {
      if (generation !== this.generation) return;
      this.statsState = STATS_ERROR;
      this.handleError(error);
    } finally {
      if (generation === this.generation) this.requesting = false;
    }
  }

  private customerEntries(): ProfileEntry[] {
    return [
      { title: '我的报修', icon: $r('app.media.ref_document'), note: '', route: ROUTE_REPAIR_ORDERS },
      { title: '维修记录', icon: $r('app.media.ref_grid'), note: '暂未接入', route: '' },
      { title: '我的报名', icon: $r('app.media.ref_flag'), note: '', route: ROUTE_MY_REGISTRATIONS },
      { title: '我的购物订单', icon: $r('app.media.ref_document'), note: '', route: ROUTE_SHOPPING_ORDERS },
      { title: '我发布的商品', icon: $r('app.media.ref_grid'), note: '', route: ROUTE_SHOPPING_MY_PRODUCTS },
      { title: '卖家订单', icon: $r('app.media.ref_message'), note: '', route: ROUTE_SHOPPING_SELLER_ORDERS },
      { title: '收藏', icon: $r('app.media.ref_star'), note: '', route: ROUTE_FAVORITES },
      { title: '消息', icon: $r('app.media.ref_message'), note: '', route: ROUTE_MESSAGES },
      { title: '修改密码', icon: $r('app.media.ref_flag'), note: '', route: ROUTE_PASSWORD_CHANGE },
      { title: '个人资料', icon: $r('app.media.ref_profile'), note: '', route: ROUTE_PERSONAL_PROFILE }
    ];
  }

  private staffEntries(): ProfileEntry[] {
    const entries: ProfileEntry[] = [
      { title: '本人维修备案', icon: $r('app.media.ref_document'), note: '', route: ROUTE_REPAIR_RECORDS },
      { title: '已审核备案库', icon: $r('app.media.ref_grid'), note: '', route: ROUTE_REPAIR_RECORDS },
      { title: '我的报名', icon: $r('app.media.ref_flag'), note: '', route: ROUTE_MY_REGISTRATIONS },
      { title: '我的购物订单', icon: $r('app.media.ref_document'), note: '', route: ROUTE_SHOPPING_ORDERS },
      { title: '我发布的商品', icon: $r('app.media.ref_grid'), note: '', route: ROUTE_SHOPPING_MY_PRODUCTS },
      { title: '卖家订单', icon: $r('app.media.ref_message'), note: '', route: ROUTE_SHOPPING_SELLER_ORDERS },
      { title: '收藏', icon: $r('app.media.ref_star'), note: '', route: ROUTE_FAVORITES },
      { title: '个人资料', icon: $r('app.media.ref_profile'), note: '', route: ROUTE_PERSONAL_PROFILE },
      { title: '进入工作台', icon: $r('app.media.ref_document'), note: '', route: ROUTE_STAFF_ORDERS },
      { title: '修改密码', icon: $r('app.media.ref_flag'), note: '', route: ROUTE_PASSWORD_CHANGE },
      { title: '典型案例库', icon: $r('app.media.ref_grid'), note: '', route: ROUTE_CASE_LIBRARY },
      { title: '知识问答', icon: $r('app.media.ref_star'), note: '', route: ROUTE_KNOWLEDGE }
    ];
    if (this.permissions.includes('repair:review')) {
      entries.push({ title: '备案审核', icon: $r('app.media.ref_flag'), note: '', route: ROUTE_STAFF_REVIEW });
    }
    entries.push({ title: '消息', icon: $r('app.media.ref_message'), note: '', route: ROUTE_MESSAGES });
    if (this.permissions.includes('activity:staff')) entries.push({ title: '成员活动', icon: $r('app.media.ref_activity'), note: '', route: ROUTE_STAFF_ACTIVITIES });
    if (this.permissions.includes('activity:admin')) entries.push({ title: '管理', icon: $r('app.media.ref_grid'), note: '', route: ROUTE_MANAGEMENT });
    return entries;
  }

  private openEntry(entry: ProfileEntry): void {
    if (entry.route === '') {
      this.getUIContext().getPromptAction().showToast({ message: `${entry.title}暂未接入` });
    } else if (entry.route === ROUTE_REPAIR_RECORDS) {
      const param: RecordListParam = { library: entry.title === '已审核备案库' };
      this.onOpen(entry.route, param);
    } else {
      this.onOpen(entry.route, null);
    }
  }

  private async handleLogout(): Promise<void> {
    if (this.logoutBusy) {
      return;
    }
    this.logoutBusy = true;
    try {
      await this.onLogout();
    } finally {
      this.logoutBusy = false;
    }
  }


  @Builder
  profileShortcut(title: string, icon: Resource, route: string) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 6 }) {
        Image(icon).width(18).height(18)
        Text(title).fontSize(12).fontWeight(FontWeight.Medium).fontColor('#3A4145')
      }.justifyContent(FlexAlign.Center).width('100%')
    }.width('33.33%').height(42).backgroundColor(Color.Transparent).borderRadius(8)
      .onClick(() => { this.onOpen(route, null); })
  }

  @Builder
  profileCard() {
    Column({ space: 16 }) {
      Row({ space: 12 }) {
        Image($r('app.media.profile_avatar')).width(50).height(50).borderRadius(25)
        Column({ space: 6 }) {
          Text(this.cardName || this.displayName || '未命名用户').fontSize(20).fontWeight(FontWeight.Bold)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.roleText).fontSize(11).fontWeight(FontWeight.Medium).fontColor('#6F5B35')
            .padding({ left: 8, right: 8, top: 2, bottom: 2 }).backgroundColor('#F3E8D0').borderRadius(12)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Button(this.logoutBusy ? '退出中…' : '退出 ›').fontSize(13).height(32)
          .fontColor('#737A80').backgroundColor(Color.Transparent).enabled(!this.logoutBusy)
          .onClick(() => { this.handleLogout(); })
      }.width('100%')
      Row() {
        Text('我的电脑医院').fontSize(15).fontWeight(FontWeight.Medium).fontColor('#62686D').layoutWeight(1)
        Button(this.home === HOME_STAFF ? '进入工作台' : '我的报修').fontSize(13).height(31)
          .fontColor('#6D5733').backgroundColor('#E6CF9E')
          .onClick(() => { this.onOpen(this.home === HOME_STAFF ? ROUTE_STAFF_ORDERS : ROUTE_REPAIR_ORDERS, null); })
      }.width('100%')
      Row() {
        this.profileShortcut('维修指南', $r('app.media.ref_document'), ROUTE_PUBLIC_GUIDES)
        this.profileShortcut('故障问诊', $r('app.media.home_headset'), ROUTE_KNOWLEDGE)
        this.profileShortcut('服务进度', $r('app.media.ref_flag'), this.home === HOME_STAFF ? ROUTE_STAFF_ORDERS : ROUTE_REPAIR_ORDERS)
      }.width('100%').backgroundColor('#F7F8F9').borderRadius(12)
    }.width('100%').padding(14).backgroundColor(Color.White).borderRadius(20)
  }

  @Builder
  statCell(label: string, value: number, icon: Resource) {
    Column({ space: 6 }) {
      Image(icon).width(28).height(28)
      Text(label).fontSize(12).fontColor('#252B2F')
      Text(`${value}`).fontSize(12).fontColor('#7B8287')
    }.layoutWeight(1).alignItems(HorizontalAlign.Center)
  }

  @Builder
  statsSection() {
    Column({ space: 10 }) {
      if (this.statsState === STATS_LOADING) {
        LoadingPanel({ text: '正在加载报修统计…' })
      } else if (this.statsState === STATS_ERROR) {
        ErrorPanel({ message: this.statsErrorText, onRetry: (): void => { this.loadStats(); } })
      } else {
        Row() {
          this.statCell('报修单', this.totalCount, $r('app.media.ref_disk'))
          this.statCell('处理中', this.pendingCount, $r('app.media.ref_activity'))
          this.statCell('已完结', this.completedCount, $r('app.media.ref_shield'))
        }.width('100%')
        Text('最近一页本人报修单（最多 20 条）').fontSize(10).fontColor('#8E969C')
      }
    }.width('100%').padding(14).backgroundColor(Color.White).borderRadius(20)
      .onClick(() => { this.loadStats(); })
  }

  build() {
    Scroll() {
      Column({ space: 14 }) {
        Row({ space: 7 }) {
          Text('我的').fontSize(28).fontWeight(FontWeight.Bold).layoutWeight(1)
          ReferenceRoundAction({ icon: $r('app.media.ref_scan'), label: '扫码暂未接入',
            onSelect: (): void => { this.getUIContext().getPromptAction().showToast({ message: '扫码暂未接入' }); } })
          ReferenceRoundAction({ icon: $r('app.media.home_headset'), label: 'AI 故障问诊',
            onSelect: (): void => { this.onOpen(ROUTE_KNOWLEDGE, null); } })
          ReferenceRoundAction({ icon: $r('app.media.home_message'), label: '站内消息',
            onSelect: (): void => { this.onOpen(ROUTE_MESSAGES, null); } })
        }.width('100%').height(50)
        this.profileCard()
        if (this.home !== HOME_STAFF) { this.statsSection() }
        Column({ space: 20 }) {
          Text('我的信息').fontSize(20).fontWeight(FontWeight.Bold).width('100%')
          Flex({ wrap: FlexWrap.Wrap }) {
            ForEach(this.home === HOME_STAFF ? this.staffEntries() : this.customerEntries(), (entry: ProfileEntry) => {
              ReferenceShortcut({
                title: entry.title, icon: entry.icon, note: entry.note,
                onSelect: (): void => { this.openEntry(entry); }
              })
            }, (entry: ProfileEntry) => entry.title)
          }.width('100%')
        }.width('100%').padding({ left: 12, right: 12, top: 24, bottom: 20 })
          .backgroundColor(Color.White).borderRadius(20)
        Column({ space: 18 }) {
          Text('常用服务').fontSize(20).fontWeight(FontWeight.Bold).width('100%')
          Row() {
            Text('电脑有问题？先从故障问诊开始').fontSize(14).layoutWeight(1)
            Button('去问诊').fontSize(12).height(29).fontColor('#1676E5').backgroundColor('#F3F6FA')
              .onClick(() => { this.onOpen(ROUTE_KNOWLEDGE, null); })
          }.width('100%')
          Divider().color('#EAEDEF')
          Row() {
            Text('查阅电脑医院公开维修指南').fontSize(14).layoutWeight(1)
            Button('去查看').fontSize(12).height(29).fontColor('#1676E5').backgroundColor('#F3F6FA')
              .onClick(() => { this.onOpen(ROUTE_PUBLIC_GUIDES, null); })
          }.width('100%')
        }.width('100%').padding(16).backgroundColor(Color.White).borderRadius(20)
      }.width('100%').padding({ left: 16, right: 16, bottom: 90 }).alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top).backgroundColor(REFERENCE_BACKGROUND)
  }
}
