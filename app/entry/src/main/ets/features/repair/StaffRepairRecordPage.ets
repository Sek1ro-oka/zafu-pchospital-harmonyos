import { util } from '@kit.ArkTS';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ROUTE_CASE_DETAIL } from '../../core/ui/Routes';
import { CARD_RADIUS, CONTROL_HEIGHT, CONTROL_RADIUS, PAGE_PADDING } from '../../core/ui/Theme';
import { CaseDetailParam } from '../knowledge/KnowledgeCaseContract';
import { TypicalCasePanel } from '../knowledge/TypicalCasePanel';
import { PhotoPicker, PickedImage } from './PhotoPicker';
import { PhotoThumb } from './PhotoThumb';
import {
  REPAIR_RECORD_LIMITS,
  RepairCategoryView,
  RepairPhotoView,
  RepairRecordDetailView,
  RepairRecordFields,
  RepairReviewView,
  RepairTimelineView,
  StaffRecordParam,
  repairRecordStatusLabel,
  repairResultLabel,
  repairTimelineEventLabel,
} from './StaffRepairContract';
import { RepairRecordService } from './RepairRecordService';
import { formatOrderTime } from './RepairOrderContract';
import { RecordComments } from './RecordComments';
import { CommunityService } from '../profile/CommunityService';

/** 字段级错误：键与后端 fieldErrors 同名，服务端错误直接落到对应区域。 */
type FieldErrorMap = Record<string, string>;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatDateValue(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${Math.round(mb * 10) / 10} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * 维修备案编辑页（Issue #38）。
 *
 * - 本人视角：草稿/退回可编辑，待审核/已通过只读（保留原 Web 的本人编辑规则）；
 * - 提交审核需要：有效日期、分类、维修内容、维修结果与至少一张真实照片；
 * - 照片走系统相册选择 + multipart 上传 + 鉴权读取；可删除误传照片；
 * - 结果由工作人员在提交前如实选择（不预置「已完成」）；
 * - 版本冲突提示「刷新后重试」，不悄悄覆盖；会话过期交回上层。
 */
@Component
export struct StaffRepairRecordPage {
  param: StaffRecordParam = { recordId: '', faultDescription: '' };
  pathStack: NavPathStack = new NavPathStack();
  onSessionExpired: () => void = () => {
  };
  @State record: RepairRecordDetailView | null = null;
  @State categories: RepairCategoryView[] = [];
  @State loading: boolean = true;
  @State errorText: string = '';
  @State fieldErrors: FieldErrorMap = {};
  @State actionError: string = '';
  @State noticeText: string = '';
  @State favoriting: boolean = false;
  @State saving: boolean = false;
  @State submitting: boolean = false;
  @State uploading: boolean = false;
  @State deletingPhotoId: string = '';
  @State previewPhotoId: string = '';
  // ---- 可编辑字段（进入详情后从服务端值回填） ----
  @State deviceModel: string = '';
  @State ownerName: string = '';
  @State ownerPhone: string = '';
  @State repairDate: string = '';
  @State durationText: string = '';
  @State categoryId: string = '';
  @State content: string = '';
  @State result: string = '';
  @State remark: string = '';
  private generation: number = 0;
  /** 提交幂等键：重试复用同一个，成功后换新。 */
  private submitKey: string = '';
  /** 最近一次加载是否为保留编辑缓冲的局部刷新：加载失败后的重试沿用同一模式。 */
  private lastLoadPreservedEdits: boolean = false;

  aboutToAppear(): void {
    this.submitKey = `app-submit-${util.generateRandomUUID(true)}`;
    this.load();
  }

  /**
   * 加载备案。
   *
   * `preserveEdits` 为 true 时只更新服务端权威状态（照片/状态/版本），
   * 保留页面上尚未保存的编辑缓冲——照片上传/删除后不整表覆盖用户输入。
   */
  private async load(preserveEdits: boolean = false): Promise<void> {
    this.lastLoadPreservedEdits = preserveEdits;
    if (this.param.recordId === '') {
      this.loading = false;
      this.errorText = '缺少备案编号';
      return;
    }
    this.generation = this.generation + 1;
    const generation = this.generation;
    if (!preserveEdits) {
      this.loading = true;
    }
    this.errorText = '';
    try {
      const record = await RepairRecordService.detail(this.param.recordId);
      if (generation !== this.generation) {
        return;
      }
      if (preserveEdits && this.record !== null) {
        this.record = record;
        this.clearFieldError('photos');
      } else {
        this.applyRecord(record);
      }
      if (this.categories.length === 0) {
        const categories = await RepairRecordService.categories();
        if (generation !== this.generation) {
          return;
        }
        this.categories = categories;
      }
      this.loading = false;
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      this.loading = false;
      if (this.isSessionExpired(error)) {
        return;
      }
      this.errorText = error instanceof ApiRequestError ? error.message : '加载备案失败';
    }
  }

  aboutToDisappear(): void { this.generation += 1; }

  private applyRecord(record: RepairRecordDetailView): void {
    this.record = record;
    this.deviceModel = record.deviceModel ?? '';
    this.ownerName = record.ownerName ?? '';
    this.ownerPhone = record.ownerPhone ?? '';
    this.repairDate = record.repairDate === null ? '' : record.repairDate;
    this.durationText = record.durationMinutes === null ? '' : `${record.durationMinutes}`;
    this.categoryId = record.category === null ? '' : record.category.id;
    this.content = record.content === null ? '' : record.content;
    this.result = record.result === null ? '' : record.result;
    this.remark = record.remark === null ? '' : record.remark;
    this.fieldErrors = {};
  }

  /** 打开典型整理生成的关联案例（典型案例面板注入）。 */
  private openCase(caseId: string): void {
    const param: CaseDetailParam = { caseId: caseId, title: '' };
    this.pathStack.pushPathByName(ROUTE_CASE_DETAIL, param);
  }

  /** 保存/提交/上传/删除互斥：任一写操作进行中都不再发起另一个，避免交错请求互相覆盖。 */
  private isBusy(): boolean {
    return this.saving || this.submitting || this.uploading || this.deletingPhotoId !== '';
  }

  private isSessionExpired(error: Object): boolean {
    if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) {
      this.onSessionExpired();
      return true;
    }
    return false;
  }

  private fieldError(name: string): string {
    const value = this.fieldErrors[name];
    return value === undefined ? '' : value;
  }

  private readServerFieldErrors(error: ApiRequestError): FieldErrorMap {
    const raw = error.fieldErrors;
    const result: FieldErrorMap = {};
    if (raw === undefined) {
      return result;
    }
    const keys = Object.keys(raw);
    for (const key of keys) {
      const messages = raw[key];
      if (messages.length > 0) {
        result[key] = messages[0];
      }
    }
    return result;
  }

  /** 提交前的本地检查：与服务端同口径的基本项，减少一次往返。 */
  private localSubmitErrors(): FieldErrorMap {
    const errors: FieldErrorMap = {};
    const date = this.repairDate.trim();
    if (date === '') {
      errors.repairDate = '请填写维修日期';
    } else if (date > shanghaiToday()) {
      errors.repairDate = '维修日期不能晚于今天';
    } else if (date < REPAIR_RECORD_LIMITS.repairDateMin) {
      errors.repairDate = `维修日期不得早于 ${REPAIR_RECORD_LIMITS.repairDateMin}`;
    }
    if (this.categoryId === '') {
      errors.categoryId = '请选择故障分类';
    }
    if (this.content.trim() === '') {
      errors.content = '请填写维修内容';
    }
    if (this.result === '') {
      errors.result = '请选择维修结果';
    }
    if (this.record !== null && this.record.photos.length === 0) {
      errors.photos = '至少上传一张维修照片';
    }
    return errors;
  }

  private durationValue(): number | null {
    const text = this.durationText.trim();
    if (text === '') {
      return null;
    }
    const value = Number(text);
    if (!Number.isInteger(value)) {
      return null;
    }
    return value;
  }

  private buildFields(): RepairRecordFields {
    const date = this.repairDate.trim();
    const duration = this.durationValue();
    return {
      deviceModel: this.deviceModel.trim() || null,
      ownerName: this.ownerName.trim() || null,
      ownerPhone: this.ownerPhone.trim() || null,
      repairDate: date === '' ? null : date,
      durationMinutes: duration,
      categoryId: this.categoryId === '' ? null : this.categoryId,
      content: this.content.trim() === '' ? null : this.content.trim(),
      result: this.result === '' ? null : this.result,
      remark: this.remark.trim() === '' ? null : this.remark.trim()
    };
  }

  private localFieldErrorsForSave(): FieldErrorMap {
    const errors: FieldErrorMap = {};
    const date = this.repairDate.trim();
    if (date !== '' && date > shanghaiToday()) {
      errors.repairDate = '维修日期不能晚于今天';
    }
    const durationText = this.durationText.trim();
    if (durationText !== '') {
      const value = Number(durationText);
      if (
        !Number.isInteger(value) ||
        value < REPAIR_RECORD_LIMITS.durationMinutesMin ||
        value > REPAIR_RECORD_LIMITS.durationMinutesMax
      ) {
        errors.durationMinutes =
          `维修时长须为 ${REPAIR_RECORD_LIMITS.durationMinutesMin}–${REPAIR_RECORD_LIMITS.durationMinutesMax} 分钟`;
      }
    }
    if (this.content.length > REPAIR_RECORD_LIMITS.contentMaxLength) {
      errors.content = `维修内容不能超过 ${REPAIR_RECORD_LIMITS.contentMaxLength} 字`;
    }
    if (this.remark.length > REPAIR_RECORD_LIMITS.remarkMaxLength) {
      errors.remark = `备注不能超过 ${REPAIR_RECORD_LIMITS.remarkMaxLength} 字`;
    }
    return errors;
  }

  private async saveDraft(): Promise<void> {
    const record = this.record;
    if (record === null || this.isBusy()) {
      return;
    }
    const local = this.localFieldErrorsForSave();
    this.fieldErrors = local;
    this.actionError = '';
    this.noticeText = '';
    if (Object.keys(local).length > 0) {
      return;
    }
    this.saving = true;
    try {
      await RepairRecordService.save(record.id, record.version, this.buildFields());
      await this.load();
      this.noticeText = '草稿已保存。';
      this.bumpRecordRevision();
    } catch (error) {
      this.handleWriteError(error, '保存失败，请重试');
    } finally {
      this.saving = false;
    }
  }

  private async submitForReview(): Promise<void> {
    const record = this.record;
    if (record === null || this.isBusy()) {
      return;
    }
    const local = this.localSubmitErrors();
    this.fieldErrors = local;
    this.actionError = '';
    this.noticeText = '';
    if (Object.keys(local).length > 0) {
      return;
    }
    this.submitting = true;
    try {
      // 先保存当前编辑内容，再按保存后的版本提交：避免用户改了字段直接点提交时丢掉修改。
      const saved = await RepairRecordService.save(record.id, record.version, this.buildFields());
      await RepairRecordService.submit(record.id, saved.version, this.submitKey);
      this.submitKey = `app-submit-${util.generateRandomUUID(true)}`;
      await this.load();
      this.noticeText = '已提交审核，等待管理员处理。';
      this.bumpRecordRevision();
    } catch (error) {
      this.handleWriteError(error, '提交失败，请重试');
    } finally {
      this.submitting = false;
    }
  }

  private handleWriteError(error: Object, fallback: string): void {
    if (error instanceof ApiRequestError) {
      if (isSessionExpiredCode(error.code)) {
        this.onSessionExpired();
        return;
      }
      if (error.code === 'REPAIR_VERSION_CONFLICT' || error.code === 'REPAIR_STATE_CONFLICT') {
        this.actionError = `${error.message}（已为你重新加载）`;
        this.load();
        return;
      }
      const serverFields = this.readServerFieldErrors(error);
      this.fieldErrors = serverFields;
      this.actionError = Object.keys(serverFields).length > 0 ? '' : error.message;
      return;
    }
    this.actionError = fallback;
  }

  private async addPhotos(): Promise<void> {
    const record = this.record;
    if (record === null || this.isBusy()) {
      return;
    }
    this.actionError = '';
    this.noticeText = '';
    const remaining = record.photoLimits.maxFiles - record.photos.length;
    if (remaining <= 0) {
      this.actionError = `最多上传 ${record.photoLimits.maxFiles} 张照片。`;
      return;
    }
    const picked = await PhotoPicker.pick(remaining);
    if (picked.length === 0) {
      return;
    }
    const accepted: PickedImage[] = [];
    let unsupported = 0;
    let tooLarge = 0;
    for (const image of picked) {
      if (image.mimeType === '') {
        unsupported++;
        continue;
      }
      if (image.data.byteLength > record.photoLimits.maxBytes) {
        tooLarge++;
        continue;
      }
      accepted.push(image);
    }
    if (unsupported > 0) {
      this.actionError = '仅支持 JPEG、PNG、WebP 图片，已跳过不支持的文件。';
    }
    if (tooLarge > 0) {
      this.actionError =
        `有 ${tooLarge} 张超过单张 ${formatBytes(record.photoLimits.maxBytes)} 的上限，已跳过。`;
    }
    if (accepted.length === 0) {
      return;
    }
    this.uploading = true;
    try {
      await RepairRecordService.uploadPhotos(record.id, accepted);
      await this.load(true);
      this.noticeText = `已上传 ${accepted.length} 张照片。`;
      this.bumpRecordRevision();
    } catch (error) {
      this.handleWriteError(error, '照片上传失败，请重试');
    } finally {
      this.uploading = false;
    }
  }

  private async removePhoto(photoId: string): Promise<void> {
    const record = this.record;
    if (record === null || this.isBusy()) {
      return;
    }
    this.actionError = '';
    this.noticeText = '';
    this.deletingPhotoId = photoId;
    try {
      await RepairRecordService.removePhoto(record.id, photoId);
      await this.load(true);
      this.noticeText = '照片已删除。';
      this.bumpRecordRevision();
    } catch (error) {
      this.handleWriteError(error, '删除照片失败，请重试');
    } finally {
      this.deletingPhotoId = '';
    }
  }

  /** 通知导航栈中可能打开的报修详情页刷新备案摘要（两页互不可见，用共享存储广播）。 */
  private bumpRecordRevision(): void {
    const current = AppStorage.get<number>('staffRecordRevision');
    AppStorage.setOrCreate<number>('staffRecordRevision', (current === undefined ? 0 : current) + 1);
  }

  private openDatePicker(): void {
    let selected = new Date();
    const current = this.repairDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(current)) {
      const parts = current.split('-');
      selected = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    }
    this.getUIContext().showDatePickerDialog({
      start: new Date(2020, 0, 1),
      end: new Date(),
      selected: selected,
      onDateAccept: (value: Date) => {
        this.repairDate = formatDateValue(value);
        this.clearFieldError('repairDate');
      }
    });
  }

  private clearFieldError(name: string): void {
    if (this.fieldErrors[name] === undefined) {
      return;
    }
    const next: FieldErrorMap = {};
    const keys = Object.keys(this.fieldErrors);
    for (const key of keys) {
      if (key !== name) {
        next[key] = this.fieldErrors[key];
      }
    }
    this.fieldErrors = next;
  }

  private latestRejection(): RepairReviewView | null {
    const record = this.record;
    if (record === null) {
      return null;
    }
    let latest: RepairReviewView | null = null;
    for (const review of record.reviews) {
      if (review.decision === 'REJECTED') {
        latest = review;
      }
    }
    return latest;
  }

  private latestRejectionNote(): string {
    const review = this.latestRejection();
    if (review === null || review.note === null || review.note === '') {
      return '未填写原因';
    }
    return review.note;
  }

  @Builder
  fieldLabel(text: string) {
    Text(text)
      .fontSize(14)
      .fontColor($r('app.color.text_secondary'))
      .width('100%')
      .textAlign(TextAlign.Start)
  }

  @Builder
  errorLine(name: string) {
    if (this.fieldError(name) !== '') {
      Text(this.fieldError(name))
        .fontSize(13)
        .fontColor($r('app.color.danger'))
        .width('100%')
        .textAlign(TextAlign.Start)
    }
  }

  @Builder
  choiceChip(label: string, selected: boolean, action: () => void) {
    Text(label)
      .fontSize(14)
      .fontColor(selected ? Color.White : $r('app.color.text_primary'))
      .padding({ left: 14, right: 14, top: 8, bottom: 8 })
      .backgroundColor(selected ? $r('app.color.brand') : $r('app.color.surface'))
      .borderRadius(16)
      .margin({ right: 8, bottom: 8 })
      .onClick(action)
  }

  private async favoriteRecord(): Promise<void> {
    if (this.favoriting || this.record === null) return;
    this.favoriting = true;
    this.actionError = ''; this.noticeText = '';
    const generation = this.generation;
    try { await CommunityService.memberFavorite(this.record.id); if (generation === this.generation) this.noticeText = '备案已收藏'; }
    catch (error) { if (generation !== this.generation) return;
      if (error instanceof ApiRequestError && isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
      this.actionError = error instanceof ApiRequestError ? error.message : '收藏失败';
    } finally { if (generation === this.generation) this.favoriting = false; }
  }

  @Builder
  photosEditor(record: RepairRecordDetailView) {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text('维修照片')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .layoutWeight(1)
          .textAlign(TextAlign.Start)
        Text(this.uploading ? '上传中…' : '添加照片')
          .fontSize(14)
          .fontColor($r('app.color.brand'))
          .onClick(() => {
            this.addPhotos();
          })
      }
      .width('100%')

      Text(`提交审核至少一张；上限 ${record.photoLimits.maxFiles} 张、单张 ${formatBytes(record.photoLimits.maxBytes)}。`)
        .fontSize(12)
        .fontColor($r('app.color.text_secondary'))
        .width('100%')
        .textAlign(TextAlign.Start)

      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(record.photos, (photo: RepairPhotoView) => {
          Column({ space: 4 }) {
            PhotoThumb({
              photoId: photo.id,
              thumbSize: 92,
              onOpen: () => {
                this.previewPhotoId = photo.id;
              }
            })
            Text(this.deletingPhotoId === photo.id ? '删除中…' : '删除')
              .fontSize(12)
              .fontColor($r('app.color.danger'))
              .onClick(() => {
                this.removePhoto(photo.id);
              })
          }
          .margin({ right: 10, bottom: 10 })
          .alignItems(HorizontalAlign.Center)
        }, (photo: RepairPhotoView) => photo.id)
      }
      .width('100%')
      this.errorLine('photos')
    }
    .width('100%')
    .padding(16)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  photoStrip(photos: RepairPhotoView[]) {
    Flex({ wrap: FlexWrap.Wrap }) {
      ForEach(photos, (photo: RepairPhotoView) => {
        Column() {
          PhotoThumb({
            photoId: photo.id,
            thumbSize: 92,
            onOpen: () => {
              this.previewPhotoId = photo.id;
            }
          })
        }
        .margin({ right: 10, bottom: 10 })
      }, (photo: RepairPhotoView) => photo.id)
    }
    .width('100%')
  }

  @Builder
  editForm(record: RepairRecordDetailView) {
    Column({ space: 14 }) {
      if (this.param.faultDescription !== '') {
        Column({ space: 6 }) {
          Text('报修故障描述（参考）')
            .fontSize(13)
            .fontColor($r('app.color.text_secondary'))
            .width('100%')
            .textAlign(TextAlign.Start)
          Text(this.param.faultDescription)
            .fontSize(13)
            .fontColor($r('app.color.text_primary'))
            .width('100%')
            .textAlign(TextAlign.Start)
        }
        .width('100%')
        .padding(12)
        .backgroundColor($r('app.color.field_bg'))
        .borderRadius(CONTROL_RADIUS)
        .alignItems(HorizontalAlign.Start)
      }

      Column({ space: 6 }) {
        this.fieldLabel('维修日期')
        Row({ space: 10 }) {
          Text(this.repairDate === '' ? '选择日期' : this.repairDate)
            .fontSize(15)
            .fontColor(this.repairDate === '' ? $r('app.color.text_secondary') : $r('app.color.text_primary'))
            .layoutWeight(1)
            .textAlign(TextAlign.Start)
          Text('选择')
            .fontSize(14)
            .fontColor($r('app.color.brand'))
        }
        .width('100%')
        .height(CONTROL_HEIGHT)
        .padding({ left: 12, right: 12 })
        .backgroundColor($r('app.color.field_bg'))
        .borderRadius(CONTROL_RADIUS)
        .onClick(() => {
          this.openDatePicker();
        })
        this.errorLine('repairDate')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Column({ space: 6 }) {
        this.fieldLabel('故障分类')
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.categories, (category: RepairCategoryView) => {
            this.choiceChip(category.name, this.categoryId === category.id, () => {
              this.categoryId = category.id;
              this.clearFieldError('categoryId');
            })
          }, (category: RepairCategoryView) => category.id)
        }
        .width('100%')
        if (this.categories.length === 0) {
          Text('分类字典加载中或为空，请稍后重试。')
            .fontSize(13)
            .fontColor($r('app.color.text_secondary'))
            .width('100%')
            .textAlign(TextAlign.Start)
        }
        this.errorLine('categoryId')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Column({ space: 6 }) {
        this.fieldLabel('设备机型（选填）')
        TextInput({ text: this.deviceModel, placeholder: '设备机型，最多 60 字' }).maxLength(60)
          .enabled(!this.isBusy()).onChange((value: string) => { this.deviceModel = value; this.clearFieldError('deviceModel'); })
        this.errorLine('deviceModel')
        this.fieldLabel('机主姓名（选填）')
        TextInput({ text: this.ownerName, placeholder: '实际机主姓名，最多 40 字' }).maxLength(40)
          .enabled(!this.isBusy()).onChange((value: string) => { this.ownerName = value; this.clearFieldError('ownerName'); })
        this.errorLine('ownerName')
        this.fieldLabel('机主电话（选填）')
        TextInput({ text: this.ownerPhone, placeholder: '支持手机或座机，最多 32 字符' }).maxLength(32)
          .enabled(!this.isBusy()).onChange((value: string) => { this.ownerPhone = value; this.clearFieldError('ownerPhone'); })
        this.errorLine('ownerPhone')
        Text('电话仅作者与审核人员可见；填写机主不会改变备案作者。').fontSize(12).fontColor('#747A7F')
      }.width('100%').alignItems(HorizontalAlign.Start)

      Column({ space: 6 }) {
        this.fieldLabel('维修内容')
        TextArea({ text: this.content, placeholder: '请记录实际维修过程，例如：更换排线并重新压接' })
          .height(104)
          .backgroundColor($r('app.color.field_bg'))
          .borderRadius(CONTROL_RADIUS)
          .onChange((next: string) => {
            this.content = next;
            this.clearFieldError('content');
          })
        this.errorLine('content')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Column({ space: 6 }) {
        this.fieldLabel('维修结果')
        Row({ space: 8 }) {
          this.choiceChip('已完成', this.result === 'COMPLETED', () => {
            this.result = 'COMPLETED';
            this.clearFieldError('result');
          })
          this.choiceChip('未完成', this.result === 'NOT_COMPLETED', () => {
            this.result = 'NOT_COMPLETED';
            this.clearFieldError('result');
          })
        }
        .width('100%')
        this.errorLine('result')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Column({ space: 6 }) {
        this.fieldLabel('维修耗时（分钟，选填）')
        TextInput({ text: this.durationText, placeholder: '如 45' })
          .type(InputType.Number)
          .height(CONTROL_HEIGHT)
          .backgroundColor($r('app.color.field_bg'))
          .borderRadius(CONTROL_RADIUS)
          .onChange((next: string) => {
            this.durationText = next;
            this.clearFieldError('durationMinutes');
          })
        this.errorLine('durationMinutes')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Column({ space: 6 }) {
        this.fieldLabel('备注（选填）')
        TextArea({ text: this.remark, placeholder: '其他需要说明的情况' })
          .height(80)
          .backgroundColor($r('app.color.field_bg'))
          .borderRadius(CONTROL_RADIUS)
          .onChange((next: string) => {
            this.remark = next;
            this.clearFieldError('remark');
          })
        this.errorLine('remark')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .padding(16)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Start)
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
  readOnlyView(record: RepairRecordDetailView) {
    Column({ space: 12 }) {
      if (record.status === 'REJECTED') {
        Column({ space: 4 }) {
          Text('该备案已被退回，可按审核意见修改后重新提交。')
            .fontSize(13)
            .fontColor($r('app.color.danger'))
            .width('100%')
            .textAlign(TextAlign.Start)
        }
        .width('100%')
        .padding(12)
        .backgroundColor($r('app.color.field_bg'))
        .borderRadius(CONTROL_RADIUS)
      }
      if (record.status === 'PENDING' || record.status === 'APPROVED') {
        Text(record.status === 'PENDING'
          ? '备案已提交审核，审核前不可修改。'
          : '备案已通过审核，内容不可修改。')
          .fontSize(13)
          .fontColor($r('app.color.text_secondary'))
          .width('100%')
          .textAlign(TextAlign.Start)
      }

      this.infoRow('维修日期', record.repairDate === null ? '未填写' : record.repairDate)
      this.infoRow('故障分类', record.category === null ? '未分类' : record.category.name)
      this.infoRow('设备机型', record.deviceModel === null ? '未填写' : record.deviceModel)
      this.infoRow('备案作者', record.member.name)
      this.infoRow('机主姓名', record.ownerName || '未填写')
      this.infoRow('机主电话', record.ownerPhone || '未填写或无查看权限')
      this.infoRow('维修内容', record.content === null ? '未填写' : record.content)
      this.infoRow('维修结果', repairResultLabel(record.result))
      this.infoRow('维修耗时', record.durationMinutes === null ? '未填写' : `${record.durationMinutes} 分钟`)
      this.infoRow('备注', record.remark === null ? '无' : record.remark)
      this.infoRow('提交时间', record.submittedAt === null ? '未提交' : formatOrderTime(record.submittedAt))
      this.infoRow('审核时间', record.reviewedAt === null ? '未审核' : formatOrderTime(record.reviewedAt))

      if (record.photos.length > 0) {
        Text('维修照片')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .width('100%')
          .textAlign(TextAlign.Start)
        this.photoStrip(record.photos)
      }

      if (record.reviews.length > 0) {
        Column({ space: 10 }) {
          Text('审核记录')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.text_primary'))
            .width('100%')
            .textAlign(TextAlign.Start)
          ForEach(record.reviews, (review: RepairReviewView) => {
            this.reviewNoteView(review);
          }, (review: RepairReviewView) => review.id)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }

      if (record.timeline.length > 0) {
        Column({ space: 8 }) {
          Text('记录时间线')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.text_primary'))
            .width('100%')
            .textAlign(TextAlign.Start)
          ForEach(record.timeline, (event: RepairTimelineView) => {
            Row({ space: 8 }) {
              Text(repairTimelineEventLabel(event.eventType))
                .fontSize(13)
                .fontColor($r('app.color.text_primary'))
              Text(formatOrderTime(event.createdAt))
                .fontSize(12)
                .fontColor($r('app.color.text_secondary'))
                .layoutWeight(1)
                .textAlign(TextAlign.End)
            }
            .width('100%')
          }, (event: RepairTimelineView) => event.id)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
    }
    .width('100%')
    .padding(16)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  infoRow(label: string, value: string) {
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

  build() {
    Stack() {
      Column({ space: 14 }) {
        Row({ space: 12 }) {
          Text('维修备案')
            .fontSize(26)
            .fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.text_primary'))
            .layoutWeight(1)
            .textAlign(TextAlign.Start)
          if (this.record !== null) {
            Text(repairRecordStatusLabel(this.record.status))
              .fontSize(12)
              .fontColor($r('app.color.brand'))
              .padding({ left: 8, right: 8, top: 3, bottom: 3 })
              .backgroundColor($r('app.color.brand_soft'))
              .borderRadius(8)
          }
          Text('刷新')
            .fontSize(14)
            .fontColor($r('app.color.brand'))
            .onClick(() => {
              this.load();
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
                Text('正在加载备案…')
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
                    // 沿用失败那次加载的模式：照片局部刷新失败后的重试不覆盖未保存输入。
                    this.load(this.lastLoadPreservedEdits);
                  })
              }
              .width('100%')
              .padding(32)
              .backgroundColor($r('app.color.surface'))
              .borderRadius(CARD_RADIUS)
              .alignItems(HorizontalAlign.Center)
            } else if (this.record !== null) {
              Button(this.favoriting ? '收藏中…' : '收藏备案').enabled(!this.favoriting).onClick(() => { this.favoriteRecord(); })
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
              if (this.record.canEdit) {
                if (this.record.status === 'REJECTED') {
                  Column({ space: 6 }) {
                    Text('退回原因')
                      .fontSize(13)
                      .fontColor($r('app.color.danger'))
                      .width('100%')
                      .textAlign(TextAlign.Start)
                    Text(this.latestRejectionNote())
                      .fontSize(13)
                      .fontColor($r('app.color.text_primary'))
                      .width('100%')
                      .textAlign(TextAlign.Start)
                  }
                  .width('100%')
                  .padding(12)
                  .backgroundColor($r('app.color.field_bg'))
                  .borderRadius(CONTROL_RADIUS)
                  .alignItems(HorizontalAlign.Start)
                }
                this.editForm(this.record)
                this.photosEditor(this.record)
                Column({ space: 10 }) {
                  Button(this.submitting ? '提交中…' : (this.record.status === 'REJECTED' ? '重新提交审核' : '提交审核'))
                    .width('100%')
                    .height(CONTROL_HEIGHT)
                    .fontSize(17)
                    .backgroundColor($r('app.color.brand'))
                    .fontColor(Color.White)
                    .enabled(!this.isBusy())
                    .onClick(() => {
                      this.submitForReview();
                    })
                  Button(this.saving ? '保存中…' : '保存草稿')
                    .width('100%')
                    .height(CONTROL_HEIGHT)
                    .fontSize(16)
                    .backgroundColor($r('app.color.brand_soft'))
                    .fontColor($r('app.color.brand'))
                    .enabled(!this.isBusy())
                    .onClick(() => {
                      this.saveDraft();
                    })
                }
                .width('100%')
              } else {
                this.readOnlyView(this.record)
                // 已通过审核的备案：作者可标记典型并查看真实整理状态（Issue #40）。
                if (this.record.status === 'APPROVED') {
                  TypicalCasePanel({
                    recordId: this.record.id,
                    onOpenCase: (caseId: string): void => {
                      this.openCase(caseId);
                    },
                    onChanged: (): void => {
                      this.load(true);
                    },
                    onSessionExpired: (): void => {
                      this.onSessionExpired();
                    }
                  })
                }
              }
              RecordComments({ recordId: this.record.id, onSessionExpired: this.onSessionExpired })
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
