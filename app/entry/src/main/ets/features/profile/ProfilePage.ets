import { roleLabelFor, HOME_STAFF } from '../../core/auth/AuthContract';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ROUTE_CASE_LIBRARY, ROUTE_PUBLIC_GUIDES, ROUTE_KNOWLEDGE, ROUTE_REPAIR_ORDERS, ROUTE_STAFF_ORDERS, ROUTE_STAFF_REVIEW } from '../../core/ui/Routes';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { ReferenceRoundAction, ReferenceShortcut, REFERENCE_BACKGROUND } from '../../core/ui/ReferencePage';
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
        Image(icon).width(18).height(18)
        Text(title).fontSize(12).fontWeight(FontWeight.Medium).fontColor('#3A4145')
      }.justifyContent(FlexAlign.Center).width('100%')
    }.width('33.33%').height(42).backgroundColor(Color.Transparent).borderRadius(8)
      .onClick(() => { this.onOpen(route, null); })
  }

  @Builder
  profileCard() {
    Column({ space: 20 }) {
      Row({ space: 12 }) {
        Image($r('app.media.profile_avatar')).width(50).height(50).objectFit(ImageFit.Contain)
        Column({ space: 6 }) {
          Text(this.displayName === '' ? '未命名用户' : this.displayName).fontSize(20).fontWeight(FontWeight.Bold)
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
      Image(icon).width(30).height(30)
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
        Row() {
          Text('全部本人报修单 · 不含已删除记录').fontSize(10).fontColor('#8E969C').layoutWeight(1)
          Button('刷新').fontSize(11).height(26).backgroundColor(Color.Transparent).fontColor('#1676E5')
            .onClick(() => { this.loadStats(); })
        }.width('100%')
      }
    }.width('100%').padding(14).backgroundColor(Color.White).borderRadius(20)
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
          ReferenceRoundAction({ icon: $r('app.media.home_message'), label: '消息暂未接入',
            onSelect: (): void => { this.getUIContext().getPromptAction().showToast({ message: '消息暂未接入' }); } })
        }.width('100%').height(50)
        this.profileCard()
        if (this.home !== HOME_STAFF) { this.statsSection() }
        Column({ space: 20 }) {
          Text('我的信息').fontSize(20).fontWeight(FontWeight.Bold).width('100%')
          Flex({ wrap: FlexWrap.Wrap }) {
            ForEach(this.home === HOME_STAFF ? this.staffEntries() : this.customerEntries(), (entry: ProfileEntry) => {
              ReferenceShortcut({
                title: entry.title, icon: entry.icon, note: entry.route === 'profile-info' && this.identityBusy ? '加载中…' : entry.note, itemWidth: '33.33%',
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
