import { roleLabelFor, HOME_STAFF } from '../../core/auth/AuthContract';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ROUTE_CASE_LIBRARY, ROUTE_PUBLIC_GUIDES, ROUTE_KNOWLEDGE, ROUTE_REPAIR_ORDERS, ROUTE_STAFF_ORDERS, ROUTE_STAFF_REVIEW } from '../../core/ui/Routes';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { ReferenceRoundAction, REFERENCE_BACKGROUND } from '../../core/ui/ReferencePage';
import { isNetworkErrorCode } from '../knowledge/KnowledgeFlow';
import { ProfileService } from './ProfileService';

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

/** 我的主页面对照②：真实会话卡、本人报修统计、信息宫格与常用服务。
 * 未接入功能直接标注；维修记录不复用报修列表冒充 RepairRecord。
 */
@Component
export struct ProfilePage {
  @Prop displayName: string = '';
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
  @State identityBusy: boolean = false;
  private identityGeneration: number = 0;
  private requesting: boolean = false;
  private generation: number = 0;
  onOpen: (route: string, param: Object | null) => void = () => {};

  aboutToAppear(): void {
    if (this.home !== HOME_STAFF) {
      this.loadStats();
    }
  }

  aboutToDisappear(): void { this.generation += 1; this.identityGeneration += 1; this.requesting = false; this.identityBusy = false; }

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
      const stats = await ProfileService.stats();
      if (generation !== this.generation) return;
      this.totalCount = stats.total;
      this.completedCount = stats.completed;
      this.pendingCount = stats.pending;
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
      { title: '活动报名', icon: $r('app.media.ref_flag'), note: '暂未接入', route: '' },
      { title: '收藏', icon: $r('app.media.ref_star'), note: '暂未接入', route: '' },
      { title: '消息', icon: $r('app.media.ref_message'), note: '暂未接入', route: '' },
      { title: '个人资料', icon: $r('app.media.ref_profile'), note: '查看资料', route: 'profile-info' }
    ];
  }

  private staffEntries(): ProfileEntry[] {
    const entries: ProfileEntry[] = [
      { title: '进入工作台', icon: $r('app.media.ref_document'), note: '', route: ROUTE_STAFF_ORDERS },
      { title: '典型案例库', icon: $r('app.media.ref_grid'), note: '', route: ROUTE_CASE_LIBRARY },
      { title: '知识问答', icon: $r('app.media.ref_star'), note: '', route: ROUTE_KNOWLEDGE }
    ];
    if (this.permissions.includes('repair:review')) {
      entries.push({ title: '备案审核', icon: $r('app.media.ref_flag'), note: '', route: ROUTE_STAFF_REVIEW });
    }
    entries.push({ title: '消息', icon: $r('app.media.ref_message'), note: '暂未接入', route: '' });
    entries.push({ title: '个人资料', icon: $r('app.media.ref_profile'), note: '查看资料', route: 'profile-info' });
    return entries;
  }

  private openEntry(entry: ProfileEntry): void {
    if (entry.route === 'profile-info') {
      this.showIdentity();
    } else if (entry.route === '') {
      this.getUIContext().getPromptAction().showToast({ message: `${entry.title}暂未接入` });
    } else {
      this.onOpen(entry.route, null);
    }
  }

  /** 资料重新查询真实会话，离开页面后忽略迟到响应。 */
  private async showIdentity(): Promise<void> {
    if (this.identityBusy) return;
    this.identityBusy = true;
    const generation = ++this.identityGeneration;
    try {
      const identity = await ProfileService.identity();
      if (generation !== this.identityGeneration) return;
      this.getUIContext().showAlertDialog({
        title: '个人资料',
        message: '姓名：' + (identity.displayName || '未命名用户') + '\n角色：' + roleLabelFor(identity.roles) +
          '\n账号状态：已登录' + (identity.mustChangePassword ? '\n请在 Web 端修改初始密码' : '') + '\n资料编辑暂未接入',
        confirm: { value: '知道了', action: (): void => {} }
      });
    } catch (error) {
      if (generation !== this.identityGeneration) return;
      if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) {
        this.onSessionExpired();
      } else {
        this.getUIContext().getPromptAction().showToast({ message: error instanceof ApiRequestError ? error.message : '资料加载失败，请重试' });
      }
    } finally {
      if (generation === this.identityGeneration) this.identityBusy = false;
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
        Image(icon).width(17).height(17).objectFit(ImageFit.Contain)
        Text(title).fontSize(12).fontWeight(FontWeight.Medium).fontColor('#565B5E').maxLines(1)
      }.justifyContent(FlexAlign.Center).width('100%')
    }.width('33.33%').height(42).padding(0).backgroundColor('#F6F7F8').borderRadius(0)
      .accessibilityText(title).onClick(() => { this.onOpen(route, null); })
  }

  @Builder
  profileCard() {
    Column({ space: 18 }) {
      Row({ space: 11 }) {
        Button({ type: ButtonType.Circle }) {
          Image($r('app.media.profile_avatar')).width(48).height(48).objectFit(ImageFit.Contain)
        }.width(48).height(48).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText('查看个人资料').enabled(!this.identityBusy).onClick(() => { this.showIdentity(); })
        Column({ space: 4 }) {
          Text(this.displayName === '' ? '未命名用户' : this.displayName).fontSize(19).fontWeight(FontWeight.Bold)
            .fontColor('#191D20').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Row({ space: 3 }) {
            Image($r('app.media.profile_role')).width(12).height(12)
            Text(this.roleText).fontSize(10).fontWeight(FontWeight.Medium).fontColor('#635333')
          }.padding({ left: 5, right: 7, top: 2, bottom: 2 }).backgroundColor('#F4EBD6').borderRadius(10)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Button(this.logoutBusy ? '退出中…' : '退出 ›').fontSize(12).height(30).padding({ left: 5, right: 0 })
          .fontColor('#7E8285').backgroundColor(Color.Transparent).enabled(!this.logoutBusy)
          .onClick(() => { this.handleLogout(); })
      }.width('100%')
      Row() {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 6 }) {
            Text('我的电脑医院').fontSize(14).fontWeight(FontWeight.Medium).fontColor('#62686D')
            Text('›').fontSize(24).fontColor('#999EA2')
          }
        }.padding(0).height(30).backgroundColor(Color.Transparent).layoutWeight(1)
          .accessibilityText('查看个人资料').enabled(!this.identityBusy).onClick(() => { this.showIdentity(); })
        Button(this.home === HOME_STAFF ? '进入工作台' : '我的报修').fontSize(12).fontWeight(FontWeight.Medium)
          .height(30).padding({ left: 16, right: 16 }).fontColor('#665331')
          .linearGradient({ angle: 90, colors: [['#EDD7A7', 0], ['#D8BB82', 1]] }).borderRadius(18)
          .onClick(() => { this.onOpen(this.home === HOME_STAFF ? ROUTE_STAFF_ORDERS : ROUTE_REPAIR_ORDERS, null); })
      }.width('100%')
      Row() {
        this.profileShortcut('维修指南', $r('app.media.ref_document'), ROUTE_PUBLIC_GUIDES)
        this.profileShortcut('故障问诊', $r('app.media.home_headset'), ROUTE_KNOWLEDGE)
        this.profileShortcut('服务进度', $r('app.media.ref_flag'), this.home === HOME_STAFF ? ROUTE_STAFF_ORDERS : ROUTE_REPAIR_ORDERS)
      }.width('100%').borderRadius(10).clip(true)
    }.width('100%').padding({ left: 12, right: 12, top: 12, bottom: 12 }).backgroundColor(Color.White).borderRadius(20)
  }

  @Builder
  statCell(label: string, value: number, icon: Resource) {
    Column({ space: 3 }) {
      Image(icon).width(34).height(34).objectFit(ImageFit.Contain).margin({ bottom: 5 })
      Text(label).fontSize(12).fontWeight(FontWeight.Medium).fontColor('#252B2F')
      Text(String(value)).fontSize(12).fontColor('#72777B')
    }.layoutWeight(1).alignItems(HorizontalAlign.Center)
      .accessibilityText(label + '，' + value + '条')
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
          this.statCell('报修单', this.totalCount, $r('app.media.profile_orders'))
          this.statCell('处理中', this.pendingCount, $r('app.media.profile_pending'))
          this.statCell('已完结', this.completedCount, $r('app.media.profile_completed'))
        }.width('100%')
        Row() {
          Text('全部本人报修单').fontSize(9).fontColor('#92989D').layoutWeight(1)
          Button('刷新').fontSize(10).height(20).padding({ left: 8, right: 0 })
            .backgroundColor(Color.Transparent).fontColor('#78838C').accessibilityText('刷新本人报修统计')
            .onClick(() => { this.loadStats(); })
        }.width('100%')
      }
    }.width('100%').padding({ left: 16, right: 16, top: 18, bottom: 8 }).backgroundColor(Color.White).borderRadius(20)
  }

  @Builder
  informationEntry(entry: ProfileEntry) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 6 }) {
        Image(entry.icon).width(30).height(30).objectFit(ImageFit.Contain)
        Text(entry.title).fontSize(12).fontWeight(FontWeight.Medium).fontColor('#242A2E').maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(entry.route === 'profile-info' && this.identityBusy ? '加载中…' : entry.note)
          .fontSize(9).fontColor('#969CA1').height(12).maxLines(1)
      }.width('100%').padding({ top: 10, bottom: 10 })
    }.width('33.33%').padding(0).backgroundColor(Color.Transparent).borderRadius(12)
      .accessibilityText(entry.title + (entry.note === '' ? '' : '，' + entry.note))
      .enabled(entry.route !== 'profile-info' || !this.identityBusy)
      .onClick(() => { this.openEntry(entry); })
  }

  @Builder
  serviceRow(title: string, description: string, action: string, route: string) {
    Row({ space: 12 }) {
      Column({ space: 4 }) {
        Text(title).fontSize(14).fontWeight(FontWeight.Medium).fontColor('#252B2F')
        Text(description).fontSize(11).fontColor('#91979C')
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Button(action).fontSize(12).fontWeight(FontWeight.Medium).height(30)
        .padding({ left: 14, right: 14 }).fontColor('#096DE0').backgroundColor('#F6F7F8').borderRadius(18)
        .onClick(() => { this.onOpen(route, null); })
    }.width('100%').padding({ top: 12, bottom: 12 })
  }

  build() {
    Scroll() {
      Column({ space: 12 }) {
        Row({ space: 7 }) {
          Text('我的').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#101416').layoutWeight(1)
          ReferenceRoundAction({ icon: $r('app.media.ref_scan'), label: '扫码暂未接入',
            onSelect: (): void => { this.getUIContext().getPromptAction().showToast({ message: '扫码暂未接入' }); } })
          ReferenceRoundAction({ icon: $r('app.media.home_headset'), label: 'AI 故障问诊',
            onSelect: (): void => { this.onOpen(ROUTE_KNOWLEDGE, null); } })
          ReferenceRoundAction({ icon: $r('app.media.home_message'), label: '消息暂未接入',
            onSelect: (): void => { this.getUIContext().getPromptAction().showToast({ message: '消息暂未接入' }); } })
        }.width('100%').height(64).padding({ top: 3, bottom: 3 })
        this.profileCard()
        if (this.home !== HOME_STAFF) { this.statsSection() }
        Column({ space: 14 }) {
          Text('我的信息').fontSize(18).fontWeight(FontWeight.Bold).fontColor('#191D20').width('100%')
          Flex({ wrap: FlexWrap.Wrap }) {
            ForEach(this.home === HOME_STAFF ? this.staffEntries() : this.customerEntries(), (entry: ProfileEntry) => {
              this.informationEntry(entry)
            }, (entry: ProfileEntry) => entry.title)
          }.width('100%')
        }.width('100%').padding({ left: 12, right: 12, top: 22, bottom: 12 }).backgroundColor(Color.White).borderRadius(20)
        Column() {
          Text('常用服务').fontSize(18).fontWeight(FontWeight.Bold).fontColor('#191D20').width('100%').margin({ bottom: 4 })
          this.serviceRow('电脑有问题？先问诊', '结合维修资料，获取有来源的建议', '去问诊', ROUTE_KNOWLEDGE)
          Divider().color('#EEF0F2').strokeWidth(0.5)
          this.serviceRow('电脑医院维修指南', '查阅公开排查方法与维修知识', '去查看', ROUTE_PUBLIC_GUIDES)
        }.width('100%').padding({ left: 12, right: 12, top: 22, bottom: 8 }).backgroundColor(Color.White).borderRadius(20)
      }.width('100%').padding({ left: 16, right: 16, bottom: 110 }).alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top).backgroundColor(REFERENCE_BACKGROUND)
  }
}
