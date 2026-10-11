import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { CARD_RADIUS, CONTROL_HEIGHT, CONTROL_RADIUS } from '../../core/ui/Theme';
import {
  RecordCaseProcessingView,
  RecordCaseRetryResult,
} from './KnowledgeCaseContract';
import { typicalPanelModel, TypicalPanelModel } from './KnowledgeCaseFlow';
import { KnowledgeCaseService } from './KnowledgeCaseService';

/**
 * 典型案例面板（Issue #40）：备案的作者与审核人员共用的标记入口。
 *
 * - 状态与按钮（标记/取消/重试）全部来自服务端返回的真实状态与能力标记；
 * - 标记是同步动作（服务端内联整理，可能等待模型返回），期间按钮显示进行中；
 * - 失败原因原样展示，重试按钮只在服务端说可以重试时出现；
 * - 成功后通过 onChanged 通知宿主刷新备案数据（典型标记已变化）。
 */
@Component
export struct TypicalCasePanel {
  @Prop @Watch('onRecordChanged') recordId: string = '';
  /** 打开关联案例详情（由宿主注入导航）。 */
  onOpenCase: (caseId: string) => void = () => {
  };
  /** 标记/取消/重试成功后通知宿主刷新备案详情。 */
  onChanged: () => void = () => {
  };
  onSessionExpired: () => void = () => {
  };
  @State loading: boolean = true;
  @State loadFailed: boolean = false;
  @State errorText: string = '';
  @State view: RecordCaseProcessingView | null = null;
  @State model: TypicalPanelModel | null = null;
  @State busy: boolean = false;
  @State actionError: string = '';
  @State notice: string = '';
  private generation: number = 0;

  aboutToAppear(): void {
    this.load();
  }

  onRecordChanged(): void {
    if (this.recordId !== '') {
      this.load();
    }
  }

  private setView(view: RecordCaseProcessingView): void {
    this.view = view;
    this.model = typicalPanelModel(view);
  }

  private async load(): Promise<void> {
    if (this.recordId === '') {
      this.loading = false;
      return;
    }
    this.generation = this.generation + 1;
    const generation = this.generation;
    this.loading = true;
    this.loadFailed = false;
    this.errorText = '';
    try {
      const view = await KnowledgeCaseService.recordStatus(this.recordId);
      if (generation !== this.generation) {
        return;
      }
      this.setView(view);
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
      this.errorText = error instanceof ApiRequestError ? error.message : '加载案例状态失败';
    }
  }

  private isSessionExpired(error: Object): boolean {
    if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) {
      this.onSessionExpired();
      return true;
    }
    return false;
  }

  private async runMark(): Promise<void> {
    if (this.busy || this.recordId === '') {
      return;
    }
    this.busy = true;
    this.actionError = '';
    this.notice = '';
    try {
      const view = await KnowledgeCaseService.markTypical(this.recordId);
      this.setView(view);
      this.notice = view.status === 'PUBLISHED' ? '已整理入库，可被检索命中。' : '';
      if (view.status === 'FAILED' && view.failureMessage !== null) {
        this.actionError = view.failureMessage;
      }
      this.onChanged();
    } catch (error) {
      this.handleActionError(error, '标记失败，请重试');
    } finally {
      this.busy = false;
    }
  }

  private async runRetry(): Promise<void> {
    if (this.busy || this.recordId === '') {
      return;
    }
    this.busy = true;
    this.actionError = '';
    this.notice = '';
    try {
      const result: RecordCaseRetryResult = await KnowledgeCaseService.retryProcessing(this.recordId);
      this.setView(result.state);
      if (result.state.status === 'PUBLISHED') {
        this.notice = '已重新入库。';
      } else if (result.state.failureMessage !== null && result.state.failureMessage !== '') {
        this.actionError = result.state.failureMessage;
      }
      this.onChanged();
    } catch (error) {
      this.handleActionError(error, '重试失败，请重试');
    } finally {
      this.busy = false;
    }
  }

  private confirmUnmark(): void {
    this.getUIContext().showAlertDialog({
      title: '取消典型案例标记',
      message: '取消后该备案的贡献会从案例中移除；关联案例将按剩余来源自动重整，没有剩余来源时会被撤下。',
      primaryButton: {
        value: '再想想',
        action: () => {
        }
      },
      secondaryButton: {
        value: '确认取消',
        action: () => {
          this.runUnmark();
        }
      }
    });
  }

  private async runUnmark(): Promise<void> {
    if (this.busy || this.recordId === '') {
      return;
    }
    this.busy = true;
    this.actionError = '';
    this.notice = '';
    try {
      const view = await KnowledgeCaseService.unmarkTypical(this.recordId);
      this.setView(view);
      this.notice = '已取消典型标记。';
      this.onChanged();
    } catch (error) {
      this.handleActionError(error, '取消失败，请重试');
    } finally {
      this.busy = false;
    }
  }

  private handleActionError(error: Object, fallback: string): void {
    if (error instanceof ApiRequestError) {
      if (isSessionExpiredCode(error.code)) {
        this.onSessionExpired();
        return;
      }
      this.actionError = error.message;
      // 409 冲突（如别人先取消、案例已撤回）：刷新拿最新真实状态，按钮不留在旧状态。
      if (error.code === 'CASE_STATE_CONFLICT' || error.code === 'CASE_VERSION_CONFLICT') {
        this.load();
      }
      return;
    }
    this.actionError = fallback;
  }

  @Builder
  panelBody(model: TypicalPanelModel) {
    Row({ space: 8 }) {
      Text(model.summary)
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor(model.mode === 'failed' ? $r('app.color.danger') : $r('app.color.text_primary'))
        .layoutWeight(1)
      if (this.busy) {
        LoadingProgress()
          .width(18)
          .height(18)
          .color($r('app.color.brand'))
      } else {
        Text('刷新')
          .fontSize(13)
          .fontColor($r('app.color.brand'))
          .onClick(() => {
            this.load();
          })
      }
    }
    .width('100%')

    if (model.detail !== '') {
      Text(model.detail)
        .fontSize(13)
        .fontColor(model.mode === 'failed' ? $r('app.color.danger') : $r('app.color.text_secondary'))
        .width('100%')
        .textAlign(TextAlign.Start)
    }
    if (model.mode === 'pending' || model.mode === 'processing') {
      Text('AI 正在整理，稍后点「刷新」查看最新状态。')
        .fontSize(12)
        .fontColor($r('app.color.text_secondary'))
        .width('100%')
        .textAlign(TextAlign.Start)
    }

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

    if (model.showMark) {
      Button(this.busy ? '整理中…（最长约 1 分钟）' : '标记为典型案例并整理')
        .width('100%')
        .height(CONTROL_HEIGHT)
        .fontSize(15)
        .backgroundColor($r('app.color.brand'))
        .fontColor(Color.White)
        .enabled(!this.busy)
        .onClick(() => {
          this.runMark();
        })
    }
    if (model.showRetry) {
      Button(this.busy ? '处理中…' : '重试整理')
        .width('100%')
        .height(42)
        .fontSize(14)
        .backgroundColor($r('app.color.brand'))
        .fontColor(Color.White)
        .enabled(!this.busy)
        .onClick(() => {
          this.runRetry();
        })
    }
    if (model.canOpenCase) {
      Button('打开关联案例')
        .width('100%')
        .height(42)
        .fontSize(14)
        .backgroundColor($r('app.color.field_bg'))
        .fontColor($r('app.color.brand'))
        .enabled(!this.busy)
        .onClick(() => {
          const caseId: string | null = this.view !== null ? this.view.caseId : null;
          if (caseId !== null) {
            this.onOpenCase(caseId);
          }
        })
    }
    if (model.showUnmark) {
      Button(this.busy ? '处理中…' : '取消典型标记')
        .width('100%')
        .height(42)
        .fontSize(14)
        .backgroundColor($r('app.color.field_bg'))
        .fontColor($r('app.color.danger'))
        .enabled(!this.busy)
        .onClick(() => {
          this.confirmUnmark();
        })
    }
  }

  build() {
    Column({ space: 10 }) {
      Text('典型案例')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.text_primary'))
        .width('100%')
        .textAlign(TextAlign.Start)

      if (this.loading) {
        Row({ space: 8 }) {
          LoadingProgress().width(20).height(20).color($r('app.color.brand'))
          Text('正在加载案例状态…')
            .fontSize(13)
            .fontColor($r('app.color.text_secondary'))
        }
        .width('100%')
      } else if (this.loadFailed) {
        Column({ space: 8 }) {
          Text(this.errorText)
            .fontSize(13)
            .fontColor($r('app.color.danger'))
            .width('100%')
          Button('重试加载')
            .height(36)
            .fontSize(14)
            .backgroundColor($r('app.color.brand'))
            .onClick(() => {
              this.load();
            })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      } else if (this.model !== null) {
        this.panelBody(this.model)
      }
    }
    .width('100%')
    .padding(16)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
  }
}
