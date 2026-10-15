/** 子页面参照图的共用材质和尺寸，系统状态栏保持系统绘制。 */
export const DETAIL_BACKGROUND: string = '#F1F6F9';

@Component
export struct DetailRoundButton {
  icon: Resource = $r('app.media.detail_back');
  label: string = '返回';
  onSelect: () => void = () => {};
  build() {
    Button({ type: ButtonType.Circle }) {
      Image(this.icon).width(24).height(24).objectFit(ImageFit.Contain)
    }.width(44).height(44).backgroundColor('#E7ECEF')
      .accessibilityText(this.label).onClick(this.onSelect)
  }
}

@Component
export struct DetailHeader {
  title: string = '';
  onBack: () => void = () => {};
  onRefresh: () => void = () => {};
  refresh: boolean = false;
  build() {
    Row({ space: 16 }) {
      DetailRoundButton({ onSelect: this.onBack })
      Text(this.title).fontSize(22).fontWeight(FontWeight.Bold).fontColor('#101416').layoutWeight(1)
      if (this.refresh) {
        DetailRoundButton({ icon: $r('app.media.detail_refresh'), label: '刷新', onSelect: this.onRefresh })
      }
    }.width('100%').height(60).padding({ left: 16, right: 16 })
  }
}

@Component
export struct DetailNotice {
  text: string = '';
  build() {
    Row({ space: 10 }) {
      Image($r('app.media.detail_info')).width(20).height(20)
      Text(this.text).fontSize(15).lineHeight(23).fontColor('#242A2E').layoutWeight(1)
    }.width('100%').padding({ left: 14, right: 14, top: 12, bottom: 12 })
      .backgroundColor('#E5EAEE').borderRadius(20)
  }
}

@Component
export struct DetailEmptyOrders {
  text: string = '您还没有报修单';
  build() {
    Column({ space: 26 }) {
      Image($r('app.media.detail_orders_empty')).width(118).height(108).objectFit(ImageFit.Contain)
      Text(this.text).fontSize(16).fontColor('#969EA4').textAlign(TextAlign.Center)
    }.width('100%').height('100%').justifyContent(FlexAlign.Center).padding({ bottom: 20 })
  }
}
