import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ROUTE_CASE_DETAIL } from '../../core/ui/Routes';
import { CARD_RADIUS, PAGE_PADDING } from '../../core/ui/Theme';
import { formatOrderTime } from '../repair/RepairOrderContract';
import {
  CaseDetailParam,
  CaseListItem,
  CaseListQuery,
  CASE_LIST_PAGE_SIZE,
  caseStatusLabel,
  caseVisibilityLabel,
} from './KnowledgeCaseContract';
import { KnowledgeCaseService } from './KnowledgeCaseService';

const STATE_LOADING: number = 0;
const STATE_READY: number = 1;
const STATE_EMPTY: number = 2;
const STATE_ERROR: number = 3;

interface StatusFilter {
  label: string;
  value: string;
}

function statusFilters(): StatusFilter[] {
  return [
    { label: '全部', value: '' },
    { label: '已发布', value: 'PUBLISHED' },
    { label: '重整中', value: 'REPROCESSING' },
    { label: '失败', value: 'FAILED' },
    { label: '已撤回', value: 'WITHDRAWN' }
  ];
}

/**
 * 典型案例库（工作人员，Issue #40）。
 *
 * - 列表按状态筛选 + 分页，条目展示真实状态、可见范围与来源数量；
 * - 点击进入案例详情（多来源证据与管理员动作在那里）；
 * - 客户没有入口（服务端要求 repair:read，客户会拿到 403）。
 */
@Component
export struct CaseLibraryPage {
  pathStack: NavPathStack = new NavPathStack();
  onSessionExpired: () => void = () => {
  };
  @State state: number = STATE_LOADING;
  @State items: CaseListItem[] = [];
  @State errorText: string = '';
  @State statusFilter: string = '';
  @State currentPage: number = 1;
  @State loadingMore: boolean = false;
  @State hasMore: boolean = false;
  @State loadMoreErrorText: string = '';
  private listGeneration: number = 0;

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.listGeneration = this.listGeneration + 1;
    const generation = this.listGeneration;
    this.state = STATE_LOADING;
    this.errorText = '';
    this.loadMoreErrorText = '';
    this.currentPage = 1;
    this.loadingMore = false;
    const query: CaseListQuery = { status: this.statusFilter, visibility: '', page: 1 };
    try {
      const items = await KnowledgeCaseService.listCases(query);
      if (generation !== this.listGeneration) {
        return;
      }
      this.items = items;
      this.hasMore = items.length >= CASE_LIST_PAGE_SIZE;
      this.state = items.length === 0 ? STATE_EMPTY : STATE_READY;
    } catch (error) {
      if (generation !== this.listGeneration) {
        return;
      }
      if (this.isSessionExpired(error)) {
        return;
      }
      this.state = STATE_ERROR;
      this.errorText = error instanceof ApiRequestError ? error.message : '加载失败，请重试';
    }
  }

  private async loadMore(): Promise<void> {
    if (this.loadingMore || !this.hasMore) {
      return;
    }
    const generation = this.listGeneration;
    this.loadingMore = true;
    this.loadMoreErrorText = '';
    try {
      const nextPage = this.currentPage + 1;
      const query: CaseListQuery = { status: this.statusFilter, visibility: '', page: nextPage };
      const items = await KnowledgeCaseService.listCases(query);
      if (generation !== this.listGeneration) {
        return;
      }
      if (items.length > 0) {
        this.items = this.items.concat(items);
        this.currentPage = nextPage;
      }
      this.hasMore = items.length >= CASE_LIST_PAGE_SIZE;
    } catch (error) {
      if (generation !== this.listGeneration) {
        return;
      }
      if (this.isSessionExpired(error)) {
        return;
      }
      this.loadMoreErrorText = error instanceof ApiRequestError ? error.message : '加载更多失败，请重试';
    } finally {
      if (generation === this.listGeneration) {
        this.loadingMore = false;
      }
    }
  }

  private isSessionExpired(error: Object): boolean {
    if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) {
      this.onSessionExpired();
      return true;
    }
    return false;
  }

  private openCase(item: CaseListItem): void {
    const param: CaseDetailParam = { caseId: item.id, title: item.title };
    this.pathStack.pushPathByName(ROUTE_CASE_DETAIL, param);
  }

  @Builder
  filterChip(filter: StatusFilter) {
    Text(filter.label)
      .fontSize(13)
      .fontColor(this.statusFilter === filter.value ? Color.White : $r('app.color.text_secondary'))
      .padding({ left: 14, right: 14, top: 6, bottom: 6 })
      .backgroundColor(this.statusFilter === filter.value ? $r('app.color.brand') : $r('app.color.field_bg'))
      .borderRadius(16)
      .onClick(() => {
        if (this.statusFilter !== filter.value) {
          this.statusFilter = filter.value;
          this.load();
        }
      })
  }

  @Builder
  caseCard(item: CaseListItem) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Text(item.title)
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(caseStatusLabel(item.status))
          .fontSize(12)
          .fontColor(item.status === 'FAILED' ? $r('app.color.danger') : $r('app.color.brand'))
          .padding({ left: 8, right: 8, top: 3, bottom: 3 })
          .backgroundColor($r('app.color.brand_soft'))
          .borderRadius(8)
      }
      .width('100%')

      Text(`${caseVisibilityLabel(item.visibility)} · ${item.sourceCount} 条来源 · 版本 v${item.contentVersion}`)
        .fontSize(13)
        .fontColor($r('app.color.text_secondary'))
        .width('100%')

      if (item.failureMessage !== null && item.failureMessage !== '') {
        Text(item.failureMessage)
          .fontSize(13)
          .fontColor($r('app.color.danger'))
          .width('100%')
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      Text(`更新于 ${formatOrderTime(item.updatedAt)}`)
        .fontSize(12)
        .fontColor($r('app.color.text_secondary'))
        .width('100%')
    }
    .width('100%')
    .padding(16)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Start)
    .onClick(() => {
      this.openCase(item);
    })
  }

  build() {
    Column({ space: 14 }) {
      Row({ space: 12 }) {
        Text('典型案例库')
          .fontSize(26)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.text_primary'))
          .layoutWeight(1)
          .textAlign(TextAlign.Start)
        Text('刷新')
          .fontSize(14)
          .fontColor($r('app.color.brand'))
          .onClick(() => {
            this.load();
          })
      }
      .width('100%')

      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(statusFilters(), (filter: StatusFilter) => {
          Column() {
            this.filterChip(filter);
          }
          .margin({ right: 8, bottom: 8 })
        }, (filter: StatusFilter) => filter.value)
      }
      .width('100%')

      Scroll() {
        Column({ space: 14 }) {
          if (this.state === STATE_LOADING) {
            Column({ space: 12 }) {
              LoadingProgress()
                .width(36)
                .height(36)
                .color($r('app.color.brand'))
              Text('正在加载案例…')
                .fontSize(14)
                .fontColor($r('app.color.text_secondary'))
            }
            .width('100%')
            .padding(32)
            .justifyContent(FlexAlign.Center)
          } else if (this.state === STATE_ERROR) {
            Column({ space: 12 }) {
              Text(this.errorText === '' ? '加载失败，请重试' : this.errorText)
                .fontSize(14)
                .fontColor($r('app.color.danger'))
                .width('100%')
                .textAlign(TextAlign.Center)
              Button('重试')
                .fontSize(14)
                .height(40)
                .backgroundColor($r('app.color.brand'))
                .fontColor(Color.White)
                .onClick(() => {
                  this.load();
                })
            }
            .width('100%')
            .padding(32)
            .backgroundColor($r('app.color.surface'))
            .borderRadius(CARD_RADIUS)
            .alignItems(HorizontalAlign.Center)
          } else if (this.state === STATE_EMPTY) {
            Column({ space: 8 }) {
              Text('暂无案例')
                .fontSize(16)
                .fontColor($r('app.color.text_primary'))
              Text('工作人员在已通过的维修备案上标记「典型案例」后，整理结果会出现在这里。')
                .fontSize(13)
                .fontColor($r('app.color.text_secondary'))
                .textAlign(TextAlign.Center)
            }
            .width('100%')
            .padding(32)
            .backgroundColor($r('app.color.surface'))
            .borderRadius(CARD_RADIUS)
            .alignItems(HorizontalAlign.Center)
          } else {
            ForEach(this.items, (item: CaseListItem) => {
              this.caseCard(item);
            }, (item: CaseListItem) => `${item.id}:v${item.contentVersion}`)

            if (this.loadMoreErrorText !== '') {
              Text(this.loadMoreErrorText)
                .fontSize(13)
                .fontColor($r('app.color.danger'))
                .width('100%')
                .textAlign(TextAlign.Center)
            }

            if (this.hasMore) {
              Button(this.loadingMore ? '加载中…' : '加载更多')
                .width('100%')
                .height(42)
                .fontSize(14)
                .backgroundColor($r('app.color.surface'))
                .fontColor($r('app.color.brand'))
                .enabled(!this.loadingMore)
                .onClick(() => {
                  this.loadMore();
                })
            }
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Auto)
      .align(Alignment.Top)
    }
    .width('100%')
    .height('100%')
    .padding(PAGE_PADDING)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.start_window_background'))
  }
}
