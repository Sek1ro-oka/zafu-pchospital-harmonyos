import { HOME_STAFF } from '../../core/auth/AuthContract';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { LoadingPanel, ErrorPanel } from '../../core/ui/StatePanel';
import { ROUTE_REPAIR_ORDERS, ROUTE_STAFF_RECORD, RepairOrderFocusParam } from '../../core/ui/Routes';
import { StaffRecordParam } from '../repair/StaffRepairContract';
import { MessageItem } from './CommunityContract';
import { CommunityService } from './CommunityService';

@Component
export struct MessagesPage {
  @Prop @Watch('refresh') refreshVersion: number = 0;
  @Prop home: string = '';
  onOpen: (route: string, param: Object | null) => void = () => {};
  onSessionExpired: () => void = () => {};
  @State items: MessageItem[] = [];
  @State unread: number = -1;
  @State loading: boolean = false;
  @State errorText: string = '';
  @State hasMore: boolean = false;
  private page: number = 0;
  private generation: number = 0;
  private retryReset: boolean = true;
  aboutToAppear(): void { this.load(true); }
  private refresh(): void { this.load(true); }
  aboutToDisappear(): void { this.generation += 1; this.loading = false; }
  private fail(error: Object): void {
    if (error instanceof ApiRequestError) { if (isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; } this.errorText = error.message; }
    else this.errorText = '消息请求失败，请重试';
  }
  private async load(reset: boolean): Promise<void> {
    if (this.loading) return;
    this.loading = true; this.errorText = ''; this.retryReset = reset;
    if (reset) { this.unread = -1; this.items = []; this.page = 0; this.hasMore = false; }
    const generation = ++this.generation, page = reset ? 1 : this.page + 1;
    try {
      const result = await CommunityService.messages(this.home === HOME_STAFF, page);
      if (generation !== this.generation) return;
      this.items = reset ? result.items : this.items.concat(result.items); this.page = page;
      this.unread = result.unreadCount; this.hasMore = result.items.length === 20;
    } catch (error) { if (generation === this.generation) this.fail(error); }
    finally { if (generation === this.generation) this.loading = false; }
  }
  private async action(action: string, item: MessageItem | null): Promise<void> {
    if (this.loading) return;
    this.loading = true; this.errorText = '';
    const generation = this.generation;
    try {
      await CommunityService.messageAction(this.home === HOME_STAFF, action, item?.id ?? '');
      if (generation !== this.generation) return;
      this.loading = false;
      if (action === 'open' && item !== null && item.targetId !== null) {
        if (this.home === HOME_STAFF) { const param: StaffRecordParam = { recordId: item.targetId, faultDescription: '' }; this.onOpen(ROUTE_STAFF_RECORD, param); }
        else { const param: RepairOrderFocusParam = { orderId: item.targetId }; this.onOpen(ROUTE_REPAIR_ORDERS, param); }
      }
      await this.load(true);
    } catch (error) { if (generation === this.generation) { this.loading = false; this.fail(error); } }
  }
  build() {
    Column({ space: 14 }) {
      Row({ space: 8 }) {
        Text(this.unread < 0 ? '未读数读取中/不可用' : `未读 ${this.unread}`).fontSize(16).layoutWeight(1)
        Button('刷新').enabled(!this.loading).onClick(() => { this.load(true); })
        Button('全部已读').enabled(!this.loading).onClick(() => { this.action('all', null); })
      }.width('100%')
      if (this.loading) { LoadingPanel({ text: '正在读取消息…' }) }
      if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(this.retryReset); } }) }
      List({ space: 12 }) {
        ForEach(this.items, (item: MessageItem) => {
          ListItem() {
            Column({ space: 10 }) {
              Text(`${item.unread ? '● ' : ''}${item.title}`).fontSize(18).fontWeight(FontWeight.Medium)
              Text(item.body).fontSize(14).fontColor('#6F7A84')
              Row({ space: 6 }) {
                Button('查看详情').enabled(!this.loading && item.targetId !== null).onClick(() => { this.action('open', item); })
                if (item.unread) { Button('已读').enabled(!this.loading).onClick(() => { this.action('read', item); }) }
                Button('删除').enabled(!this.loading).onClick(() => { this.action('delete', item); })
              }
            }.width('100%').padding(18).backgroundColor(Color.White).borderRadius(18).alignItems(HorizontalAlign.Start)
          }
        }, (item: MessageItem) => item.id)
        if (!this.loading && this.items.length === 0 && this.errorText === '') { ListItem() { Text('暂无站内消息').padding(24) } }
        if (this.hasMore) { ListItem() { Button('加载更多').enabled(!this.loading).onClick(() => { this.load(false); }) } }
      }.width('100%').layoutWeight(1)
    }.width('100%').height('100%').padding(16).backgroundColor('#F0F5F8')
  }
}
