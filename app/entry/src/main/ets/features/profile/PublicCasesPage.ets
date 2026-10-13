import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { LoadingPanel, ErrorPanel } from '../../core/ui/StatePanel';
import { ROUTE_PUBLIC_CASE_DETAIL } from '../../core/ui/Routes';
import { PublicCaseItem, PublicCaseParam } from './CommunityContract';
import { CommunityService } from './CommunityService';
@Component
export struct PublicCasesPage {
  @Prop @Watch('refresh') refreshVersion: number = 0;
  onOpen: (route: string, param: Object | null) => void = () => {};
  onSessionExpired: () => void = () => {};
  @State items: PublicCaseItem[] = [];
  @State loading: boolean = false;
  @State errorText: string = '';
  @State hasMore: boolean = false;
  private page: number = 0;
  private generation: number = 0;
  aboutToAppear(): void { this.load(true); }
  private refresh(): void { this.load(true); }
  aboutToDisappear(): void { this.generation += 1; }
  private async load(reset: boolean): Promise<void> {
    if (this.loading) return;
    this.loading = true; this.errorText = ''; if (reset) { this.items = []; this.page = 0; this.hasMore = false; }
    const generation = ++this.generation, page = reset ? 1 : this.page + 1;
    try { const items = await CommunityService.cases(page); if (generation !== this.generation) return;
      this.items = reset ? items : this.items.concat(items); this.page = page; this.hasMore = items.length === 20;
    } catch (error) { if (generation !== this.generation) return;
      if (error instanceof ApiRequestError) { if (isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; } this.errorText = error.message; }
      else this.errorText = '公开案例读取失败';
    } finally { if (generation === this.generation) this.loading = false; }
  }
  build() {
    Column({ space: 14 }) {
      Text('AI 整理案例 · 当前有效公开资料').fontSize(14).fontColor('#76828D')
      Button('刷新案例').enabled(!this.loading).onClick(() => { this.load(true); })
      if (this.loading) { LoadingPanel({ text: '正在读取案例…' }) }
      if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(true); } }) }
      List({ space: 12 }) {
        ForEach(this.items, (item: PublicCaseItem) => {
          ListItem() {
            Button({ type: ButtonType.Normal }) { Text(item.title).fontSize(18).width('100%').textAlign(TextAlign.Start) }
              .width('100%').padding(18).backgroundColor(Color.White).borderRadius(18).fontColor('#17242E')
              .onClick(() => { const param: PublicCaseParam = { caseId: item.caseId }; this.onOpen(ROUTE_PUBLIC_CASE_DETAIL, param); })
          }
        }, (item: PublicCaseItem) => item.caseId)
        if (!this.loading && this.errorText === '' && this.items.length === 0) { ListItem() { Text('暂无有效公开案例').padding(24) } }
        if (this.hasMore) { ListItem() { Button('加载更多').enabled(!this.loading).onClick(() => { this.load(false); }) } }
      }.width('100%').layoutWeight(1)
    }.width('100%').height('100%').padding(16).backgroundColor('#F0F5F8')
  }
}
