import { DetailHeader } from '../../core/ui/ReferenceDetail';
import { ReadingAuthor, ReadingBottomBar } from '../../core/ui/ReadingReference';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { PublicCaseParam, PublicCaseDetail, PublicCaseSource, PublicCaseQuote } from './CommunityContract';
import { CommunityService } from './CommunityService';
@Component
export struct PublicCaseDetailPage {
  @Prop @Watch('refresh') refreshVersion: number = 0;
  param: PublicCaseParam = { caseId: '' };
  onSessionExpired: () => void = () => {};
  onBack: () => void = () => {};
  @State detail: PublicCaseDetail | null = null;
  @State loading: boolean = false;
  @State busy: boolean = false;
  @State errorText: string = '';
  @State notice: string = '';
  private generation: number = 0;
  aboutToAppear(): void { this.load(); }
  private refresh(): void { this.load(); }
  aboutToDisappear(): void { this.generation += 1; this.detail = null; this.loading = false; this.busy = false; }
  private async load(): Promise<void> {
    if (this.loading || this.busy) return;
    this.loading = true; this.detail = null; this.errorText = ''; this.notice = '';
    const generation = ++this.generation;
    try { const detail = await CommunityService.caseDetail(this.param.caseId); if (generation === this.generation) this.detail = detail; }
    catch (error) { if (generation !== this.generation) return;
      if (error instanceof ApiRequestError) { if (isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; } this.errorText = error.message; }
      else this.errorText = '案例读取失败';
    } finally { if (generation === this.generation) this.loading = false; }
  }
  private async favorite(): Promise<void> {
    if (this.busy || this.loading || this.detail === null) return;
    this.busy = true; this.notice = ''; this.errorText = ''; const generation = this.generation;
    try { await CommunityService.favorite('CASE', this.param.caseId); if (generation === this.generation) this.notice = '已收藏；重复收藏不会新增'; }
    catch (error) { if (generation !== this.generation) return;
      if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) { this.detail = null; this.onSessionExpired(); return; }
      this.errorText = error instanceof ApiRequestError ? error.message : '收藏失败';
      // 撤回或转内部时清除当前正文，不能只在旧正文上叠一个错误提示。
      if (error instanceof ApiRequestError && error.code === 'CASE_NOT_FOUND') this.detail = null;
    } finally { if (generation === this.generation) this.busy = false; }
  }
  build() {
    Column() {
      DetailHeader({ title: '案例详情', onBack: this.onBack, refresh: true,
        onRefresh: (): void => { if (!this.loading && !this.busy) this.load(); } })
      Scroll() {
        Column({ space: 12 }) {
          if (this.loading) { LoadingPanel({ text: '正在读取案例…' }) }
          if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(); } }) }
          if (this.detail !== null) {
            Text(this.detail.title).fontSize(24).fontWeight(FontWeight.Medium).lineHeight(34).fontColor('#14191D').width('100%')
            ReadingAuthor({ name: '电脑医院 · 已审核维修来源', note: 'AI 整理案例 · 公开 · 版本 v' + this.detail.contentVersion.toString() })
            Text(this.detail.displayText).fontSize(16).lineHeight(29).fontColor('#343C42').width('100%').copyOption(CopyOptions.InApp)
            if (this.notice !== '') { Text(this.notice).fontSize(13).fontColor('#287B4E').width('100%') }
            Text('来源证据').fontSize(19).fontWeight(FontWeight.Medium).width('100%').margin({ top: 20, bottom: 6 })
            ForEach(this.detail.sources, (source: PublicCaseSource) => {
              Column({ space: 12 }) {
                Text('来源 ' + source.index.toString()).fontSize(15).fontWeight(FontWeight.Medium).fontColor('#3B4652')
                ForEach(source.quotes, (quote: PublicCaseQuote) => {
                  Text('“' + quote.quote + '”').fontSize(15).lineHeight(26).fontColor('#65717B').width('100%')
                })
              }.width('100%').padding(18).backgroundColor('#F5F7FA').borderRadius(16).alignItems(HorizontalAlign.Start)
            }, (source: PublicCaseSource) => source.index.toString())
          }
        }.width('100%').padding({ left: 18, right: 18, top: 18, bottom: 28 }).alignItems(HorizontalAlign.Start)
      }.width('100%').layoutWeight(1).scrollBar(BarState.Off).align(Alignment.Top).backgroundColor(Color.White)
      if (this.detail !== null) {
        ReadingBottomBar({ text: '公开案例 · ' + this.detail.sources.length.toString() + ' 条来源证据',
          action: this.busy ? '收藏中…' : '收藏案例', actionEnabled: !this.busy && !this.loading,
          onSelect: (): void => { this.favorite(); } })
      }
    }.width('100%').height('100%').backgroundColor('#F1F6F9')
  }
}
