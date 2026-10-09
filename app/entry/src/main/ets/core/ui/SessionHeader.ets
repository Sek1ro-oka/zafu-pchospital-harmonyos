import { CARD_RADIUS } from './Theme';

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
    Row({ space: 12 }) {
      Column({ space: 6 }) {
        Text(this.displayName === '' ? '未命名用户' : this.displayName)
          .fontSize(20)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Row({ space: 8 }) {
          Text(this.roleText)
            .fontSize(12)
            .fontColor($r('app.color.brand'))
            .padding({ left: 8, right: 8, top: 2, bottom: 2 })
            .backgroundColor($r('app.color.brand_soft'))
            .borderRadius(8)
          Text('已登录')
            .fontSize(12)
            .fontColor($r('app.color.text_secondary'))
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Button(this.busy ? '退出中…' : '退出')
        .fontSize(14)
        .height(36)
        .backgroundColor($r('app.color.brand_soft'))
        .fontColor($r('app.color.brand'))
        .enabled(!this.busy)
        .onClick(() => {
          this.handleLogout();
        })
    }
    .width('100%')
    .padding(16)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
  }
}
