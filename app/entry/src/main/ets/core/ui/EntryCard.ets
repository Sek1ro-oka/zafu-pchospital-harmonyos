import {
  CARD_GAP,
  CARD_PADDING,
  CARD_RADIUS,
  FONT_NOTE,
  FONT_SUBTITLE,
  GAP_XS,
  ICON_TILE,
} from './Theme';
import { IconTile } from './IconTile';

/**
 * 入口卡片：图标砖在左、标题与说明在右（对照参考图服务页的双列功能卡）。
 * 首页与服务页共用，保证入口网格在全 app 一个样式。
 * `ready` 为 false 表示业务未接入：图标砖用灰底弱化，点击行为由调用方如实提示。
 * `hue` 选彩色图标砖的色相（见 IconTile），不传走蓝色对。
 */
@Component
export struct EntryCard {
  @Prop icon: string = '';
  @Prop title: string = '';
  @Prop note: string = '';
  @Prop hue: string = 'blue';
  @Prop ready: boolean = true;
  onSelect: () => void = () => {
  };

  build() {
    Row({ space: CARD_GAP }) {
      IconTile({
        icon: this.icon,
        hue: this.ready ? this.hue : '',
        sideLen: ICON_TILE
      })
      Column({ space: GAP_XS }) {
        Text(this.title)
          .fontSize(FONT_SUBTITLE)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(this.note)
          .fontSize(FONT_NOTE)
          .fontColor($r('app.color.text_secondary'))
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('48%')
    .padding(CARD_PADDING)
    .margin({ bottom: CARD_GAP })
    .alignItems(VerticalAlign.Center)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .onClick(() => {
      this.onSelect();
    })
  }
}
