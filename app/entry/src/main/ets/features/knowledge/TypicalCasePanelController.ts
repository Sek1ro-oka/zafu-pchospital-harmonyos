// 典型面板的写动作编排（无 ArkUI / 无网络依赖，依赖注入，可被回归用例执行真实路径）。
//
// 两个独立代次：
// - generation（读取代次）：由 load 推进，保护「数据写回」——切备案或刷新后旧响应不得写回视图；
// - actionSeq（写动作代次）：由每个写动作开始时推进，保护 busy 的归属——409 冲突触发的刷新
//   会推进读取代次，但收尾仍属于该写动作，必须能正常结束 busy；A 的迟到请求也不能
//   清除已切到 B（或 B 上新动作）的 busy。

import {
  RecordCaseProcessingView,
  RecordCaseRetryResult,
} from './KnowledgeCaseContract';
import { isActionContextCurrent, isActionRunCurrent, typicalPanelModel, TypicalPanelModel } from './KnowledgeCaseFlow';

/** 错误归一化视图：登录失效（全局处理）、服务端错误码与原文消息。 */
export interface PanelErrorView {
  sessionExpired: boolean;
  code: string | null;
  message: string;
}

/** 面板可见状态的回写钩子（由宿主组件把值落到自己的 @State 字段）。 */
export class TypicalPanelHooks {
  loading: (value: boolean) => void = (): void => {};
  loadFailed: (value: boolean, text: string) => void = (): void => {};
  appliedView: (view: RecordCaseProcessingView, model: TypicalPanelModel) => void = (): void => {};
  busy: (value: boolean) => void = (): void => {};
  actionError: (text: string) => void = (): void => {};
  notice: (text: string) => void = (): void => {};
  changed: () => void = (): void => {};
  sessionExpired: () => void = (): void => {};
}

/** 面板依赖的网络能力（宿主注入真实服务；回归用例注入桩）。 */
export class TypicalPanelDeps {
  readonly recordStatus: (recordId: string) => Promise<RecordCaseProcessingView>;
  readonly markTypical: (recordId: string) => Promise<RecordCaseProcessingView>;
  readonly retryProcessing: (recordId: string) => Promise<RecordCaseRetryResult>;
  readonly unmarkTypical: (recordId: string) => Promise<RecordCaseProcessingView>;
  readonly describeError: (error: Object) => PanelErrorView;

  constructor(
    recordStatus: (recordId: string) => Promise<RecordCaseProcessingView>,
    markTypical: (recordId: string) => Promise<RecordCaseProcessingView>,
    retryProcessing: (recordId: string) => Promise<RecordCaseRetryResult>,
    unmarkTypical: (recordId: string) => Promise<RecordCaseProcessingView>,
    describeError: (error: Object) => PanelErrorView,
  ) {
    this.recordStatus = recordStatus;
    this.markTypical = markTypical;
    this.retryProcessing = retryProcessing;
    this.unmarkTypical = unmarkTypical;
    this.describeError = describeError;
  }
}

export class TypicalCasePanelController {
  private readonly deps: TypicalPanelDeps;
  private readonly hooks: TypicalPanelHooks;
  private recordId: string = '';
  private generation: number = 0;
  private actionSeq: number = 0;
  private busy: boolean = false;

  constructor(deps: TypicalPanelDeps, hooks: TypicalPanelHooks) {
    this.deps = deps;
    this.hooks = hooks;
  }

  /** 进入/切换备案：重置忙碌与提示，并让在途写操作的结果失效（load 会推进读取代次）。 */
  setRecord(recordId: string): void {
    this.recordId = recordId;
    this.busy = false;
    this.hooks.busy(false);
    this.hooks.actionError('');
    this.hooks.notice('');
    if (recordId !== '') {
      this.load();
    } else {
      this.hooks.loading(false);
    }
  }

  async load(): Promise<void> {
    if (this.recordId === '') {
      this.hooks.loading(false);
      return;
    }
    this.generation = this.generation + 1;
    const generation: number = this.generation;
    this.hooks.loading(true);
    this.hooks.loadFailed(false, '');
    try {
      const view: RecordCaseProcessingView = await this.deps.recordStatus(this.recordId);
      if (generation !== this.generation) {
        return;
      }
      this.applyView(view);
      this.hooks.loading(false);
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      this.hooks.loading(false);
      const info: PanelErrorView = this.deps.describeError(error as Object);
      if (info.sessionExpired) {
        this.hooks.sessionExpired();
        return;
      }
      this.hooks.loadFailed(true, info.message !== '' ? info.message : '加载案例状态失败');
    }
  }

  async runMark(): Promise<void> {
    if (this.busy || this.recordId === '') {
      return;
    }
    const recordId: string = this.recordId;
    const generation: number = this.generation;
    const actionSeq: number = this.beginAction();
    try {
      const view: RecordCaseProcessingView = await this.deps.markTypical(recordId);
      if (!this.canWriteBack(recordId, generation)) {
        return;
      }
      this.applyView(view);
      if (view.status === 'PUBLISHED') {
        this.hooks.notice('已整理入库，可被检索命中。');
      } else if (view.status === 'FAILED' && view.failureMessage !== null) {
        this.hooks.actionError(view.failureMessage);
      }
      this.hooks.changed();
    } catch (error) {
      await this.handleActionError(recordId, generation, error as Object, '标记失败，请重试');
    } finally {
      this.finishAction(recordId, actionSeq);
    }
  }

  async runRetry(): Promise<void> {
    if (this.busy || this.recordId === '') {
      return;
    }
    const recordId: string = this.recordId;
    const generation: number = this.generation;
    const actionSeq: number = this.beginAction();
    try {
      const result: RecordCaseRetryResult = await this.deps.retryProcessing(recordId);
      if (!this.canWriteBack(recordId, generation)) {
        return;
      }
      this.applyView(result.state);
      if (result.state.status === 'PUBLISHED') {
        this.hooks.notice('已重新入库。');
      } else if (result.state.failureMessage !== null && result.state.failureMessage !== '') {
        this.hooks.actionError(result.state.failureMessage);
      }
      this.hooks.changed();
    } catch (error) {
      await this.handleActionError(recordId, generation, error as Object, '重试失败，请重试');
    } finally {
      this.finishAction(recordId, actionSeq);
    }
  }

  async runUnmark(recordId: string): Promise<void> {
    if (this.busy || recordId !== this.recordId) {
      return;
    }
    const generation: number = this.generation;
    const actionSeq: number = this.beginAction();
    try {
      const view: RecordCaseProcessingView = await this.deps.unmarkTypical(recordId);
      if (!this.canWriteBack(recordId, generation)) {
        return;
      }
      this.applyView(view);
      this.hooks.notice('已取消典型标记。');
      this.hooks.changed();
    } catch (error) {
      await this.handleActionError(recordId, generation, error as Object, '取消失败，请重试');
    } finally {
      this.finishAction(recordId, actionSeq);
    }
  }

  private beginAction(): number {
    this.actionSeq = this.actionSeq + 1;
    this.busy = true;
    this.hooks.busy(true);
    this.hooks.actionError('');
    this.hooks.notice('');
    return this.actionSeq;
  }

  private applyView(view: RecordCaseProcessingView): void {
    this.hooks.appliedView(view, typicalPanelModel(view));
  }

  private canWriteBack(recordId: string, generation: number): boolean {
    return isActionContextCurrent(this.recordId, this.generation, recordId, generation);
  }

  private async handleActionError(
    recordId: string,
    generation: number,
    error: Object,
    fallback: string,
  ): Promise<void> {
    const info: PanelErrorView = this.deps.describeError(error);
    if (info.sessionExpired) {
      // 会话失效是全局的：无论面板切到哪条备案都要回登录。
      this.hooks.sessionExpired();
      return;
    }
    if (!this.canWriteBack(recordId, generation)) {
      return;
    }
    this.hooks.actionError(info.code !== null ? info.message : fallback);
    // 409 冲突（如别人先取消、案例已撤回）：刷新拿最新真实状态，按钮不留在旧状态。
    // 刷新推进读取代次，但收尾的 busy 清除由写动作代次负责（见 finishAction）。
    if (info.code === 'CASE_STATE_CONFLICT' || info.code === 'CASE_VERSION_CONFLICT') {
      await this.load();
    }
  }

  private finishAction(recordId: string, actionSeq: number): void {
    if (isActionRunCurrent(this.recordId, this.actionSeq, recordId, actionSeq)) {
      this.busy = false;
      this.hooks.busy(false);
    }
  }
}
