import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { LoadingPanel, ErrorPanel } from '../../core/ui/StatePanel';
import { ROUTE_STAFF_RECORD } from '../../core/ui/Routes';
import { StaffRecordParam, repairRecordStatusLabel } from '../repair/StaffRepairContract';
import { ActivityParam, ActivityBoard, StaffRegistration, ServedRegistration, CheckInInput, activityIssueLabel, activityTime } from './ActivityContract';
import { ActivityIssueSelector } from './ActivityWidgets';
import { ActivityService } from './ActivityService';
import { ActivityRequestGuard } from './ActivityRequestGuard';
@Component
export struct ActivityBoardPage {
  param: ActivityParam = { activityId: '' };
  @Prop @Watch('refresh') refreshVersion: number = 0;
  onOpen: (route: string, param: Object | null) => void = () => {};
  onSessionExpired: () => void = () => {};
  @State board: ActivityBoard | null = null;
  @State tab: string = '待签到';
  @State query: string = '';
  @State selectedId: string = '';
  @State selectedIssueType: string = 'OTHER';
  @State phoneText: string = '';
  @State phoneId: string = '';
  @State loading: boolean = false;
  @State busy: boolean = false;
  @State errorText: string = '';
  private guard: ActivityRequestGuard = new ActivityRequestGuard();
  aboutToAppear(): void { this.load(); }
  aboutToDisappear(): void { this.guard.invalidate(); this.loading = false; this.busy = false; this.phoneText = ''; this.phoneId = ''; }
  private refresh(): void { this.guard.invalidate(); this.loading = false; this.busy = false; this.load(); }
  private fail(error: Object): void {
    if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
    this.errorText = error instanceof ApiRequestError ? error.message : '现场操作失败，请重试';
  }
  private async load(): Promise<void> {
    if (this.loading || this.busy) return;
    const ticket = this.guard.begin(); this.loading = true; this.errorText = ''; this.board = null;
    this.phoneId = ''; this.phoneText = ''; this.selectedId = '';
    try { const board = await ActivityService.board(this.param.activityId); if (this.guard.current(ticket)) this.board = board; }
    catch (error) { if (this.guard.current(ticket)) this.fail(error); }
    finally { if (this.guard.current(ticket)) this.loading = false; }
  }
  private openRecord(id: string): void {
    if (id === '') return;
    const param: StaffRecordParam = { recordId: id, faultDescription: '' }; this.onOpen(ROUTE_STAFF_RECORD, param);
  }
  private async action(kind: string, id: string = ''): Promise<void> {
    if (this.busy || this.loading) return;
    const ticket = this.guard.begin(); this.busy = true; this.errorText = '';
    try {
      if (kind === 'attendance') await ActivityService.attend(this.param.activityId);
      else if (kind === 'check-in') {
        const input: CheckInInput = { registrationIds: [id], issueTypeUpdates: [{ registrationId: id, issueType: this.selectedIssueType }] };
        await ActivityService.checkIn(this.param.activityId, input);
      } else if (kind === 'withdraw') {
        const answer = await this.getUIContext().getPromptAction().showDialog({ title: '撤回客户排队？', message: '客户将返回待签到列表，报名和占用名额保留。',
          buttons: [{ text: '返回', color: '#69747C' }, { text: '撤回排队', color: '#D23F3F' }] });
        if (!this.guard.current(ticket)) return;
        if (answer.index !== 1) { this.busy = false; return; }
        await ActivityService.withdraw(this.param.activityId, id);
      } else if (kind === 'serve') {
        const result = await ActivityService.serve(this.param.activityId, id);
        if (!this.guard.current(ticket)) return;
        this.busy = false; this.board = null;
        this.openRecord(result.repairRecordId); return;
      } else if (kind === 'phone') {
        const result = await ActivityService.phone(this.param.activityId, id);
        if (!this.guard.current(ticket)) return;
        this.phoneId = id; this.phoneText = result.phone; return;
      }
      if (!this.guard.current(ticket)) return; this.busy = false; await this.load();
    } catch (error) {
      if (!this.guard.current(ticket)) return;
      this.fail(error);
      if (error instanceof ApiRequestError && error.code === 'ACTIVITY_SERVE_DRAFT_PENDING') {
        this.busy = false; await this.load(); this.errorText = error.message;
      }
    } finally { if (this.guard.current(ticket)) this.busy = false; }
  }
  private matches(item: StaffRegistration): boolean {
    const query = this.query.trim(); return item.name.includes(query) || item.phoneMasked.includes(query) || activityIssueLabel(item.issueType).includes(query);
  }
  private rows(): StaffRegistration[] {
    if (this.board === null) return [];
    return (this.tab === '待签到' ? this.board.eligible : this.board.queue).filter((item: StaffRegistration) => this.matches(item));
  }
  private served(): ServedRegistration[] {
    return this.board === null ? [] : this.board.served.filter((item: ServedRegistration) => this.matches(item));
  }
  @Builder
  row(item: StaffRegistration) {
    Column({ space: 10 }) {
      Text(`${item.name} · ${item.phoneMasked}`).fontSize(18).fontWeight(FontWeight.Bold).width('100%')
      Text(`${activityIssueLabel(item.issueType)} · ${item.deviceModel === null ? '机型未填写' : item.deviceModel}`).width('100%').fontSize(14)
      if (item.status === 'CHECKED_IN') { Text(`签到：${activityTime(item.checkedInAt)}`).fontSize(13).width('100%') }
      if (this.phoneId === item.id && this.phoneText !== '') {
        Row() {
          Text(this.phoneText).layoutWeight(1)
          Button('隐藏').onClick(() => { this.phoneText = ''; this.phoneId = ''; })
        }.width('100%')
      } else { Button('按需查看完整电话').enabled(!this.busy && !this.loading).onClick(() => { this.action('phone', item.id); }) }
      if (this.board !== null && this.board.attended && item.status === 'REGISTERED') {
        if (this.selectedId === item.id) {
          ActivityIssueSelector({ value: this.selectedIssueType, disabled: this.busy, onChange: (value: string): void => { this.selectedIssueType = value; } })
          Button('确认类型并签到入队').enabled(!this.busy && this.board.activity.canOperateStaff).onClick(() => { this.action('check-in', item.id); })
        } else {
          Button('签到 / 调整故障类型').enabled(!this.busy && this.board.activity.canOperateStaff)
            .onClick(() => { this.selectedId = item.id; this.selectedIssueType = item.issueType; })
        }
      }
      if (this.board !== null && this.board.attended && item.status === 'CHECKED_IN') {
        Row({ space: 10 }) {
          Button('接待并填写备案').enabled(!this.busy && this.board.activity.canOperateStaff && this.board.pendingServeDraft === null)
            .onClick(() => { this.action('serve', item.id); })
          Button('撤回排队').enabled(!this.busy).onClick(() => { this.action('withdraw', item.id); })
        }.width('100%')
      }
    }.width('100%').padding(16).backgroundColor(Color.White).borderRadius(18)
  }
  build() {
    Column({ space: 12 }) {
      Button('刷新看板').enabled(!this.loading && !this.busy).onClick(() => { this.load(); })
      if (this.loading) { LoadingPanel({ text: '正在读取现场看板…' }) }
      if (this.busy) { LoadingPanel({ text: '正在处理…' }) }
      if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(); } }) }
      if (this.board !== null) {
        Text(this.board.activity.title).fontSize(22).fontWeight(FontWeight.Bold).width('100%')
        if (!this.board.activity.canOperateStaff) { Text('报名截止后开放出勤、签到和接待').fontColor('#69747C').width('100%') }
        if (!this.board.attended) {
          Button('标记本场出勤').enabled(!this.busy && this.board.activity.canOperateStaff).onClick(() => { this.action('attendance'); })
        } else { Text(`本场已出勤 · ${activityTime(this.board.attendanceCheckedInAt)}`).fontSize(13).width('100%') }
        if (this.board.pendingServeDraft !== null) {
          Button(`继续填写：${this.board.pendingServeDraft.ownerName}（${this.board.pendingServeDraft.activityTitle}）`)
            .width('100%').enabled(!this.busy).onClick(() => { if (this.board !== null && this.board.pendingServeDraft !== null) this.openRecord(this.board.pendingServeDraft.repairRecordId); })
        }
        Row({ space: 8 }) {
          ForEach(['待签到', '排队中', '已接待'], (label: string) => {
            Button(label).fontSize(13).backgroundColor(this.tab === label ? '#1676E5' : '#DEE8F1')
              .fontColor(this.tab === label ? Color.White : '#324353').enabled(!this.busy)
              .onClick(() => { this.tab = label; this.selectedId = ''; this.phoneText = ''; this.phoneId = ''; })
          })
        }.width('100%')
        TextInput({ text: this.query, placeholder: '姓名、电话尾号或故障类型' }).onChange((value: string) => { this.query = value; this.phoneText = ''; })
        Text(`待签到 ${this.board.eligible.length} · 排队 ${this.board.queue.length} · 已接待 ${this.board.served.length}`).fontSize(13).width('100%')
        List({ space: 12 }) {
          if (this.tab === '已接待') {
            ForEach(this.served(), (item: ServedRegistration) => {
              ListItem() {
                Column({ space: 10 }) {
                  this.row(item)
                  Text(`备案：${item.recordStatus === null ? '不可用' : repairRecordStatusLabel(item.recordStatus)}`).fontSize(14)
                  if (item.repairRecordId !== null && item.recordStatus !== null && item.canOpenRecord) {
                    Button('查看关联备案').enabled(!this.busy).onClick(() => { if (item.repairRecordId !== null) this.openRecord(item.repairRecordId); })
                  }
                }.width('100%')
              }
            }, (item: ServedRegistration) => item.id)
          } else {
            ForEach(this.rows(), (item: StaffRegistration) => { ListItem() { this.row(item) } }, (item: StaffRegistration) => item.id)
          }
          if ((this.tab === '已接待' ? this.served().length : this.rows().length) === 0) { ListItem() { Text('暂无匹配的报名').padding(24) } }
        }.width('100%').layoutWeight(1)
      }
    }.width('100%').height('100%').padding(16).backgroundColor('#F0F5F8')
  }
}
