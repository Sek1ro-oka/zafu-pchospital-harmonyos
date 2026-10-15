import { HOME_STAFF } from '../../core/auth/AuthContract';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { DetailRoundButton, DETAIL_BACKGROUND } from '../../core/ui/ReferenceDetail';
import { ROUTE_CASE_DETAIL, ROUTE_PUBLIC_CASE_DETAIL, ROUTE_PUBLIC_GUIDES, GuideFocusParam } from '../../core/ui/Routes';
import { BrowseGuide, BrowseCase, KnowledgeSearchState, KnowledgeSearchController, KnowledgeSearchDeps,
  emptySearchState, highlightQuery, SearchHighlight } from './KnowledgeBrowse';
import { KnowledgeBrowseService } from './KnowledgeBrowseService';
import { CaseDetailParam } from './KnowledgeCaseContract';
import { PublicCaseParam } from '../profile/CommunityContract';
import { guideCategory } from './GuideCategory';

@Component
struct SearchWords {
  @Prop text: string = '';
  @Prop query: string = '';
  pointSize: number = 16;
  lineLimit: number = 3;
  muted: boolean = false;
  build() {
    Text() {
      ForEach(highlightQuery(this.text, this.query), (part: SearchHighlight) => {
        Span(part.text).fontColor(part.matched ? '#0877E0' : this.muted ? '#7C858C' : '#14191D')
      })
    }.fontSize(this.pointSize).lineHeight(this.pointSize + 9).maxLines(this.lineLimit)
      .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%').textAlign(TextAlign.Start)
  }
}

@Component
export struct KnowledgeSearchPage {
  @Prop @Watch('scopeChanged') authenticated: boolean = false;
  @Prop @Watch('scopeChanged') home: string = '';
  @Prop @Watch('scopeChanged') permissions: string[] = [];
  @Prop @Watch('refresh') refreshVersion: number = 0;
  initialQuery: string = '';
  onBack: () => void = () => {};
  onLogin: () => void = () => {};
  onOpen: (route: string, param: Object | null) => void = () => {};
  onSessionExpired: () => void = () => {};
  @State state: KnowledgeSearchState = emptySearchState();
  @State notice: string = '';
  @State opening: boolean = false;
  private uiGeneration: number = 0;
  private controller: KnowledgeSearchController | null = null;
  private active: boolean = false;

  aboutToAppear(): void {
    this.active = true;
    if (this.controller === null) {
      const deps: KnowledgeSearchDeps = {
        guides: (): Promise<BrowseGuide[]> => KnowledgeBrowseService.guides(),
        cases: (query: string, page: number) => KnowledgeBrowseService.cases(query, page),
        message: (error: Object): string => {
          if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) this.onSessionExpired();
          return error instanceof ApiRequestError ? error.message : '读取失败，请重试';
        },
        changed: (state: KnowledgeSearchState): void => { this.state = state; }
      };
      this.controller = new KnowledgeSearchController(deps);
      this.search(this.initialQuery, 'all');
    } else this.refresh();
  }
  aboutToDisappear(): void { this.active = false; this.uiGeneration += 1; this.opening = false; this.controller?.invalidate(); }
  private includeCases(): boolean {
    return this.authenticated && (this.home !== HOME_STAFF || this.permissions.includes('repair:read'));
  }
  private search(query: string, type: string): void {
    this.uiGeneration += 1; this.opening = false; this.notice = '';
    this.controller?.search(query, type, this.includeCases());
  }
  private refresh(): void { if (this.active) this.search(this.state.query, this.state.type); }
  private scopeChanged(): void { this.refresh(); }
  private openGuide(guide: BrowseGuide): void {
    const param: GuideFocusParam = { guideId: guide.id }; this.onOpen(ROUTE_PUBLIC_GUIDES, param);
  }
  private async openCase(item: BrowseCase): Promise<void> {
    if (this.opening) return;
    const generation = this.uiGeneration;
    this.opening = true; this.notice = '';
    try {
      // 旧搜索结果点击时重读目标，撤回/转内部/来源失效不能沿旧卡片继续打开。
      const result = await KnowledgeBrowseService.cases(this.state.query.trim(), 1, item.caseId);
      if (generation !== this.uiGeneration) return;
      if (result.items.length === 0) {
        this.refresh(); this.notice = '案例已变化或不可访问，已刷新搜索结果。'; return;
      }
      this.navigateCase(result.items[0]);
    } catch (error) {
      if (generation !== this.uiGeneration) return;
      if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
      this.notice = error instanceof ApiRequestError ? error.message : '案例确认失败，请重试';
    } finally { if (generation === this.uiGeneration) this.opening = false; }
  }
  private navigateCase(item: BrowseCase): void {
    if (this.home === HOME_STAFF) {
      const param: CaseDetailParam = { caseId: item.caseId, title: item.title }; this.onOpen(ROUTE_CASE_DETAIL, param);
    } else {
      const param: PublicCaseParam = { caseId: item.caseId }; this.onOpen(ROUTE_PUBLIC_CASE_DETAIL, param);
    }
  }
  @Builder
  filter(label: string, value: string) {
    Button(label).layoutWeight(1).height(39).fontSize(16).fontWeight(FontWeight.Medium)
      .backgroundColor(this.state.type === value ? '#0755FF' : '#FFFFFF')
      .fontColor(this.state.type === value ? Color.White : '#14191D').borderRadius(23)
      .onClick(() => { this.search(this.state.query, value); })
  }
  @Builder
  guideRow(guide: BrowseGuide) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        Column({ space: 8 }) {
          SearchWords({ text: guide.title, query: this.state.query, pointSize: 17 })
          Text(guideCategory(guide.title) + ' · 公开维修指南').fontSize(12).fontColor('#879096')
          Text('快照版本 ' + (guide.revision === null ? '未记录' : guide.revision.substring(0, 8))).fontSize(11).fontColor('#989EA3')
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Image($r('app.media.ref_document')).width(58).height(62).padding(12).backgroundColor('#F1F5FA').borderRadius(14)
      }.width('100%').padding({ top: 18, bottom: 18 })
    }.width('100%').backgroundColor(Color.Transparent).onClick(() => { this.openGuide(guide); })
  }
  @Builder
  caseRow(item: BrowseCase) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 8 }) {
        SearchWords({ text: item.title, query: this.state.query, pointSize: 17 })
        if (item.excerpt !== '') { SearchWords({ text: item.excerpt, query: this.state.query, pointSize: 14, muted: true }) }
        Text((item.visibility === 'PUBLIC' ? '公开 AI 案例' : '内部 AI 案例') + ' · ' + item.sourceCount.toString() + ' 条来源 · v' + item.contentVersion.toString())
          .fontSize(11).fontColor('#969DA2').width('100%')
      }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 18, bottom: 18 })
    }.width('100%').backgroundColor(Color.Transparent).onClick(() => { this.openCase(item); })
  }
  @Builder
  guideGroup() {
    Column() {
      Row() {
        Text('维修指南').fontSize(21).fontWeight(FontWeight.Bold).layoutWeight(1)
        if (!this.state.guidesLoading && this.state.guideError === '') { Text(this.state.guides.length.toString() + ' 条').fontSize(13).fontColor('#8C949A') }
      }.width('100%').margin({ bottom: 8 })
      if (this.state.guidesLoading) { LoadingProgress().width(30).height(30).margin(20) }
      else if (this.state.guideError !== '') {
        Text(this.state.guideError).fontSize(14).fontColor('#BA4545')
        Button('重试指南搜索').onClick(() => { this.refresh(); })
      } else if (this.state.guides.length === 0) { Text('未找到匹配的指南').fontSize(14).fontColor('#8D959B').padding(20) }
      else {
        ForEach(this.state.guides, (guide: BrowseGuide, index: number) => {
          if (index > 0) { Divider().color('#E4E8EB') }
          this.guideRow(guide)
        }, (guide: BrowseGuide) => guide.id)
      }
    }.width('100%').padding(18).backgroundColor(Color.White).borderRadius(25).alignItems(HorizontalAlign.Start)
  }
  @Builder
  caseGroup() {
    Column() {
      Row() {
        Text('AI 维修案例').fontSize(21).fontWeight(FontWeight.Bold).layoutWeight(1)
        if (this.includeCases() && !this.state.casesLoading && this.state.caseError === '') { Text(this.state.caseTotal.toString() + ' 条').fontSize(13).fontColor('#8C949A') }
      }.width('100%').margin({ bottom: 8 })
      if (!this.includeCases()) {
        Text(this.authenticated ? '当前账号没有案例读取权限' : '登录后搜索你有权查看的案例').fontSize(14).fontColor('#8D959B').padding({ top: 18, bottom: 18 })
        if (!this.authenticated) { Button('登录后搜索案例').height(36).fontSize(14).onClick(this.onLogin) }
      } else if (this.state.casesLoading) { LoadingProgress().width(30).height(30).margin(20) }
      else {
        ForEach(this.state.cases, (item: BrowseCase, index: number) => {
          if (index > 0) { Divider().color('#E4E8EB') }
          this.caseRow(item)
        }, (item: BrowseCase) => item.caseId + ':' + item.contentVersion.toString())
        if (this.state.caseError !== '') {
          Text(this.state.caseError).fontSize(14).fontColor('#BA4545')
          Button('重试案例搜索').onClick(() => { if (this.state.page > 0) this.controller?.more(); else this.refresh(); })
        } else if (this.state.cases.length === 0) { Text('未找到有效案例').fontSize(14).fontColor('#8D959B').padding(20) }
        if (this.state.hasMore) { Button(this.state.moreLoading ? '加载中…' : '加载更多案例').enabled(!this.state.moreLoading).onClick(() => { this.controller?.more(); }) }
      }
    }.width('100%').padding(18).backgroundColor(Color.White).borderRadius(25).alignItems(HorizontalAlign.Start)
  }
  build() {
    Column({ space: 0 }) {
      Row({ space: 8 }) {
        DetailRoundButton({ onSelect: this.onBack })
        Row({ space: 6 }) {
          Image($r('app.media.home_search')).width(18).height(18)
          TextInput({ text: this.state.query, placeholder: '搜索指南或维修案例' }).layoutWeight(1).height(44).fontSize(16)
            .maxLength(100).backgroundColor(Color.Transparent).padding({ left: 0, right: 0 })
            .onChange((value: string) => { this.search(value, this.state.type); }).onSubmit(() => { this.refresh(); })
          if (this.state.query !== '') {
            Button('×').width(28).height(32).padding(0).fontSize(25).backgroundColor(Color.Transparent).fontColor('#8C959B')
              .accessibilityText('清空搜索').onClick(() => { this.search('', this.state.type); })
          }
        }.layoutWeight(1).padding({ left: 12, right: 7 }).backgroundColor(Color.White).borderRadius(28)
      }.width('100%').height(64).padding({ left: 16, right: 16 })
      Row({ space: 10 }) { this.filter('全部', 'all'); this.filter('指南', 'guides'); this.filter('案例', 'cases') }
        .width('100%').padding({ left: 16, right: 16, top: 10, bottom: 14 })
      Text('指南按标题匹配 · 案例按标题和正文匹配').fontSize(11).fontColor('#90999F').padding({ bottom: 12 })
      if (this.opening || this.notice !== '') { Text(this.opening ? '正在确认案例可访问性…' : this.notice).fontSize(12).fontColor('#8C6A35').padding({ left: 18, right: 18, bottom: 12 }) }
      Scroll() {
        Column({ space: 14 }) {
          if (this.state.query.trim() === '') {
            Image($r('app.media.home_search')).width(40).height(40).opacity(0.35).margin({ top: 65 })
            Text('输入关键词，查找维修知识').fontSize(16).fontColor('#88939B').margin({ top: 8 })
          } else {
            if (this.state.type !== 'cases') { this.guideGroup() }
            if (this.state.type !== 'guides') { this.caseGroup() }
          }
        }.width('100%').padding({ left: 16, right: 16, bottom: 24 })
      }.width('100%').layoutWeight(1).scrollBar(BarState.Off).align(Alignment.Top)
    }.width('100%').height('100%').backgroundColor(DETAIL_BACKGROUND)
  }
}
