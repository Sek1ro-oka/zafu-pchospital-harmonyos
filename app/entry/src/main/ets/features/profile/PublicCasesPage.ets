import { ReadingLibraryHero } from '../../core/ui/ReadingReference';
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
  onBack: () => void = () => {};
  @State items: PublicCaseItem[] = [];
  @State loading: boolean = false;
  @State errorText: string = '';
  @State hasMore: boolean = false;
  private page: number = 0;
  private generation: number = 0;
  aboutToAppear(): void { this.load(true); }
  private refresh(): void { this.load(true); }
  aboutToDisappear(): void { this.generation += 1; this.loading = false; }
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
    Scroll() {
      Column({ space: 0 }) {
        ReadingLibraryHero({ title: '公开维修案例', scope: '当前有效公开资料', loaded: this.items.length,
          onBack: this.onBack, onRefresh: (): void => { this.load(true); } })
        Column({ space: 16 }) {
          Row() {
            Text('案例资料').fontSize(21).fontWeight(FontWeight.Bold).fontColor('#151B20').layoutWeight(1)
            Text('公开可读').fontSize(14).fontColor('#8B9399')
          }.width('100%').margin({ top: 10 })
          Text('内容来自已审核维修备案的 AI 整理结果，打开案例可查看来源证据。').fontSize(13).lineHeight(21).fontColor('#69747D')
            .width('100%').padding(14).backgroundColor(Color.White).borderRadius(16)
          if (this.loading) { LoadingPanel({ text: '正在读取案例…' }) }
          if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(true); } }) }
          ForEach(this.items, (item: PublicCaseItem) => {
            Button({ type: ButtonType.Normal }) {
              Column({ space: 15 }) {
                Row({ space: 12 }) {
                  Image($r('app.media.ref_shield')).width(38).height(38)
                  Column({ space: 5 }) {
                    Text('电脑医院 · AI 整理案例').fontSize(15).fontWeight(FontWeight.Medium).fontColor('#242D35')
                    Text('有效公开资料').fontSize(11).fontColor('#8B949B')
                  }.alignItems(HorizontalAlign.Start).layoutWeight(1)
                  Text('查看').fontSize(13).fontColor('#0877E0')
                    .padding({ left: 13, right: 13, top: 6, bottom: 6 }).backgroundColor('#F3F6FA').borderRadius(16)
                }.width('100%')
                Text(item.title).fontSize(20).lineHeight(29).fontWeight(FontWeight.Medium).fontColor('#171D22').width('100%').textAlign(TextAlign.Start)
                Text('公开 · 版本 v' + item.contentVersion.toString()).fontSize(13).fontColor('#879198').width('100%').textAlign(TextAlign.Start)
              }.width('100%').padding(18).alignItems(HorizontalAlign.Start)
            }.width('100%').backgroundColor(Color.White).borderRadius(22)
              .onClick(() => { const param: PublicCaseParam = { caseId: item.caseId }; this.onOpen(ROUTE_PUBLIC_CASE_DETAIL, param); })
          }, (item: PublicCaseItem) => item.caseId)
          if (!this.loading && this.errorText === '' && this.items.length === 0) { Text('暂无有效公开案例').fontColor('#879198').padding(28) }
          if (this.hasMore) { Button('加载更多').enabled(!this.loading).onClick(() => { this.load(false); }) }
        }.width('100%').padding({ left: 18, right: 18, top: 16, bottom: 24 })
          .backgroundColor('#F1F6F9').borderRadius({ topLeft: 30, topRight: 30 }).alignItems(HorizontalAlign.Start)
      }.width('100%').backgroundColor('#0C1723')
    }.width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top).backgroundColor('#F1F6F9')
  }
}
