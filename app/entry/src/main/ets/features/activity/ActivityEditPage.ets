import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { LabeledInput } from '../../core/ui/FormControls';
import { LoadingPanel, ErrorPanel } from '../../core/ui/StatePanel';
import { ActivityParam, ActivitySaveInput } from './ActivityContract';
import { ActivityDateTimeInput } from './ActivityDateTimeInput';
import { ActivityService } from './ActivityService';
import { ActivityRequestGuard } from './ActivityRequestGuard';
@Component
export struct ActivityEditPage {
  param: ActivityParam = { activityId: '' };
  @State title: string = '';
  @State location: string = '';
  @State capacity: string = '';
  @State activityAt: string = '';
  @State signupOpensAt: string = '';
  @State signupClosesAt: string = '';
  @State loading: boolean = false;
  @State busy: boolean = false;
  @State errorText: string = '';
  @State successText: string = '';
  private savedId: string = '';
  private guard: ActivityRequestGuard = new ActivityRequestGuard();
  onSessionExpired: () => void = () => {};
  aboutToAppear(): void { this.savedId = this.param.activityId; if (this.savedId !== '') this.load(); }
  aboutToDisappear(): void { this.guard.invalidate(); this.loading = false; this.busy = false; }
  private fail(error: Object): void {
    if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
    this.errorText = error instanceof ApiRequestError ? error.message : '活动读取或保存失败，请重试';
  }
  private async load(): Promise<void> {
    if (this.loading || this.busy) return;
    const ticket = this.guard.begin(); this.loading = true; this.errorText = '';
    try { const item = await ActivityService.detail(this.savedId); if (!this.guard.current(ticket)) return;
      this.title = item.title; this.location = item.location === null ? '' : item.location;
      this.capacity = item.capacity.toString(); this.activityAt = item.activityAt;
      this.signupOpensAt = item.signupOpensAt; this.signupClosesAt = item.signupClosesAt;
    } catch (error) { if (this.guard.current(ticket)) this.fail(error); }
    finally { if (this.guard.current(ticket)) this.loading = false; }
  }
  private async save(): Promise<void> {
    if (this.busy || this.loading) return;
    if (this.activityAt === '' || this.signupOpensAt === '' || this.signupClosesAt === '') { this.errorText = '请选择活动时间、报名开始及截止时间'; return; }
    const input: ActivitySaveInput = { title: this.title, location: this.location.trim() === '' ? null : this.location,
      capacity: Number(this.capacity), activityAt: this.activityAt, signupOpensAt: this.signupOpensAt, signupClosesAt: this.signupClosesAt };
    const ticket = this.guard.begin(); this.busy = true; this.errorText = ''; this.successText = '';
    try { const result = await ActivityService.saveActivity(this.savedId, input); if (!this.guard.current(ticket)) return;
      this.savedId = result.id; this.successText = '活动已保存'; this.busy = false; await this.load();
    } catch (error) { if (this.guard.current(ticket)) this.fail(error); }
    finally { if (this.guard.current(ticket)) this.busy = false; }
  }
  build() {
    Scroll() {
      Column({ space: 18 }) {
        Text(this.param.activityId === '' ? '创建维修活动' : '编辑维修活动').fontSize(24).fontWeight(FontWeight.Bold).width('100%')
        if (this.loading) { LoadingPanel({ text: '正在读取活动…' }) }
        if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { if (this.title === '' && this.savedId !== '') this.load(); else this.save(); } }) }
        if (this.successText !== '') { Text(this.successText).fontColor('#1676E5').width('100%') }
        LabeledInput({ label: '活动标题', text: this.title, maxLength: 120, disabled: this.busy || this.loading,
          onChange: (value: string): void => { this.title = value; } })
        LabeledInput({ label: '地点（可留空，显示地点待公布）', text: this.location, maxLength: 200, disabled: this.busy || this.loading,
          onChange: (value: string): void => { this.location = value; } })
        LabeledInput({ label: '名额上限（1–10000）', text: this.capacity, inputType: InputType.Number, maxLength: 5, disabled: this.busy || this.loading,
          onChange: (value: string): void => { this.capacity = value; } })
        ActivityDateTimeInput({ label: '活动时间', value: this.activityAt, disabled: this.busy || this.loading, onChange: (value: string): void => { this.activityAt = value; } })
        ActivityDateTimeInput({ label: '报名开始', value: this.signupOpensAt, disabled: this.busy || this.loading, onChange: (value: string): void => { this.signupOpensAt = value; } })
        ActivityDateTimeInput({ label: '报名截止', value: this.signupClosesAt, disabled: this.busy || this.loading, onChange: (value: string): void => { this.signupClosesAt = value; } })
        Text('报名开始须早于截止；截止不得晚于活动时间。状态由时间及有效报名数自动计算。').fontSize(13).lineHeight(22).width('100%')
        Button(this.busy ? '保存中…' : '保存活动').width('100%').enabled(!this.busy && !this.loading).onClick(() => { this.save(); })
      }.width('100%').padding(18)
    }.width('100%').height('100%').backgroundColor('#F0F5F8')
  }
}
