import { DetailHeader, DETAIL_BACKGROUND } from '../../core/ui/ReferenceDetail';
import { ApiClient, ApiRequestError } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { HOME_STAFF } from '../../core/auth/AuthContract';
import { isSessionExpiredCode } from '../../core/network/ApiClient';
import { CommunityService } from '../profile/CommunityService';
import { GUIDE_CATEGORIES, guideCategory } from './GuideCategory';

interface PublicGuide {
  id: string;
  title: string;
  revision: string | null;
}
interface PublicGuideList { guides: PublicGuide[]; }
interface PublicGuideSection { title: string; content: string; }
interface PublicGuideDetail { title: string; revision: string | null; sections: PublicGuideSection[]; }
interface GuideGroup { title: string; guides: PublicGuide[]; }

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
  onSearch: () => void = () => {};
  onOpenGuide: (id: string) => void = () => {};
  private guideScroller: Scroller = new Scroller();
  @State guides: PublicGuide[] = [];
  @State detail: PublicGuideDetail | null = null;
  @State selectedCategory: string = '全部指南';
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

  private directoryGroups(): GuideGroup[] {
    return GUIDE_CATEGORIES.filter((category: string) => category !== '全部指南' &&
      (this.selectedCategory === '全部指南' || category === this.selectedCategory))
      .map((category: string): GuideGroup => ({ title: category,
        guides: this.guides.filter((guide: PublicGuide) => guideCategory(guide.title) === category) }))
      .filter((group: GuideGroup) => this.selectedCategory !== '全部指南' || group.guides.length > 0);
  }

  private categoryIcon(category: string): Resource {
    if (category === '开机故障') return $r('app.media.detail_power');
    if (category === '系统软件') return $r('app.media.ref_system');
    if (category === '网络') return $r('app.media.detail_network');
    if (category === '磁盘') return $r('app.media.detail_disk');
    if (category === '散热') return $r('app.media.detail_cooling');
    if (category === '硬件外设') return $r('app.media.detail_device');
    return $r('app.media.ref_document');
  }

  @Builder
  directoryRow(guide: PublicGuide) {
    Row({ space: 10 }) {
      Image(this.categoryIcon(guideCategory(guide.title))).width(44).height(46).padding(5)
        .objectFit(ImageFit.Contain).backgroundColor(Color.White).borderRadius(12)
      Column({ space: 5 }) {
        Text(guide.title).fontSize(15).lineHeight(21).fontColor('#151B20').fontWeight(FontWeight.Medium).width('100%')
        Text('公开指南 · ' + (guide.revision === null ? '版本未记录' : guide.revision.substring(0, 8)))
          .fontSize(10).lineHeight(15).fontColor('#929A9F').width('100%')
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Button('查看').height(29).width(46).padding(0).fontSize(13).fontWeight(FontWeight.Medium)
        .backgroundColor('#E8EDF0').fontColor('#0877E0').onClick(() => { this.onOpenGuide(guide.id); })
    }.width('100%').padding({ top: 13, bottom: 13 }).alignItems(VerticalAlign.Center)
      .onClick(() => { this.onOpenGuide(guide.id); })
  }

  @Builder
  directory() {
    Row({ space: 0 }) {
      Scroll() {
        Column({ space: 0 }) {
          ForEach(GUIDE_CATEGORIES, (category: string) => {
            Button({ type: ButtonType.Normal }) {
              Text(category).fontSize(14).lineHeight(21).fontWeight(this.selectedCategory === category ? FontWeight.Bold : FontWeight.Medium)
                .fontColor(this.selectedCategory === category ? '#0877E0' : '#737C82').width('100%')
                .maxLines(2).textAlign(TextAlign.Start)
            }.width('100%').constraintSize({ minHeight: 51 }).padding({ left: 18, right: 8, top: 10, bottom: 10 })
              .backgroundColor(Color.Transparent).onClick(() => { this.selectedCategory = category; })
          }, (category: string) => category)
        }.width('100%').alignItems(HorizontalAlign.Start)
      }.width(82).height('100%').scrollBar(BarState.Off).align(Alignment.Top)
      Scroll() {
        Column({ space: 6 }) {
          Row() {
            Text(this.selectedCategory).fontSize(20).fontWeight(FontWeight.Bold).fontColor('#12171A').layoutWeight(1)
          }.width('100%').margin({ top: 12, bottom: 7 })
          Text('按指南标题粗分').fontSize(11).fontColor('#959DA2').width('100%').margin({ bottom: 9 })
          ForEach(this.directoryGroups(), (group: GuideGroup) => {
            if (this.selectedCategory === '全部指南') {
              Text(group.title).fontSize(18).fontWeight(FontWeight.Bold).fontColor('#11171A').width('100%').margin({ top: 14, bottom: 4 })
            }
            if (group.guides.length === 0) {
              Text('暂无该分类指南').fontSize(13).fontColor('#949DA3').width('100%').padding({ top: 14, bottom: 20 })
            } else {
              ForEach(group.guides, (guide: PublicGuide, index: number) => {
                if (index > 0) { Divider().color('#D6DDE1').margin({ left: 54 }).width('80%') }
                this.directoryRow(guide)
              }, (guide: PublicGuide) => guide.id)
            }
          }, (group: GuideGroup) => group.title)
        }.width('100%').padding({ left: 10, right: 16, bottom: 28 }).alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).height('100%').scrollBar(BarState.Off).align(Alignment.Top)
    }.width('100%').layoutWeight(1).alignItems(VerticalAlign.Top)
  }

  build() {
    Column() {
      Row() {
        DetailHeader({ title: this.selectedId === '' ? '全部指南' : '维修指南', onBack: this.onBack, refresh: true,
          onRefresh: (): void => { this.load(this.selectedId); } }).layoutWeight(1)
        if (this.selectedId === '') {
          Button({ type: ButtonType.Circle }) { Image($r('app.media.home_search')).width(23).height(23) }
            .width(42).height(42).margin({ right: 16 }).backgroundColor(Color.White).accessibilityText('搜索知识').onClick(this.onSearch)
        }
      }.width('100%')
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
        this.directory()
      }
    }.width('100%').height('100%').backgroundColor(DETAIL_BACKGROUND)
  }
}
