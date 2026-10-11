import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { CARD_RADIUS, CONTROL_HEIGHT, PAGE_PADDING } from '../../core/ui/Theme';
import { formatOrderTime } from '../repair/RepairOrderContract';
import {
  CaseDetailParam,
  CaseDetailView,
  CaseEvidence,
  CaseSourceView,
  CASE_VISIBILITY_PUBLIC,
  CASE_VISIBILITY_STAFF,
  caseEmbeddingLabel,
  caseEvidenceFieldLabel,
  caseResultLabel,
  caseSourceResultLabel,
  caseStatusLabel,
  caseVisibilityLabel,
  caseWithdrawnLabel,
} from './KnowledgeCaseContract';
import { CaseContentRow, contentRows, unknownsText } from './KnowledgeCaseFlow';
import { KnowledgeCaseService } from './KnowledgeCaseService';

/**
 * 案例详情（工作人员读，管理员可管）。
 *
 * - 结构化正文 + 逐字段「原文未提供」如实展示，不推断缺失事实；
 * - 多来源逐条列出：作者、日期、机型、结果与证据引文；
 * - 管理动作（可见范围/撤回/重整恢复/重建向量）只按服务端 canXxx 标记出现；
 * - 撤回与「改公开」都先确认再执行；动作结果以服务端返回的最新详情为准。
 */
@Component
export struct CaseDetailPage {
  param: CaseDetailParam = { caseId: '', title: '' };
  onSessionExpired: () => void = () => {
  };
  @State loading: boolean = true;
  @State loadFailed: boolean = false;
  @State errorText: string = '';
  @State detail: CaseDetailView | null = null;
  @State busy: boolean = false;
  @State actionError: string = '';
  @State notice: string = '';
  private generation: number = 0;

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    if (this.param.caseId === '') {
      this.loading = false;
      this.loadFailed = true;
      this.errorText = '缺少案例编号';
      return;
    }
    this.generation = this.generation + 1;
    const generation = this.generation;
    this.loading = true;
    this.loadFailed = false;
    this.errorText = '';
    try {
      const detail = await KnowledgeCaseService.caseDetail(this.param.caseId);
      if (generation !== this.generation) {
        return;
      }
      this.detail = detail;
      this.loading = false;
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      this.loading = false;
      if (this.isSessionExpired(error)) {
        return;
      }
      this.loadFailed = true;
      this.errorText = error instanceof ApiRequestError ? error.message : '加载案例失败';
    }
  }

  private isSessionExpired(error: Object): boolean {
    if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) {
      this.onSessionExpired();
      return true;
    }
    return false;
  }

  private handleActionError(error: Object, fallback: string): void {
    if (error instanceof ApiRequestError) {
      if (isSessionExpiredCode(error.code)) {
        this.onSessionExpired();
        return;
      }
      this.actionError = error.message;
      if (error.code === 'CASE_STATE_CONFLICT' || error.code === 'CASE_NOT_FOUND') {
        this.load();
      }
      return;
    }
    this.actionError = fallback;
  }

  private async runVisibility(visibility: string): Promise<void> {
    if (this.busy || this.detail === null) {
      return;
    }
    this.busy = true;
    this.actionError = '';
    this.notice = '';
    try {
      const detail = await KnowledgeCaseService.setVisibility(this.detail.id, visibility);
      this.detail = detail;
      this.notice = visibility === CASE_VISIBILITY_PUBLIC ? '已改为公开可见。' : '已改为内部可见。';
    } catch (error) {
      this.handleActionError(error, '调整可见范围失败，请重试');
    } finally {
      this.busy = false;
    }
  }

  private confirmWithdraw(): void {
    this.getUIContext().showAlertDialog({
      title: '撤回该案例',
      message: '撤回后立即停止检索命中与来源读取；普通重试不会自动恢复，需要管理员显式重整才能重新发布。',
      primaryButton: {
        value: '再想想',
        action: () => {
        }
      },
      secondaryButton: {
        value: '确认撤回',
        action: () => {
          this.runWithdraw();
        }
      }
    });
  }

  private async runWithdraw(): Promise<void> {
    if (this.busy || this.detail === null) {
      return;
    }
    this.busy = true;
    this.actionError = '';
    this.notice = '';
    try {
      const detail = await KnowledgeCaseService.withdraw(this.detail.id);
      this.detail = detail;
      this.notice = '已撤回案例。';
    } catch (error) {
      this.handleActionError(error, '撤回失败，请重试');
    } finally {
      this.busy = false;
    }
  }

  private async runReprocess(): Promise<void> {
    if (this.busy || this.detail === null) {
      return;
    }
    this.busy = true;
    this.actionError = '';
    this.notice = '';
    try {
      const result = await KnowledgeCaseService.reprocess(this.detail.id);
      this.detail = result.case;
      if (result.case.status === 'PUBLISHED') {
        this.notice = '已重新整理发布。';
      } else if (result.outcome.failureMessage !== null && result.outcome.failureMessage !== '') {
        this.actionError = result.outcome.failureMessage;
      }
    } catch (error) {
      this.handleActionError(error, '重整失败，请重试');
    } finally {
      this.busy = false;
    }
  }

  private async runReembed(): Promise<void> {
    if (this.busy || this.detail === null) {
      return;
    }
    this.busy = true;
    this.actionError = '';
    this.notice = '';
    try {
      const detail = await KnowledgeCaseService.reembed(this.detail.id);
      this.detail = detail;
      this.notice = detail.embedding.status === 'READY' ? '向量已生成。' : '';
      if (detail.embedding.status !== 'READY' && detail.embedding.error !== null) {
        this.actionError = detail.embedding.error;
      }
    } catch (error) {
      this.handleActionError(error, '生成向量失败，请重试');
    } finally {
      this.busy = false;
    }
  }

  @Builder
  metaRow(label: string, value: string) {
    Row({ space: 12 }) {
      Text(label)
        .fontSize(13)
        .fontColor($r('app.color.text_secondary'))
        .width(84)
        .textAlign(TextAlign.Start)
      Text(value)
        .fontSize(13)
        .fontColor($r('app.color.text_primary'))
        .layoutWeight(1)
        .textAlign(TextAlign.Start)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  @Builder
  quoteView(quote: CaseEvidence) {
    Column({ space: 4 }) {
      Text(caseEvidenceFieldLabel(quote.field))
        .fontSize(12)
        .fontColor($r('app.color.brand'))
      Text(`“${quote.quote}”`)
        .fontSize(13)
        .fontColor($r('app.color.text_primary'))
        .width('100%')
        .textAlign(TextAlign.Start)
    }
    .width('100%')
    .padding({ left: 10, top: 8, right: 10, bottom: 8 })
    .backgroundColor($r('app.color.field_bg'))
    .borderRadius(8)
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  sourceView(source: CaseSourceView, index: number) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Text(`来源 ${index + 1} · ${source.authorName}`)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(caseSourceResultLabel(source.result))
          .fontSize(12)
          .fontColor($r('app.color.text_secondary'))
      }
      .width('100%')
      Text(
        `${source.repairDate === null ? '日期未填' : source.repairDate} · ${source.deviceModel === null ? '机型未填' : source.deviceModel} · ${source.categoryName === null ? '未分类' : source.categoryName}`
      )
        .fontSize(12)
        .fontColor($r('app.color.text_secondary'))
        .width('100%')
      if (source.quotes.length === 0) {
        Text('该来源没有逐项证据引文')
          .fontSize(12)
          .fontColor($r('app.color.text_secondary'))
      } else {
        ForEach(source.quotes, (quote: CaseEvidence) => {
          this.quoteView(quote);
        }, (quote: CaseEvidence) => `${source.id}:${quote.field}:${quote.quote}`)
      }
    }
    .width('100%')
    .padding(14)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  adminPanel(detail: CaseDetailView) {
    Column({ space: 10 }) {
      Text('管理员操作')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.text_primary'))
        .width('100%')

      Text(`当前范围：${caseVisibilityLabel(detail.visibility)}`)
        .fontSize(13)
        .fontColor($r('app.color.text_secondary'))
        .width('100%')

      Row({ space: 10 }) {
        if (detail.visibility === CASE_VISIBILITY_STAFF) {
          Button(this.busy ? '处理中…' : '改为公开')
            .layoutWeight(1)
            .height(42)
            .fontSize(14)
            .backgroundColor($r('app.color.field_bg'))
            .fontColor($r('app.color.brand'))
            .enabled(!this.busy)
            .onClick(() => {
              this.runVisibility(CASE_VISIBILITY_PUBLIC);
            })
        } else {
          Button(this.busy ? '处理中…' : '改为内部')
            .layoutWeight(1)
            .height(42)
            .fontSize(14)
            .backgroundColor($r('app.color.field_bg'))
            .fontColor($r('app.color.brand'))
            .enabled(!this.busy)
            .onClick(() => {
              this.runVisibility(CASE_VISIBILITY_STAFF);
            })
        }
        if (detail.status !== 'WITHDRAWN') {
          Button(this.busy ? '处理中…' : '撤回案例')
            .layoutWeight(1)
            .height(42)
            .fontSize(14)
            .backgroundColor($r('app.color.field_bg'))
            .fontColor($r('app.color.danger'))
            .enabled(!this.busy)
            .onClick(() => {
              this.confirmWithdraw();
            })
        }
      }
      .width('100%')

      if (detail.actions.canRestore || detail.actions.canReprocess) {
        Button(this.busy ? '重整中…（最长约 1 分钟）' : detail.actions.canRestore ? '恢复并重新整理' : '重新整理')
          .width('100%')
          .height(CONTROL_HEIGHT)
          .fontSize(15)
          .backgroundColor($r('app.color.brand'))
          .fontColor(Color.White)
          .enabled(!this.busy)
          .onClick(() => {
            this.runReprocess();
          })
      }
      if (detail.actions.canReembed) {
        Button(this.busy ? '处理中…' : detail.embedding.status === 'READY' ? '重建向量' : '生成向量')
          .width('100%')
          .height(42)
          .fontSize(14)
          .backgroundColor($r('app.color.field_bg'))
          .fontColor($r('app.color.brand'))
          .enabled(!this.busy)
          .onClick(() => {
            this.runReembed();
          })
      }
    }
    .width('100%')
    .padding(16)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Column({ space: 12 }) {
      if (this.loading) {
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
      } else if (this.loadFailed) {
        Column({ space: 12 }) {
          Text(this.errorText)
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
      } else if (this.detail !== null) {
        Scroll() {
          Column({ space: 12 }) {
            // ---- 头部：标题 + 状态 ----
            Column({ space: 8 }) {
              Text(this.detail.title)
                .fontSize(22)
                .fontWeight(FontWeight.Bold)
                .fontColor($r('app.color.text_primary'))
                .width('100%')
                .textAlign(TextAlign.Start)
              Row({ space: 8 }) {
                Text(caseStatusLabel(this.detail.status))
                  .fontSize(12)
                  .fontColor(this.detail.status === 'FAILED' ? $r('app.color.danger') : $r('app.color.brand'))
                  .padding({ left: 8, right: 8, top: 3, bottom: 3 })
                  .backgroundColor($r('app.color.brand_soft'))
                  .borderRadius(8)
                Text(caseVisibilityLabel(this.detail.visibility))
                  .fontSize(12)
                  .fontColor($r('app.color.text_secondary'))
              }
              .width('100%')
              Text(`版本 v${this.detail.contentVersion} · ${this.detail.sources.length} 条来源`)
                .fontSize(12)
                .fontColor($r('app.color.text_secondary'))
                .width('100%')
              Text('刷新')
                .fontSize(13)
                .fontColor($r('app.color.brand'))
                .onClick(() => {
                  this.load();
                })
            }
            .width('100%')
            .padding(16)
            .backgroundColor($r('app.color.surface'))
            .borderRadius(CARD_RADIUS)
            .alignItems(HorizontalAlign.Start)

            if (this.detail.withdrawn !== null) {
              Column({ space: 4 }) {
                Text(`该案例已撤回：${caseWithdrawnLabel(this.detail.withdrawn.source)}`)
                  .fontSize(13)
                  .fontColor($r('app.color.danger'))
                  .width('100%')
                if (this.detail.withdrawn.at !== null) {
                  Text(`撤回时间 ${formatOrderTime(this.detail.withdrawn.at)}`)
                    .fontSize(12)
                    .fontColor($r('app.color.text_secondary'))
                    .width('100%')
                }
              }
              .width('100%')
              .padding(14)
              .backgroundColor($r('app.color.surface'))
              .borderRadius(CARD_RADIUS)
              .alignItems(HorizontalAlign.Start)
            }

            if (this.detail.failure !== null) {
              Column({ space: 4 }) {
                Text(`整理失败（${this.detail.failure.code}）`)
                  .fontSize(13)
                  .fontColor($r('app.color.danger'))
                  .width('100%')
                Text(this.detail.failure.message)
                  .fontSize(13)
                  .fontColor($r('app.color.text_primary'))
                  .width('100%')
              }
              .width('100%')
              .padding(14)
              .backgroundColor($r('app.color.surface'))
              .borderRadius(CARD_RADIUS)
              .alignItems(HorizontalAlign.Start)
            }

            // ---- 结构化正文 ----
            Column({ space: 10 }) {
              Text(`维修结果：${caseResultLabel(this.detail.content.result)}`)
                .fontSize(14)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary'))
                .width('100%')
              ForEach(contentRows(this.detail.content), (row: CaseContentRow) => {
                Column({ space: 3 }) {
                  Text(row.label)
                    .fontSize(13)
                    .fontColor($r('app.color.text_secondary'))
                    .width('100%')
                  Text(row.value)
                    .fontSize(14)
                    .fontColor($r('app.color.text_primary'))
                    .width('100%')
                    .textAlign(TextAlign.Start)
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start)
              }, (row: CaseContentRow) => row.label)
              if (unknownsText(this.detail.content.unknowns) !== '') {
                Text(unknownsText(this.detail.content.unknowns))
                  .fontSize(12)
                  .fontColor($r('app.color.text_secondary'))
                  .width('100%')
              }
            }
            .width('100%')
            .padding(16)
            .backgroundColor($r('app.color.surface'))
            .borderRadius(CARD_RADIUS)
            .alignItems(HorizontalAlign.Start)

            // ---- 来源证据 ----
            Text(`来源证据（${this.detail.sources.length}）`)
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
              .fontColor($r('app.color.text_primary'))
              .width('100%')
              .textAlign(TextAlign.Start)
            ForEach(this.detail.sources, (source: CaseSourceView, index: number) => {
              this.sourceView(source, index);
            }, (source: CaseSourceView) => source.id)

            // ---- 元数据 ----
            Column({ space: 6 }) {
              this.metaRow('整理模型', this.detail.model === null ? '未记录' : this.detail.model);
              this.metaRow('提示版本', this.detail.promptVersion === null ? '未记录' : this.detail.promptVersion);
              this.metaRow(
                '向量',
                `${caseEmbeddingLabel(this.detail.embedding.status)}${this.detail.embedding.fingerprint === null ? '' : ` · ${this.detail.embedding.fingerprint}`}`
              );
              if (this.detail.embedding.error !== null) {
                this.metaRow('向量错误', this.detail.embedding.error);
              }
              this.metaRow('发布时间', this.detail.publishedAt === null ? '未发布' : formatOrderTime(this.detail.publishedAt));
            }
            .width('100%')
            .padding(16)
            .backgroundColor($r('app.color.surface'))
            .borderRadius(CARD_RADIUS)
            .alignItems(HorizontalAlign.Start)

            if (this.actionError !== '') {
              Text(this.actionError)
                .fontSize(13)
                .fontColor($r('app.color.danger'))
                .width('100%')
                .textAlign(TextAlign.Start)
            }
            if (this.notice !== '') {
              Text(this.notice)
                .fontSize(13)
                .fontColor($r('app.color.ok'))
                .width('100%')
                .textAlign(TextAlign.Start)
            }

            if (this.detail.actions.canManage) {
              this.adminPanel(this.detail);
            }
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
        .layoutWeight(1)
        .width('100%')
        .scrollBar(BarState.Auto)
        .align(Alignment.Top)
      }
    }
    .width('100%')
    .height('100%')
    .padding(PAGE_PADDING)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.start_window_background'))
  }
}
