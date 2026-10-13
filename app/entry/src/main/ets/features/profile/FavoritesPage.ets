import { HOME_STAFF } from '../../core/auth/AuthContract';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { LoadingPanel, ErrorPanel } from '../../core/ui/StatePanel';
import { ROUTE_PUBLIC_GUIDES, ROUTE_PUBLIC_CASE_DETAIL, ROUTE_STAFF_RECORD, GuideFocusParam } from '../../core/ui/Routes';
import { StaffRecordParam } from '../repair/StaffRepairContract';
import { FavoriteItem, PublicCaseParam } from './CommunityContract';
import { CommunityService } from './CommunityService';

@Component
export struct FavoritesPage {
  @Prop @Watch('refresh') refreshVersion: number = 0;
  @Prop home: string = '';
  onOpen: (route: string, param: Object | null) => void = () => {};
  onSessionExpired: () => void = () => {};
  @State items: FavoriteItem[] = [];
  @State loading: boolean = false;
  @State errorText: string = '';
  @State hasMore: boolean = false;
  private page: number = 0;
  private generation: number = 0;
  private retryReset: boolean = true;
  aboutToAppear(): void { this.load(true); }
  private refresh(): void { this.load(true); }
  aboutToDisappear(): void { this.generation += 1; }
  private fail(error: Object): void {
    if (error instanceof ApiRequestError) {
      if (isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
      this.errorText = error.message;
    } else { this.errorText = '收藏加载失败，请重试'; }
  }
  private async load(reset: boolean): Promise<void> {
    if (this.loading) return;
    this.loading = true; this.errorText = ''; this.retryReset = reset;
    // 刷新立即清除旧可见内容，失效内容不继续展示旧标题。
    if (reset) { this.items = []; this.page = 0; this.hasMore = false; }
    const generation = ++this.generation, page = reset ? 1 : this.page + 1;
    try {
      const items = await CommunityService.favorites(this.home === HOME_STAFF, page);
      if (generation !== this.generation) return;
      this.items = reset ? items : this.items.concat(items); this.page = page; this.hasMore = items.length === 20;
    } catch (error) { if (generation === this.generation) this.fail(error); }
    finally { if (generation === this.generation) this.loading = false; }
  }
  private open(item: FavoriteItem): void {
    if (!item.available || item.targetId === null || this.loading) return;
    if (item.kind === 'GUIDE') { const param: GuideFocusParam = { guideId: item.targetId }; this.onOpen(ROUTE_PUBLIC_GUIDES, param); }
    else if (item.kind === 'CASE') { const param: PublicCaseParam = { caseId: item.targetId }; this.onOpen(ROUTE_PUBLIC_CASE_DETAIL, param); }
    else { const param: StaffRecordParam = { recordId: item.targetId, faultDescription: '' }; this.onOpen(ROUTE_STAFF_RECORD, param); }
  }
  private async remove(item: FavoriteItem): Promise<void> {
    if (this.loading) return;
    this.loading = true; this.errorText = '';
    const generation = this.generation;
    try { await CommunityService.removeFavorite(this.home === HOME_STAFF, item);
      if (generation !== this.generation) return;
      this.loading = false; await this.load(true);
    } catch (error) { if (generation === this.generation) { this.loading = false; this.fail(error); } }
  }
  build() {
    Column({ space: 14 }) {
      Button('刷新收藏').enabled(!this.loading).onClick(() => { this.load(true); })
      if (this.loading) { LoadingPanel({ text: '正在读取收藏…' }) }
      if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(this.retryReset); } }) }
      List({ space: 12 }) {
        ForEach(this.items, (item: FavoriteItem) => {
          ListItem() {
            Column({ space: 10 }) {
              Text(item.title).fontSize(18).fontWeight(FontWeight.Medium).width('100%')
              Text(item.kind === 'REPAIR' ? '维修备案' : item.kind === 'GUIDE' ? '维修指南' : 'AI 整理案例').fontSize(12).fontColor('#7A858E')
              Row({ space: 10 }) {
                Button(item.available ? '打开' : '不可访问').enabled(item.available && !this.loading).onClick(() => { this.open(item); })
                Button('取消收藏').enabled(!this.loading).onClick(() => { this.remove(item); })
              }
            }.width('100%').padding(18).backgroundColor(Color.White).borderRadius(18).alignItems(HorizontalAlign.Start)
          }
        }, (item: FavoriteItem) => item.id)
        if (!this.loading && this.items.length === 0 && this.errorText === '') { ListItem() { Text('暂无收藏；可在内容详情中收藏。').padding(24) } }
        if (this.hasMore) { ListItem() { Button('加载更多').enabled(!this.loading).onClick(() => { this.load(false); }) } }
      }.width('100%').layoutWeight(1)
    }.width('100%').height('100%').padding(16).backgroundColor('#F0F5F8')
  }
}
