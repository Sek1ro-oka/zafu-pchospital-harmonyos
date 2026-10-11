import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { CARD_RADIUS, CONTROL_HEIGHT, CONTROL_RADIUS, PAGE_PADDING } from '../../core/ui/Theme';
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
  private generation: number = 0;

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
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
    Row({ space: 8 }) {
      Text(label)
        .fontSize(13)
        .fontColor($r('app.color.text_secondary'))
        .width(72)
      Text(value)
        .fontSize(13)
        .fontColor($r('app.color.text_primary'))
        .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  @Builder
  body(data: KnowledgeSourceData) {
    Column({ space: 10 }) {
      Text(data.docTitle)
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.text_primary'))
      this.metaRow('章节', headingTrailText(data.headingPath));
      this.metaRow('位置', `${sourceLocationText(data)}（${data.sourcePath}）`);
      this.metaRow('版本', `${data.revision !== null ? data.revision.substring(0, 10) : '内部资料'} · ${data.indexVersion}`);
      if (data.visibility === 'STAFF') {
        Text('内部资料（仅工作人员可见）')
          .fontSize(12)
          .fontColor($r('app.color.brand'))
      }
      Divider().color($r('app.color.field_bg'))
      Text(data.content)
        .fontSize(15)
        .fontColor($r('app.color.text_primary'))
        .textSelectable(TextSelectableMode.SELECTABLE_UNFOCUSABLE)
        .width('100%')
      if (data.originalUrl !== null) {
        Button('在浏览器打开原文')
          .width('100%')
          .height(CONTROL_HEIGHT)
          .fontSize(15)
          .backgroundColor($r('app.color.brand'))
          .borderRadius(CONTROL_RADIUS)
          .onClick(() => {
            this.openOriginal();
          })
      } else {
        Text('内部测试资料：没有外部原文链接')
          .fontSize(12)
          .fontColor($r('app.color.text_secondary'))
      }
    }
    .width('100%')
    .padding(16)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
  }

  build() {
    Column({ space: 12 }) {
      if (this.loading) {
        Row({ space: 8 }) {
          LoadingProgress().width(22).height(22)
          Text('正在加载引用正文…')
            .fontSize(14)
            .fontColor($r('app.color.text_secondary'))
        }
      } else if (this.notFound) {
        Column({ space: 8 }) {
          Text('引用已过期或不存在')
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.text_primary'))
          Text(`${this.errorMessage}。请返回对话重新提问，用最新结果打开引用。`)
            .fontSize(14)
            .fontColor($r('app.color.text_secondary'))
        }
        .width('100%')
        .padding(16)
        .alignItems(HorizontalAlign.Start)
        .backgroundColor($r('app.color.surface'))
        .borderRadius(CARD_RADIUS)
      } else if (this.failed) {
        Column({ space: 8 }) {
          Text(this.errorMessage)
            .fontSize(14)
            .fontColor($r('app.color.danger'))
          Button('重试')
            .height(34)
            .fontSize(14)
            .backgroundColor($r('app.color.brand'))
            .onClick(() => {
              this.load();
            })
        }
        .width('100%')
        .padding(16)
        .alignItems(HorizontalAlign.Start)
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
