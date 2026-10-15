import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { LabeledInput } from '../../core/ui/FormControls';
import { LoadingPanel, ErrorPanel } from '../../core/ui/StatePanel';
import { ROUTE_ACTIVITY_SIGNUP, ROUTE_ACTIVITY_LOOKUP, ROUTE_MY_REGISTRATIONS, ROUTE_MY_REGISTRATION } from '../../core/ui/Routes';
import { ActivityDetail, ActivityParam, RegistrationParam, SignupInput } from './ActivityContract';
import { ActivityFacts, ActivityIssueSelector } from './ActivityWidgets';
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
  private guard: ActivityRequestGuard = new ActivityRequestGuard();
  aboutToAppear(): void { this.load(); }
  aboutToDisappear(): void { this.guard.invalidate(); this.loading = false; this.busy = false; }
  private refresh(): void { this.guard.invalidate(); this.loading = false; this.busy = false; this.load(); }
  private fail(error: Object, action: boolean): void {
    if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
    const message: string = error instanceof ApiRequestError ? error.message : '请求失败，请重试';
    if (action) this.actionText = message; else this.errorText = message;
  }
  private async load(): Promise<void> {
    if (this.loading || this.busy) return;
    const ticket = this.guard.begin();
    this.loading = true; this.errorText = '';
    try {
      const detail = await ActivityService.detail(this.param.activityId);
      if (!this.guard.current(ticket)) return;
      if (this.detail === null || this.detail.consent.version !== detail.consent.version) this.consentAccepted = false;
      this.detail = detail;
    } catch (error) { if (this.guard.current(ticket)) this.fail(error, false); }
    finally { if (this.guard.current(ticket)) this.loading = false; }
  }
  private async submit(): Promise<void> {
    if (this.busy || this.loading || this.detail === null || this.submittedId !== '') return;
    if (!this.consentAccepted) { this.actionText = '请阅读并同意本页报名须知'; return; }
    const input: SignupInput = { name: this.name, phone: this.phone, deviceModel: this.deviceModel,
      issueType: this.issueType, consentAccepted: this.consentAccepted, consentVersion: this.detail.consent.version };
    this.busy = true; this.actionText = '';
    const ticket = this.guard.begin();
    try {
      const result = await ActivityService.signup(this.param.activityId, input);
      if (!this.guard.current(ticket)) return;
      this.submittedId = result.id; this.actionText = '报名成功，请按时到场。可在“我的报名”查询签到与接待状态。';
      this.busy = false; await this.load();
    } catch (error) {
      if (!this.guard.current(ticket)) return;
      this.fail(error, true);
      if (error instanceof ApiRequestError && error.code === 'ACTIVITY_CONSENT_VERSION_CHANGED') {
        this.consentAccepted = false; this.busy = false; await this.load();
      }
    } finally { if (this.guard.current(ticket)) this.busy = false; }
  }
  private openSubmitted(): void {
    const param: RegistrationParam = { activityId: this.param.activityId, registrationId: this.submittedId };
    this.onOpen(ROUTE_MY_REGISTRATION, param);
  }
  build() {
    Scroll() {
      Column({ space: 16 }) {
        if (this.loading) { LoadingPanel({ text: '正在读取活动…' }) }
        if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(); } }) }
        if (this.detail !== null) {
          ActivityFacts({ detail: this.detail })
          if (this.signup && this.submittedId === '') {
            Column({ space: 14 }) {
              LabeledInput({ label: '联系姓名', text: this.name, maxLength: 40, disabled: this.busy,
                onChange: (value: string): void => { this.name = value; } })
              LabeledInput({ label: '常用手机号', text: this.phone, inputType: InputType.PhoneNumber, maxLength: 11, disabled: this.busy,
                onChange: (value: string): void => { this.phone = value; } })
              ActivityIssueSelector({ value: this.issueType, disabled: this.busy, onChange: (value: string): void => { this.issueType = value; } })
              LabeledInput({ label: '机型（选填）', text: this.deviceModel, maxLength: 60, disabled: this.busy,
                onChange: (value: string): void => { this.deviceModel = value; } })
            }.padding(18).backgroundColor(Color.White).borderRadius(20).width('100%')
          }
          Column({ space: 12 }) {
            Text(this.detail.consent.title).fontSize(20).fontWeight(FontWeight.Bold).width('100%')
            Text(`版本：${this.detail.consent.version}`).fontSize(12).fontColor('#69747C').width('100%')
            ForEach(this.detail.consent.clauses, (clause: string) => { Text(clause).fontSize(14).lineHeight(23).width('100%') })
            if (this.signup && this.submittedId === '') {
              Row({ space: 10 }) {
                Checkbox({ name: 'activity-consent', group: 'signup' }).select(this.consentAccepted)
                  .enabled(!this.busy && !this.loading).onChange((checked: boolean) => { this.consentAccepted = checked; })
                Text('我已阅读并同意以上报名须知').fontSize(14).layoutWeight(1)
              }.width('100%')
            }
          }.width('100%').padding(18).backgroundColor(Color.White).borderRadius(20)
          if (this.actionText !== '') { Text(this.actionText).fontSize(14).fontColor('#2469AD').width('100%') }
          if (this.submittedId !== '') {
            Button('查看本次报名').width('100%').onClick(() => { this.openSubmitted(); })
          } else {
            Button(this.signup ? (this.busy ? '正在提交…' : '提交报名') : '报名参加')
              .width('100%').enabled(!this.busy && !this.loading && this.detail.status === 'OPEN' && (!this.signup || this.consentAccepted))
              .onClick(() => { if (this.signup) this.submit(); else this.onOpen(ROUTE_ACTIVITY_SIGNUP, this.param); })
          }
          Button('我的报名').width('100%').enabled(!this.busy).onClick(() => { this.onOpen(ROUTE_MY_REGISTRATIONS, null); })
          if (!this.signup) {
            Button('旧匿名报名查询').width('100%').onClick(() => { this.onOpen(ROUTE_ACTIVITY_LOOKUP, this.param); })
          }
          Button('刷新活动').enabled(!this.loading && !this.busy).onClick(() => { this.load(); })
        }
      }.width('100%').padding(16)
    }.width('100%').height('100%').backgroundColor('#F0F5F8')
  }
}
