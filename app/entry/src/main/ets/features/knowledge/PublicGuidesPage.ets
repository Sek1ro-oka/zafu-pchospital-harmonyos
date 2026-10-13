import { ApiClient, ApiRequestError } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { HOME_STAFF } from '../../core/auth/AuthContract';
import { isSessionExpiredCode } from '../../core/network/ApiClient';
import { CommunityService } from '../profile/CommunityService';

interface PublicGuide {
  id: string;
  title: string;
  revision: string | null;
}
interface PublicGuideList { guides: PublicGuide[]; }
interface PublicGuideSection { title: string; content: string; }
interface PublicGuideDetail { title: string; revision: string | null; sections: PublicGuideSection[]; }

/** 公开指南目录/详情子页；分类主页面由 KnowledgeLibraryPage 负责。 */
@Component
export struct PublicGuidesPage {
  @Prop authenticated: boolean = false;
  @Prop home: string = '';
  onSessionExpired: () => void = () => {};
  @State favoriting: boolean = false;
  @State notice: string = '';
  @Prop initialGuideId: string = '';
  onConsult: () => void = () => {};
  @State guides: PublicGuide[] = [];
  @State detail: PublicGuideDetail | null = null;
  @State query: string = '';
  @State loading: boolean = false;
  @State errorText: string = '';
  private selectedId: string = '';
  private generation: number = 0;

  aboutToAppear(): void { this.load(this.initialGuideId); }
  aboutToDisappear(): void { this.generation += 1; }

  private async load(id: string): Promise<void> {
    const generation = ++this.generation;
    this.selectedId = id;
    this.loading = true;
    this.errorText = '';
    this.detail = null; this.notice = ''; this.favoriting = false;
    try {
      const path = '/api/v1/public/knowledge/guides';
      if (id === '') {
        const data = await ApiClient.get<PublicGuideList>(ApiConfig.getBaseUrl(), path, '');
        if (generation !== this.generation) return;
        this.guides = data.guides;
        this.detail = null;
      } else {
        const data = await ApiClient.get<PublicGuideDetail>(ApiConfig.getBaseUrl(), `${path}?id=${encodeURIComponent(id)}`, '');
        if (generation !== this.generation) return;
        this.detail = data;
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.errorText = error instanceof ApiRequestError ? error.message : '指南加载失败，请重试';
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  private async favorite(): Promise<void> {
    if (this.favoriting || this.loading || this.detail === null) return;
    this.favoriting = true; this.notice = '';
    const generation = this.generation;
    try { await CommunityService.favorite('GUIDE', this.selectedId); if (generation === this.generation) this.notice = '指南已收藏'; }
    catch (error) { if (generation !== this.generation) return;
      if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
      this.errorText = error instanceof ApiRequestError ? error.message : '收藏失败';
      if (error instanceof ApiRequestError && error.code === 'KNOWLEDGE_SOURCE_NOT_FOUND') this.detail = null;
    } finally { if (generation === this.generation) this.favoriting = false; }
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
        Button('AI 故障问诊').onClick(this.onConsult)
        if (this.loading) {
          LoadingPanel({ text: '正在加载公开指南…' })
        } else if (this.errorText !== '') {
          ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(this.selectedId); } })
        } else if (this.detail !== null) {
          Button('返回指南目录').onClick(() => { this.load(''); })
          Text(this.detail.title).fontSize(24).fontWeight(FontWeight.Bold)
          if (this.authenticated && this.home !== HOME_STAFF) {
            Button(this.favoriting ? '收藏中…' : '收藏指南').enabled(!this.favoriting).onClick(() => { this.favorite(); })
            if (this.notice !== '') { Text(this.notice).fontColor('#288050') }
          }
          Text(`来源：电脑医院公开文档 · 版本 ${this.detail.revision === null ? '未知' : this.detail.revision.substring(0, 8)}`)
            .fontSize(12).fontColor('#697071')
          ForEach(this.detail.sections, (section: PublicGuideSection) => {
            Column({ space: 10 }) {
              Text(section.title).fontSize(18).fontWeight(FontWeight.Medium)
              // 展示导入的真实 Markdown 原文，暂不实现富文本排版。
              Text(section.content).fontSize(15).lineHeight(24).copyOption(CopyOptions.InApp)
            }.width('100%').alignItems(HorizontalAlign.Start)
          })
        } else {
          Text('公开维修指南').fontSize(24).fontWeight(FontWeight.Bold)
          TextInput({ text: $$this.query, placeholder: '按标题查找指南' }).height(44)
          if (this.guides.length === 0) {
            Text('暂无公开指南')
          } else {
            ForEach(this.guides.filter((guide: PublicGuide) => guide.title.toLowerCase().includes(this.query.trim().toLowerCase())), (guide: PublicGuide) => {
              Button({ type: ButtonType.Normal }) {
                Text(`${guide.title}  ›`).fontSize(16).fontColor('#17242D').width('100%').textAlign(TextAlign.Start)
              }.width('100%').padding(18).backgroundColor(Color.White).borderRadius(16)
                .onClick(() => { this.load(guide.id); })
            }, (guide: PublicGuide) => guide.id)
          }
        }
      }.width('100%').padding(20).alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').align(Alignment.Top).backgroundColor('#F0F5F8')
  }
}
