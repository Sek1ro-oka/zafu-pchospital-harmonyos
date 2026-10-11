import {
  CONTROL_RADIUS,
  FONT_HEADING,
  ICON_TILE,
} from './Theme';

/**
 * 彩色图标砖（本轮重设计的统一图标语言）。
 *
 * 参考图的图标配色是「柔和底色 + 同系前景色」的多彩色对，工程无图片资源，
 * 因此沿用 #41 的「色块 + 单字」方案，但把单色灰蓝扩展为七个色对：
 * 色对定义在 resources/base/element/color.json（tile_*_bg / tile_*_fg），
 * 这里按传入的 hue 键取色；取不到的 hue 回退到蓝色对而不是崩。
 * 未接入的能力不传 hue（空串），渲染灰砖如实弱化。
 */
@Component
export struct IconTile {
  /** 图标砖上的单字。 */
  @Prop icon: string = '';
  /** 色相键：orange / green / blue / purple / teal / red / gold；空串 = 未接入灰砖。 */
  @Prop hue: string = '';
  /** 砖的边长；进度条等场景可传小尺寸。 */
  @Prop sideLen: number = ICON_TILE;

  private bgColor(): Resource {
    if (this.hue === '') {
      return $r('app.color.field_bg');
    }
    if (this.hue === 'orange') {
      return $r('app.color.tile_orange_bg');
    }
    if (this.hue === 'green') {
      return $r('app.color.tile_green_bg');
    }
    if (this.hue === 'purple') {
      return $r('app.color.tile_purple_bg');
    }
    if (this.hue === 'teal') {
      return $r('app.color.tile_teal_bg');
    }
    if (this.hue === 'red') {
      return $r('app.color.tile_red_bg');
    }
    if (this.hue === 'gold') {
      return $r('app.color.tile_gold_bg');
    }
    return $r('app.color.tile_blue_bg');
  }

  private fgColor(): Resource {
    if (this.hue === '') {
      return $r('app.color.text_secondary');
    }
    if (this.hue === 'orange') {
      return $r('app.color.tile_orange_fg');
    }
    if (this.hue === 'green') {
      return $r('app.color.tile_green_fg');
    }
    if (this.hue === 'purple') {
      return $r('app.color.tile_purple_fg');
    }
    if (this.hue === 'teal') {
      return $r('app.color.tile_teal_fg');
    }
    if (this.hue === 'red') {
      return $r('app.color.tile_red_fg');
    }
    if (this.hue === 'gold') {
      return $r('app.color.tile_gold_fg');
    }
    return $r('app.color.tile_blue_fg');
  }

  build() {
    Text(this.icon)
      .fontSize(this.sideLen < ICON_TILE ? this.sideLen * 0.5 : FONT_HEADING)
      .fontWeight(FontWeight.Medium)
      .fontColor(this.fgColor())
      .width(this.sideLen)
      .height(this.sideLen)
      .textAlign(TextAlign.Center)
      .backgroundColor(this.bgColor())
      .borderRadius(CONTROL_RADIUS)
  }
}
