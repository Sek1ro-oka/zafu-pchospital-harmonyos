/** Issue #75：参考图的阅读层级，不包含业务状态或接口。 */

@Component
export struct ReadingSectionLabel {
  @Prop text: string = '';
  build() {
    Row({ space: 8 }) {
      Image($r('app.media.detail_info')).width(16).height(16).opacity(0.6)
      Text(this.text).fontSize(16).fontWeight(FontWeight.Medium).fontColor('#697176')
    }.width('100%').margin({ top: 18, bottom: 10 })
  }
}

@Component
export struct RepairDeviceCard {
  @Prop model: string = '';
  @Prop serial: string | null = null;
  @Prop status: string = '';
  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Row({ space: 16 }) {
        Image($r('app.media.reading_laptop')).width(45).height(56).objectFit(ImageFit.Contain)
        Column({ space: 7 }) {
          Text(this.model).fontSize(18).fontWeight(FontWeight.Medium).fontColor('#14191D').width('100%')
          Text(`序列号 ${this.serial || '未填写'}`).fontSize(13).fontColor('#858D93').width('100%')
          Text(this.status).fontSize(14).fontWeight(FontWeight.Medium).fontColor('#0877DF').width('100%')
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }.width('100%').padding({ left: 22, right: 18, top: 25, bottom: 20 })
      Text('报修设备').fontSize(10).fontColor(Color.White).padding({ left: 10, right: 10, top: 3, bottom: 3 })
        .backgroundColor('#82C8DC').borderRadius({ topLeft: 22, bottomRight: 16 })
    }.width('100%').backgroundColor(Color.White).borderRadius(22).clip(true)
  }
}

@Component
export struct ReadingStatusCard {
  @Prop title: string = '';
  @Prop subtitle: string = '';
  @Prop text: string = '';
  icon: Resource = $r('app.media.ref_shield');
  build() {
    Row({ space: 14 }) {
      Column({ space: 10 }) {
        Text(this.title).fontSize(18).fontWeight(FontWeight.Medium).fontColor('#171D21').width('100%')
        if (this.subtitle !== '') { Text(this.subtitle).fontSize(14).fontColor('#818A90').width('100%') }
        if (this.text !== '') { Text(this.text).fontSize(13).lineHeight(21).fontColor('#818A90').width('100%') }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Image(this.icon).width(40).height(40).objectFit(ImageFit.Contain)
    }.width('100%').padding(18).constraintSize({ minHeight: 124 }).alignItems(VerticalAlign.Top)
      .linearGradient({ angle: 115, colors: [['#FFFFFF', 0], ['#FFFFFF', 0.4], ['#F4F8FF', 1]] })
      .borderRadius(22)
  }
}

@Component
export struct ReadingAuthor {
  @Prop name: string = '';
  @Prop note: string = '';
  build() {
    Row({ space: 12 }) {
      Image($r('app.media.ref_shield')).width(40).height(40).objectFit(ImageFit.Contain)
      Column({ space: 5 }) {
        Text(this.name).fontSize(15).fontWeight(FontWeight.Medium).fontColor('#171C20')
        Text(this.note).fontSize(12).fontColor('#879095').maxLines(3)
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
    }.width('100%').padding({ top: 16, bottom: 26 })
  }
}

@Component
export struct ReadingBottomBar {
  @Prop text: string = '';
  @Prop action: string = '';
  @Prop actionEnabled: boolean = true;
  onSelect: () => void = () => {};
  build() {
    Row({ space: 14 }) {
      Text(this.text).fontSize(13).fontColor('#7B8389').lineHeight(20).layoutWeight(1)
      if (this.action !== '') {
        Button({ type: ButtonType.Normal }) {
          Column({ space: 2 }) {
            Image($r('app.media.reading_star')).width(24).height(24)
            Text(this.action).fontSize(11).fontColor('#343C42')
          }
        }.height(48).padding({ left: 12, right: 12 }).backgroundColor(Color.Transparent)
          .enabled(this.actionEnabled).onClick(this.onSelect)
      }
    }.width('100%').constraintSize({ minHeight: 62 }).padding({ left: 18, right: 18, top: 5, bottom: 5 })
      .backgroundColor(Color.White).border({ width: { top: 0.5 }, color: '#EDF0F2' })
  }
}

@Component
export struct ReadingLibraryHero {
  @Prop title: string = '维修案例库';
  @Prop scope: string = '';
  @Prop loaded: number = 0;
  onBack: () => void = () => {};
  onRefresh: () => void = () => {};
  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Image($r('app.media.reading_library_hero')).width('100%').height(226).objectFit(ImageFit.Cover)
        .hitTestBehavior(HitTestMode.None)
      Column({ space: 18 }) {
        Row() {
          Button({ type: ButtonType.Circle }) {
            Image($r('app.media.reading_back_light')).width(24).height(24)
          }.width(44).height(44).backgroundColor('#665B6B7C').accessibilityText('返回').onClick(this.onBack)
          Blank()
          Button({ type: ButtonType.Circle }) {
            Image($r('app.media.reading_refresh_light')).width(24).height(24)
          }.width(44).height(44).backgroundColor('#665B6B7C').accessibilityText('刷新案例').onClick(this.onRefresh)
        }.width('100%')
        Column({ space: 6 }) {
          Text(this.title).fontSize(23).fontWeight(FontWeight.Bold).fontColor(Color.White)
          Text(`${this.scope} · 已加载 ${this.loaded} 条`).fontSize(13).fontColor('#D7E4EF')
        }.width('100%').alignItems(HorizontalAlign.Start)
        Row({ space: 8 }) {
          this.tile('审核来源', $r('app.media.ref_shield'))
          this.tile('AI 整理', $r('app.media.ref_system'))
          this.tile('故障经验', $r('app.media.ref_repair'))
          this.tile('证据可查', $r('app.media.ref_document'))
        }.width('100%')
      }.width('100%').padding({ left: 18, right: 18, top: 12 })
    }.width('100%').height(236).backgroundColor('#0C1723')
  }
  @Builder
  tile(label: string, icon: Resource) {
    Column({ space: 7 }) {
      Image(icon).width(27).height(27).objectFit(ImageFit.Contain)
      Text(label).fontSize(12).fontWeight(FontWeight.Medium).fontColor(Color.White)
    }.layoutWeight(1).height(64).justifyContent(FlexAlign.Center).backgroundColor('#665D6A79').borderRadius(17)
  }
}
