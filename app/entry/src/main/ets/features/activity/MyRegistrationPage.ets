import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { LoadingPanel, ErrorPanel } from '../../core/ui/StatePanel';
import { MyRegistration, RegistrationParam, activityTime, registrationStatusLabel } from './ActivityContract';
import { ActivityIssueSelector } from './ActivityWidgets';
import { ActivityService } from './ActivityService';
import { ActivityRequestGuard } from './ActivityRequestGuard';
@Component
export struct MyRegistrationPage {
  param: RegistrationParam = { activityId: '', registrationId: '' };
  @Prop @Watch('refresh') refreshVersion: number = 0;
  onSessionExpired: () => void = () => {};
  @State item: MyRegistration | null = null;
  @State issueType: string = 'OTHER';
  @State loading: boolean = false;
  @State busy: boolean = false;
  @State errorText: string = '';
  @State actionText: string = '';
  private guard: ActivityRequestGuard = new ActivityRequestGuard();
  aboutToAppear(): void { this.load(); }
  aboutToDisappear(): void { this.guard.invalidate(); this.loading = false; this.busy = false; }
  private refresh(): void { this.guard.invalidate(); this.loading = false; this.busy = false; this.load(); }
  private fail(error: Object): void {
    if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
    this.errorText = error instanceof ApiRequestError ? error.message : '读取或保存失败，请重试';
  }
  private async load(): Promise<void> {
    if (this.loading || this.busy) return;
    const ticket = this.guard.begin(); this.loading = true; this.errorText = ''; this.item = null;
    try { const item = await ActivityService.registration(this.param.activityId, this.param.registrationId);
      if (!this.guard.current(ticket)) return; this.item = item; this.issueType = item.issueType;
    } catch (error) { if (this.guard.current(ticket)) this.fail(error); }
    finally { if (this.guard.current(ticket)) this.loading = false; }
  }
  private async save(): Promise<void> {
    if (this.busy || this.loading || this.item === null || !this.item.canEditIssueType) return;
    const ticket = this.guard.begin(); this.busy = true; this.errorText = ''; this.actionText = '';
    try { await ActivityService.updateMine(this.param.activityId, this.param.registrationId, this.issueType);
      if (!this.guard.current(ticket)) return; this.busy = false; this.actionText = '故障类型已保存'; await this.load();
    } catch (error) { if (this.guard.current(ticket)) this.fail(error); }
    finally { if (this.guard.current(ticket)) this.busy = false; }
  }
  build() {
    Scroll() {
      Column({ space: 16 }) {
        if (this.loading) { LoadingPanel({ text: '正在读取报名详情…' }) }
        if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { if (this.item === null) this.load(); else this.save(); } }) }
        if (this.item !== null) {
          Column({ space: 12 }) {
            Text(this.item.activity.title).fontSize(24).fontWeight(FontWeight.Bold).width('100%')
            Text(registrationStatusLabel(this.item.status)).fontColor('#1676E5').width('100%')
            Text(`地点：${this.item.activity.location === null ? '地点待公布' : this.item.activity.location}\n活动：${activityTime(this.item.activity.activityAt)}\n报名：${activityTime(this.item.createdAt)}\n签到：${activityTime(this.item.checkedInAt)}\n接待：${activityTime(this.item.servedAt)}`)
              .fontSize(14).lineHeight(24).width('100%')
            Text(`${this.item.name} · ${this.item.phoneMasked}\n机型：${this.item.deviceModel === null ? '未填写' : this.item.deviceModel}`).width('100%')
            ActivityIssueSelector({ value: this.issueType, disabled: this.busy || !this.item.canEditIssueType,
              onChange: (value: string): void => { this.issueType = value; } })
            if (this.item.canEditIssueType) { Button(this.busy ? '保存中…' : '保存故障类型').enabled(!this.busy && !this.loading).onClick(() => { this.save(); }) }
            else { Text('当前状态不可修改故障类型').fontSize(14).fontColor('#76818A') }
          }.width('100%').padding(18).backgroundColor(Color.White).borderRadius(20)
        }
        if (this.actionText !== '') { Text(this.actionText).fontColor('#1676E5') }
        Button('刷新详情').enabled(!this.loading && !this.busy).onClick(() => { this.load(); })
      }.width('100%').padding(16)
    }.width('100%').height('100%').backgroundColor('#F0F5F8')
  }
}
