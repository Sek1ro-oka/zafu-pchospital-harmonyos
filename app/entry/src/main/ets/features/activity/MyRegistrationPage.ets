import { SessionIdentity } from '../../core/auth/AuthContract';
import { SessionService } from '../../core/auth/SessionService';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { LoadingPanel, ErrorPanel } from '../../core/ui/StatePanel';
import { MyRegistration, RegistrationParam, activityTime, activityIssueLabel, registrationStatusLabel, registrationStageReached, registrationStageTime } from './ActivityContract';
import { ActivityIssueSelector, ActivityInfoRow, RegistrationStageCard } from './ActivityWidgets';
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
  private loadedIdentity: SessionIdentity | null = SessionService.current();
  private retryKind: string = '';
  private retryActivityId: string = '';
  private retryId: string = '';
  private retryIssue: string = '';
  private retryIdentity: SessionIdentity | null = null;
  aboutToAppear(): void { this.load(); }
  aboutToDisappear(): void { this.guard.invalidate(); this.loading = false; this.busy = false; this.retryKind = ''; }
  private refresh(): void { this.guard.invalidate(); this.loading = false; this.busy = false; this.retryKind = ''; this.load(); }
  private current(ticket: number, activityId: string, id: string): boolean {
    return this.guard.current(ticket) && activityId === this.param.activityId && id === this.param.registrationId;
  }
  private fail(error: Object): void {
    if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
    this.errorText = error instanceof ApiRequestError ? error.message : '读取或保存失败，请重试';
  }
  private async load(): Promise<void> {
    if (this.loading || this.busy) return;
    if (this.loadedIdentity !== SessionService.current()) {
      this.loadedIdentity = SessionService.current(); this.actionText = ''; this.issueType = 'OTHER';
    }
    const activityId: string = this.param.activityId, id: string = this.param.registrationId;
    const ticket = this.guard.begin(); this.loading = true; this.errorText = ''; this.item = null; this.retryKind = '';
    try {
      const item = await ActivityService.registration(activityId, id);
      if (!this.current(ticket, activityId, id)) return;
      this.item = item; this.issueType = item.issueType;
    } catch (error) {
      if (this.current(ticket, activityId, id)) { this.retryKind = 'load'; this.fail(error); }
    } finally { if (this.current(ticket, activityId, id)) this.loading = false; }
  }
  private async save(): Promise<void> { await this.write(this.param.activityId, this.param.registrationId, this.issueType); }
  private async retry(): Promise<void> {
    if (this.busy || this.loading) return;
    if (this.retryKind === 'save' && this.retryIdentity === SessionService.current() &&
      this.retryActivityId === this.param.activityId && this.retryId === this.param.registrationId) {
      await this.write(this.retryActivityId, this.retryId, this.retryIssue);
    } else { await this.load(); }
  }
  private async write(activityId: string, id: string, issue: string): Promise<void> {
    if (this.busy || this.loading || this.item === null || !this.item.canEditIssueType) return;
    if (this.loadedIdentity !== SessionService.current() || this.item.id !== id || this.item.activityId !== activityId) { await this.load(); return; }
    const ticket = this.guard.begin(); this.busy = true; this.errorText = ''; this.actionText = ''; this.retryKind = '';
    try {
      await ActivityService.updateMine(activityId, id, issue);
      if (!this.current(ticket, activityId, id)) return;
      this.busy = false; this.actionText = '故障类型已保存'; await this.load();
    } catch (error) {
      if (this.current(ticket, activityId, id)) {
        this.retryKind = 'save'; this.retryActivityId = activityId; this.retryId = id;
        this.retryIssue = issue; this.retryIdentity = SessionService.current(); this.fail(error);
      }
    } finally { if (this.current(ticket, activityId, id)) this.busy = false; }
  }
  @Builder
  private heading() {
    if (this.item !== null) {
      Column({ space: 14 }) {
        Row({ space: 12 }) {
          Column({ space: 8 }) {
            Text('电脑医院 · 本人报名').fontSize(13).fontColor('#9A7652').letterSpacing(1)
            Text('到场参与，进度随时查看').fontSize(13).fontColor('#A58A70')
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          Image($r('app.media.ref_laptop_hero')).width(92).height(86).objectFit(ImageFit.Contain)
            .accessibilityText('电脑医院主题插画')
        }.width('100%')
        Text(this.item.activity.title).fontSize(28).lineHeight(38).fontWeight(FontWeight.Bold).fontColor('#30281F').width('100%')
        Text(activityTime(this.item.activity.activityAt) + '（北京时间）').fontSize(14).fontColor('#8B7661').width('100%')
        Text(this.item.activity.location === null || this.item.activity.location.trim() === '' ? '地点待公布' : this.item.activity.location)
          .fontSize(14).lineHeight(23).fontColor('#8B7661').width('100%')
      }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 24, right: 24, top: 20, bottom: 28 })
        .linearGradient({ angle: 140, colors: [['#FFF2DA', 0], ['#FFF9EF', 1]] })
    }
  }
  @Builder
  private statusCard() {
    if (this.item !== null) {
      Column({ space: 18 }) {
        Text('现场状态').fontSize(21).fontWeight(FontWeight.Bold).fontColor('#3C2E22').width('100%')
        Text(registrationStatusLabel(this.item.status)).fontSize(16).fontWeight(FontWeight.Medium).fontColor('#B5672D').width('100%')
        Row({ space: 8 }) {
          RegistrationStageCard({ label: '报名', reached: registrationStageReached(this.item.status, 0),
            time: registrationStageTime(this.item.status, 0, this.item.createdAt) }).layoutWeight(1)
          RegistrationStageCard({ label: '签到', reached: registrationStageReached(this.item.status, 1),
            time: registrationStageTime(this.item.status, 1, this.item.checkedInAt) }).layoutWeight(1)
          RegistrationStageCard({ label: '接待', reached: registrationStageReached(this.item.status, 2),
            time: registrationStageTime(this.item.status, 2, this.item.servedAt) }).layoutWeight(1)
        }.width('100%').alignItems(VerticalAlign.Top)
        Text(this.item.status === 'SERVED' ? '已接待表示工作人员已开始接待，维修结果请联系现场成员确认。' :
          this.item.status === 'CHECKED_IN' ? '你已完成本场签到，请等候现场工作人员安排接待。' :
          this.item.status === 'REGISTERED' ? '当前尚未签到，请按活动时间到场，由工作人员核实。撤回排队后也会回到此状态。' :
          '暂不能确认现场状态，请刷新详情或联系现场工作人员。')
          .fontSize(13).lineHeight(22).fontColor('#9B8875').width('100%')
      }.width('100%').padding(22).backgroundColor(Color.White).borderRadius(28)
    }
  }
  @Builder
  private contactCard() {
    if (this.item !== null) {
      Column({ space: 16 }) {
        Text('我的报名信息').fontSize(21).fontWeight(FontWeight.Bold).fontColor('#3C2E22').width('100%')
        ActivityInfoRow({ label: '联系姓名', value: this.item.name })
        ActivityInfoRow({ label: '联系手机', value: this.item.phoneMasked })
        ActivityInfoRow({ label: '故障类型', value: activityIssueLabel(this.item.issueType) })
        ActivityInfoRow({ label: '电脑机型', value: this.item.deviceModel === null || this.item.deviceModel.trim() === '' ? '未填写' : this.item.deviceModel })
      }.width('100%').padding(22).backgroundColor(Color.White).borderRadius(28)
    }
  }
  @Builder
  private editCard() {
    if (this.item !== null) {
      Column({ space: 14 }) {
        Text('调整故障类型').fontSize(18).fontWeight(FontWeight.Medium).fontColor('#3C2E22').width('100%')
        if (this.item.canEditIssueType) {
          ActivityIssueSelector({ value: this.issueType, disabled: this.busy || this.loading,
            onChange: (value: string): void => { this.issueType = value; } })
          Text('仅修改本次报名的故障类型，联系信息保留报名时的快照。').fontSize(13).lineHeight(22).fontColor('#9B8875').width('100%')
        } else {
          Text('当前状态不可修改故障类型').fontSize(14).fontColor('#9B8875').width('100%')
        }
      }.width('100%').padding(22).backgroundColor(Color.White).borderRadius(28)
    }
  }
  build() {
    Column() {
      Scroll() {
        Column({ space: 0 }) {
          if (this.loading) { LoadingPanel({ text: '正在读取报名详情…' }) }
          if (this.errorText !== '' && this.item === null) { ErrorPanel({ message: this.errorText, onRetry: (): void => { this.retry(); } }) }
          if (this.item !== null) {
            this.heading()
            Column({ space: 16 }) {
              this.statusCard()
              this.contactCard()
              this.editCard()
            }.width('100%').padding({ left: 16, right: 16, top: 8, bottom: 24 })
          }
        }.width('100%')
      }.width('100%').layoutWeight(1)
      Column({ space: 8 }) {
        if (this.errorText !== '' && this.item !== null) {
          Text(this.errorText).fontSize(13).lineHeight(20).fontColor('#AD4935').width('100%')
          Button('重试保存').height(40).fontSize(14).fontColor('#936135').backgroundColor('#FFF1DD')
            .enabled(!this.loading && !this.busy).onClick(() => { this.retry(); })
        }
        if (this.actionText !== '') { Text(this.actionText).fontSize(13).fontColor('#9B622F').width('100%') }
        Row({ space: 12 }) {
          Button('刷新详情').height(48).fontSize(15).fontColor('#936135').backgroundColor('#FFF1DD')
            .enabled(!this.loading && !this.busy).layoutWeight(1).onClick(() => { this.load(); })
          if (this.item !== null && this.item.canEditIssueType) {
            Button(this.busy ? '保存中…' : '保存故障类型').height(48).fontSize(15).backgroundColor('#B96D32')
              .enabled(!this.loading && !this.busy).layoutWeight(1).onClick(() => { this.save(); })
          }
        }.width('100%')
      }.width('100%').padding({ left: 20, right: 20, top: 12, bottom: 16 }).backgroundColor(Color.White)
        .border({ width: { top: 0.5 }, color: '#F1E5D7' })
    }.width('100%').height('100%').backgroundColor('#FFF8EB')
  }
}
