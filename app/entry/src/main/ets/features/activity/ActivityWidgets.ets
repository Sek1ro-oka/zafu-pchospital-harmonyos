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
  @Prop detail: ActivityDetail | null = null;
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

/** Primitive props keep async status changes observable; no cached DTO snapshots. */
@Component
export struct ActivityInfoRow {
  @Prop label: string = '';
  @Prop value: string = '';
  build() {
    Row({ space: 18 }) {
      Text(this.label).fontSize(14).fontColor('#8A8178').width(64)
      Text(this.value).fontSize(15).lineHeight(23).fontColor('#302A25').layoutWeight(1)
    }.width('100%').alignItems(VerticalAlign.Top)
  }
}
@Component
export struct RegistrationStageCard {
  @Prop label: string = '';
  @Prop time: string = '';
  @Prop reached: boolean = false;
  build() {
    Column({ space: 9 }) {
      Text(this.reached ? '✓' : '—').fontSize(20).fontWeight(FontWeight.Bold)
        .fontColor(this.reached ? '#B76024' : '#B9AFA5').width(32).height(32).textAlign(TextAlign.Center)
        .backgroundColor(this.reached ? '#FFE2BD' : '#EEEAE5').borderRadius(16)
      Text(this.label).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.reached ? '#704222' : '#958B82')
      Text(this.time).fontSize(11).lineHeight(17).fontColor('#8A7B6F').textAlign(TextAlign.Center).width('100%')
    }.width('100%').constraintSize({ minHeight: 126 }).padding({ left: 6, right: 6, top: 14, bottom: 14 })
      .backgroundColor(this.reached ? '#FFF2DF' : '#F7F5F2').borderRadius(16)
  }
}
