import { util } from '@kit.ArkTS';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ROUTE_CASE_DETAIL } from '../../core/ui/Routes';
import { CARD_RADIUS, CONTROL_HEIGHT, CONTROL_RADIUS, PAGE_PADDING } from '../../core/ui/Theme';
import { CaseDetailParam } from '../knowledge/KnowledgeCaseContract';
import { TypicalCasePanel } from '../knowledge/TypicalCasePanel';
import { PhotoThumb } from './PhotoThumb';
import { formatOrderTime } from './RepairOrderContract';
import { RepairRecordService } from './RepairRecordService';
import { RepairReviewService } from './RepairReviewService';
import {
  RepairPhotoView,
  RepairRecordDetailView,
  RepairRecordView,
  RepairReviewView,
  repairRecordStatusLabel,
  repairResultLabel,
} from './StaffRepairContract';

const STATE_LOADING: number = 0;
const STATE_READY: number = 1;
const STATE_EMPTY: number = 2;
const STATE_ERROR: number = 3;
const PAGE_SIZE: number = 20;
const SCOPE_PENDING: string = 'PENDING';
const SCOPE_APPROVED: string = 'APPROVED';

/**
 * 管理员审核页（App 内业务备案审核，Issue #38）。
 *
 * - 待审核分页列表 + 详情（字段、照片、审核记录）→ 通过 / 退回（原因必填）；
 * - 「已通过」范围列出审核通过的备案，审核人员可在此标记典型案例（Issue #40）；
 * - 审核结果不自动改变客户报修处理状态；
 * - 重复审核或别人先处理（409）给出真实冲突信息并刷新；
 * - 普通工作人员没有入口也没有权限（服务端 403）。
 */
@Component
export struct AdminRepairReviewPage {
  pathStack: NavPathStack = new NavPathStack();
  onSessionExpired: () => void = () => {
  };
  /** 列表范围：待审核 / 已通过（已通过用于典型标记）。 */
  @State scope: string = SCOPE_PENDING;
  @State state: number = STATE_LOADING;
  @State records: RepairRecordView[] = [];
  @State errorText: string = '';
  @State currentPage: number = 1;
  @State loadingMore: boolean = false;
  @State hasMore: boolean = false;
  @State loadMoreErrorText: string = '';
  // ---- 详情面板 ----
  @State detailOpen: boolean = false;
  @State detailTargetId: string = '';
  @State detailLoading: boolean = false;
  @State detailErrorText: string = '';
  @State detail: RepairRecordDetailView | null = null;
  @State reviewBusy: boolean = false;
  @State reviewError: string = '';
  @State noticeText: string = '';
  @State rejectOpen: boolean = false;
  @State rejectNote: string = '';
  @State previewPhotoId: string = '';
  private listGeneration: number = 0;
  private detailGeneration: number = 0;
  /**
   * 审核幂等键按备案隔离：同一次「结果不确定」的重试复用同一键（服务端回放），
   * 换备案必须换键；审核成功后作废，重新提交再审核时用新键。
   */
  private approveKeys: Map<string, string> = new Map<string, string>();
  private rejectKeys: Map<string, string> = new Map<string, string>();

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
    // 新列表代重置分页状态：旧代的 loadMore 在 finally 里不再回写本代，
    // 若这里不清掉，刷新/切换范围后按钮会永远停在「加载中…」。
    this.loadingMore = false;
    try {
      const items = await RepairReviewService.recordsByStatus(this.scope, 1);
      if (generation !== this.listGeneration) {
        return;
      }
      this.records = items;
      this.hasMore = items.length >= PAGE_SIZE;
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
      const items = await RepairReviewService.recordsByStatus(this.scope, nextPage);
      if (generation !== this.listGeneration) {
        return;
      }
      if (items.length > 0) {
        this.records = this.records.concat(items);
        this.currentPage = nextPage;
      }
      this.hasMore = items.length >= PAGE_SIZE;
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

  private switchScope(scope: string): void {
    if (this.scope === scope) {
      return;
    }
    this.scope = scope;
    this.closeDetail();
    this.load();
  }

  /** 打开典型整理生成的关联案例（典型案例面板注入）。 */
  private openCase(caseId: string): void {
    const param: CaseDetailParam = { caseId: caseId, title: '' };
    this.pathStack.pushPathByName(ROUTE_CASE_DETAIL, param);
  }

  /** 标记/取消后备案数据变化：刷新详情与列表（典型标记徽标同步）。 */
  private async refreshAfterCaseChange(recordId: string): Promise<void> {
    await this.fetchDetail(recordId);
    await this.load();
  }

  private openDetail(record: RepairRecordView): void {
    this.detailOpen = true;
    this.detailTargetId = record.id;
    this.reviewError = '';
    this.noticeText = '';
    this.rejectOpen = false;
    this.rejectNote = '';
    this.fetchDetail(record.id);
  }

  private async fetchDetail(id: string): Promise<void> {
    this.detailGeneration = this.detailGeneration + 1;
    const generation = this.detailGeneration;
    this.detailLoading = true;
    this.detailErrorText = '';
    try {
      const detail = await RepairRecordService.detail(id);
      if (generation !== this.detailGeneration) {
        return;
      }
      this.detail = detail;
      this.detailLoading = false;
    } catch (error) {
      if (generation !== this.detailGeneration) {
        return;
      }
      this.detailLoading = false;
      if (this.isSessionExpired(error)) {
        return;
      }
      this.detailErrorText = error instanceof ApiRequestError ? error.message : '加载详情失败';
    }
  }

  private closeDetail(): void {
    this.detailGeneration = this.detailGeneration + 1;
    this.detailOpen = false;
    this.detail = null;
    this.detailTargetId = '';
    this.detailErrorText = '';
    this.detailLoading = false;
    this.reviewError = '';
    this.rejectOpen = false;
    this.rejectNote = '';
  }

  /** 发起时记录上下文是否仍是当前展示的详情（收起或切到另一条后为 false）。 */
  private isSameDetailContext(recordId: string, generation: number): boolean {
    return this.detailTargetId === recordId && this.detailGeneration === generation;
  }

  /** 该备案该决定的幂等键：不存在则生成；结果不确定的重试复用同一键。 */
  private reviewKey(decision: string, recordId: string): string {
    const store = decision === 'APPROVED' ? this.approveKeys : this.rejectKeys;
    let key = store.get(recordId);
    if (key === undefined) {
      const prefix = decision === 'APPROVED' ? 'app-approve' : 'app-reject';
      key = `${prefix}-${util.generateRandomUUID(true)}`;
      store.set(recordId, key);
    }
    return key;
  }

  private clearReviewKeys(recordId: string): void {
    this.approveKeys.delete(recordId);
    this.rejectKeys.delete(recordId);
  }

  private async submitReview(decision: string): Promise<void> {
    const detail = this.detail;
    if (detail === null || this.reviewBusy) {
      return;
    }
    if (decision === 'REJECTED' && this.rejectNote.trim() === '') {
      this.reviewError = '退回必须填写原因';
      return;
    }
    // 审核操作绑定发起时的备案与详情代次：完成后只改写仍属于该上下文的 UI，
    // 迟到的响应不会把当前查看的另一条详情覆盖回去，也不清掉它的退回输入。
    const recordId = detail.id;
    const generation = this.detailGeneration;
    this.reviewBusy = true;
    this.reviewError = '';
    this.noticeText = '';
    try {
      const key = this.reviewKey(decision, recordId);
      const note = decision === 'REJECTED' ? this.rejectNote.trim() : '';
      await RepairReviewService.review(recordId, decision, note, key);
      this.clearReviewKeys(recordId);
      if (this.isSameDetailContext(recordId, generation)) {
        this.rejectOpen = false;
        this.rejectNote = '';
        this.noticeText = decision === 'APPROVED' ? '已通过该备案。' : '已退回该备案。';
        // 审核后刷新详情（显示终态），再刷新列表（移除已处理项）。
        await this.fetchDetail(recordId);
      }
      await this.load();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (isSessionExpiredCode(error.code)) {
          this.onSessionExpired();
          return;
        }
        if (error.code === 'IDEMPOTENCY_CONFLICT') {
          // 键已绑定到不同内容（正常流程下不会发生）：换键后允许重新发起。
          this.clearReviewKeys(recordId);
        }
        if (this.isSameDetailContext(recordId, generation)) {
          this.reviewError = error.message;
        }
        if (error.code === 'REPAIR_STATE_CONFLICT' || error.code === 'IDEMPOTENCY_CONFLICT') {
          if (this.isSameDetailContext(recordId, generation)) {
            await this.fetchDetail(recordId);
          }
          await this.load();
        }
      } else if (this.isSameDetailContext(recordId, generation)) {
        this.reviewError = '审核失败，请重试';
      }
    } finally {
      this.reviewBusy = false;
    }
  }

  @Builder
  scopeChip(label: string, scope: string) {
    Text(label)
      .fontSize(13)
      .fontColor(this.scope === scope ? Color.White : $r('app.color.text_secondary'))
      .padding({ left: 14, right: 14, top: 6, bottom: 6 })
      .backgroundColor(this.scope === scope ? $r('app.color.brand') : $r('app.color.field_bg'))
      .borderRadius(16)
      .onClick(() => {
        this.switchScope(scope);
      })
  }

  @Builder
  recordCard(record: RepairRecordView) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Text(record.member.name)
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (record.isTypical) {
          Text('典型')
            .fontSize(12)
            .fontColor($r('app.color.ok'))
            .padding({ left: 8, right: 8, top: 3, bottom: 3 })
            .backgroundColor($r('app.color.field_bg'))
            .borderRadius(8)
        }
        Text(repairRecordStatusLabel(record.status))
          .fontSize(12)
          .fontColor($r('app.color.brand'))
          .padding({ left: 8, right: 8, top: 3, bottom: 3 })
          .backgroundColor($r('app.color.brand_soft'))
          .borderRadius(8)
      }
      .width('100%')

      Text(record.deviceModel === null ? '未填写机型' : record.deviceModel)
        .fontSize(14)
        .fontColor($r('app.color.text_primary'))
        .width('100%')
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .textAlign(TextAlign.Start)

      Text(record.content === null || record.content === '' ? '未填写维修内容' : record.content)
        .fontSize(13)
        .fontColor($r('app.color.text_secondary'))
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
        .textAlign(TextAlign.Start)

      Text(record.submittedAt === null ? '' : `提交时间 ${formatOrderTime(record.submittedAt)}`)
        .fontSize(12)
        .fontColor($r('app.color.text_secondary'))
        .width('100%')
        .textAlign(TextAlign.Start)
    }
    .width('100%')
    .padding(16)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Start)
    .onClick(() => {
      this.openDetail(record);
    })
  }

  @Builder
  detailRow(label: string, value: string) {
    Row({ space: 12 }) {
      Text(label)
        .fontSize(13)
        .fontColor($r('app.color.text_secondary'))
        .width(80)
        .textAlign(TextAlign.Start)
      Text(value)
        .fontSize(14)
        .fontColor($r('app.color.text_primary'))
        .layoutWeight(1)
        .textAlign(TextAlign.Start)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  @Builder
  reviewNoteView(review: RepairReviewView) {
    Column({ space: 4 }) {
      Row({ space: 8 }) {
        Text(review.decision === 'APPROVED' ? '审核通过' : '审核退回')
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor(review.decision === 'APPROVED' ? $r('app.color.ok') : $r('app.color.danger'))
        Text(`${review.reviewerName} · ${formatOrderTime(review.createdAt)}`)
          .fontSize(12)
          .fontColor($r('app.color.text_secondary'))
          .layoutWeight(1)
          .textAlign(TextAlign.End)
      }
      .width('100%')
      if (review.note !== null && review.note !== '') {
        Text(review.note)
          .fontSize(13)
          .fontColor($r('app.color.text_primary'))
          .width('100%')
          .textAlign(TextAlign.Start)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  detailPanel() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        Text('审核详情')
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .layoutWeight(1)
        Text('收起')
          .fontSize(14)
          .fontColor($r('app.color.brand'))
          .onClick(() => {
            this.closeDetail();
          })
      }
      .width('100%')

      if (this.detailLoading) {
        Column({ space: 8 }) {
          LoadingProgress()
            .width(28)
            .height(28)
            .color($r('app.color.brand'))
          Text('正在加载详情…')
            .fontSize(13)
            .fontColor($r('app.color.text_secondary'))
        }
        .width('100%')
        .padding(20)
        .justifyContent(FlexAlign.Center)
      } else if (this.detailErrorText !== '') {
        Column({ space: 12 }) {
          Text(this.detailErrorText)
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
              if (this.detailTargetId !== '') {
                this.fetchDetail(this.detailTargetId);
              }
            })
        }
        .width('100%')
        .padding(20)
        .backgroundColor($r('app.color.surface'))
        .borderRadius(CARD_RADIUS)
        .alignItems(HorizontalAlign.Center)
      } else if (this.detail !== null) {
        Text(repairRecordStatusLabel(this.detail.status))
          .fontSize(13)
          .fontColor($r('app.color.brand'))
          .padding({ left: 8, right: 8, top: 3, bottom: 3 })
          .backgroundColor($r('app.color.brand_soft'))
          .borderRadius(8)

        this.detailRow('维修成员', this.detail.member.name)
        this.detailRow('维修日期', this.detail.repairDate === null ? '未填写' : this.detail.repairDate)
        this.detailRow('故障分类', this.detail.category === null ? '未分类' : this.detail.category.name)
        this.detailRow('设备机型', this.detail.deviceModel === null ? '未填写' : this.detail.deviceModel)
        this.detailRow('维修内容', this.detail.content === null ? '未填写' : this.detail.content)
        this.detailRow('维修结果', repairResultLabel(this.detail.result))
        this.detailRow('维修耗时', this.detail.durationMinutes === null ? '未填写' : `${this.detail.durationMinutes} 分钟`)
        this.detailRow('备注', this.detail.remark === null ? '无' : this.detail.remark)

        if (this.detail.photos.length > 0) {
          Text('维修照片')
            .fontSize(14)
            .fontColor($r('app.color.text_primary'))
            .width('100%')
            .textAlign(TextAlign.Start)
          Flex({ wrap: FlexWrap.Wrap }) {
            ForEach(this.detail.photos, (photo: RepairPhotoView) => {
              Column() {
                PhotoThumb({
                  photoId: photo.id,
                  thumbSize: 88,
                  onOpen: () => {
                    this.previewPhotoId = photo.id;
                  }
                })
              }
              .margin({ right: 8, bottom: 8 })
            }, (photo: RepairPhotoView) => photo.id)
          }
          .width('100%')
        }

        if (this.detail.reviews.length > 0) {
          Column({ space: 10 }) {
            Text('审核记录')
              .fontSize(14)
              .fontColor($r('app.color.text_primary'))
              .width('100%')
              .textAlign(TextAlign.Start)
            ForEach(this.detail.reviews, (review: RepairReviewView) => {
              this.reviewNoteView(review);
            }, (review: RepairReviewView) => review.id)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }

        // 已通过的备案：审核人员可直接标记典型案例（业务范围内的备案均可标）。
        if (this.detail.status === 'APPROVED') {
          TypicalCasePanel({
            recordId: this.detailTargetId,
            onOpenCase: (caseId: string): void => {
              this.openCase(caseId);
            },
            onChanged: (): void => {
              this.refreshAfterCaseChange(this.detailTargetId);
            },
            onSessionExpired: (): void => {
              this.onSessionExpired();
            }
          })
        }

        if (this.detail.status === 'PENDING') {
          Column({ space: 10 }) {
            if (this.reviewError !== '') {
              Text(this.reviewError)
                .fontSize(13)
                .fontColor($r('app.color.danger'))
                .width('100%')
                .textAlign(TextAlign.Start)
            }
            Button(this.reviewBusy ? '提交中…' : '通过')
              .width('100%')
              .height(CONTROL_HEIGHT)
              .fontSize(16)
              .backgroundColor($r('app.color.brand'))
              .fontColor(Color.White)
              .enabled(!this.reviewBusy)
              .onClick(() => {
                this.submitReview('APPROVED');
              })
            if (this.rejectOpen) {
              TextArea({ text: this.rejectNote, placeholder: '请填写退回原因（必填）' })
                .height(88)
                .backgroundColor($r('app.color.field_bg'))
                .borderRadius(CONTROL_RADIUS)
                .onChange((next: string) => {
                  this.rejectNote = next;
                })
              Button(this.reviewBusy ? '提交中…' : '确认退回')
                .width('100%')
                .height(42)
                .fontSize(14)
                .backgroundColor($r('app.color.danger'))
                .fontColor(Color.White)
                .enabled(!this.reviewBusy)
                .onClick(() => {
                  this.submitReview('REJECTED');
                })
            } else {
              Button('退回')
                .width('100%')
                .height(42)
                .fontSize(14)
                .backgroundColor($r('app.color.field_bg'))
                .fontColor($r('app.color.danger'))
                .enabled(!this.reviewBusy)
                .onClick(() => {
                  this.rejectOpen = true;
                  this.reviewError = '';
                })
            }
          }
          .width('100%')
        }

        if (this.noticeText !== '') {
          Text(this.noticeText)
            .fontSize(13)
            .fontColor($r('app.color.ok'))
            .width('100%')
            .textAlign(TextAlign.Start)
        }
      }
    }
    .width('100%')
    .padding(16)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Stack() {
      Column({ space: 14 }) {
        Row({ space: 12 }) {
          Text('备案审核')
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

        Row({ space: 10 }) {
          this.scopeChip('待审核', SCOPE_PENDING);
          this.scopeChip('已通过', SCOPE_APPROVED);
        }
        .width('100%')

        Scroll() {
          Column({ space: 14 }) {
            if (this.detailOpen) {
              this.detailPanel();
            }

            if (this.state === STATE_LOADING) {
              Column({ space: 12 }) {
                LoadingProgress()
                  .width(36)
                  .height(36)
                  .color($r('app.color.brand'))
                Text('正在加载备案…')
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
                Text(this.scope === SCOPE_PENDING ? '暂无待审核备案' : '暂无已通过备案')
                  .fontSize(16)
                  .fontColor($r('app.color.text_primary'))
                Text(this.scope === SCOPE_PENDING
                  ? '工作人员提交备案后会出现在这里。'
                  : '审核通过的备案会出现在这里，可标记为典型案例并自动整理入库。')
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
              ForEach(this.records, (record: RepairRecordView) => {
                this.recordCard(record);
              }, (record: RepairRecordView) => record.id)

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

      if (this.previewPhotoId !== '') {
        Column() {
          PhotoThumb({
            photoId: this.previewPhotoId,
            thumbSize: 300,
            onOpen: () => {
              this.previewPhotoId = '';
            }
          })
          Text('点击图片或空白处关闭')
            .fontSize(13)
            .fontColor(Color.White)
            .margin({ top: 12 })
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
        .backgroundColor('#D9000000')
        .onClick(() => {
          this.previewPhotoId = '';
        })
      }
    }
    .width('100%')
    .height('100%')
  }
}
