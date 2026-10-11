import { util } from '@kit.ArkTS';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ROUTE_STAFF_RECORD } from '../../core/ui/Routes';
import { CARD_RADIUS, CONTROL_HEIGHT, CONTROL_RADIUS, PAGE_PADDING } from '../../core/ui/Theme';
import { formatOrderTime, repairOrderStatusLabel, RepairOrderEventView } from './RepairOrderContract';
import {
  StaffOrderParam,
  StaffRecordParam,
  StaffRepairOrderView,
  recordSummaryLabel,
} from './StaffRepairContract';
import { StaffRepairOrderService } from './StaffRepairOrderService';

/**
 * 报修详情（工作人员视角，Issue #38）。
 *
 * - 受理、开始处理、完成、取消与建档按钮来自服务端计算的 `actions`；
 * - 抢单冲突/状态冲突（409）提示后自动刷新当前状态，不覆盖他人的受理结果；
 * - 处理状态与备案状态分开展示；完成后仍可补备案（两套状态独立）。
 */
@Component
export struct StaffRepairOrderDetailPage {
  pathStack: NavPathStack = new NavPathStack();
  param: StaffOrderParam = { orderId: '' };
  onSessionExpired: () => void = () => {
  };
  @State order: StaffRepairOrderView | null = null;
  @State loading: boolean = true;
  @State errorText: string = '';
  @State actionBusy: boolean = false;
  @State actionError: string = '';
  @State cancelOpen: boolean = false;
  @State cancelNote: string = '';
  @State noticeText: string = '';
  /** 备案页保存/提交后自增本键（AppStorage 广播），本页监听刷新备案摘要。 */
  @StorageLink('staffRecordRevision') @Watch('onRecordRevision') recordRevision: number = 0;
  private generation: number = 0;
  /** 建档幂等键：重复点击或网络重试复用，服务端据此返回同一份草稿。 */
  private recordKey: string = '';

  aboutToAppear(): void {
    this.recordKey = `app-record-${util.generateRandomUUID(true)}`;
    this.fetchDetail();
  }

  /** 备案页保存/提交后（本页仍在导航栈中）刷新备案摘要。 */
  private onRecordRevision(): void {
    this.fetchDetail();
  }

  private async fetchDetail(): Promise<void> {
    if (this.param.orderId === '') {
      this.loading = false;
      this.errorText = '缺少报修单编号';
      return;
    }
    this.generation = this.generation + 1;
    const generation = this.generation;
    this.loading = true;
    this.errorText = '';
    try {
      const view = await StaffRepairOrderService.detail(this.param.orderId);
      if (generation !== this.generation) {
        return;
      }
      this.order = view;
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
      this.errorText = error instanceof ApiRequestError ? error.message : '加载详情失败';
    }
  }

  /** 动作失败的统一处理：冲突类刷新当前状态，权限类只提示。 */
  private handleActionError(error: Object): void {
    if (error instanceof ApiRequestError) {
      if (isSessionExpiredCode(error.code)) {
        this.onSessionExpired();
        return;
      }
      this.actionError = error.message;
      if (error.code === 'REPAIR_ORDER_STATE_CONFLICT' || error.code === 'REPAIR_ORDER_STATE_INVALID') {
        this.fetchDetail();
      }
      return;
    }
    this.actionError = '操作失败，请重试';
  }

  private async runAccept(): Promise<void> {
    await this.runAction(async () => {
      this.order = await StaffRepairOrderService.accept(this.param.orderId, '');
      this.noticeText = '受理成功，你已成为该单的受理人。';
      this.cancelOpen = false;
    });
  }

  private async runProgress(toStatus: string, okText: string): Promise<void> {
    await this.runAction(async () => {
      this.order = await StaffRepairOrderService.progress(this.param.orderId, toStatus, '');
      this.noticeText = okText;
    });
  }

  private async runCancel(): Promise<void> {
    const note = this.cancelNote.trim();
    if (note === '') {
      this.actionError = '取消必须填写说明';
      return;
    }
    await this.runAction(async () => {
      this.order = await StaffRepairOrderService.cancel(this.param.orderId, note);
      this.noticeText = '已取消该报修单。';
      this.cancelOpen = false;
      this.cancelNote = '';
    });
  }

  private async runAction(action: () => Promise<void>): Promise<void> {
    if (this.actionBusy) {
      return;
    }
    this.actionBusy = true;
    this.actionError = '';
    this.noticeText = '';
    try {
      await action();
    } catch (error) {
      this.handleActionError(error);
    } finally {
      this.actionBusy = false;
    }
  }

  /** 建档或继续备案：已有备案直接打开；没有则先建立关联草稿再打开。 */
  private async openRecord(): Promise<void> {
    const current = this.order;
    if (current === null) {
      return;
    }
    if (current.record !== null) {
      this.pushRecord(current.record.id);
      return;
    }
    await this.runAction(async () => {
      const created = await StaffRepairOrderService.createRecord(this.param.orderId, this.recordKey);
      // 建档成功换新键：下一次建档（理论上不会发生）是新请求。
      this.recordKey = `app-record-${util.generateRandomUUID(true)}`;
      await this.fetchDetail();
      this.pushRecord(created.id);
    });
  }

  private pushRecord(recordId: string): void {
    const param: StaffRecordParam = {
      recordId: recordId,
      faultDescription: this.order === null ? '' : this.order.faultDescription
    };
    this.pathStack.pushPathByName(ROUTE_STAFF_RECORD, param);
  }

  @Builder
  chip(text: string, emphasized: boolean) {
    Text(text)
      .fontSize(12)
      .fontColor(emphasized ? Color.White : $r('app.color.text_primary'))
      .padding({ left: 8, right: 8, top: 3, bottom: 3 })
      .backgroundColor(emphasized ? $r('app.color.brand') : $r('app.color.field_bg'))
      .borderRadius(8)
  }

  @Builder
  detailRow(label: string, value: string) {
    Row({ space: 12 }) {
      Text(label)
        .fontSize(13)
        .fontColor($r('app.color.text_secondary'))
        .width(88)
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
  timelineEvent(status: string, note: string | null, createdAt: string) {
    Row({ space: 10 }) {
      Text('●')
        .fontSize(10)
        .fontColor($r('app.color.brand'))
      Column({ space: 4 }) {
        Text(repairOrderStatusLabel(status))
          .fontSize(14)
          .fontColor($r('app.color.text_primary'))
          .width('100%')
          .textAlign(TextAlign.Start)
        if (note !== null && note !== '') {
          Text(note)
            .fontSize(13)
            .fontColor($r('app.color.text_secondary'))
            .width('100%')
            .textAlign(TextAlign.Start)
        }
        Text(formatOrderTime(createdAt))
          .fontSize(12)
          .fontColor($r('app.color.text_secondary'))
          .width('100%')
          .textAlign(TextAlign.Start)
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  @Builder
  actionButton(text: string, enabled: boolean, danger: boolean, action: () => void) {
    Button(this.actionBusy ? '处理中…' : text)
      .width('100%')
      .height(CONTROL_HEIGHT)
      .fontSize(16)
      .backgroundColor(danger ? $r('app.color.danger') : $r('app.color.brand'))
      .fontColor(Color.White)
      .enabled(enabled && !this.actionBusy)
      .onClick(action)
  }

  @Builder
  secondaryButton(text: string, action: () => void) {
    Button(this.actionBusy ? '处理中…' : text)
      .width('100%')
      .height(CONTROL_HEIGHT)
      .fontSize(16)
      .backgroundColor($r('app.color.brand_soft'))
      .fontColor($r('app.color.brand'))
      .enabled(!this.actionBusy)
      .onClick(action)
  }

  @Builder
  actionsView(order: StaffRepairOrderView) {
    Column({ space: 10 }) {
      Text('可执行操作')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.text_primary'))
        .width('100%')
        .textAlign(TextAlign.Start)

      if (order.actions.canAccept) {
        this.actionButton('受理此单', true, false, () => {
          this.runAccept();
        })
      }
      if (order.actions.canStartRepair) {
        this.actionButton('开始处理', true, false, () => {
          this.runProgress('REPAIRING', '已开始处理。');
        })
      }
      if (order.actions.canComplete) {
        this.actionButton('完成维修', true, false, () => {
          this.runProgress('COMPLETED', '已完成维修处理，可继续补填维修备案。');
        })
      }
      if (order.actions.canCreateRecord) {
        this.secondaryButton('建立维修备案', () => {
          this.openRecord();
        })
      } else if (order.record !== null) {
        this.secondaryButton('查看 / 继续备案', () => {
          this.openRecord();
        })
      }
      if (order.actions.canCancel) {
        if (this.cancelOpen) {
          Column({ space: 8 }) {
            TextArea({ text: this.cancelNote, placeholder: '请填写取消说明（必填）' })
              .height(88)
              .backgroundColor($r('app.color.field_bg'))
              .borderRadius(CONTROL_RADIUS)
              .onChange((next: string) => {
                this.cancelNote = next;
              })
            Row({ space: 10 }) {
              Button(this.actionBusy ? '提交中…' : '确认取消')
                .layoutWeight(1)
                .height(42)
                .fontSize(14)
                .backgroundColor($r('app.color.danger'))
                .fontColor(Color.White)
                .enabled(!this.actionBusy)
                .onClick(() => {
                  this.runCancel();
                })
              Button('收起')
                .layoutWeight(1)
                .height(42)
                .fontSize(14)
                .backgroundColor($r('app.color.field_bg'))
                .fontColor($r('app.color.text_primary'))
                .onClick(() => {
                  this.cancelOpen = false;
                  this.actionError = '';
                })
            }
            .width('100%')
          }
          .width('100%')
        } else {
          this.actionButton('取消报修', true, true, () => {
            this.cancelOpen = true;
            this.actionError = '';
          })
        }
      }

      if (this.actionError !== '') {
        Text(this.actionError)
          .fontSize(13)
          .fontColor($r('app.color.danger'))
          .width('100%')
          .textAlign(TextAlign.Start)
      }
      if (this.noticeText !== '') {
        Text(this.noticeText)
          .fontSize(13)
          .fontColor($r('app.color.ok'))
          .width('100%')
          .textAlign(TextAlign.Start)
      }
      if (!order.actions.canAccept &&
        !order.actions.canStartRepair &&
        !order.actions.canComplete &&
        !order.actions.canCancel &&
        !order.actions.canCreateRecord &&
        order.record === null &&
        this.actionError === '') {
        Text('当前状态没有可执行的操作。')
          .fontSize(13)
          .fontColor($r('app.color.text_secondary'))
          .width('100%')
          .textAlign(TextAlign.Start)
      }
    }
    .width('100%')
    .padding(16)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  detailBody(order: StaffRepairOrderView) {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        Text(order.deviceModel)
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.text_primary'))
          .layoutWeight(1)
          .textAlign(TextAlign.Start)
        this.chip(repairOrderStatusLabel(order.status), true)
      }
      .width('100%')

      Row({ space: 8 }) {
        Text('处理状态')
          .fontSize(13)
          .fontColor($r('app.color.text_secondary'))
        this.chip(repairOrderStatusLabel(order.status), false)
        Text('备案状态')
          .fontSize(13)
          .fontColor($r('app.color.text_secondary'))
        this.chip(recordSummaryLabel(order.record), false)
      }
      .width('100%')

      this.detailRow('设备序列号', order.deviceSerial === null || order.deviceSerial === '' ? '未填写' : order.deviceSerial)
      this.detailRow('联系电话', order.contactPhone)
      this.detailRow('受理人', order.assignee === null ? '尚未受理' : order.assignee.name)
      this.detailRow('提交时间', formatOrderTime(order.createdAt))
      this.detailRow('最近进度', order.lastProgressAt === null ? '无' : formatOrderTime(order.lastProgressAt))
      this.detailRow('故障描述', order.faultDescription)

      this.actionsView(order)

      Column({ space: 10 }) {
        Text('进度时间线')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .width('100%')
          .textAlign(TextAlign.Start)
        if (order.events.length === 0) {
          Text('暂无进度记录')
            .fontSize(13)
            .fontColor($r('app.color.text_secondary'))
            .width('100%')
            .textAlign(TextAlign.Start)
        } else {
          ForEach(order.events, (event: RepairOrderEventView) => {
            this.timelineEvent(event.toStatus, event.note, event.createdAt);
          }, (event: RepairOrderEventView) => event.id)
        }
      }
      .width('100%')
      .padding(16)
      .backgroundColor($r('app.color.surface'))
      .borderRadius(CARD_RADIUS)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Column({ space: 14 }) {
      Row({ space: 12 }) {
        Text('报修详情')
          .fontSize(26)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.text_primary'))
          .layoutWeight(1)
          .textAlign(TextAlign.Start)
        Text('刷新')
          .fontSize(14)
          .fontColor($r('app.color.brand'))
          .onClick(() => {
            this.fetchDetail();
          })
      }
      .width('100%')

      Scroll() {
        Column({ space: 14 }) {
          if (this.loading) {
            Column({ space: 12 }) {
              LoadingProgress()
                .width(32)
                .height(32)
                .color($r('app.color.brand'))
              Text('正在加载详情…')
                .fontSize(13)
                .fontColor($r('app.color.text_secondary'))
            }
            .width('100%')
            .padding(32)
            .justifyContent(FlexAlign.Center)
          } else if (this.errorText !== '') {
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
                  this.fetchDetail();
                })
            }
            .width('100%')
            .padding(32)
            .backgroundColor($r('app.color.surface'))
            .borderRadius(CARD_RADIUS)
            .alignItems(HorizontalAlign.Center)
          } else if (this.order !== null) {
            this.detailBody(this.order);
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
