import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { LoadingPanel, ErrorPanel } from '../../core/ui/StatePanel';
import { ROUTE_ACTIVITY_BOARD, ROUTE_ACTIVITY_EDIT, ROUTE_ACTIVITY_REGISTRATION_ADMIN } from '../../core/ui/Routes';
import { ActivitySummary, ActivityParam, ActivityAdmin, StaffActivity, activityTime, activityStatusLabel } from './ActivityContract';
import { ActivityService } from './ActivityService';
import { ActivityRequestGuard } from './ActivityRequestGuard';
@Component
export struct ActivityWorkspacePage {
  @Prop admin: boolean = false;
  @Prop @Watch('refresh') refreshVersion: number = 0;
  onOpen: (route: string, param: Object | null) => void = () => {};
  onSessionExpired: () => void = () => {};
  @State staffItems: StaffActivity[] = [];
  @State adminItems: ActivityAdmin[] = [];
  @State query: string = '';
  @State loading: boolean = false;
  @State busy: boolean = false;
  @State errorText: string = '';
  private guard: ActivityRequestGuard = new ActivityRequestGuard();
  aboutToAppear(): void { this.load(); }
  aboutToDisappear(): void { this.guard.invalidate(); this.loading = false; this.busy = false; }
  private refresh(): void { this.guard.invalidate(); this.loading = false; this.busy = false; this.load(); }
  private fail(error: Object): void {
    if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
    this.errorText = error instanceof ApiRequestError ? error.message : '活动读取或操作失败，请重试';
  }
  private async load(): Promise<void> {
    if (this.loading || this.busy) return;
    const ticket = this.guard.begin(); this.loading = true; this.errorText = ''; this.staffItems = []; this.adminItems = [];
    try {
      if (this.admin) { const items = await ActivityService.adminList(); if (this.guard.current(ticket)) this.adminItems = items; }
      else { const items = await ActivityService.staffActivities(); if (this.guard.current(ticket)) this.staffItems = items; }
    } catch (error) { if (this.guard.current(ticket)) this.fail(error); }
    finally { if (this.guard.current(ticket)) this.loading = false; }
  }
  private open(route: string, id: string): void {
    const param: ActivityParam = { activityId: id }; this.onOpen(route, param);
  }
  private async remove(id: string): Promise<void> {
    if (this.busy || this.loading) return;
    const ticket = this.guard.begin(); this.busy = true;
    try {
      const answer = await this.getUIContext().getPromptAction().showDialog({ title: '删除活动？', message: '将隐藏该活动及其报名入口，请确认本次管理操作。',
        buttons: [{ text: '返回', color: '#69747C' }, { text: '确认删除', color: '#D23F3F' }] });
      if (!this.guard.current(ticket)) return;
      if (answer.index === 1) { await ActivityService.deleteActivity(id); if (!this.guard.current(ticket)) return; }
      this.busy = false; await this.load();
    } catch (error) { if (this.guard.current(ticket)) this.fail(error); }
    finally { if (this.guard.current(ticket)) this.busy = false; }
  }
  @Builder
  card(item: ActivitySummary, attended: boolean) {
    Column({ space: 10 }) {
      Text(item.title).fontSize(20).fontWeight(FontWeight.Bold).width('100%')
      Text(`${activityTime(item.activityAt)} · ${activityStatusLabel(item.status)}`).fontSize(14).width('100%')
      Text(`报名 ${item.registeredCount} / ${item.capacity}${this.admin ? '' : attended ? ' · 已出勤' : ' · 未出勤'}`).fontSize(14).width('100%')
      if (this.admin) {
        Row({ space: 10 }) {
          Button('编辑').enabled(!this.busy).onClick(() => { this.open(ROUTE_ACTIVITY_EDIT, item.id); })
          Button('报名管理').enabled(!this.busy).onClick(() => { this.open(ROUTE_ACTIVITY_REGISTRATION_ADMIN, item.id); })
        }
        Button('删除活动').enabled(!this.busy).fontColor('#C33B3B').backgroundColor('#FFF3F3').onClick(() => { this.remove(item.id); })
      } else {
        Button('进入现场看板').enabled(!this.busy).onClick(() => { this.open(ROUTE_ACTIVITY_BOARD, item.id); })
      }
    }.width('100%').padding(18).backgroundColor(Color.White).borderRadius(20)
  }
  build() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        Text(this.admin ? '活动管理' : '成员活动出勤').fontSize(22).fontWeight(FontWeight.Bold).layoutWeight(1)
        Button('刷新').enabled(!this.loading && !this.busy).onClick(() => { this.load(); })
      }.width('100%')
      if (this.admin) { Button('创建活动').width('100%').enabled(!this.busy).onClick(() => { this.open(ROUTE_ACTIVITY_EDIT, ''); }) }
      TextInput({ text: this.query, placeholder: '搜索活动标题' }).onChange((value: string) => { this.query = value; })
      if (this.loading) { LoadingPanel({ text: '正在读取活动…' }) }
      if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(); } }) }
      List({ space: 12 }) {
        if (this.admin) {
          ForEach(this.adminItems.filter((item: ActivityAdmin) => item.title.includes(this.query.trim())), (item: ActivityAdmin) => { ListItem() { this.card(item, false) } }, (item: ActivityAdmin) => item.id)
        } else {
          ForEach(this.staffItems.filter((item: StaffActivity) => item.title.includes(this.query.trim())), (item: StaffActivity) => { ListItem() { this.card(item, item.attended) } }, (item: StaffActivity) => item.id)
        }
        if (!this.loading && this.errorText === '' && (this.admin ? this.adminItems.filter((item: ActivityAdmin) => item.title.includes(this.query.trim())).length === 0 : this.staffItems.filter((item: StaffActivity) => item.title.includes(this.query.trim())).length === 0)) {
          ListItem() { Text('暂无匹配的活动').padding(24) }
        }
      }.width('100%').layoutWeight(1)
    }.width('100%').height('100%').padding(16).backgroundColor('#F0F5F8')
  }
}
