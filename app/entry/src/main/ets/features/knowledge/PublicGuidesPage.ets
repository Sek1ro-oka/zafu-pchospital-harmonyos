import { DetailHeader, DETAIL_BACKGROUND } from '../../core/ui/ReferenceDetail';
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
  onBack: () => void = () => {};
  private guideScroller: Scroller = new Scroller();
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
    Column() {
      DetailHeader({ title: this.detail === null ? '公开维修指南' : '维修指南', onBack: this.onBack, refresh: true,
        onRefresh: (): void => { this.load(this.selectedId); } })
      if (this.loading) { LoadingPanel({ text: '正在加载公开指南…' }) }
      else if (this.errorText !== '') {
        ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(this.selectedId); } })
      } else if (this.detail !== null) {
        List({ scroller: this.guideScroller, space: 22 }) {
          ListItem() {
            Column({ space: 20 }) {
              Stack({ alignContent: Alignment.Start }) {
                Image($r('app.media.reading_guide_hero')).width('100%').height(184).objectFit(ImageFit.Cover)
                  .hitTestBehavior(HitTestMode.None)
                Column({ space: 8 }) {
                  Text(this.detail.title).fontSize(21).fontWeight(FontWeight.Bold).fontColor('#1B1940')
                  Text('电脑医院 · 维修指南').fontSize(12).fontColor('#6A6592')
                }.width('55%').padding({ left: 20, right: 6 })
              }.width('100%').height(184).borderRadius(18).clip(true)
              Row({ space: 2 }) {
                ForEach(this.detail.sections.slice(0, 3), (section: PublicGuideSection, index: number) => {
                  Button({ type: ButtonType.Normal }) {
                    Column({ space: 8 }) {
                      Image($r('app.media.ref_document')).width(29).height(29)
                      Text(section.title).fontSize(11).fontColor('#272E35').maxLines(2).textAlign(TextAlign.Center)
                    }.width('100%')
                  }.layoutWeight(1).height(76).backgroundColor(Color.Transparent)
                    .onClick(() => { this.guideScroller.scrollToIndex(index + 1, true, ScrollAlign.START); })
                }, (_section: PublicGuideSection, index: number) => 'chapter-' + index.toString())
                Button({ type: ButtonType.Normal }) {
                  Column({ space: 8 }) {
                    Image($r('app.media.ref_grid')).width(29).height(29)
                    Text('全部指南').fontSize(11).fontColor('#272E35')
                  }
                }.layoutWeight(1).height(76).backgroundColor(Color.Transparent).onClick(() => { this.load(''); })
                Button({ type: ButtonType.Normal }) {
                  Column({ space: 8 }) {
                    Image($r('app.media.home_headset')).width(29).height(29)
                    Text('AI 问诊').fontSize(11).fontColor('#272E35')
                  }
                }.layoutWeight(1).height(76).backgroundColor(Color.Transparent).onClick(this.onConsult)
              }.width('100%')
              Row({ space: 10 }) {
                Divider().width(30).color('#E3E5E8')
                Text('阅读指引').fontSize(16).fontWeight(FontWeight.Medium).fontColor('#242B30')
                Divider().width(30).color('#E3E5E8')
              }.width('100%').justifyContent(FlexAlign.Center).margin({ top: 8 })
              Text('来源：电脑医院公开文档 · 版本 ' + (this.detail.revision === null ? '未知' : this.detail.revision.substring(0, 8)))
                .fontSize(12).fontColor('#8B9097').width('100%')
              if (this.notice !== '') { Text(this.notice).fontSize(13).fontColor('#288050').width('100%') }
            }.width('100%')
          }
          ForEach(this.detail.sections, (section: PublicGuideSection, index: number) => {
            ListItem() {
              Column({ space: 12 }) {
                Text(section.title).fontSize(18).fontWeight(FontWeight.Medium).fontColor('#292D32').width('100%')
                Text(section.content).fontSize(15).lineHeight(26).fontColor('#6C7278').width('100%')
                  .copyOption(CopyOptions.InApp)
              }.width('100%').alignItems(HorizontalAlign.Start)
            }
          }, (_section: PublicGuideSection, index: number) => 'section-' + index.toString())
          ListItem() {
            Column({ space: 12 }) {
              Button({ type: ButtonType.Normal }) {
                Row() {
                  Text('继续排查电脑问题').fontSize(17).fontWeight(FontWeight.Medium).fontColor('#242D39').layoutWeight(1)
                  Text('AI 问诊').fontSize(14).fontColor(Color.White).padding({ left: 14, right: 14, top: 7, bottom: 7 })
                    .backgroundColor('#A897EB').borderRadius(18)
                }.width('100%').padding(18)
              }.width('100%').backgroundColor('#F1EEFC').borderRadius(20).onClick(this.onConsult)
              if (this.authenticated && this.home !== HOME_STAFF) {
                Button(this.favoriting ? '收藏中…' : '收藏指南').height(44).width('100%')
                  .fontColor('#6650C8').backgroundColor('#EEEAFB').enabled(!this.favoriting).onClick(() => { this.favorite(); })
              }
              Button('返回指南目录').backgroundColor(Color.Transparent).fontColor('#747B83').onClick(() => { this.load(''); })
            }.width('100%').padding({ bottom: 20 })
          }
        }.width('100%').layoutWeight(1).padding({ left: 18, right: 18, top: 12 }).scrollBar(BarState.Off)
          .backgroundColor(Color.White)
      } else {
        Scroll() {
          Column({ space: 14 }) {
            TextInput({ text: $$this.query, placeholder: '按标题查找指南' }).height(44)
            if (this.guides.length === 0) { Text('暂无公开指南').padding(24) }
            ForEach(this.guides.filter((guide: PublicGuide) => guide.title.toLowerCase().includes(this.query.trim().toLowerCase())), (guide: PublicGuide) => {
              Button({ type: ButtonType.Normal }) {
                Text(guide.title + '  ›').fontSize(16).fontColor('#17242D').width('100%').textAlign(TextAlign.Start)
              }.width('100%').padding(18).backgroundColor(Color.White).borderRadius(18).onClick(() => { this.load(guide.id); })
            }, (guide: PublicGuide) => guide.id)
          }.width('100%').padding(18)
        }.width('100%').layoutWeight(1).scrollBar(BarState.Off)
      }
    }.width('100%').height('100%').backgroundColor(DETAIL_BACKGROUND)
  }
}
