import { activityTime } from './ActivityContract';
/** Picker components use local calendar controls; serialized values always use Beijing time. */
@Component
export struct ActivityDateTimeInput {
  @Prop label: string = '';
  @Prop value: string = '';
  @Prop disabled: boolean = false;
  onChange: (value: string) => void = () => {};
  private beijing(): Date { return this.value === '' ? new Date(Date.now() + 8 * 3600000) : new Date(new Date(this.value).getTime() + 8 * 3600000); }
  private date(): void {
    const current = this.beijing();
    this.getUIContext().showDatePickerDialog({ start: new Date(2020, 0, 1), end: new Date(2100, 11, 31),
      selected: new Date(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()),
      onDateAccept: (date: Date) => {
        this.onChange(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), current.getUTCHours(), current.getUTCMinutes()) - 8 * 3600000).toISOString());
      } });
  }
  private time(): void {
    const current = this.beijing();
    this.getUIContext().showTimePickerDialog({
      selected: new Date(2026, 0, 1, current.getUTCHours(), current.getUTCMinutes()), useMilitaryTime: true,
      onAccept: (value: TimePickerResult) => {
        this.onChange(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate(),
          value.hour === undefined ? 0 : value.hour, value.minute === undefined ? 0 : value.minute) - 8 * 3600000).toISOString());
      } });
  }
  build() {
    Column({ space: 8 }) {
      Text(this.label).fontSize(14).width('100%')
      Text(this.value === '' ? '请选择日期和时间（北京时间）' : activityTime(this.value)).fontSize(15).width('100%')
      Row({ space: 12 }) {
        Button('选择日期').enabled(!this.disabled).onClick(() => { this.date(); })
        Button('选择时间').enabled(!this.disabled).onClick(() => { this.time(); })
      }.width('100%')
    }.width('100%')
  }
}
