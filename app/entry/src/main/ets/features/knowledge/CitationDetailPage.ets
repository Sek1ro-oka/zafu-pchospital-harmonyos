import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { CARD_GAP, CARD_PADDING, CARD_RADIUS, CONTROL_HEIGHT, CONTROL_RADIUS, FONT_BODY, FONT_CHIP, FONT_HEADING, FONT_NOTE, FONT_SUBTITLE, FONT_TEXT, GAP_SM, PAGE_PADDING } from '../../core/ui/Theme';
import {
  headingTrailText,
  KnowledgeSourceData,
  KnowledgeSourceParam,
  sourceLocationText
} from './KnowledgeContract';
import { KnowledgeService } from './KnowledgeService';

const CODE_SOURCE_NOT_FOUND: string = 'KNOWLEDGE_SOURCE_NOT_FOUND';

/**
 * 引用详情：显示引用位置（行范围/拆分段）、来源版本与正文，
 * 并可经系统浏览器打开固定提交的原文链接。
 *
 * - 加载/失败/重试只围绕本页 sourceId（切换引用会进入新的页面实例，不会重试上一个来源）；
 * - 已过期/不存在（404）与网络失败分开提示；会话过期交给上层回登录。
 */
@Component
export struct CitationDetailPage {
  param: KnowledgeSourceParam = { sourceId: '', title: '' };
  onSessionExpired: () => void = () => {
  };
  @State loading: boolean = true;
  @State notFound: boolean = false;
  @State failed: boolean = false;
  @State errorMessage: string = '';
  @State data: KnowledgeSourceData | null = null;
  /** 请求进行中标记：与 loading 分开，防止重试按钮连点发出并发请求。 */
  private requesting: boolean = false;
  private generation: number = 0;

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    if (this.requesting) {
      return;
    }
    this.requesting = true;
    const generation: number = ++this.generation;
    this.loading = true;
    this.failed = false;
    this.notFound = false;
    try {
      const data: KnowledgeSourceData = await KnowledgeService.fetchSource(this.param.sourceId);
      if (generation !== this.generation) {
        return;
      }
      this.data = data;
      this.loading = false;
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      this.loading = false;
      if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) {
        this.onSessionExpired();
        return;
      }
      if (error instanceof ApiRequestError && error.code === CODE_SOURCE_NOT_FOUND) {
        this.notFound = true;
        this.errorMessage = error.message;
        return;
      }
      this.failed = true;
      this.errorMessage = error instanceof ApiRequestError ? error.message : '加载失败，请重试';
    } finally {
      this.requesting = false;
    }
  }

  private async openOriginal(): Promise<void> {
    const data: KnowledgeSourceData | null = this.data;
    if (data === null || data.originalUrl === null) {
      return;
    }
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      await context.startAbility({
        action: 'ohos.want.action.viewData',
        entities: ['entity.system.browsable'],
        uri: data.originalUrl
      });
    } catch (error) {
      const businessError = error as BusinessError;
      this.getUIContext().getPromptAction().showToast({ message: `无法打开浏览器（${businessError.code}）` });
    }
  }

  @Builder
  metaRow(label: string, value: string) {
    Row({ space: GAP_SM }) {
      Text(label)
        .fontSize(FONT_NOTE)
        .fontColor($r('app.color.text_secondary'))
        .width(72)
      Text(value)
        .fontSize(FONT_NOTE)
        .fontColor($r('app.color.text_primary'))
        .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  @Builder
  body(data: KnowledgeSourceData) {
    Column({ space: GAP_SM }) {
      Text(data.docTitle)
        .fontSize(FONT_HEADING)
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.text_primary'))
      this.metaRow('章节', headingTrailText(data.headingPath));
      this.metaRow('位置', `${sourceLocationText(data)}（${data.sourcePath}）`);
      this.metaRow('版本', `${data.revision !== null ? data.revision.substring(0, 10) : '内部资料'} · ${data.indexVersion}`);
      if (data.visibility === 'STAFF') {
        Text('内部资料（仅工作人员可见）')
          .fontSize(FONT_CHIP)
          .fontColor($r('app.color.brand'))
      }
      Divider().color($r('app.color.field_bg'))
      Text(data.content)
        .fontSize(FONT_BODY)
        .fontColor($r('app.color.text_primary'))
        .textSelectable(TextSelectableMode.SELECTABLE_UNFOCUSABLE)
        .width('100%')
      if (data.originalUrl !== null) {
        Button('在浏览器打开原文')
          .width('100%')
          .height(CONTROL_HEIGHT)
          .fontSize(FONT_BODY)
          .backgroundColor($r('app.color.brand'))
          .borderRadius(CONTROL_RADIUS)
          .onClick(() => {
            this.openOriginal();
          })
      } else {
        Text('内部测试资料：没有外部原文链接')
          .fontSize(FONT_CHIP)
          .fontColor($r('app.color.text_secondary'))
      }
    }
    .width('100%')
    .padding(CARD_PADDING)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
  }

  build() {
    Column({ space: CARD_GAP }) {
      if (this.loading) {
        // 状态面板统一转圈规格与文案层级；引用正文卡由下方段落渲染。
        Column() {
          LoadingPanel({ text: '正在加载引用正文…' })
        }
        .width('100%')
        .backgroundColor($r('app.color.surface'))
        .borderRadius(CARD_RADIUS)
      } else if (this.notFound) {
        Column({ space: GAP_SM }) {
          Text('引用已过期或不存在')
            .fontSize(FONT_SUBTITLE)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.text_primary'))
          Text(`${this.errorMessage}。请返回对话重新提问，用最新结果打开引用。`)
            .fontSize(FONT_TEXT)
            .fontColor($r('app.color.text_secondary'))
        }
        .width('100%')
        .padding(CARD_PADDING)
        .alignItems(HorizontalAlign.Start)
        .backgroundColor($r('app.color.surface'))
        .borderRadius(CARD_RADIUS)
      } else if (this.failed) {
        // 失败态复用统一错误面板：错误信息 + 重试（网络错误与业务错误文案由 ApiClient 区分）。
        Column() {
          ErrorPanel({
            message: this.errorMessage,
            onRetry: (): void => {
              this.load();
            }
          })
        }
        .width('100%')
        .backgroundColor($r('app.color.surface'))
        .borderRadius(CARD_RADIUS)
      } else if (this.data !== null) {
        Scroll() {
          Column() {
            this.body(this.data);
          }
          .width('100%')
        }
        .layoutWeight(1)
        .width('100%')
        .scrollBar(BarState.Auto)
      }
    }
    .width('100%')
    .height('100%')
    .padding(PAGE_PADDING)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.start_window_background'))
  }
}
