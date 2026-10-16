import { KeyboardAvoidMode } from '@kit.ArkUI';
import { SessionIdentity } from '../../core/auth/AuthContract';
import { SessionService } from '../../core/auth/SessionService';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { LabeledInput } from '../../core/ui/FormControls';
import { LoadingPanel, ErrorPanel } from '../../core/ui/StatePanel';
import { ROUTE_ACTIVITY_SIGNUP, ROUTE_ACTIVITY_LOOKUP, ROUTE_MY_REGISTRATIONS, ROUTE_MY_REGISTRATION } from '../../core/ui/Routes';
import { ActivityDetail, ActivityParam, RegistrationParam, SignupInput, activityTime, activityStatusLabel, activityActionLabel } from './ActivityContract';
import { ActivityIssueSelector } from './ActivityWidgets';
import { ActivityService } from './ActivityService';
import { ActivityRequestGuard } from './ActivityRequestGuard';

@Component
export struct ActivityDetailPage {
  param: ActivityParam = { activityId: '' };
  @Prop signup: boolean = false;
  @Prop @Watch('refresh') refreshVersion: number = 0;
  onOpen: (route: string, param: Object | null) => void = () => {};
  onSessionExpired: () => void = () => {};
  @State detail: ActivityDetail | null = null;
  @State loading: boolean = false;
  @State busy: boolean = false;
  @State errorText: string = '';
  @State actionText: string = '';
  @State name: string = '';
  @State phone: string = '';
  @State deviceModel: string = '';
  @State issueType: string = 'OTHER';
  @State consentAccepted: boolean = false;
  @State submittedId: string = '';
  @State fieldErrors: Record<string, string[]> = {};
  private guard: ActivityRequestGuard = new ActivityRequestGuard();
  private loadedIdentity: SessionIdentity | null = SessionService.current();
  private loadedActivityId: string = '';
  private loadedConsentVersion: string = '';
  private previousKeyboardMode: KeyboardAvoidMode | null = null;
  aboutToAppear(): void {
    if (this.signup) {
      this.previousKeyboardMode = this.getUIContext().getKeyboardAvoidMode();
      this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    }
    this.load();
  }
  aboutToDisappear(): void {
    if (this.previousKeyboardMode !== null) {
      this.getUIContext().setKeyboardAvoidMode(this.previousKeyboardMode); this.previousKeyboardMode = null;
    }
    this.guard.invalidate(); this.loading = false; this.busy = false;
  }
  private refresh(): void { this.guard.invalidate(); this.loading = false; this.busy = false; this.load(); }
  private clearDraft(): void {
    this.name = ''; this.phone = ''; this.deviceModel = ''; this.issueType = 'OTHER';
    this.consentAccepted = false; this.submittedId = ''; this.actionText = ''; this.fieldErrors = {}; this.loadedConsentVersion = '';
  }
  private current(ticket: number, activityId: string): boolean {
    return this.guard.current(ticket) && this.param.activityId === activityId;
  }
  private fail(error: Object, action: boolean): void {
    if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
    const message: string = error instanceof ApiRequestError ? error.message : '请求失败，请重试';
    if (action) {
      this.actionText = message;
      this.fieldErrors = error instanceof ApiRequestError && error.fieldErrors !== undefined ? error.fieldErrors : {};
    } else this.errorText = message;
  }
  private fieldError(field: string): string {
    return this.fieldErrors[field] === undefined ? '' : this.fieldErrors[field].join('；');
  }
  private async load(): Promise<void> {
    if (this.loading || this.busy) return;
    const activityId: string = this.param.activityId;
    if (this.loadedActivityId !== activityId || this.loadedIdentity !== SessionService.current()) {
      this.clearDraft(); this.loadedActivityId = activityId; this.loadedIdentity = SessionService.current();
    }
    const ticket = this.guard.begin();
    // A failed refresh must not leave an old OPEN action enabled.
    this.loading = true; this.errorText = ''; this.detail = null;
    try {
      const detail = await ActivityService.detail(activityId);
      if (!this.current(ticket, activityId)) return;
      if (this.loadedConsentVersion !== detail.consent.version) this.consentAccepted = false;
      this.loadedConsentVersion = detail.consent.version;
      this.detail = detail;
    } catch (error) { if (this.current(ticket, activityId)) this.fail(error, false); }
    finally { if (this.current(ticket, activityId)) this.loading = false; }
  }
  private async submit(): Promise<void> {
    if (this.busy || this.loading || this.detail === null || this.submittedId !== '') return;
    if (this.loadedIdentity !== SessionService.current() || this.detail.id !== this.param.activityId) { await this.load(); return; }
    if (this.detail.status !== 'OPEN') return;
    if (!this.consentAccepted) { this.actionText = '请阅读并同意本页报名须知'; return; }
    const activityId: string = this.param.activityId;
    const input: SignupInput = { name: this.name, phone: this.phone, deviceModel: this.deviceModel,
      issueType: this.issueType, consentAccepted: this.consentAccepted, consentVersion: this.detail.consent.version };
    this.busy = true; this.actionText = ''; this.fieldErrors = {};
    const ticket = this.guard.begin();
    try {
      const result = await ActivityService.signup(activityId, input);
      if (!this.current(ticket, activityId)) return;
      this.submittedId = result.id; this.actionText = '报名成功，请按时到场。可查看本次报名的签到与接待状态。';
      this.busy = false; await this.load();
    } catch (error) {
      if (!this.current(ticket, activityId)) return;
      this.fail(error, true);
      if (error instanceof ApiRequestError && (error.code === 'ACTIVITY_CONSENT_VERSION_CHANGED' ||
        error.code === 'ACTIVITY_FULL' || error.code === 'ACTIVITY_NOT_OPEN' || error.code === 'ACTIVITY_ENDED')) {
        if (error.code === 'ACTIVITY_CONSENT_VERSION_CHANGED') this.consentAccepted = false;
        this.busy = false; await this.load();
      }
    } finally { if (this.current(ticket, activityId)) this.busy = false; }
  }
  private openSubmitted(): void {
    if (this.submittedId === '' || this.loadedIdentity !== SessionService.current() || this.loadedActivityId !== this.param.activityId) return;
    const param: RegistrationParam = { activityId: this.param.activityId, registrationId: this.submittedId };
    this.onOpen(ROUTE_MY_REGISTRATION, param);
  }
  private primaryLabel(): string {
    if (this.submittedId !== '') return '查看本次报名';
    if (this.busy) return '正在提交…';
    if (this.detail === null) return '活动信息待确认';
    if (this.detail.status !== 'OPEN') return activityActionLabel(this.detail.status);
    return this.signup ? '提交报名' : '报名参加';
  }
  private primaryEnabled(): boolean {
    if (this.busy || this.loading) return false;
    if (this.submittedId !== '') return true;
    return this.detail !== null && this.detail.status === 'OPEN' && (!this.signup || this.consentAccepted);
  }
  @Builder
  private hero() {
    if (this.detail !== null) {
      Column({ space: 14 }) {
        Text('电脑医院 · 维修活动').fontSize(14).fontColor('#486E99').letterSpacing(2)
        Text(this.detail.title).fontSize(30).fontWeight(FontWeight.Bold).fontColor('#172C46')
          .textAlign(TextAlign.Center).width('100%').lineHeight(40)
        Text(activityStatusLabel(this.detail.status)).fontSize(13).fontColor('#28629F')
          .padding({ left: 16, right: 16, top: 6, bottom: 6 }).backgroundColor('#EAF5FF').borderRadius(16)
        Column({ space: 7 }) {
          Text(activityTime(this.detail.activityAt) + '（北京时间）').fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor('#304E70').textAlign(TextAlign.Center).width('100%')
          Text(this.detail.location === null || this.detail.location.trim() === '' ? '地点待公布' : this.detail.location)
            .fontSize(14).fontColor('#506A87').textAlign(TextAlign.Center).width('100%')
        }.width('100%')
        Image($r('app.media.activity_campaign_laptop')).width('100%').aspectRatio(1.6).objectFit(ImageFit.Contain)
          .accessibilityText('电脑医院主题插画')
        Text('先报名，再到场参与').fontSize(13).fontColor('#607C9B')
      }.width('100%').padding({ left: 24, right: 24, top: 30, bottom: 24 })
        .linearGradient({ angle: 135, colors: [['#C8DDF8', 0], ['#E8F3FF', 1]] })
    }
  }
  @Builder
  private information() {
    if (this.detail !== null) {
      Column({ space: 18 }) {
        Text('活动信息').fontSize(22).fontWeight(FontWeight.Bold).fontColor('#172C46').width('100%')
        Row() {
          Column({ space: 6 }) { Text(`${this.detail.registeredCount}`).fontSize(26).fontWeight(FontWeight.Bold); Text('已报名').fontSize(13) }.layoutWeight(1)
          Column({ space: 6 }) { Text(`${this.detail.capacity}`).fontSize(26).fontWeight(FontWeight.Bold); Text('总名额').fontSize(13) }.layoutWeight(1)
          Column({ space: 6 }) { Text(`${this.detail.remaining}`).fontSize(26).fontWeight(FontWeight.Bold); Text('剩余名额').fontSize(13) }.layoutWeight(1)
        }.width('100%').padding(18).backgroundColor('#F0F6FE').borderRadius(20)
        Column({ space: 10 }) {
          Text('报名窗口 · 北京时间').fontSize(14).fontColor('#6C7B8A').width('100%')
          Text(`开始  ${activityTime(this.detail.signupOpensAt)}`).fontSize(15).width('100%')
          Text(`截止  ${activityTime(this.detail.signupClosesAt)}`).fontSize(15).width('100%')
        }.width('100%')
        Text('参与说明').fontSize(18).fontWeight(FontWeight.Medium).width('100%')
        Text('报名后请按活动时间到场，由工作人员核实签到并安排接待。具体处理以现场判断为准，请先阅读下方报名须知。')
          .fontSize(14).lineHeight(24).fontColor('#697786').width('100%')
        if (!this.signup) {
          Button('旧匿名报名查询').fontSize(14).fontColor('#356DA8').backgroundColor('#EEF5FD')
            .onClick(() => { this.onOpen(ROUTE_ACTIVITY_LOOKUP, this.param); })
        }
      }.width('100%').padding(24).backgroundColor(Color.White).alignItems(HorizontalAlign.Start)
    }
  }
  @Builder
  private form() {
    Column({ space: 16 }) {
      Text('填写报名信息').fontSize(22).fontWeight(FontWeight.Bold).width('100%')
      Text('联系信息仅用于本次活动，请填写可联系到本人的手机号。').fontSize(13).lineHeight(22).fontColor('#73808E').width('100%')
      LabeledInput({ label: '联系姓名', text: this.name, errorText: this.fieldError('name'), maxLength: 40, disabled: this.busy,
        onChange: (value: string): void => { this.name = value; } })
      LabeledInput({ label: '常用手机号', text: this.phone, errorText: this.fieldError('phone'), inputType: InputType.PhoneNumber, maxLength: 11, disabled: this.busy,
        onChange: (value: string): void => { this.phone = value; } })
      ActivityIssueSelector({ value: this.issueType, disabled: this.busy, onChange: (value: string): void => { this.issueType = value; } })
      if (this.fieldError('issueType') !== '') { Text(this.fieldError('issueType')).fontSize(13).fontColor('#B04438').width('100%') }
      LabeledInput({ label: '机型（选填）', text: this.deviceModel, errorText: this.fieldError('deviceModel'), maxLength: 60, disabled: this.busy,
        onChange: (value: string): void => { this.deviceModel = value; } })
    }.width('100%').padding(24).backgroundColor(Color.White).borderRadius(24)
  }
  @Builder
  private consent() {
    if (this.detail !== null) {
      Column({ space: 14 }) {
        Text(this.detail.consent.title).fontSize(22).fontWeight(FontWeight.Bold).width('100%')
        Text(`实际条款 · 版本 ${this.detail.consent.version}`).fontSize(12).fontColor('#788696').width('100%')
        ForEach(this.detail.consent.clauses, (clause: string) => { Text(clause).fontSize(14).lineHeight(24).fontColor('#536373').width('100%') }, (clause: string) => clause)
        if (this.signup && this.submittedId === '') {
          Row({ space: 8 }) {
            Checkbox({ name: 'activity-consent', group: 'signup' }).select(this.consentAccepted)
              .enabled(!this.busy && !this.loading).onChange((checked: boolean) => { this.consentAccepted = checked; })
            Text('我已阅读并同意以上报名须知').fontSize(14).lineHeight(22).layoutWeight(1)
              .onClick(() => { if (!this.busy && !this.loading) this.consentAccepted = !this.consentAccepted; })
          }.width('100%')
          if (this.fieldError('consentAccepted') !== '') { Text(this.fieldError('consentAccepted')).fontSize(13).fontColor('#B04438') }
        }
      }.width('100%').padding(24).backgroundColor(Color.White).borderRadius(24)
    }
  }
  build() {
    Column() {
      Scroll() {
        Column({ space: 0 }) {
          if (this.loading) { LoadingPanel({ text: '正在读取活动…' }) }
          if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(); } }) }
          if (this.detail !== null) {
            this.hero()
            this.information()
            Column({ space: 16 }) {
              if (this.signup && this.submittedId === '') { this.form() }
              this.consent()
              Button('刷新活动').fontColor('#456C95').backgroundColor('#E5EFFB').enabled(!this.loading && !this.busy).onClick(() => { this.load(); })
            }.width('100%').padding({ left: 16, right: 16, top: 16, bottom: 24 })
          }
        }.width('100%')
      }.width('100%').layoutWeight(1)
      Column({ space: 8 }) {
        if (this.actionText !== '') { Text(this.actionText).fontSize(13).lineHeight(20).fontColor('#2D629C').width('100%') }
        Row({ space: 12 }) {
          Button('我的报名').fontSize(15).height(48).fontColor('#315F93').backgroundColor('#EBF3FD')
            .enabled(!this.busy).onClick(() => { this.onOpen(ROUTE_MY_REGISTRATIONS, null); })
          Button(this.primaryLabel()).fontSize(16).fontWeight(FontWeight.Medium).height(48).layoutWeight(1)
            .backgroundColor('#2465AD').enabled(this.primaryEnabled()).onClick(() => {
              if (this.submittedId !== '') this.openSubmitted();
              else if (this.signup) this.submit();
              else this.onOpen(ROUTE_ACTIVITY_SIGNUP, this.param);
            })
        }.width('100%')
      }.width('100%').padding({ left: 20, right: 20, top: 12, bottom: 16 }).backgroundColor(Color.White)
        .border({ width: { top: 0.5 }, color: '#E1EAF4' })
    }.width('100%').height('100%').backgroundColor('#F0F5FB')
  }
}
