import { NavPusher, ROUTE_KNOWLEDGE, ROUTE_REPAIR_ORDERS } from '../../core/ui/Routes';
import { EntryCard } from '../../core/ui/EntryCard';
import {
  CARD_GAP,
  CARD_PADDING,
  CARD_RADIUS,
  CONTROL_RADIUS,
  FONT_HEADING,
  FONT_NOTE,
  FONT_SUBTITLE,
  GAP_LG,
  GAP_XS,
  ICON_TILE,
  PAGE_PADDING,
} from '../../core/ui/Theme';

interface ServiceEntry {
  title: string;
  note: string;
  icon: string;
  route: string;
  /** false = 未接入：图标砖灰底，点击提示而不是跳转。 */
  ready: boolean;
}

function serviceEntries(): ServiceEntry[] {
  return [
    { title: '我要报修', note: '提交故障申报', icon: '报', route: ROUTE_REPAIR_ORDERS, ready: true },
    { title: '我的进度', note: '查看处理进度', icon: '进', route: ROUTE_REPAIR_ORDERS, ready: true },
    { title: '知识问答', note: '有出处的 AI 咨询', icon: '问', route: ROUTE_KNOWLEDGE, ready: true },
    { title: '预约服务', note: '待接口确定后接入', icon: '约', route: '', ready: false }
  ];
}

/**
 * 客户服务页（骨架对照 docs/reference/my-huawei/service-my-products-repair-entry.jpg）。
 *
 * 布局对照参考图的"我的产品 → 功能卡网格 → 快捷服务"分区结构：
 * 我的设备卡片（未接入，如实标注）→ 常用服务网格（报修/进度/问答已接入）→
 * 服务记录入口（指向我的报修单页）。不伪造设备与服务数据。
 */
@Component
export struct ServicePage {
  /** 由 HomePage 注入的导航栈：真实入口统一从这里压栈。 */
  pathStack: NavPathStack = new NavPathStack();
  private pusher: NavPusher = new NavPusher();

  private openEntry(entry: ServiceEntry): void {
    if (entry.route === '') {
      this.getUIContext().getPromptAction().showToast({ message: `${entry.title}未接入，接口确定后开放` });
      return;
    }
    this.pusher.push(this.pathStack, entry.route, null);
  }

  @Builder
  sectionTitle(text: string) {
    Text(text)
      .fontSize(FONT_HEADING)
      .fontWeight(FontWeight.Bold)
      .fontColor($r('app.color.text_primary'))
      .width('100%')
      .textAlign(TextAlign.Start)
  }

  @Builder
  deviceCard() {
    Row({ space: CARD_GAP }) {
      Text('备')
        .fontSize(FONT_HEADING)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.text_secondary'))
        .width(ICON_TILE)
        .height(ICON_TILE)
        .textAlign(TextAlign.Center)
        .backgroundColor($r('app.color.field_bg'))
        .borderRadius(CONTROL_RADIUS)
      Column({ space: GAP_XS }) {
        Text('设备信息未接入')
          .fontSize(FONT_SUBTITLE)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
        Text('设备绑定与保修查询将在服务端接口确定后接入。')
          .fontSize(FONT_NOTE)
          .fontColor($r('app.color.text_secondary'))
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .padding(CARD_PADDING)
    .alignItems(VerticalAlign.Center)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
  }

  @Builder
  recordRow() {
    Row({ space: CARD_GAP }) {
      Text('录')
        .fontSize(FONT_HEADING)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.brand'))
        .width(ICON_TILE)
        .height(ICON_TILE)
        .textAlign(TextAlign.Center)
        .backgroundColor($r('app.color.brand_soft'))
        .borderRadius(CONTROL_RADIUS)
      Column({ space: GAP_XS }) {
        Text('服务记录')
          .fontSize(FONT_SUBTITLE)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
        Text('全部报修单与处理记录 · 已接入')
          .fontSize(FONT_NOTE)
          .fontColor($r('app.color.text_secondary'))
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      Text('>')
        .fontSize(FONT_SUBTITLE)
        .fontColor($r('app.color.text_secondary'))
    }
    .width('100%')
    .padding(CARD_PADDING)
    .alignItems(VerticalAlign.Center)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .onClick(() => {
      this.pusher.push(this.pathStack, ROUTE_REPAIR_ORDERS, null);
    })
  }

  build() {
    Column({ space: GAP_LG }) {
      this.sectionTitle('我的设备')
      this.deviceCard()
      this.sectionTitle('常用服务')
      Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
        ForEach(serviceEntries(), (entry: ServiceEntry) => {
          EntryCard({
            icon: entry.icon,
            title: entry.title,
            note: entry.note,
            ready: entry.ready,
            onSelect: (): void => {
              this.openEntry(entry);
            }
          });
        }, (entry: ServiceEntry) => entry.title + entry.route)
      }
      .width('100%')
      this.sectionTitle('服务记录')
      this.recordRow()
    }
    .width('100%')
    .height('100%')
    .padding(PAGE_PADDING)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.start_window_background'))
  }
}
