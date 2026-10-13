import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { REFERENCE_BACKGROUND } from '../../core/ui/ReferencePage';
import { ROUTE_PERSONAL_PROFILE } from '../../core/ui/Routes';
import { MemberDirectoryEntry, PersonalProfileParam } from './PersonalProfileContract';
import { PersonalProfileService } from './PersonalProfileService';

@Component
export struct MemberDirectoryPage {
  onOpen: (route: string, param: Object | null) => void = () => {};
  onSessionExpired: () => void = () => {};
  @State query: string = '';
  @State items: MemberDirectoryEntry[] = [];
  @State busy: boolean = false;
  @State errorText: string = '';
  @State hasMore: boolean = false;
  private currentQuery: string = '';
  private page: number = 0;
  private retryReset: boolean = true;
  private generation: number = 0;
  aboutToAppear(): void { this.load(true); }
  aboutToDisappear(): void { this.generation += 1; this.busy = false; }
  private async load(reset: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.errorText = '';
    this.retryReset = reset;
    const generation = ++this.generation;
    const page = reset ? 1 : this.page + 1;
    const query = reset ? this.query.trim() : this.currentQuery;
    try {
      const result = await PersonalProfileService.directory(query, page);
      if (generation !== this.generation) return;
      this.items = reset ? result.items : this.items.concat(result.items);
      this.currentQuery = query; this.page = page; this.hasMore = result.hasMore;
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof ApiRequestError) {
        if (isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
        this.errorText = error.message;
      } else { this.errorText = '成员资料加载失败'; }
    } finally { if (generation === this.generation) this.busy = false; }
  }
  build() {
    Column({ space: 14 }) {
      Row({ space: 8 }) {
        TextInput({ text: this.query, placeholder: '按姓名或昵称搜索' }).layoutWeight(1).enabled(!this.busy)
          .onChange((value: string) => { this.query = value; })
        Button('搜索').enabled(!this.busy).onClick(() => { this.load(true); })
      }.width('100%')
      if (this.busy) { LoadingPanel({ text: '正在读取成员…' }) }
      if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(this.retryReset); } }) }
      List({ space: 10 }) {
        ForEach(this.items, (item: MemberDirectoryEntry) => {
          ListItem() {
            Row() { Text(item.displayName).fontSize(17).layoutWeight(1); Text('查看 ›').fontColor('#1676E5') }
              .width('100%').padding(20).backgroundColor(Color.White).borderRadius(16)
              .onClick(() => {
                const param: PersonalProfileParam = { memberProfileId: item.memberProfileId };
                this.onOpen(ROUTE_PERSONAL_PROFILE, param);
              })
          }
        }, (item: MemberDirectoryEntry) => item.memberProfileId)
        if (!this.busy && this.items.length === 0 && this.errorText === '') { ListItem() { Text('暂无匹配成员').padding(24) } }
        if (this.hasMore) { ListItem() { Button('加载更多').enabled(!this.busy).onClick(() => { this.load(false); }) } }
      }.layoutWeight(1).width('100%')
    }.padding(16).width('100%').height('100%').backgroundColor(REFERENCE_BACKGROUND)
  }
}
