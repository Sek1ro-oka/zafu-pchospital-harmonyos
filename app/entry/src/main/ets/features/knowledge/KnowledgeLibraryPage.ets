import { HOME_STAFF } from '../../core/auth/AuthContract';
import { ApiClient, ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { GuideFocusParam, ROUTE_PUBLIC_GUIDES, ROUTE_KNOWLEDGE, ROUTE_CASE_LIBRARY, ROUTE_CASE_DETAIL } from '../../core/ui/Routes';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { DetailHeader, DETAIL_BACKGROUND } from '../../core/ui/ReferenceDetail';
import { CaseDetailParam, CaseListItem, CaseListQuery } from './KnowledgeCaseContract';
import { KnowledgeCaseService } from './KnowledgeCaseService';
import { guideCategory } from './GuideCategory';
import { ROUTE_PUBLIC_CASES } from '../../core/ui/Routes';
import { ROUTE_KNOWLEDGE_SEARCH } from '../../core/ui/Routes';

interface GuideItem { id: string; title: string; revision: string | null; }
interface GuideList { guides: GuideItem[]; }
interface CategoryItem { title: string; icon: Resource; }

@Component
export struct KnowledgeLibraryPage {
  @Prop @Watch('authChanged') authenticated: boolean = false;
  @Prop @Watch('authChanged') home: string = '';
  @Prop @Watch('authChanged') permissions: string[] = [];
  onOpen: (route: string, param: Object | null) => void = () => {};
  onSessionExpired: () => void = () => {};
  onBack: () => void = () => {};
  @State expanded: string = '';
  @State category: string = '全部指南';
  @State guides: GuideItem[] = [];
  @State loading: boolean = false;
  @State errorText: string = '';
  @State cases: CaseListItem[] = [];
  @State casesLoading: boolean = false;
  @State casesError: string = '';
  private guideGeneration: number = 0;
  private caseGeneration: number = 0;

  aboutToAppear(): void { this.loadGuides(); this.authChanged(); }
  aboutToDisappear(): void { this.guideGeneration += 1; this.caseGeneration += 1; }

  private authChanged(): void {
    this.caseGeneration += 1;
    this.cases = [];
    this.casesError = '';
    this.casesLoading = false;
    if (this.authenticated && this.home === HOME_STAFF && this.permissions.includes('repair:read')) this.loadCases();
  }

  private async loadGuides(): Promise<void> {
    const generation = ++this.guideGeneration;
    this.loading = true;
    this.errorText = '';
    try {
      const data = await ApiClient.get<GuideList>(ApiConfig.getBaseUrl(), '/api/v1/public/knowledge/guides', '');
      if (generation !== this.guideGeneration) return;
      this.guides = data.guides;
    } catch (error) {
      if (generation !== this.guideGeneration) return;
      this.errorText = error instanceof ApiRequestError ? error.message : '指南加载失败，请重试';
    } finally {
      if (generation === this.guideGeneration) this.loading = false;
    }
  }

  private async loadCases(): Promise<void> {
    const generation = ++this.caseGeneration;
    this.casesLoading = true;
    this.casesError = '';
    try {
      const query: CaseListQuery = { status: 'PUBLISHED', visibility: '', page: 1 };
      const items = await KnowledgeCaseService.listCases(query);
      if (generation !== this.caseGeneration) return;
      this.cases = items;
    } catch (error) {
      if (generation !== this.caseGeneration) return;
      if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) {
        this.onSessionExpired();
        return;
      }
      this.casesError = error instanceof ApiRequestError ? error.message : '案例加载失败，请重试';
    } finally {
      if (generation === this.caseGeneration) this.casesLoading = false;
    }
  }

  private categories(): CategoryItem[] {
    return [
      { title: '开机故障', icon: $r('app.media.detail_power') },
      { title: '系统软件', icon: $r('app.media.detail_system') },
      { title: '网络', icon: $r('app.media.detail_network') },
      { title: '磁盘', icon: $r('app.media.detail_disk') },
      { title: '散热', icon: $r('app.media.detail_cooling') },
      { title: '硬件外设', icon: $r('app.media.detail_device') },
      { title: '使用技巧', icon: $r('app.media.detail_book') },
      { title: '全部指南', icon: $r('app.media.detail_grid') }
    ];
  }

  private visibleGuides(): GuideItem[] {
    return this.guides.filter((guide: GuideItem) =>
      this.category === '全部指南' || guideCategory(guide.title) === this.category);
  }

  private openGuide(guide: GuideItem): void {
    const param: GuideFocusParam = { guideId: guide.id };
    this.onOpen(ROUTE_PUBLIC_GUIDES, param);
  }

  @Builder
  guideCard(guide: GuideItem) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        Image($r('app.media.ref_document')).width(29).height(32)
        Column({ space: 6 }) {
          Text(guide.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor('#1A2228')
          Text(`${guideCategory(guide.title)} · 电脑医院公开指南`).fontSize(11).fontColor('#818B93')
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        Text('›').fontSize(24).fontColor('#8C939A')
      }.width('100%').padding(16)
    }.width('100%').backgroundColor(Color.White).borderRadius(18).onClick(() => { this.openGuide(guide); })
  }

  @Builder
  casesSection() {
    Row() {
      Text('已审核案例').fontSize(20).fontWeight(FontWeight.Bold).layoutWeight(1)
      if (this.authenticated && this.home === HOME_STAFF && this.permissions.includes('repair:read')) {
        Text('更多 ›').fontSize(13).fontColor('#717B84').onClick(() => { this.onOpen(ROUTE_CASE_LIBRARY, null); })
      }
    }.width('100%').margin({ top: 14 })
    if (this.authenticated && this.home === HOME_STAFF && this.permissions.includes('repair:read')) {
      if (this.casesLoading) {
        LoadingPanel({ text: '正在加载已发布案例…' })
      } else if (this.casesError !== '') {
        ErrorPanel({ message: this.casesError, onRetry: (): void => { this.loadCases(); } })
      } else if (this.cases.length === 0) {
        Text('暂无已发布案例').fontSize(14).fontColor('#77848D').width('100%').padding(20).backgroundColor(Color.White).borderRadius(18)
      } else {
        ForEach(this.cases, (item: CaseListItem) => {
          Button({ type: ButtonType.Normal }) {
            Column({ space: 8 }) {
              Text(item.title).fontSize(16).fontWeight(FontWeight.Medium).fontColor('#17242E')
              Text(`${item.visibility === 'PUBLIC' ? '公开' : '内部'} · ${item.sourceCount} 条来源证据`).fontSize(12).fontColor('#75828D')
            }.width('100%').alignItems(HorizontalAlign.Start).padding(16)
          }.width('100%').backgroundColor(Color.White).borderRadius(18)
            .onClick(() => {
              const param: CaseDetailParam = { caseId: item.id, title: item.title };
              this.onOpen(ROUTE_CASE_DETAIL, param);
            })
        }, (item: CaseListItem) => item.id)
        Text('展示最近一页已发布案例；全部记录可从「更多」查看。').fontSize(10).fontColor('#8A9298')
      }
    } else {
      Column({ space: 10 }) {
        if (this.authenticated && this.home !== HOME_STAFF) {
          Button('浏览有效公开案例').onClick(() => { this.onOpen(ROUTE_PUBLIC_CASES, null); })
        }
        Text('在 AI 问答中查看公开案例引用').fontSize(15).fontWeight(FontWeight.Medium)
        Text(this.authenticated ? '客户可浏览有效公开 AI 案例；原始备案仅向授权成员开放。' : '登录后浏览有效公开案例。').fontSize(12).fontColor('#7A868F')
        Button('去问诊').height(32).fontSize(13).backgroundColor('#F0F5FD').fontColor('#2776D8')
          .onClick(() => { this.onOpen(ROUTE_KNOWLEDGE, null); })
      }.width('100%').padding(20).backgroundColor(Color.White).borderRadius(20)
    }
  }

  @Builder
  categoryRow(item: CategoryItem) {
    Column({ space: 0 }) {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 16 }) {
          Image(item.icon).width(23).height(26).objectFit(ImageFit.Contain)
          Text(item.title).fontSize(18).fontWeight(FontWeight.Medium).fontColor('#14191D').layoutWeight(1)
          Image($r('app.media.detail_chevron')).width(22).height(22)
            .rotate({ angle: this.expanded === item.title ? 180 : 0 })
        }.width('100%').padding({ left: 17, right: 17 })
      }.width('100%').height(57).backgroundColor(Color.White).borderRadius(22)
        .accessibilityText(item.title).onClick(() => {
          if (item.title === '全部指南') { this.onOpen(ROUTE_PUBLIC_GUIDES, null); return; }
          this.expanded = this.expanded === item.title ? '' : item.title;
          this.category = item.title;
        })
      if (this.expanded === item.title) {
        Column({ space: 10 }) {
          if (this.loading) { LoadingPanel({ text: '正在加载公开指南…' }) }
          else if (this.errorText !== '') {
            ErrorPanel({ message: this.errorText, onRetry: (): void => { this.loadGuides(); } })
          } else if (this.visibleGuides().length === 0) {
            Text('暂无匹配的指南').fontSize(14).fontColor('#7A858D').padding(16)
          } else {
            ForEach(this.visibleGuides(), (guide: GuideItem) => { this.guideCard(guide); }, (guide: GuideItem) => guide.id)
          }
        }.width('100%').padding({ top: 10 })
      }
    }.width('100%')
  }

  build() {
    Column() {
      DetailHeader({ title: '知识与帮助', onBack: this.onBack, refresh: true,
        onRefresh: (): void => { this.loadGuides(); this.authChanged(); } })
      Scroll() {
        Column({ space: 0 }) {
          Column() {
            Image($r('app.media.detail_diagnosis')).width(41).height(49)
            Button('AI 故障问诊').width(170).height(41).fontSize(18).fontWeight(FontWeight.Medium)
              .backgroundColor('#0755FF').fontColor(Color.White).borderRadius(25).margin({ top: 66 })
              .onClick(() => { this.onOpen(ROUTE_KNOWLEDGE, null); })
          }.width('100%').height(316).padding({ top: 116 }).alignItems(HorizontalAlign.Center)
          Row({ space: 8 }) {
            Text('?').fontSize(13).fontWeight(FontWeight.Bold).fontColor(Color.White)
              .width(17).height(17).textAlign(TextAlign.Center).backgroundColor('#6A7074').borderRadius(9)
            Text('获取帮助').fontSize(16).fontWeight(FontWeight.Medium).fontColor('#626B71').layoutWeight(1)
            Button({ type: ButtonType.Circle }) {
              Image($r('app.media.home_search')).width(19).height(19)
            }.width(28).height(28).backgroundColor(Color.Transparent).accessibilityText('搜索知识')
              .onClick(() => { this.onOpen(ROUTE_KNOWLEDGE_SEARCH, null); })
          }.width('100%').margin({ bottom: 12 })
          Column({ space: 14 }) {
            ForEach(this.categories(), (item: CategoryItem) => { this.categoryRow(item); }, (item: CategoryItem) => item.title)
            this.casesSection()
          }.width('100%')
        }.width('100%').padding({ left: 18, right: 18, bottom: 96 }).alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
    }.width('100%').height('100%').backgroundColor(DETAIL_BACKGROUND)
  }
}
