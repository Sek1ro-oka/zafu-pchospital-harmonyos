import { ApiClient, ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { SessionStore } from '../../core/auth/SessionStore';
import { ROUTE_FAVORITES, ROUTE_MESSAGES, ROUTE_REPAIR_RECORDS, ROUTE_STAFF_RECORD } from '../../core/ui/Routes';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { StaffRecordParam, repairRecordStatusLabel } from './StaffRepairContract';
import { RecordListParam } from './RepairRecordsPage';

interface Metric { status: string; value: number | null; }
interface Summary { totalApprovedCount: Metric; monthApprovedCount: Metric; termApprovedCount: Metric; totalApprovedDurationMinutes: Metric; source: string; }
interface Queue { draftCount: number; pendingCount: number; rejectedCount: number; }
interface Recent { id: string; status: string; contentExcerpt: string; }
interface NoticeSummary { available: boolean; unreadCount: number | null; }
interface FavoriteSummary { available: boolean; count: number | null; }
export interface Dashboard { repairSummary: Summary; workQueue: Queue; recentActivity: Recent[]; degraded: string[]; notifications: NoticeSummary; favorites: FavoriteSummary; }
export function metricText(value: Metric): string { return value.status === 'AVAILABLE' && value.value !== null ? `${value.value}` : '待配置'; }

@Component
export struct WorkbenchSummary {
  @Prop @Watch('refresh') refreshVersion: number = 0;
  onOpen: (route: string, param: Object | null) => void = () => {};
  onSessionExpired: () => void = () => {};
  @State dashboard: Dashboard | null = null;
  @State loading: boolean = false;
  @State errorText: string = '';
  private generation: number = 0;
  aboutToAppear(): void { this.load(); }
  aboutToDisappear(): void { this.generation += 1; }
  private refresh(): void { this.load(); }
  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true; this.dashboard = null; this.errorText = ''; const generation = ++this.generation;
    try {
      const token = await SessionStore.readToken();
      if (token === '') throw new ApiRequestError('UNAUTHENTICATED', '请先登录', 401, '');
      const dashboard = await ApiClient.get<Dashboard>(ApiConfig.getBaseUrl(), '/api/v1/member/dashboard', token);
      if (generation === this.generation) this.dashboard = dashboard;
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
      this.errorText = error instanceof ApiRequestError ? error.message : '工作摘要加载失败';
    } finally { if (generation === this.generation) this.loading = false; }
  }
  @Builder
  cell(label: string, text: string) {
    Column({ space: 6 }) { Text(text).fontSize(21).fontWeight(FontWeight.Bold).fontColor('#477886'); Text(label).fontSize(11).fontColor('#747A7F') }.layoutWeight(1)
  }
  build() {
    Column({ space: 12 }) {
      Row() { Text('我的维修工作').fontSize(19).fontWeight(FontWeight.Bold).layoutWeight(1); Button('刷新摘要').fontSize(12).height(30).enabled(!this.loading).onClick(() => { this.load(); }) }.width('100%')
      if (this.loading) { LoadingPanel({ text: '正在读取工作摘要…' }) }
      if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(); } }) }
      if (this.dashboard !== null) {
        Row() {
          this.cell('累计已审核', metricText(this.dashboard.repairSummary.totalApprovedCount))
          this.cell('本月已审核', metricText(this.dashboard.repairSummary.monthApprovedCount))
          this.cell('本学期已审核', metricText(this.dashboard.repairSummary.termApprovedCount))
          this.cell('累计分钟', metricText(this.dashboard.repairSummary.totalApprovedDurationMinutes))
        }.width('100%')
        if (this.dashboard.degraded.includes('repairSummary')) { Text('维修统计暂时不可用，刷新重试').fontSize(12).fontColor('#C34141') }
        if (this.dashboard.degraded.includes('workQueue')) { Text('备案队列暂时不可用').fontSize(12).fontColor('#C34141') }
        else { Text(`草稿 ${this.dashboard.workQueue.draftCount} · 待审核 ${this.dashboard.workQueue.pendingCount} · 退回 ${this.dashboard.workQueue.rejectedCount}`).fontSize(13) }
        Row({ space: 8 }) {
          Button('本人备案').fontSize(12).height(32).onClick(() => { const param: RecordListParam = { library: false }; this.onOpen(ROUTE_REPAIR_RECORDS, param); })
          Button('已审核备案库').fontSize(12).height(32).onClick(() => { const param: RecordListParam = { library: true }; this.onOpen(ROUTE_REPAIR_RECORDS, param); })
        }
        Text('近期备案（包含未审核）').fontSize(14).fontWeight(FontWeight.Medium)
        if (this.dashboard.degraded.includes('recentActivity')) { Text('近期备案暂时不可用').fontSize(12).fontColor('#C34141') }
        else if (this.dashboard.recentActivity.length === 0) { Text('暂无本人备案').fontSize(12).fontColor('#747A7F') }
        else {
          ForEach(this.dashboard.recentActivity, (record: Recent) => {
            Text(`${repairRecordStatusLabel(record.status)} · ${record.contentExcerpt || '正文尚未填写'} ›`).fontSize(13).maxLines(2).width('100%')
              .padding(10).backgroundColor('#F5F8FA').borderRadius(8).onClick(() => { const param: StaffRecordParam = { recordId: record.id, faultDescription: '' }; this.onOpen(ROUTE_STAFF_RECORD, param); })
          }, (record: Recent) => record.id)
        }
        Row({ space: 10 }) {
          Button(this.dashboard.notifications.available ? `未读消息 ${this.dashboard.notifications.unreadCount}` : '消息摘要不可用').fontSize(12).height(32).onClick(() => { this.onOpen(ROUTE_MESSAGES, null); })
          Button(this.dashboard.favorites.available ? `收藏 ${this.dashboard.favorites.count}` : '收藏摘要不可用').fontSize(12).height(32).onClick(() => { this.onOpen(ROUTE_FAVORITES, null); })
        }
      }
    }.width('100%').padding(16).backgroundColor(Color.White).borderRadius(20).alignItems(HorizontalAlign.Start)
  }
}
