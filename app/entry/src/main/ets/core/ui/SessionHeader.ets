import {
  CARD_GAP,
  CARD_PADDING,
  CARD_RADIUS,
  CHIP_RADIUS,
  CONTROL_HEIGHT_SM,
  FONT_CHIP,
  FONT_HEADING,
  FONT_TEXT,
  GAP_SM,
} from './Theme';

/** 登录身份条：显示服务端返回的姓名与角色，提供退出。 */
@Component
export struct SessionHeader {
  @Prop displayName: string = '';
  @Prop roleText: string = '';
  onLogout: () => Promise<void> = async () => {
  };
  @State busy: boolean = false;

  private async handleLogout(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      await this.onLogout();
    } finally {
      this.busy = false;
    }
  }

  build() {
    Row({ space: CARD_GAP }) {
      Column({ space: GAP_SM }) {
        Text(this.displayName === '' ? '未命名用户' : this.displayName)
          .fontSize(FONT_HEADING)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Row({ space: GAP_SM }) {
          Text(this.roleText)
            .fontSize(FONT_CHIP)
            .fontColor($r('app.color.brand'))
            .padding({ left: GAP_SM, right: GAP_SM, top: 2, bottom: 2 })
            .backgroundColor($r('app.color.brand_soft'))
            .borderRadius(CHIP_RADIUS)
          Text('已登录')
            .fontSize(FONT_CHIP)
            .fontColor($r('app.color.text_secondary'))
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Button(this.busy ? '退出中…' : '退出')
        .fontSize(FONT_TEXT)
        .height(CONTROL_HEIGHT_SM)
        .backgroundColor($r('app.color.brand_soft'))
        .fontColor($r('app.color.brand'))
        .enabled(!this.busy)
        .onClick(() => {
          this.handleLogout();
        })
    }
    .width('100%')
    .padding(CARD_PADDING)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
  }
}
