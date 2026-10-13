import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { PublicCaseParam, PublicCaseDetail, PublicCaseSource, PublicCaseQuote } from './CommunityContract';
import { CommunityService } from './CommunityService';
@Component
export struct PublicCaseDetailPage {
  @Prop @Watch('refresh') refreshVersion: number = 0;
  param: PublicCaseParam = { caseId: '' };
  onSessionExpired: () => void = () => {};
  @State detail: PublicCaseDetail | null = null;
  @State loading: boolean = false;
  @State busy: boolean = false;
  @State errorText: string = '';
  @State notice: string = '';
  private generation: number = 0;
  aboutToAppear(): void { this.load(); }
  private refresh(): void { this.load(); }
  aboutToDisappear(): void { this.generation += 1; this.detail = null; }
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
    Scroll() {
      Column({ space: 14 }) {
        Button('刷新案例').enabled(!this.loading && !this.busy).onClick(() => { this.load(); })
        if (this.loading) { LoadingPanel({ text: '正在读取案例…' }) }
        if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(); } }) }
        if (this.detail !== null) {
          Text(this.detail.title).fontSize(24).fontWeight(FontWeight.Bold)
          Text('来源：已审核维修备案的 AI 整理案例（公开）').fontSize(12).fontColor('#71808B')
          Text(this.detail.displayText).fontSize(16).lineHeight(25).copyOption(CopyOptions.InApp)
          Button(this.busy ? '收藏中…' : '收藏案例').enabled(!this.busy).onClick(() => { this.favorite(); })
          if (this.notice !== '') { Text(this.notice).fontColor('#287B4E') }
          ForEach(this.detail.sources, (source: PublicCaseSource) => {
            Column({ space: 8 }) {
              Text(`来源证据 ${source.index}`).fontSize(16).fontWeight(FontWeight.Medium)
              ForEach(source.quotes, (quote: PublicCaseQuote) => { Text(quote.quote).fontSize(14).lineHeight(22) })
            }.width('100%').padding(16).backgroundColor(Color.White).borderRadius(16)
          }, (source: PublicCaseSource) => `${source.index}`)
        }
      }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').align(Alignment.Top).backgroundColor('#F0F5F8')
  }
}
