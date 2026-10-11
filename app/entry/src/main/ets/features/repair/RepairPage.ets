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

/**
 * 工作人员工作台骨架页（Issue #38 由他人开发，本阶段不新建业务页面）。
 * 页面标题由 HomePage 的 NavDestination 统一提供；这里只保留如实的未接入说明。
 */
@Component
export struct RepairPage {
  build() {
    Column({ space: GAP_LG }) {
      Row({ space: CARD_GAP }) {
        Text('工')
          .fontSize(FONT_HEADING)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_secondary'))
          .width(ICON_TILE)
          .height(ICON_TILE)
          .textAlign(TextAlign.Center)
          .backgroundColor($r('app.color.field_bg'))
          .borderRadius(CONTROL_RADIUS)
        Column({ space: GAP_XS }) {
          Text('页面骨架，未接入业务数据')
            .fontSize(FONT_SUBTITLE)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.text_primary'))
          Text('受理、状态更新与维修备案将在服务端授权和报修单模型完成后接入。')
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
    .width('100%')
    .height('100%')
    .padding(PAGE_PADDING)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.start_window_background'))
  }
}
