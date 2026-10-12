/** 首页专用视觉组件；不改动服务、我的或其他业务页的主题。 */
@Component
export struct HomeReferenceHeader {
  onConsult: () => void = () => {};
  onSearch: () => void = () => {};
  onRepair: () => void = () => {};
  onRecords: () => void = () => {};

  @Builder
  roundAction(icon: Resource, label: string, action: () => void) {
    Button({ type: ButtonType.Circle }) {
      Image(icon).width(25).height(25).objectFit(ImageFit.Contain)
    }
    .width(44)
    .height(44)
    .backgroundColor('#45FFFFFF')
    .border({ width: 0.8, color: '#80FFFFFF' })
    .accessibilityText(label)
    .onClick(action)
  }

  build() {
    Column() {
      Row({ space: 10 }) {
        Text('首页')
          .fontSize(28)
          .fontWeight(FontWeight.Bold)
          .fontColor('#151713')
          .layoutWeight(1)
        this.roundAction($r('app.media.home_headset'), 'AI 故障问诊', this.onConsult)
        this.roundAction($r('app.media.home_message'), '查看报修记录', this.onRecords)
      }
      .width('100%')
      .height(64)
      .padding({ left: 18, right: 18, top: 6 })

      Button({ type: ButtonType.Normal }) {
        Row({ space: 10 }) {
          Image($r('app.media.home_search')).width(18).height(18)
          Text('搜索维修知识')
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor('#696347')
        }
        .width('100%')
        .padding({ left: 15, right: 15 })
      }
      .width('92%')
      .height(44)
      .backgroundColor('#50FFFFFF')
      .border({ width: 0.8, color: '#80FFF7CF' })
      .borderRadius(25)
      .clip(true)
      .shadow({ radius: 18, color: '#12B48328', offsetY: 8 })
      .accessibilityText('浏览公开维修指南')
      .onClick(this.onSearch)

      Column({ space: 6 }) {
        Text('电脑出问题？')
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .fontColor('#181A15')
        Text('先问诊或预约维修')
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .fontColor('#181A15')
        Text('校园电脑服务 · 从排查到维修')
          .fontSize(12)
          .fontColor('#57523B')
      }
      .width('100%')
      .margin({ top: 28, bottom: 5 })

      // 主视觉是项目自有 SVG 插画；不是接口数据或伪造的维修结果。
      Image($r('app.media.home_diagnosis_hero'))
        .width('100%')
        .aspectRatio(1.6)
        .objectFit(ImageFit.Contain)
        .accessibilityText('电脑、维修工具与健康盾牌插画')
        .margin({ bottom: 12 })


    }
    .width('100%')
    .linearGradient({ angle: 140, colors: [['#FFD786', 0], ['#FFF0B3', 0.46], ['#FFF8D8', 0.78], ['#FFEDC4', 1]] })
  }
}

@Component
export struct HomeQuickCard {
  title: string = '';
  icon: Resource = $r('app.media.home_consult');
  onSelect: () => void = () => {};

  build() {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 10 }) {
        Image(this.icon).width(38).height(38).objectFit(ImageFit.Contain)
        Text(this.title)
          .fontSize(11)
          .fontWeight(FontWeight.Medium)
          .fontColor('#171A1A')
          .maxLines(1)
      }
      .width('100%')
      .justifyContent(FlexAlign.Center)
    }
    .width('23.5%')
    .height(82)
    .backgroundColor('#FFFFFF')
    .borderRadius(15)
    .accessibilityText(this.title)
    .onClick(this.onSelect)
  }
}

/** 依照页面映射保留五个位置；活动提示未接入，知识库复用已有知识入口。 */
@Component
export struct HomeReferenceTabBar {
  @Prop currentTab: number = 0;
  @Prop staff: boolean = false;
  onSelect: (index: number) => void = () => {};

  @Builder
  item(index: number, label: string, icon: Resource, selectedIcon: Resource) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 3 }) {
        Image(this.currentTab === index ? selectedIcon : icon)
          .width(24)
          .height(24)
          .objectFit(ImageFit.Contain)
        Text(label)
          .fontSize(11)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.currentTab === index ? '#0674F8' : '#161B1C')
      }
      .justifyContent(FlexAlign.Center)
      .width('100%')
      .height('100%')
    }
    .layoutWeight(1)
    .height('100%')
    .backgroundColor(Color.Transparent)
    .borderRadius(30)
    .accessibilityText(label)
    .accessibilitySelected(this.currentTab === index)
    .onClick(() => this.onSelect(index))
  }

  build() {
    Stack() {
      // 真正模糊下层页面，再叠加透明反光；不使用不透明蓝色填充。
      Image($r('app.media.home_nav_glass'))
        .width('100%').height('100%').objectFit(ImageFit.Fill)
        .hitTestBehavior(HitTestMode.None)
      Row() {
        this.item(0, '首页', $r('app.media.home_nav_home'), $r('app.media.home_nav_home_active'))
        this.item(-1, '活动', $r('app.media.home_nav_activity'), $r('app.media.home_nav_activity'))
        this.item(1, this.staff ? '工作台' : '服务', $r('app.media.home_headset'), $r('app.media.home_headset_active'))
        this.item(-2, '知识', $r('app.media.home_nav_knowledge'), $r('app.media.home_nav_knowledge'))
        this.item(2, '我的', $r('app.media.home_nav_profile'), $r('app.media.home_nav_profile_active'))
      }
      .width('100%').height('100%')
      .padding({ left: 8, right: 8 })
    }
    .width('84%')
    .height(54)
    .backgroundEffect({ radius: 11, saturation: 1.5, brightness: 1.03, color: '#18B6CDF6' })
    .borderRadius(34)
    .clip(true)
    .shadow({ radius: 16, color: '#303C526F', offsetY: 7 })
    .margin({ bottom: 12 })
  }
}
