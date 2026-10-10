import { ApiRequestError } from '../../core/network/ApiClient';
import { CARD_RADIUS, CONTROL_HEIGHT, CONTROL_RADIUS } from '../../core/ui/Theme';
import {
  REPAIR_ORDER_LIMITS,
  RepairOrderSubmitRequest,
} from './RepairOrderContract';

/** 电话允许的字符：数字、`+`、`-`、空格、括号（与后端 PHONE_PATTERN 一致）。 */
const PHONE_PATTERN: RegExp = /^[0-9+\-\s()]{5,32}$/;

/** 表单字段级错误：键与后端 fieldErrors 同名，便于把服务端错误直接落到输入框下方。 */
export type FieldErrorMap = Record<string, string>;

/**
 * 客户报修提交表单。
 *
 * 提交前先做一遍本地校验，**但不把本地校验当成通过条件**：
 * 服务端仍会独立校验，且返回的 `fieldErrors` 会覆盖本地结果 ——
 * 长度上限这类规则只有服务端是权威，客户端只负责让用户少跑一趟。
 */
@Component
export struct RepairOrderForm {
  /** 提交成功后由父组件刷新列表并收起表单。 */
  onSubmitted: () => Promise<void> = async () => {
  };
  submit: (request: RepairOrderSubmitRequest) => Promise<void> = async () => {
  };
  @State deviceModel: string = '';
  @State deviceSerial: string = '';
  @State faultDescription: string = '';
  @State contactPhone: string = '';
  @State busy: boolean = false;
  @State errorText: string = '';
  @State fieldErrors: FieldErrorMap = {};

  private fieldError(name: string): string {
    const value: string | undefined = this.fieldErrors[name];
    return value === undefined ? '' : value;
  }

  private hasFieldErrors(): boolean {
    return Object.keys(this.fieldErrors).length > 0;
  }

  /** 本地校验：只拦「明显不合法」，返回空 map 表示可以发请求。 */
  private localValidation(): FieldErrorMap {
    const errors: FieldErrorMap = {};
    const model = this.deviceModel.trim();
    const serial = this.deviceSerial.trim();
    const fault = this.faultDescription.trim();
    const phone = this.contactPhone.trim();

    if (model === '') {
      errors.deviceModel = '请填写设备机型';
    } else if (model.length > REPAIR_ORDER_LIMITS.deviceModelMaxLength) {
      errors.deviceModel = `机型不能超过 ${REPAIR_ORDER_LIMITS.deviceModelMaxLength} 字`;
    }
    if (serial.length > REPAIR_ORDER_LIMITS.deviceSerialMaxLength) {
      errors.deviceSerial = `序列号不能超过 ${REPAIR_ORDER_LIMITS.deviceSerialMaxLength} 字`;
    }
    if (fault === '') {
      errors.faultDescription = '请描述故障现象';
    } else if (fault.length < REPAIR_ORDER_LIMITS.faultDescriptionMinLength) {
      errors.faultDescription = `故障描述至少 ${REPAIR_ORDER_LIMITS.faultDescriptionMinLength} 字`;
    } else if (fault.length > REPAIR_ORDER_LIMITS.faultDescriptionMaxLength) {
      errors.faultDescription = `故障描述不能超过 ${REPAIR_ORDER_LIMITS.faultDescriptionMaxLength} 字`;
    }
    if (phone === '') {
      errors.contactPhone = '请填写联系电话';
    } else if (!PHONE_PATTERN.test(phone)) {
      errors.contactPhone = '联系电话格式无效';
    }
    return errors;
  }

  /** 把服务端返回的 fieldErrors（`Object`）安全地转成本地 map。 */
  private readServerFieldErrors(error: ApiRequestError): FieldErrorMap {
    const raw: Record<string, string[]> | undefined = error.fieldErrors;
    const result: FieldErrorMap = {};
    if (raw === undefined) {
      return result;
    }
    const keys: string[] = Object.keys(raw);
    for (const key of keys) {
      const messages: string[] = raw[key];
      if (messages.length > 0) {
        result[key] = messages[0];
      }
    }
    return result;
  }

  private async handleSubmit(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.errorText = '';
    const local: FieldErrorMap = this.localValidation();
    this.fieldErrors = local;
    if (Object.keys(local).length > 0) {
      return;
    }

    this.busy = true;
    try {
      const request: RepairOrderSubmitRequest = {
        deviceModel: this.deviceModel.trim(),
        faultDescription: this.faultDescription.trim(),
        contactPhone: this.contactPhone.trim(),
      };
      // 序列号选填：留空时**不带这个键**，避免提交空串被服务端当成「填了一个空值」。
      const serial = this.deviceSerial.trim();
      if (serial !== '') {
        request.deviceSerial = serial;
      }
      await this.submit(request);
      this.deviceModel = '';
      this.deviceSerial = '';
      this.faultDescription = '';
      this.contactPhone = '';
      this.fieldErrors = {};
      await this.onSubmitted();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const serverFields = this.readServerFieldErrors(error);
        this.fieldErrors = serverFields;
        // 服务端给出的字段级提示已经足够具体时，不再叠一句笼统的总错误。
        this.errorText = Object.keys(serverFields).length > 0 ? '' : error.message;
      } else {
        this.errorText = '提交失败，请重试';
      }
    } finally {
      this.busy = false;
    }
  }

  @Builder
  labeledInput(label: string, placeholder: string, value: string, name: string, onChange: (v: string) => void) {
    Column({ space: 6 }) {
      Text(label)
        .fontSize(14)
        .fontColor($r('app.color.text_secondary'))
        .width('100%')
        .textAlign(TextAlign.Start)
      TextInput({ text: value, placeholder: placeholder })
        .height(CONTROL_HEIGHT)
        .backgroundColor($r('app.color.field_bg'))
        .borderRadius(CONTROL_RADIUS)
        .onChange((next: string) => {
          onChange(next);
        })
      if (this.fieldError(name) !== '') {
        Text(this.fieldError(name))
          .fontSize(13)
          .fontColor($r('app.color.danger'))
          .width('100%')
          .textAlign(TextAlign.Start)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Column({ space: 14 }) {
      Text('提交报修')
        .fontSize(20)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.text_primary'))
        .width('100%')
        .textAlign(TextAlign.Start)

      this.labeledInput('设备机型（必填）', '如 ThinkPad X1 Carbon', this.deviceModel, 'deviceModel', (v: string) => {
        this.deviceModel = v;
      })
      this.labeledInput('设备序列号（选填）', '如 PF2ABCDE', this.deviceSerial, 'deviceSerial', (v: string) => {
        this.deviceSerial = v;
      })
      Column({ space: 6 }) {
        Text('故障描述（必填）')
          .fontSize(14)
          .fontColor($r('app.color.text_secondary'))
          .width('100%')
          .textAlign(TextAlign.Start)
        TextArea({ text: this.faultDescription, placeholder: '请描述故障现象，例如：开机后风扇狂转但屏幕无显示' })
          .height(104)
          .backgroundColor($r('app.color.field_bg'))
          .borderRadius(CONTROL_RADIUS)
          .onChange((next: string) => {
            this.faultDescription = next;
          })
        if (this.fieldError('faultDescription') !== '') {
          Text(this.fieldError('faultDescription'))
            .fontSize(13)
            .fontColor($r('app.color.danger'))
            .width('100%')
            .textAlign(TextAlign.Start)
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      this.labeledInput('联系电话（必填）', '如 13800138000', this.contactPhone, 'contactPhone', (v: string) => {
        this.contactPhone = v;
      })

      if (this.errorText !== '') {
        Text(this.errorText)
          .fontSize(14)
          .fontColor($r('app.color.danger'))
          .width('100%')
          .textAlign(TextAlign.Start)
      }

      Button(this.busy ? '提交中…' : '提交报修')
        .width('100%')
        .height(CONTROL_HEIGHT)
        .fontSize(17)
        .backgroundColor($r('app.color.brand'))
        .fontColor(Color.White)
        .enabled(!this.busy)
        .onClick(() => {
          this.handleSubmit();
        })
    }
    .width('100%')
    .padding(16)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Start)
  }
}
