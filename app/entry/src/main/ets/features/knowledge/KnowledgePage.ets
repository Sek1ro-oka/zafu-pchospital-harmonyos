import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { NavPusher, ROUTE_KNOWLEDGE_SOURCE } from '../../core/ui/Routes';
import { ErrorPanel } from '../../core/ui/StatePanel';
import {
  CARD_GAP,
  CARD_PADDING,
  CARD_PADDING_SM,
  CARD_RADIUS,
  CONTROL_HEIGHT,
  CONTROL_HEIGHT_SM,
  CONTROL_RADIUS,
  FONT_BODY,
  FONT_CHIP,
  FONT_HEADING,
  FONT_NOTE,
  FONT_TEXT,
  GAP_SM,
  GAP_XS,
  PAGE_PADDING,
} from '../../core/ui/Theme';
import {
  headingTrailText,
  KnowledgeChatData,
  KnowledgeChatMessage,
  KnowledgeCitation,
  KnowledgeSourceParam,
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS,
  MAX_QUESTION_CHARS,
  MAX_TOTAL_HISTORY_CHARS
} from './KnowledgeContract';
import {
  appendMessage,
  ChatMessage,
  failedMessage,
  insertAfterUser,
  isNetworkErrorCode,
  KIND_CLARIFY,
  KIND_INSUFFICIENT,
  pendingMessage,
  removeMessageById,
  replaceMessageById,
  responseMessage,
  retryUserIndex,
  ROLE_ASSISTANT,
  ROLE_USER,
  STATUS_DONE,
  STATUS_FAILED,
  STATUS_PENDING,
  userMessage
} from './KnowledgeFlow';
import { KnowledgeService } from './KnowledgeService';

const EXAMPLE_QUESTIONS: string[] = [
  '校园网认证失败怎么办？',
  '开机黑屏怎么排查？',
  'CrystalDiskInfo 怎么看硬盘健康状态？'
];

/** 「资料不足」回答的引导文案：干净回答应当给出处，没有出处就明确说清可以怎么补问。 */
const INSUFFICIENT_HINT: string =
  '现有资料不足以支持回答，可补充机型、系统版本或具体报错原文后再问一次。';

/** 澄清追问的引导文案：后端追问会带上需要补充的信息。 */
const CLARIFY_HINT: string = '请补充上面的信息后再发一次。';

/**
 * 知识问答页：客户与工作人员共用，资料范围由服务端按角色过滤。
 *
 * - 本次对话只保存在页面内存；离开问答功能、清空或退出登录即清除（实例随导航销毁）；
 * - 发送中防重复；失败保留问题可重试；异步返回带代次校验，清空后的旧响应不会恢复旧消息；
 * - 消息顺序不变量由 KnowledgeFlow 的纯函数保证：回答紧跟对应问题，
 *   旧问题重试不会跑到新问题之后，重复失败仍可重试；
 * - 会话过期交给上层（onSessionExpired → 现有退出/回登录流程）。
 * - 页面标题由 HomePage 的 NavDestination 提供，本页只保留对话工具行。
 */
@Component
export struct KnowledgePage {
  pathStack: NavPathStack = new NavPathStack();
  onSessionExpired: () => void = () => {
  };
  @State messages: ChatMessage[] = [];
  @State inputText: string = '';
  @State sending: boolean = false;
  private scroller: Scroller = new Scroller();
  /** 引用详情跳转与首页同一套路：防抖，双击不会压入两个详情页。 */
  private pusher: NavPusher = new NavPusher();
  private nextId: number = 1;
  /** 代次：清空/离开时自增，旧请求的异步返回据此丢弃。 */
  private generation: number = 0;

  private scrollToBottom(): void {
    this.scroller.scrollEdge(Edge.Bottom);
  }

  /** 历史消息：跳过 pending/failed 的助手消息，按契约上限截断（取最近的若干条）。 */
  private buildHistory(beforeIndex: number): KnowledgeChatMessage[] {
    const history: KnowledgeChatMessage[] = [];
    const start: number = Math.max(0, beforeIndex - MAX_HISTORY_MESSAGES * 2);
    for (let index = start; index < beforeIndex; index += 1) {
      const message = this.messages[index];
      if (message.role === ROLE_ASSISTANT && (message.status !== STATUS_DONE || message.text === '')) {
        continue;
      }
      history.push({ role: message.role, content: this.truncateText(message.text, MAX_MESSAGE_CHARS) });
    }
    let total: number = 0;
    for (const message of history) {
      total += message.content.length;
    }
    while (history.length > MAX_HISTORY_MESSAGES || total > MAX_TOTAL_HISTORY_CHARS) {
      total -= history[0].content.length;
      history.shift();
    }
    return history;
  }

  private truncateText(text: string, maxChars: number): string {
    return text.length <= maxChars ? text : text.substring(0, maxChars);
  }

  private async send(): Promise<void> {
    if (this.sending) {
      return;
    }
    const question: string = this.inputText.trim();
    if (question === '') {
      return;
    }
    if (question.length > MAX_QUESTION_CHARS) {
      this.getUIContext().getPromptAction().showToast({ message: `问题过长（上限 ${MAX_QUESTION_CHARS} 字）` });
      return;
    }
    this.inputText = '';
    this.messages = appendMessage(this.messages, userMessage(this.nextId++, question));
    this.scrollToBottom();
    await this.dispatch(this.messages.length - 1);
  }

  /** 发送/重试共用：userMessageIndex 是本次问题所在的消息下标，其之前的内容作为历史。 */
  private async dispatch(userMessageIndex: number): Promise<void> {
    const question: string = this.messages[userMessageIndex].text;
    const history: KnowledgeChatMessage[] = this.buildHistory(userMessageIndex);
    const generation: number = this.generation;
    const pendingId: number = this.nextId++;
    this.sending = true;
    // 回答插在问题之后（而不是追加到末尾）：旧问题重试不会打乱后续问答顺序。
    this.messages = insertAfterUser(this.messages, userMessageIndex, pendingMessage(pendingId));
    this.scrollToBottom();
    try {
      const data: KnowledgeChatData = await KnowledgeService.sendChat(question, history);
      if (generation !== this.generation) {
        return;
      }
      this.messages = replaceMessageById(this.messages, pendingId, responseMessage(pendingId, data));
      this.scrollToBottom();
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) {
        this.generation += 1;
        this.messages = [];
        this.sending = false;
        this.onSessionExpired();
        return;
      }
      const apiError: ApiRequestError | null = error instanceof ApiRequestError ? error : null;
      const errorCode: string = apiError !== null ? apiError.code : 'UNKNOWN';
      const errorMessage: string = apiError !== null ? apiError.message : '请求失败，请重试';
      this.messages = replaceMessageById(
        this.messages,
        pendingId,
        // 网络错误与业务错误分开展示：网络错误补一句排查引导，业务错误直接用后端信封文案。
        failedMessage(
          pendingId,
          errorCode,
          isNetworkErrorCode(errorCode) ? `${errorMessage}（请检查服务器地址、网络与后端是否已启动）` : errorMessage
        )
      );
      this.scrollToBottom();
    } finally {
      if (generation === this.generation) {
        this.sending = false;
      }
    }
  }

  /** 重试：去掉失败的助手消息，用原问题重发；用户消息不重复插入。 */
  private async retry(failedId: number): Promise<void> {
    if (this.sending) {
      return;
    }
    const userIndex: number = retryUserIndex(this.messages, failedId);
    if (userIndex < 0) {
      return;
    }
    this.messages = removeMessageById(this.messages, failedId);
    await this.dispatch(userIndex);
  }

  private clearChat(): void {
    this.generation += 1;
    this.messages = [];
    this.inputText = '';
    this.sending = false;
  }

  private openCitation(citation: KnowledgeCitation): void {
    const param: KnowledgeSourceParam = { sourceId: citation.sourceId, title: citation.title };
    this.pusher.push(this.pathStack, ROUTE_KNOWLEDGE_SOURCE, param);
  }

  @Builder
  emptyState() {
    Column({ space: GAP_SM }) {
      Text('有出处的维修知识问答')
        .fontSize(FONT_HEADING)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.text_primary'))
      Text('回答依据当前账号可访问的资料，并给出可打开的引用；资料不足时会追问或说明。')
        .fontSize(FONT_TEXT)
        .fontColor($r('app.color.text_secondary'))
      Text('试试这样问：')
        .fontSize(FONT_NOTE)
        .fontColor($r('app.color.text_secondary'))
        .margin({ top: GAP_SM })
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(EXAMPLE_QUESTIONS, (question: string) => {
          Text(question)
            .fontSize(FONT_NOTE)
            .fontColor($r('app.color.brand'))
            .padding({ left: CARD_GAP, right: CARD_GAP, top: GAP_SM, bottom: GAP_SM })
            .margin({ right: GAP_SM, bottom: GAP_SM })
            .backgroundColor($r('app.color.field_bg'))
            .borderRadius(CONTROL_RADIUS)
            .onClick(() => {
              this.inputText = question;
            })
        }, (question: string) => question)
      }
      .width('100%')
    }
    .width('100%')
    .padding(CARD_PADDING)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
  }

  @Builder
  citationCard(citation: KnowledgeCitation) {
    Column({ space: GAP_XS }) {
      Text(`[${citation.label}] ${citation.docTitle}`)
        .fontSize(FONT_TEXT)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.text_primary'))
      Text(headingTrailText(citation.headingPath))
        .fontSize(FONT_CHIP)
        .fontColor($r('app.color.text_secondary'))
      Text(citation.snippet)
        .fontSize(FONT_CHIP)
        .fontColor($r('app.color.text_secondary'))
        .maxLines(3)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Text('查看引用原文 >')
        .fontSize(FONT_CHIP)
        .fontColor($r('app.color.brand'))
        .margin({ top: 2 })
    }
    .width('100%')
    .padding(CARD_PADDING_SM)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.start_window_background'))
    .borderRadius(CONTROL_RADIUS)
    .onClick(() => {
      this.openCitation(citation);
    })
  }

  @Builder
  messageBubble(message: ChatMessage) {
    if (message.role === ROLE_USER) {
      Row() {
        Text(message.text)
          .fontSize(FONT_BODY)
          .fontColor(Color.White)
          .padding(CARD_PADDING_SM)
          .backgroundColor($r('app.color.brand'))
          .borderRadius(CARD_RADIUS)
      }
      .width('100%')
      .justifyContent(FlexAlign.End)
    } else {
      Column({ space: GAP_SM }) {
        if (message.status === STATUS_PENDING) {
          Row({ space: GAP_SM }) {
            LoadingProgress().width(20).height(20)
            Text('正在检索资料并生成回答…')
              .fontSize(FONT_TEXT)
              .fontColor($r('app.color.text_secondary'))
          }
        } else if (message.status === STATUS_FAILED) {
          // 失败卡复用统一错误面板：错误信息 + 重试；是否包卡片底色由外层气泡决定。
          ErrorPanel({
            message: message.errorMessage,
            onRetry: (): void => {
              this.retry(message.id);
            }
          })
        } else {
          if (message.kind === KIND_CLARIFY) {
            Text('需要补充信息：')
              .fontSize(FONT_NOTE)
              .fontColor($r('app.color.brand'))
          }
          if (message.kind === KIND_INSUFFICIENT) {
            Text('资料不足')
              .fontSize(FONT_NOTE)
              .fontColor($r('app.color.brand'))
          }
          if (message.text !== '') {
            Text(message.text)
              .fontSize(FONT_BODY)
              .fontColor($r('app.color.text_primary'))
          }
          // 空数据引导：资料不足 / 追问时没有正文，给出下一步可做的事，不留空白。
          if (message.kind === KIND_INSUFFICIENT) {
            Text(INSUFFICIENT_HINT)
              .fontSize(FONT_CHIP)
              .fontColor($r('app.color.text_secondary'))
          } else if (message.kind === KIND_CLARIFY) {
            Text(CLARIFY_HINT)
              .fontSize(FONT_CHIP)
              .fontColor($r('app.color.text_secondary'))
          }
          if (message.degradationMessage !== '') {
            Text(`本次为关键词检索：${message.degradationMessage}`)
              .fontSize(FONT_CHIP)
              .fontColor($r('app.color.text_secondary'))
          }
          if (message.citations.length > 0) {
            Text('来源')
              .fontSize(FONT_NOTE)
              .fontWeight(FontWeight.Medium)
              .fontColor($r('app.color.text_secondary'))
            ForEach(message.citations, (citation: KnowledgeCitation) => {
              this.citationCard(citation);
            }, (citation: KnowledgeCitation) => citation.sourceId)
          }
        }
      }
      .width('100%')
      .padding(CARD_PADDING_SM)
      .alignItems(HorizontalAlign.Start)
      .backgroundColor($r('app.color.surface'))
      .borderRadius(CARD_RADIUS)
    }
  }

  build() {
    Column({ space: CARD_GAP }) {
      // 标题在 NavDestination 标题栏；这里只放对话工具行（清空）。
      Row() {
        Blank()
        Button('清空本次对话')
          .height(CONTROL_HEIGHT_SM)
          .fontSize(FONT_NOTE)
          .backgroundColor($r('app.color.surface'))
          .fontColor($r('app.color.text_secondary'))
          .enabled(this.messages.length > 0)
          .onClick(() => {
            this.clearChat();
          })
      }
      .width('100%')

      List({ space: CARD_GAP, scroller: this.scroller }) {
        if (this.messages.length === 0) {
          ListItem() {
            this.emptyState();
          }
        }
        ForEach(this.messages, (message: ChatMessage) => {
          ListItem() {
            this.messageBubble(message);
          }
        // 消息按不可变对象替换。状态变化时重建气泡，否则 ForEach 复用旧的 pending 构建结果。
        }, (message: ChatMessage) => message.id.toString() + ':' + message.status)
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Auto)

      Row({ space: GAP_SM }) {
        TextInput({ text: this.inputText, placeholder: '描述故障或提问，支持多轮追问' })
          .layoutWeight(1)
          .height(CONTROL_HEIGHT)
          .fontSize(FONT_BODY)
          .backgroundColor($r('app.color.surface'))
          .borderRadius(CONTROL_RADIUS)
          .enterKeyType(EnterKeyType.Send)
          .onChange((value: string) => {
            this.inputText = value;
          })
          .onSubmit(() => {
            this.send();
          })
        Button() {
          Row({ space: GAP_SM }) {
            if (this.sending) {
              LoadingProgress()
                .width(18)
                .height(18)
                .color(Color.White)
            }
            Text(this.sending ? '发送中…' : '发送')
              .fontSize(FONT_BODY)
              .fontColor(Color.White)
          }
        }
        .height(CONTROL_HEIGHT)
        .backgroundColor($r('app.color.brand'))
        .enabled(!this.sending && this.inputText.trim() !== '')
        .onClick(() => {
          this.send();
        })
      }
      .width('100%')
    }
    .width('100%')
    .height('100%')
    .padding(PAGE_PADDING)
    .backgroundColor($r('app.color.start_window_background'))
  }
}
