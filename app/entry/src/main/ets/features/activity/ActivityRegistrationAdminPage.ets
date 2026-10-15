import { SessionIdentity } from '../../core/auth/AuthContract';
import { SessionService } from '../../core/auth/SessionService';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { LabeledInput } from '../../core/ui/FormControls';
import { LoadingPanel, ErrorPanel } from '../../core/ui/StatePanel';
import { ActivityParam, AdminRegistration, AdminRegistrationUpdate, activityIssueLabel, registrationStatusLabel } from './ActivityContract';
import { ActivityIssueSelector } from './ActivityWidgets';
import { ActivityService } from './ActivityService';
import { ActivityRequestGuard } from './ActivityRequestGuard';
@Component
export struct ActivityRegistrationAdminPage {
  param: ActivityParam = { activityId: '' };
  @Prop @Watch('refresh') refreshVersion: number = 0;
  onSessionExpired: () => void = () => {};
  @State items: AdminRegistration[] = [];
  @State query: string = '';
  @State selectedId: string = '';
  @State name: string = '';
  @State phone: string = '';
  @State issueType: string = 'OTHER';
  @State loading: boolean = false;
  @State busy: boolean = false;
  @State errorText: string = '';
  private guard: ActivityRequestGuard = new ActivityRequestGuard();
  private loadedIdentity: SessionIdentity | null = SessionService.current();
  private retryKind: string = '';
  private retryId: string = '';
  private retryInput: AdminRegistrationUpdate | null = null;
  private retryActivityId: string = '';
  private retryIdentity: SessionIdentity | null = null;
  aboutToAppear(): void { this.load(); }
  aboutToDisappear(): void { this.guard.invalidate(); this.loading = false; this.busy = false; this.retryKind = ''; }
  private refresh(): void { this.guard.invalidate(); this.loading = false; this.busy = false; this.retryKind = ''; this.load(); }
  private fail(error: Object): void {
    if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
    this.errorText = error instanceof ApiRequestError ? error.message : '报名读取或操作失败，请重试';
  }
  private async load(): Promise<void> {
    if (this.loading || this.busy) return;
    if (this.loadedIdentity !== SessionService.current()) {
      this.loadedIdentity = SessionService.current(); this.items = []; this.selectedId = ''; this.name = ''; this.phone = ''; this.retryKind = '';
    }
    const ticket = this.guard.begin(); this.loading = true; this.errorText = ''; this.retryKind = '';
    try { const items = await ActivityService.adminRegistrations(this.param.activityId); if (this.guard.current(ticket)) this.items = items; }
    catch (error) {
      if (this.guard.current(ticket)) { this.retryKind = 'load'; this.retryIdentity = SessionService.current(); this.fail(error); }
    } finally { if (this.guard.current(ticket)) this.loading = false; }
  }
  private select(item: AdminRegistration): void {
    if (this.busy || this.loading) return;
    this.selectedId = item.id; this.name = item.name; this.phone = ''; this.issueType = item.issueType;
  }
  private async save(): Promise<void> {
    if (this.selectedId === '') return;
    const input: AdminRegistrationUpdate = { name: this.name, issueType: this.issueType,
      phone: this.phone.trim() === '' ? undefined : this.phone };
    await this.write('save', this.param.activityId, this.selectedId, input);
  }
  private async remove(id: string): Promise<void> { await this.write('delete', this.param.activityId, id, null); }
  private async retry(): Promise<void> {
    if (this.busy || this.loading) return;
    if (this.retryIdentity !== SessionService.current()) {
      this.retryKind = ''; this.selectedId = ''; this.name = ''; this.phone = ''; this.items = []; await this.load(); return;
    }
    if (this.retryKind === 'load') { await this.load(); return; }
    if (this.retryKind === 'save' || this.retryKind === 'delete') {
      await this.write(this.retryKind, this.retryActivityId, this.retryId, this.retryInput);
    }
  }
  private async write(kind: string, activityId: string, id: string, input: AdminRegistrationUpdate | null): Promise<void> {
    if (this.busy || this.loading) return;
    const ticket = this.guard.begin(); this.busy = true; this.errorText = ''; this.retryKind = '';
    try {
      if (kind === 'delete') {
        const answer = await this.getUIContext().getPromptAction().showDialog({ title: '删除本条报名？', message: '删除后将不再占用有效名额，请确认本次管理操作。',
          buttons: [{ text: '返回', color: '#69747C' }, { text: '确认删除', color: '#D23F3F' }] });
        if (!this.guard.current(ticket) || answer.index !== 1) return;
        await ActivityService.deleteRegistration(activityId, id);
      } else if (input !== null) { await ActivityService.saveRegistration(activityId, id, input); }
      if (!this.guard.current(ticket)) return;
      if (this.selectedId === id) this.selectedId = '';
      this.busy = false;
      // A successful write followed by a failed refresh must only retry the read.
      await this.load();
    } catch (error) {
      if (this.guard.current(ticket)) {
        this.retryKind = kind; this.retryId = id; this.retryInput = input;
        this.retryActivityId = activityId; this.retryIdentity = SessionService.current(); this.fail(error);
      }
    } finally { if (this.guard.current(ticket)) this.busy = false; }
  }
  private visible(): AdminRegistration[] {
    return this.items.filter((item: AdminRegistration) => item.name.includes(this.query.trim()) || item.phoneMasked.includes(this.query.trim()));
  }
  build() {
    Column({ space: 12 }) {
      Button('刷新报名').enabled(!this.loading && !this.busy).onClick(() => { this.load(); })
      TextInput({ text: this.query, placeholder: '搜索姓名或电话尾号' }).onChange((value: string) => { this.query = value; })
      if (this.loading) { LoadingPanel({ text: '正在读取活动报名…' }) }
      if (this.errorText !== '' && this.retryKind === 'save') { Text('重试将提交上次保存的内容；提交当前编辑内容请点保存修改。').fontSize(13).width('100%') }
      if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { this.retry(); } }) }
      List({ space: 12 }) {
        ForEach(this.visible(), (item: AdminRegistration) => {
          ListItem() {
            Column({ space: 12 }) {
              Text(`${item.name} · ${item.phoneMasked}`).fontSize(18).fontWeight(FontWeight.Bold).width('100%')
              Text(`${registrationStatusLabel(item.status)} · ${activityIssueLabel(item.issueType)}${item.deletedAt === null ? '' : ' · 已删除'}`).fontSize(13).width('100%')
              if (item.deletedAt === null) {
                if (this.selectedId === item.id) {
                  LabeledInput({ label: '联系姓名', text: this.name, maxLength: 40, disabled: this.busy,
                    onChange: (value: string): void => { this.name = value; } })
                  LabeledInput({ label: '替换手机号（留空保持原号码）', text: this.phone, maxLength: 11, inputType: InputType.PhoneNumber, disabled: this.busy,
                    onChange: (value: string): void => { this.phone = value; } })
                  ActivityIssueSelector({ value: this.issueType, disabled: this.busy, onChange: (value: string): void => { this.issueType = value; } })
                  Button('保存修改').enabled(!this.busy).onClick(() => { this.save(); })
                  Button('取消编辑').enabled(!this.busy).onClick(() => { this.selectedId = ''; })
                } else { Button('修改报名').enabled(!this.busy).onClick(() => { this.select(item); }) }
                Button('删除报名').enabled(!this.busy).fontColor('#C33B3B').backgroundColor('#FFF3F3').onClick(() => { this.remove(item.id); })
              }
            }.width('100%').padding(16).backgroundColor(Color.White).borderRadius(18)
          }
        }, (item: AdminRegistration) => `${item.id}:${item.name}:${item.phoneMasked}:${item.issueType}:${item.status}:${item.deletedAt}`)
        if (!this.loading && this.errorText === '' && this.visible().length === 0) { ListItem() { Text('暂无匹配的报名').padding(24) } }
      }.width('100%').layoutWeight(1)
    }.width('100%').height('100%').padding(16).backgroundColor('#F0F5F8')
  }
}
