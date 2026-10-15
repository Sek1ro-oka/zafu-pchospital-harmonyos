import { ActivityDetail, ACTIVITY_ISSUE_TYPES, ACTIVITY_ISSUE_LABELS, activityTime, activityStatusLabel } from './ActivityContract';
@Component
export struct ActivityIssueSelector {
  @Prop value: string = 'OTHER';
  @Prop disabled: boolean = false;
  onChange: (value: string) => void = () => {};
  build() {
    Column({ space: 8 }) {
      Text('故障类型').fontSize(14).width('100%')
      Select(ACTIVITY_ISSUE_LABELS.map((label: string): SelectOption => { return { value: label }; }))
        .selected(ACTIVITY_ISSUE_TYPES.indexOf(this.value))
        .value(ACTIVITY_ISSUE_LABELS[ACTIVITY_ISSUE_TYPES.indexOf(this.value)])
        .enabled(!this.disabled).width('100%')
        .onSelect((index: number) => { this.onChange(ACTIVITY_ISSUE_TYPES[index]); })
    }.width('100%')
  }
}
@Component
export struct ActivityFacts {
  detail: ActivityDetail | null = null;
  build() {
    Column({ space: 10 }) {
      if (this.detail !== null) {
      Text(this.detail.title).fontSize(24).fontWeight(FontWeight.Bold).width('100%')
      Text(activityStatusLabel(this.detail.status)).fontColor('#1676E5').width('100%')
      Text(`活动时间：${activityTime(this.detail.activityAt)}（北京时间）`).width('100%')
      Text(`地点：${this.detail.location === null ? '地点待公布' : this.detail.location}`).width('100%')
      Text(`报名开始：${activityTime(this.detail.signupOpensAt)}\n报名截止：${activityTime(this.detail.signupClosesAt)}`).fontSize(14).lineHeight(23).width('100%')
      Text(`名额 ${this.detail.registeredCount} / ${this.detail.capacity} · 剩余 ${this.detail.remaining}`).fontSize(14).width('100%')
      }
    }.padding(18).backgroundColor(Color.White).borderRadius(20).width('100%')
  }
}
