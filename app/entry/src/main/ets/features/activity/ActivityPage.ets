import { ApiClient, ApiRequestError } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { ReferenceBanner, ReferenceSearch, ReferenceShortcut, REFERENCE_BACKGROUND } from '../../core/ui/ReferencePage';

interface RepairActivity {
  id: string;
  title: string;
  activityAt: string;
  capacity: number;
  signupOpensAt: string;
  signupClosesAt: string;
  status: string;
  registeredCount: number;
  remaining: number;
}

/** 只读复用公开维修活动接口；公告/分享和报名尚未接入，不填充假帖子。 */
@Component
export struct ActivityPage {
  @State channel: string = '推荐';
  @State query: string = '';
  @State activities: RepairActivity[] = [];
  @State loading: boolean = false;
  @State errorText: string = '';
  @State expandedId: string = '';
  private generation: number = 0;

  aboutToAppear(): void { this.load(); }
  aboutToDisappear(): void { this.generation += 1; }

  private async load(): Promise<void> {
    const generation = ++this.generation;
    this.loading = true;
    this.errorText = '';
    try {
      const items = await ApiClient.get<RepairActivity[]>(ApiConfig.getBaseUrl(), '/api/v1/repair-activities', '');
      if (generation !== this.generation) return;
      this.activities = items;
    } catch (error) {
      if (generation !== this.generation) return;
      this.errorText = error instanceof ApiRequestError ? error.message : '活动加载失败，请重试';
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  private statusLabel(status: string): string {
    if (status === 'OPEN') return '报名中';
    if (status === 'FULL') return '已报满';
    if (status === 'CLOSED') return '报名截止';
    if (status === 'ENDED') return '已结束';
    return '未开始';
  }

  private dateText(value: string): string {
    // 公开接口返回 ISO，统一呈现北京时间。
    const time = new Date(new Date(value).getTime() + 8 * 3600000);
    return `${time.getUTCFullYear()}年${time.getUTCMonth() + 1}月${time.getUTCDate()}日 ${time.getUTCHours().toString().padStart(2, '0')}:${time.getUTCMinutes().toString().padStart(2, '0')}`;
  }

  private visibleActivities(): RepairActivity[] {
    return this.activities.filter((item: RepairActivity) => item.title.toLowerCase().includes(this.query.trim().toLowerCase()));
  }

  @Builder
  activityCard(item: RepairActivity) {
    Column({ space: 14 }) {
      Row({ space: 10 }) {
        Image($r('app.media.ref_activity')).width(36).height(36)
        Column({ space: 4 }) {
          Text('电脑医院 · 维修活动').fontSize(15).fontWeight(FontWeight.Bold)
          Text(this.dateText(item.activityAt)).fontSize(11).fontColor('#777E84')
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Text(this.statusLabel(item.status)).fontSize(12).fontColor('#137AE7')
          .padding({ left: 10, right: 10, top: 6, bottom: 6 }).backgroundColor('#F3F7FC').borderRadius(18)
      }.width('100%')
      Text(item.title).fontSize(17).fontWeight(FontWeight.Medium).width('100%')
      Image($r('app.media.ref_activity_hero')).width('100%').height(160).objectFit(ImageFit.Contain)
        .backgroundColor('#F1EBFF').borderRadius(12).accessibilityText('项目主题插画，非活动现场照片')
      Row() {
        Text(`已报名 ${item.registeredCount} · 剩余名额 ${item.remaining}`).fontSize(12).fontColor('#747A7F').layoutWeight(1)
        Text(this.expandedId === item.id ? '收起 ∧' : '活动信息 ›').fontSize(12).fontColor('#2474D4')
      }.width('100%')
      if (this.expandedId === item.id) {
        Text(`报名开始：${this.dateText(item.signupOpensAt)}\n报名截止：${this.dateText(item.signupClosesAt)}\n名额：${item.capacity}\nApp 活动报名暂未接入。`)
          .fontSize(13).fontColor('#626C75').lineHeight(22).width('100%')
      }
    }.width('100%').padding(14).backgroundColor(Color.White).borderRadius(20)
      .alignItems(HorizontalAlign.Start)
      .onClick(() => { this.expandedId = this.expandedId === item.id ? '' : item.id; })
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
        Scroll() {
          Row({ space: 20 }) {
            ForEach(['推荐', '维修活动', '服务公告', '经验分享'], (name: string) => {
              Text(name).fontSize(this.channel === name ? 26 : 18)
                .fontWeight(this.channel === name ? FontWeight.Bold : FontWeight.Medium)
                .fontColor(this.channel === name ? '#111416' : '#6E7376')
                .onClick(() => { this.channel = name; })
            })
          }.height(50)
        }.scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%')
        ReferenceSearch({ text: $query, placeholder: '搜索社团维修活动' })
        ReferenceBanner({
          title: '电脑医院  校园同行', subtitle: '维修活动 · 经验分享', image: $r('app.media.ref_activity_hero'),
          violet: true, actionText: '查看维修活动',
          onSelect: (): void => { this.channel = '维修活动'; }
        })
        Row() {
          ReferenceShortcut({ title: '维修活动', icon: $r('app.media.ref_activity'), onSelect: (): void => { this.channel = '维修活动'; } })
          ReferenceShortcut({ title: '服务公告', icon: $r('app.media.ref_document'), onSelect: (): void => { this.channel = '服务公告'; } })
          ReferenceShortcut({ title: '经验分享', icon: $r('app.media.ref_system'), onSelect: (): void => { this.channel = '经验分享'; } })
        }.width('100%').margin({ bottom: 8 })
        if (this.channel === '服务公告' || this.channel === '经验分享') {
          Column({ space: 10 }) {
            Image($r('app.media.ref_document')).width(40).height(40)
            Text(`${this.channel}暂未接入`).fontSize(16).fontWeight(FontWeight.Medium)
            Text('首版由社团发布内容').fontSize(12).fontColor('#7B848B')
          }.width('100%').padding(28).backgroundColor(Color.White).borderRadius(20)
        } else if (this.loading) {
          LoadingPanel({ text: '正在加载活动…' })
        } else if (this.errorText !== '') {
          ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(); } })
        } else if (this.visibleActivities().length === 0) {
          Column({ space: 10 }) {
            Image($r('app.media.ref_activity')).width(44).height(44)
            Text(this.query.trim() === '' ? '暂未发布维修活动' : '没有匹配的活动').fontSize(16)
            Button('刷新活动').fontSize(13).backgroundColor('#F1F6FD').fontColor('#2677DB').onClick(() => { this.load(); })
          }.width('100%').padding(24).backgroundColor(Color.White).borderRadius(20)
        } else {
          ForEach(this.visibleActivities(), (item: RepairActivity) => { this.activityCard(item); }, (item: RepairActivity) => item.id)
          Button('刷新活动').fontSize(13).onClick(() => { this.load(); })
        }
      }.width('100%').padding({ left: 16, right: 16, bottom: 90 }).alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top).backgroundColor(REFERENCE_BACKGROUND)
  }
}
