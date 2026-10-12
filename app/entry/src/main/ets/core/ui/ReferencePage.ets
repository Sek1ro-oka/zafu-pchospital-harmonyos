/** 四个主页面共用参考图比例；首页保持自身布局。 */
export const REFERENCE_BACKGROUND: string = '#F0F5F8';
export const REFERENCE_INSET: number = 16;
export const REFERENCE_RADIUS: number = 20;
export const TAB_SLIDE_DURATION: number = 260;

@Component
export struct ReferenceRoundAction {
  icon: Resource = $r('app.media.home_search');
  label: string = '';
  onSelect: () => void = () => {};
  build() {
    Button({ type: ButtonType.Circle }) {
      Image(this.icon).width(25).height(25).objectFit(ImageFit.Contain)
    }.width(42).height(42).backgroundColor('#30FFFFFF')
      .border({ width: 0.8, color: '#E8FFFFFF' })
      .accessibilityText(this.label).onClick(this.onSelect)
  }
}

@Component
export struct ReferenceTitle {
  @Prop title: string = '';
  onConsult: () => void = () => {};
  onRecords: () => void = () => {};
  build() {
    Row({ space: 8 }) {
      Text(this.title).fontSize(28).fontWeight(FontWeight.Bold).fontColor('#101416').layoutWeight(1)
      ReferenceRoundAction({ icon: $r('app.media.home_headset'), label: 'AI 故障问诊', onSelect: this.onConsult })
      ReferenceRoundAction({ icon: $r('app.media.home_message'), label: '查看记录', onSelect: this.onRecords })
    }.width('100%').height(50)
  }
}

@Component
export struct ReferenceSearch {
  @Link text: string;
  placeholder: string = '';
  build() {
    Row({ space: 10 }) {
      Image($r('app.media.home_search')).width(17).height(17)
      TextInput({ text: $$this.text, placeholder: this.placeholder })
        .fontSize(16).height(40).layoutWeight(1).backgroundColor(Color.Transparent)
        .padding(0).placeholderColor('#73777A')
    }.height(44).width('100%').padding({ left: 14, right: 14 })
      .backgroundColor('#30FFFFFF').border({ width: 0.8, color: '#FFFFFF' }).borderRadius(25)
      .shadow({ radius: 18, color: '#12677880', offsetY: 8 })
  }
}

@Component
export struct ReferenceShortcut {
  @Prop title: string = '';
  icon: Resource = $r('app.media.ref_document');
  @Prop note: string = '';
  itemWidth: string = '25%';
  onSelect: () => void = () => {};
  build() {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 8 }) {
        Image(this.icon).width(32).height(32).objectFit(ImageFit.Contain)
        Text(this.title).fontSize(12).fontWeight(FontWeight.Medium).fontColor('#151A1D').maxLines(1)
        if (this.note !== '') { Text(this.note).fontSize(9).fontColor('#7A8288') }
      }.width('100%').padding({ top: 8, bottom: 8 })
    }.width(this.itemWidth).backgroundColor(Color.Transparent).borderRadius(14)
      .accessibilityText(this.note === '' ? this.title : `${this.title}，${this.note}`)
      .onClick(this.onSelect)
  }
}

@Component
export struct ReferenceBanner {
  title: string = '';
  subtitle: string = '';
  image: Resource = $r('app.media.ref_laptop_hero');
  tall: boolean = false;
  violet: boolean = false;
  actionText: string = '';
  bannerHeight: number = 200;
  onSelect: () => void = () => {};
  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Image(this.image).width('100%').height('100%').objectFit(ImageFit.Contain)
        .hitTestBehavior(HitTestMode.None)
      Column({ space: 5 }) {
        Text(this.title).fontSize(this.tall ? 21 : 20).fontWeight(FontWeight.Bold).fontColor('#11151B')
        Text(this.subtitle).fontSize(14).fontColor('#62666C')
        if (this.actionText !== '') {
          Button(this.actionText).fontSize(14).height(30).padding({ left: 14, right: 14 })
            .fontColor(this.violet ? '#6950E8' : '#146DD6').backgroundColor('#EEFFFFFF')
            .border({ width: 0.6, color: '#D5CFEE' }).margin({ top: 9 }).onClick(this.onSelect)
        }
      }.alignItems(HorizontalAlign.Start).padding(14).width(this.tall ? '100%' : '66%')
        .margin({ top: this.tall ? 3 : (this.bannerHeight < 200 ? 20 : 44) })
    }.width('100%').height(this.tall ? 355 : this.bannerHeight)
      .linearGradient({ angle: 145, colors: this.violet
        ? [['#FFFFFF', 0], ['#F6F4FF', 0.46], ['#D7D1FE', 1]]
        : [['#F7DEC7', 0], ['#FFFFFF', 0.5], ['#F4DBBE', 1]] })
      .borderRadius(REFERENCE_RADIUS).clip(true)
  }
}
