import { ApiRequestError } from '../../core/network/ApiClient';
import { LabeledInput } from '../../core/ui/FormControls';
import { ActivityParam, RegistrationLookup, registrationStatusLabel, activityTime } from './ActivityContract';
import { ActivityIssueSelector } from './ActivityWidgets';
import { ActivityService } from './ActivityService';
import { ActivityRequestGuard } from './ActivityRequestGuard';
@Component
export struct ActivityLookupPage {
  param: ActivityParam = { activityId: '' };
  @State phone: string = '';
  @State issueType: string = 'OTHER';
  @State item: RegistrationLookup | null = null;
  @State busy: boolean = false;
  @State message: string = '';
  private guard: ActivityRequestGuard = new ActivityRequestGuard();
  aboutToDisappear(): void { this.guard.invalidate(); this.busy = false; this.item = null; }
  private async lookup(): Promise<void> {
    if (this.busy) return;
    const ticket = this.guard.begin(); this.busy = true; this.item = null; this.message = '';
    try { const item = await ActivityService.lookup(this.param.activityId, this.phone);
      if (!this.guard.current(ticket)) return; this.item = item; this.issueType = item.issueType;
    } catch (error) { if (this.guard.current(ticket)) this.message = error instanceof ApiRequestError ? error.message : '查询失败，请重试'; }
    finally { if (this.guard.current(ticket)) this.busy = false; }
  }
  private async save(): Promise<void> {
    if (this.busy || this.item === null) return;
    const item = this.item, ticket = this.guard.begin(); this.busy = true; this.message = '';
    try { await ActivityService.updateAnonymous(this.param.activityId, item, this.phone, this.issueType);
      if (!this.guard.current(ticket)) return; this.busy = false; await this.lookup(); this.message = '故障类型已保存';
    } catch (error) { if (this.guard.current(ticket)) this.message = error instanceof ApiRequestError ? error.message : '保存失败，请重试'; }
    finally { if (this.guard.current(ticket)) this.busy = false; }
  }
  build() {
    Scroll() {
      Column({ space: 16 }) {
        Text('查询旧匿名报名').fontSize(24).fontWeight(FontWeight.Bold).width('100%')
        Text('沿用原手机号查询。本入口不会将历史报名绑定到当前账号；活动结束后停止查询和修改。').fontSize(14).lineHeight(23).width('100%')
        LabeledInput({ label: '报名时的手机号', text: this.phone, inputType: InputType.PhoneNumber, maxLength: 11, disabled: this.busy,
          onChange: (value: string): void => { this.phone = value; this.item = null; this.message = ''; } })
        Button(this.busy ? '处理中…' : '查询报名').width('100%').enabled(!this.busy).onClick(() => { this.lookup(); })
        if (this.message !== '') { Text(this.message).width('100%').fontColor('#2469AD') }
        if (this.item !== null) {
          Column({ space: 14 }) {
            Text(`${this.item.name} · ${this.item.phoneMasked}`).fontSize(18).width('100%')
            Text(registrationStatusLabel(this.item.status)).width('100%')
            Text(`报名时间：${activityTime(this.item.createdAt)}\n机型：${this.item.deviceModel === null ? '未填写' : this.item.deviceModel}`).width('100%')
            ActivityIssueSelector({ value: this.issueType, disabled: this.busy || this.item.status !== 'REGISTERED',
              onChange: (value: string): void => { this.issueType = value; } })
            Button('保存故障类型').width('100%').enabled(!this.busy && this.item.status === 'REGISTERED').onClick(() => { this.save(); })
          }.padding(18).backgroundColor(Color.White).borderRadius(20).width('100%')
        }
      }.padding(16).width('100%')
    }.width('100%').height('100%').backgroundColor('#F0F5F8')
  }
}
