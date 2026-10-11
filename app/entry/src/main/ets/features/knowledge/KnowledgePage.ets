import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ROUTE_KNOWLEDGE_SOURCE } from '../../core/ui/Routes';
import { CARD_RADIUS, CONTROL_HEIGHT, CONTROL_RADIUS, PAGE_PADDING } from '../../core/ui/Theme';
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
import { KnowledgeService } from './KnowledgeService';

const ROLE_USER: string = 'user';
const ROLE_ASSISTANT: string = 'assistant';
const STATUS_DONE: string = 'done';
const STATUS_PENDING: string = 'pending';
const STATUS_FAILED: string = 'failed';

const KIND_ANSWER: string = 'answer';
const KIND_CLARIFY: string = 'clarify';
const KIND_INSUFFICIENT: string = 'insufficient_evidence';

/** 单条消息的完整状态：失败与重试所需的信息都挂在消息上，重试不重复插入用户消息。 */
interface ChatMessage {
  id: number;
  role: string;
  text: string;
  status: string;
  kind: string;
  citations: KnowledgeCitation[];
  retrievalMode: string;
  degradationMessage: string;
  errorCode: string;
  errorMessage: string;
}

const EXAMPLE_QUESTIONS: string[] = [
  '校园网认证失败怎么办？',
  '开机黑屏怎么排查？',
  'CrystalDiskInfo 怎么看硬盘健康状态？'
];

/**
 * 知识问答页：客户与工作人员共用，资料范围由服务端按角色过滤。
 *
 * - 本次对话只保存在页面内存；离开问答功能、清空或退出登录即清除（实例随导航销毁）；
 * - 发送中防重复；失败保留问题可重试；异步返回带代次校验，清空后的旧响应不会恢复旧消息；
 * - 会话过期交给上层（onSessionExpired → 现有退出/回登录流程）。
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
    this.messages.push({
      id: this.nextId++,
      role: ROLE_USER,
      text: question,
      status: STATUS_DONE,
      kind: '',
      citations: [],
      retrievalMode: '',
      degradationMessage: '',
      errorCode: '',
      errorMessage: ''
    });
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
    this.messages.push({
      id: pendingId,
      role: ROLE_ASSISTANT,
      text: '',
      status: STATUS_PENDING,
      kind: '',
      citations: [],
      retrievalMode: '',
      degradationMessage: '',
      errorCode: '',
      errorMessage: ''
    });
    this.scrollToBottom();
    try {
      const data: KnowledgeChatData = await KnowledgeService.sendChat(question, history);
      if (generation !== this.generation) {
        return;
      }
      this.applyResponse(pendingId, data);
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
      this.applyFailure(pendingId, apiError);
    } finally {
      if (generation === this.generation) {
        this.sending = false;
      }
    }
  }

  private applyResponse(pendingId: number, data: KnowledgeChatData): void {
    const index: number = this.messages.findIndex((message: ChatMessage) => message.id === pendingId);
    if (index < 0) {
      return;
    }
    let text: string = '';
    if (data.status === KIND_CLARIFY) {
      text = data.clarifyingQuestion !== null ? data.clarifyingQuestion : '';
    } else {
      text = data.answer !== null ? data.answer : '';
    }
    this.messages.splice(index, 1, {
      id: pendingId,
      role: ROLE_ASSISTANT,
      text: text,
      status: STATUS_DONE,
      kind: data.status,
      citations: data.citations,
      retrievalMode: data.retrievalMode,
      degradationMessage: data.degradation !== null ? data.degradation.message : '',
      errorCode: '',
      errorMessage: ''
    });
    this.scrollToBottom();
  }

  private applyFailure(pendingId: number, apiError: ApiRequestError | null): void {
    const index: number = this.messages.findIndex((message: ChatMessage) => message.id === pendingId);
    if (index < 0) {
      return;
    }
    this.messages.splice(index, 1, {
      id: pendingId,
      role: ROLE_ASSISTANT,
      text: '',
      status: STATUS_FAILED,
      kind: '',
      citations: [],
      retrievalMode: '',
      degradationMessage: '',
      errorCode: apiError !== null ? apiError.code : 'UNKNOWN',
      errorMessage: apiError !== null ? apiError.message : '请求失败，请重试'
    });
    this.scrollToBottom();
  }

  /** 重试：去掉失败的助手消息，用原问题重发；用户消息不重复插入。 */
  private async retry(failedId: number): Promise<void> {
    if (this.sending) {
      return;
    }
    const index: number = this.messages.findIndex((message: ChatMessage) => message.id === failedId);
    if (index < 1) {
      return;
    }
    const userMessage: ChatMessage = this.messages[index - 1];
    if (userMessage.role !== ROLE_USER) {
      return;
    }
    this.messages.splice(index, 1);
    await this.dispatch(index - 1);
  }

  private clearChat(): void {
    this.generation += 1;
    this.messages = [];
    this.inputText = '';
    this.sending = false;
  }

  private openCitation(citation: KnowledgeCitation): void {
    const param: KnowledgeSourceParam = { sourceId: citation.sourceId, title: citation.title };
    this.pathStack.pushPathByName(ROUTE_KNOWLEDGE_SOURCE, param);
  }

  @Builder
  emptyState() {
    Column({ space: 10 }) {
      Text('有出处的维修知识问答')
        .fontSize(18)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.text_primary'))
      Text('回答只依据电脑医院公开文档，并给出可打开的引用；资料不足时会追问或说明。')
        .fontSize(14)
        .fontColor($r('app.color.text_secondary'))
      Text('试试这样问：')
        .fontSize(13)
        .fontColor($r('app.color.text_secondary'))
        .margin({ top: 6 })
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(EXAMPLE_QUESTIONS, (question: string) => {
          Text(question)
            .fontSize(13)
            .fontColor($r('app.color.brand'))
            .padding({ left: 12, right: 12, top: 8, bottom: 8 })
            .margin({ right: 8, bottom: 8 })
            .backgroundColor($r('app.color.surface'))
            .borderRadius(CONTROL_RADIUS)
            .onClick(() => {
              this.inputText = question;
            })
        }, (question: string) => question)
      }
      .width('100%')
    }
    .width('100%')
    .padding(16)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
  }

  @Builder
  citationCard(citation: KnowledgeCitation, index: number) {
    Column({ space: 4 }) {
      Text(`[${index + 1}] ${citation.docTitle}`)
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.text_primary'))
      Text(headingTrailText(citation.headingPath))
        .fontSize(12)
        .fontColor($r('app.color.text_secondary'))
      Text(citation.snippet)
        .fontSize(12)
        .fontColor($r('app.color.text_secondary'))
        .maxLines(3)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Text('查看引用原文 >')
        .fontSize(12)
        .fontColor($r('app.color.brand'))
        .margin({ top: 2 })
    }
    .width('100%')
    .padding(10)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.start_window_background'))
    .borderRadius(10)
    .onClick(() => {
      this.openCitation(citation);
    })
  }

  @Builder
  messageBubble(message: ChatMessage) {
    if (message.role === ROLE_USER) {
      Row() {
        Text(message.text)
          .fontSize(15)
          .fontColor(Color.White)
          .padding(12)
          .backgroundColor($r('app.color.brand'))
          .borderRadius(CARD_RADIUS)
      }
      .width('100%')
      .justifyContent(FlexAlign.End)
    } else {
      Column({ space: 8 }) {
        if (message.status === STATUS_PENDING) {
          Row({ space: 8 }) {
            LoadingProgress().width(20).height(20)
            Text('正在检索资料并生成回答…')
              .fontSize(14)
              .fontColor($r('app.color.text_secondary'))
          }
        } else if (message.status === STATUS_FAILED) {
          Text(message.errorMessage)
            .fontSize(14)
            .fontColor($r('app.color.danger'))
          Button('重试')
            .height(34)
            .fontSize(14)
            .backgroundColor($r('app.color.brand'))
            .onClick(() => {
              this.retry(message.id);
            })
        } else {
          if (message.kind === KIND_CLARIFY) {
            Text('需要补充信息：')
              .fontSize(13)
              .fontColor($r('app.color.brand'))
          }
          if (message.kind === KIND_INSUFFICIENT) {
            Text('资料不足')
              .fontSize(13)
              .fontColor($r('app.color.brand'))
          }
          if (message.text !== '') {
            Text(message.text)
              .fontSize(15)
              .fontColor($r('app.color.text_primary'))
          }
          if (message.degradationMessage !== '') {
            Text(`本次为关键词检索：${message.degradationMessage}`)
              .fontSize(12)
              .fontColor($r('app.color.text_secondary'))
          }
          if (message.citations.length > 0) {
            Text('来源')
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor($r('app.color.text_secondary'))
            ForEach(message.citations, (citation: KnowledgeCitation, index: number) => {
              this.citationCard(citation, index);
            }, (citation: KnowledgeCitation) => citation.sourceId)
          }
        }
      }
      .width('100%')
      .padding(12)
      .alignItems(HorizontalAlign.Start)
      .backgroundColor($r('app.color.surface'))
      .borderRadius(CARD_RADIUS)
    }
  }

  build() {
    Column({ space: 10 }) {
      Row() {
        Text('知识问答')
          .fontSize(22)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.text_primary'))
        Blank()
        Button('清空本次对话')
          .height(34)
          .fontSize(13)
          .backgroundColor($r('app.color.surface'))
          .fontColor($r('app.color.text_secondary'))
          .enabled(this.messages.length > 0)
          .onClick(() => {
            this.clearChat();
          })
      }
      .width('100%')

      List({ space: 10, scroller: this.scroller }) {
        if (this.messages.length === 0) {
          ListItem() {
            this.emptyState();
          }
        }
        ForEach(this.messages, (message: ChatMessage) => {
          ListItem() {
            this.messageBubble(message);
          }
        }, (message: ChatMessage) => message.id.toString())
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Auto)

      Row({ space: 8 }) {
        TextInput({ text: this.inputText, placeholder: '描述故障或提问，支持多轮追问' })
          .layoutWeight(1)
          .height(CONTROL_HEIGHT)
          .fontSize(15)
          .backgroundColor($r('app.color.surface'))
          .borderRadius(CONTROL_RADIUS)
          .enterKeyType(EnterKeyType.Send)
          .onChange((value: string) => {
            this.inputText = value;
          })
          .onSubmit(() => {
            this.send();
          })
        Button(this.sending ? '发送中…' : '发送')
          .height(CONTROL_HEIGHT)
          .fontSize(15)
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
