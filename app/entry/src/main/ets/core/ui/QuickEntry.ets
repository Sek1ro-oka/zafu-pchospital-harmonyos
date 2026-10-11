import {
  CARD_PADDING_SM,
  CARD_RADIUS,
  FONT_TEXT,
  GAP_SM,
  ICON_TILE,
} from './Theme';
import { IconTile } from './IconTile';

/**
 * 快捷入口（图标在上、文字在下）。
 *
 * 对照参考图首页「快捷服务」四列白卡网格与「我的」页「我的信息」四列
 * 图标网格：图标砖居上、单行文字居下，一屏一排四个。
 * `ready` 为 false 表示业务未接入：灰砖弱化，点击行为由调用方如实提示。
 */
@Component
export struct QuickEntry {
  @Prop icon: string = '';
  @Prop title: string = '';
  @Prop hue: string = 'blue';
  @Prop ready: boolean = true;
  onSelect: () => void = () => {
  };

  build() {
    Column({ space: GAP_SM }) {
      IconTile({
        icon: this.icon,
        hue: this.ready ? this.hue : '',
        sideLen: ICON_TILE
      })
      Text(this.title)
        .fontSize(FONT_TEXT)
        .fontColor($r('app.color.text_primary'))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('23.5%')
    .padding({ top: CARD_PADDING_SM, bottom: CARD_PADDING_SM })
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .alignItems(HorizontalAlign.Center)
    .onClick(() => {
      this.onSelect();
    })
  }
}
