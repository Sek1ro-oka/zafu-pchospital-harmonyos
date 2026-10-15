import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { LoadingPanel, ErrorPanel } from '../../core/ui/StatePanel';
import { ROUTE_MY_REGISTRATION } from '../../core/ui/Routes';
import { MyRegistration, RegistrationParam, activityTime, activityIssueLabel, registrationStatusLabel } from './ActivityContract';
import { ActivityService } from './ActivityService';
import { ActivityRequestGuard } from './ActivityRequestGuard';
@Component
export struct MyRegistrationsPage {
  @Prop @Watch('refresh') refreshVersion: number = 0;
  onOpen: (route: string, param: Object | null) => void = () => {};
  onSessionExpired: () => void = () => {};
  @State items: MyRegistration[] = [];
  @State loading: boolean = false;
  @State errorText: string = '';
  @State hasMore: boolean = false;
  @State total: number = 0;
  private page: number = 0;
  private retryReset: boolean = true;
  private guard: ActivityRequestGuard = new ActivityRequestGuard();
  aboutToAppear(): void { this.load(true); }
  aboutToDisappear(): void { this.guard.invalidate(); this.loading = false; }
  private refresh(): void { this.guard.invalidate(); this.loading = false; this.load(true); }
  private async load(reset: boolean): Promise<void> {
    if (this.loading) return;
    const ticket = this.guard.begin(), next = reset ? 1 : this.page + 1;
    this.loading = true; this.errorText = ''; this.retryReset = reset;
    if (reset) { this.items = []; this.page = 0; this.hasMore = false; this.total = 0; }
    try {
      const result = await ActivityService.mine(next);
      if (!this.guard.current(ticket)) return;
      this.items = reset ? result.items : this.items.concat(result.items);
      this.page = result.pagination.page; this.total = result.pagination.total;
      this.hasMore = this.page < result.pagination.totalPages;
    } catch (error) {
      if (!this.guard.current(ticket)) return;
      if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
      this.errorText = error instanceof ApiRequestError ? error.message : '报名列表读取失败，请重试';
    } finally { if (this.guard.current(ticket)) this.loading = false; }
  }
  private open(item: MyRegistration): void {
    const param: RegistrationParam = { activityId: item.activityId, registrationId: item.id };
    this.onOpen(ROUTE_MY_REGISTRATION, param);
  }
  build() {
    Column({ space: 12 }) {
      Row() {
        Text(`我的报名 · 共 ${this.total} 条`).fontSize(19).layoutWeight(1)
        Button('刷新').enabled(!this.loading).onClick(() => { this.load(true); })
      }.width('100%')
      if (this.loading) { LoadingPanel({ text: '正在读取报名…' }) }
      if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(this.retryReset); } }) }
      List({ space: 12 }) {
        ForEach(this.items, (item: MyRegistration) => {
          ListItem() {
            Column({ space: 10 }) {
              Text(item.activity.title).fontSize(19).fontWeight(FontWeight.Bold).width('100%')
              Text(registrationStatusLabel(item.status)).fontColor('#1676E5').width('100%')
              Text(`活动：${activityTime(item.activity.activityAt)}\n报名：${activityTime(item.createdAt)}\n${activityIssueLabel(item.issueType)} · ${item.deviceModel === null ? '机型未填写' : item.deviceModel}`)
                .fontSize(14).lineHeight(23).width('100%')
              Button('查看报名').enabled(!this.loading).onClick(() => { this.open(item); })
            }.width('100%').padding(18).backgroundColor(Color.White).borderRadius(20)
          }
        }, (item: MyRegistration) => item.id)
        if (!this.loading && this.items.length === 0 && this.errorText === '') {
          ListItem() { Text('暂无账号报名；旧匿名报名请从活动详情单独查询。').padding(24) }
        }
        if (this.hasMore) { ListItem() { Button('加载更多').enabled(!this.loading).onClick(() => { this.load(false); }) } }
      }.layoutWeight(1).width('100%')
    }.width('100%').height('100%').padding(16).backgroundColor('#F0F5F8')
  }
}
