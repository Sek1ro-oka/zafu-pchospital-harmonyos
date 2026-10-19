import { CATEGORIES, GUIDES, PERSONAL, DemoGuide, searchGuides, futureModule } from './DemoData';
@Component
export struct NavigationDemo {
  @State tab: number = 0;
  @State role: string = '游客';
  @State reduceMotion: boolean = false;
  @State category: string = '全部';
  @State query: string = '';
  @State dataState: string = '内容';
  @State forum: boolean = false;
  @State savedIds: string[] = [];
  @State notice: string = '';
  private stack: NavPathStack = new NavPathStack();
  private tabs: TabsController = new TabsController();
  private pending: string = '';
  private pendingGuideId: string = '';
  @State guideId: string = 'demo-boot';
  private staff(): boolean { return this.role === '工作人员' || this.role === '管理员'; }
  private setBarTone(tone: string): void { AppStorage.setOrCreate('demoBarTone', tone); }
  private open(name: string): void { this.setBarTone('light'); this.stack.pushPathByName(name, null); }
  private select(index: number): void {
    if (index === 4 && this.role === '游客') { this.pending = '@my'; this.open('登录'); return; }
    this.tab = index; this.tabs.changeIndex(index); this.setBarTone(index === 0 ? 'gold' : 'light');
  }
  private guarded(name: string): void {
    if (this.role === '游客') {
      this.pending = name; this.pendingGuideId = name === '收藏操作' ? this.guideId : ''; this.open('登录');
    } else if (name === '收藏操作') {
      const existed: boolean = this.savedIds.includes(this.guideId);
      this.savedIds = existed ? this.savedIds.filter((id: string): boolean => id !== this.guideId) : this.savedIds.concat(this.guideId);
      this.notice = existed ? '演示收藏已取消' : '演示收藏已加入（仅内存）';
    }
    else this.open(name);
  }
  private login(role: string): void {
    this.role = role; const target: string = this.pending;
    if (target === '收藏操作' && this.pendingGuideId !== '') this.guideId = this.pendingGuideId;
    this.pending = ''; this.pendingGuideId = ''; this.stack.pop();
    if (target === '@my') this.select(4); else if (target !== '') this.guarded(target);
  }
  private reset(role: string): void {
    this.role = role; this.savedIds = []; this.notice = ''; this.pending = ''; this.pendingGuideId = ''; this.stack.clear();
    if (role === '游客') this.select(0);
  }
  private guide(): DemoGuide { return GUIDES.find((g: DemoGuide): boolean => g.id === this.guideId) || GUIDES[0]; }
  private openGuide(id: string): void { this.guideId = id; this.notice = ''; this.open('阅读指南'); }
  @Builder
  link(title: string, subtitle: string, action: () => void) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 10 }) {
        Column({ space: 5 }) {
          Text(title).fontSize(17).fontWeight(FontWeight.Medium).fontColor('#18222D')
          Text(subtitle).fontSize(12).fontColor('#667585').maxLines(3)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Text('›').fontSize(24).fontColor('#82909F')
      }.width('100%').padding(17)
    }.width('100%').backgroundColor('#FFFFFF').borderRadius(22).onClick(action)
  }
  @Builder
  heading(title: string, subtitle: string) {
    Column({ space: 7 }) {
      Text(title).fontSize(29).fontWeight(FontWeight.Bold).fontColor('#17202A')
      Text(subtitle).fontSize(13).fontColor('#63717E')
    }.width('100%').alignItems(HorizontalAlign.Start).margin({ top: 8, bottom: 10 })
  }
  private icon(title: string): Resource {
    if (title.includes('问诊')) return $r('app.media.home_consult');
    if (title.includes('帮助') || title.includes('指南') || title.includes('故障')) return $r('app.media.ref_shield');
    if (title.includes('收藏') || title.includes('好物')) return $r('app.media.reading_star');
    if (title.includes('进度')) return $r('app.media.home_progress');
    if (title.includes('报修') || title.includes('处理')) return $r('app.media.ref_repair');
    if (title.includes('审核')) return $r('app.media.ref_scan');
    if (title.includes('备案') || title.includes('记录')) return $r('app.media.detail_book');
    if (title.includes('网络')) return $r('app.media.ref_network');
    if (title.includes('散热') || title.includes('工具')) return $r('app.media.ref_cooling');
    if (title.includes('系统')) return $r('app.media.ref_system');
    if (title.includes('开机')) return $r('app.media.ref_boot');
    if (title.includes('现场')) return $r('app.media.ref_activity');
    if (title.includes('活动') || title.includes('报名')) return $r('app.media.ref_flag');
    if (title.includes('消息')) return $r('app.media.ref_message');
    if (title.includes('帖子')) return $r('app.media.home_message');
    if (title.includes('卖家')) return $r('app.media.detail_grid');
    if (title.includes('订单')) return $r('app.media.detail_orders_empty');
    if (title.includes('商品') || title.includes('选购')) return $r('app.media.demo_shop');
    if (title.includes('配件')) return $r('app.media.detail_device');
    if (title.includes('外设') || title.includes('数码')) return $r('app.media.home_headset');
    if (title.includes('耗材')) return $r('app.media.home_repair');
    if (title.includes('分类')) return $r('app.media.ref_grid');
    if (title.includes('资料')) return $r('app.media.ref_profile');
    if (title.includes('电脑') || title.includes('笔记本')) return $r('app.media.reading_laptop');
    if (title.includes('磁盘') || title.includes('存储')) return $r('app.media.ref_disk');
    return $r('app.media.ref_document');
  }
  private entry(title: string): void {
    if (title === '知识与帮助' || title === '维修指南') this.open('知识中心');
    else if (title === '近期活动') this.select(1);
    else if (title === '校园活动') { this.forum = false; this.select(1); }
    else if (title === '校园选购') this.select(3);
    else if (title === 'AI 问诊') this.open('AI 问诊');
    else if (['处理报修', '维修备案', '备案审核', '活动现场'].includes(title)) this.open(this.staff() ? title : '工作人员权限');
    else this.guarded(title);
  }
  @Builder
  tool(icon: Resource, title: string, action: () => void) {
    Button({ type: ButtonType.Circle }) { Image(icon).width(23).height(23) }
      .width(40).height(40).backgroundColor('#65FFFFFF').border({ width: 1, color: '#AAFFFFFF' })
      .accessibilityText(title).onClick(action)
  }
  @Builder
  top(title: string) {
    Row({ space: 8 }) {
      Text(title).fontSize(28).fontWeight(FontWeight.Bold).layoutWeight(1)
      Text('演示版').fontSize(10).fontColor('#687178').padding({ left: 7, right: 7, top: 4, bottom: 4 }).backgroundColor('#65FFFFFF').borderRadius(8)
      this.tool($r('app.media.home_headset'), '知识与帮助', () => this.open('知识中心'))
      this.tool($r('app.media.ref_grid'), '演示设置', () => this.open('演示设置'))
    }.width('100%').padding({ top: 10, bottom: 8 })
  }
  @Builder
  search(label: string, action: () => void) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 10 }) {
        Image($r('app.media.home_search')).width(20).height(20)
        Text(label).fontSize(15).fontColor('#636968')
        Blank()
      }.width('100%').padding({ left: 14, right: 14 })
    }.width('100%').height(42).backgroundColor('#65FFFFFF').borderRadius(24)
      .border({ width: 1, color: '#CCFFFFFF' }).borderRadius(24).onClick(action)
  }
  @Builder
  dots() {
    Row({ space: 4 }) {
      ForEach([0, 1, 2, 3, 4], (n: number) => {
        Row().height(2).layoutWeight(1).backgroundColor(n === 0 ? '#242A2D' : '#30242A2D').borderRadius(2)
      })
    }.width('100%').padding({ top: 12, bottom: 3 })
  }
  @Builder
  sectionTitle(title: string) {
    Row() {
      Text(title).fontSize(20).fontWeight(FontWeight.Bold)
      Blank()
    }.width('100%').margin({ top: 12, bottom: 5 })
  }
  @Builder
  shortcuts(titles: string[], card: boolean) {
    Row({ space: 7 }) {
      ForEach(titles, (title: string) => {
        Button({ type: ButtonType.Normal }) {
          Column({ space: 9 }) {
            Image(this.icon(title)).width(31).height(31).objectFit(ImageFit.Contain)
            Text(title).fontSize(12).fontColor('#252D33').maxLines(1)
          }.width('100%').padding({ top: 15, bottom: 14 })
        }.layoutWeight(1).backgroundColor(card ? '#FFFFFF' : Color.Transparent).borderRadius(18)
          .accessibilityText(title).onClick(() => this.entry(title))
      })
    }.width('100%')
  }
  @Builder
  tile(title: string, subtitle: string) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 9 }) {
        Image(this.icon(title)).width(34).height(38).objectFit(ImageFit.Contain)
        Column({ space: 5 }) {
          Text(title).fontSize(14).fontWeight(FontWeight.Bold).fontColor('#20272C')
          Text(subtitle).fontSize(10).fontColor('#6B7278').maxLines(2)
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      }.width('100%').height(83).padding(13)
    }.layoutWeight(1).borderRadius(22).backgroundColor('#FFFFFF').onClick(() => this.entry(title))
  }
  @Builder
  home() {
    Column({ space: 12 }) {
      Column({ space: 10 }) {
        this.top('首页')
        this.search('搜索维修知识', () => this.open('知识搜索'))
        Column({ space: 6 }) {
          Text('电脑出问题？').fontSize(27).fontWeight(FontWeight.Bold)
          Text('先找方法，再找帮手').fontSize(19).fontWeight(FontWeight.Medium)
          Text('校园电脑医院 · 让服务更近一步').fontSize(12).fontColor('#66583E')
          Image($r('app.media.ref_laptop_hero')).width('100%').height(242).objectFit(ImageFit.Contain)
        }.width('100%').padding({ top: 20 })
        this.dots()
      }.width('100%').padding({ left: 16, right: 16, bottom: 12 })
        .linearGradient({ angle: 130, colors: [['#FFD27B', 0], ['#FFEBA6', 0.5], ['#FFF8CE', 1]] })
      Column({ space: 11 }) {
        Row({ space: 6 }) {
          ForEach(['推荐', '活动', '维修', '好物'], (title: string, index: number) => {
            Button(title).layoutWeight(1).height(35).fontSize(13).fontColor(index === 0 ? '#FFFFFF' : '#283035')
              .backgroundColor(index === 0 ? '#283132' : '#FFFFFF').onClick(() => {
                if (index === 1) this.select(1); else if (index === 2) this.select(2); else if (index === 3) this.select(3);
              })
          })
        }.width('100%')
        this.sectionTitle('快捷服务')
        this.shortcuts(['AI 问诊', '我要报修', '报修进度', '近期活动'], true)
        this.sectionTitle('校园服务')
        this.link('知识与帮助', '查看维修指南与故障分类', () => this.open('知识中心'))
        this.link('校园选购', '二手与维修耗材 · 建设中', () => this.select(3))
      }.padding({ left: 16, right: 16 }).width('100%')
    }.width('100%')
  }
  @Builder
  service() {
    if (this.staff()) { this.top('工作台') } else { this.top('我的电脑') }
    Row({ space: 12 }) {
      Image($r('app.media.reading_laptop')).width(92).height(100).objectFit(ImageFit.Contain)
      Column({ space: 9 }) {
        Text(this.staff() ? '维修服务工作台' : '尚未关联报修设备').fontSize(18).fontWeight(FontWeight.Bold)
        Text('演示版 · 未接入设备数据').fontSize(11).fontColor('#6D747A')
        Row({ space: 5 }) {
          Text('校园维修').fontSize(10).padding(5).backgroundColor('#F1F3F5').borderRadius(10)
          Text('知识与帮助').fontSize(10).padding(5).backgroundColor('#F1F3F5').borderRadius(10)
        }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
    }.width('100%').height(149).padding(18).backgroundColor('#FFFFFF').borderRadius(25)
    if (this.staff()) {
      Row({ space: 8 }) { this.tile('处理报修', '受理与维修进度'); this.tile('维修备案', '记录维修过程') }.width('100%')
      Row({ space: 8 }) { this.tile('备案审核', '单独审核权限'); this.tile('活动现场', '现场服务与接待') }.width('100%')
    } else {
      Row({ space: 8 }) { this.tile('知识与帮助', '定位故障，自助查阅'); this.tile('AI 问诊', '描述现象，理清问题') }.width('100%')
      Row({ space: 8 }) { this.tile('我要报修', '提交设备与故障'); this.tile('报修进度', '查看维修节点') }.width('100%')
    }
    this.sectionTitle('精选服务')
    Stack({ alignContent: Alignment.Start }) {
      Image($r('app.media.ref_service_hero')).width('100%').height(157).objectFit(ImageFit.Cover)
      Column({ space: 9 }) {
        Text('懂你的电脑').fontSize(21).fontWeight(FontWeight.Bold)
        Text('从日常维护开始').fontSize(13).fontColor('#697278')
        Button('查看维修指南  ›').fontSize(11).fontColor('#2069C4').backgroundColor('#EDF4FE').height(28).onClick(() => this.open('知识中心'))
      }.padding(20).alignItems(HorizontalAlign.Start)
    }.width('100%').height(157).backgroundColor('#FFFFFF').borderRadius(24).clip(true)
    this.sectionTitle('快捷服务')
    this.shortcuts(['知识与帮助', 'AI 问诊', '报修进度', '我的报名'], false)
  }
  @Builder
  shopping() {
    this.top('选购')
    this.search('搜索二手与维修耗材', () => this.open('选购待接入'))
    Stack({ alignContent: Alignment.TopStart }) {
      Image($r('app.media.ref_laptop_hero')).width('100%').height(310).objectFit(ImageFit.Contain).margin({ top: 43 })
      Column({ space: 6 }) {
        Text('让闲置继续发光').fontSize(24).fontWeight(FontWeight.Bold)
        Text('校园二手 · 电脑配件 · 维修耗材').fontSize(12).fontColor('#8C6249')
      }.padding(19).alignItems(HorizontalAlign.Start)
    }.width('100%').height(337).linearGradient({ angle: 140, colors: [['#FCE0CB', 0], ['#FFF9F1', 0.5], ['#F8E2CB', 1]] }).borderRadius(24).clip(true)
    this.dots()
    Row({ space: 5 }) { this.shopCategory('笔记本电脑'); this.shopCategory('电脑配件'); this.shopCategory('存储设备'); this.shopCategory('外设数码') }.width('100%')
    Row({ space: 5 }) { this.shopCategory('维修耗材'); this.shopCategory('散热工具'); this.shopCategory('二手好物'); this.shopCategory('全部分类') }.width('100%')
    this.sectionTitle('校园好物')
    Column({ space: 10 }) {
      Image($r('app.media.detail_orders_empty')).width(60).height(60)
      Text('选购功能建设中').fontSize(17).fontWeight(FontWeight.Medium)
      Text('暂无法下单，商品将在接入后展示').fontSize(12).fontColor('#7D858C')
      Button('发布二手商品').fontSize(12).height(32).backgroundColor('#EAF2FF').fontColor('#176BE1').onClick(() => this.guarded('发布二手商品'))
    }.padding(23).width('100%').backgroundColor('#FFFFFF').borderRadius(24)
  }
  @Builder
  shopCategory(title: string) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 7 }) {
        Image(this.icon(title)).width(36).height(36).objectFit(ImageFit.Contain)
        Text(title).fontSize(11).fontColor('#242B31')
      }.padding({ top: 10, bottom: 10 }).width('100%')
    }.layoutWeight(1).backgroundColor(Color.Transparent).onClick(() => this.open('选购待接入'))
  }
  @Builder
  community() {
    Row({ space: 16 }) {
      this.tool($r('app.media.ref_grid'), '演示设置', () => this.open('演示设置'))
      Button('活动').fontSize(this.forum ? 21 : 27).fontWeight(FontWeight.Bold).fontColor(this.forum ? '#7A8086' : '#151B20').backgroundColor(Color.Transparent).padding(0).onClick(() => this.forum = false)
      Button('论坛').fontSize(this.forum ? 27 : 21).fontWeight(FontWeight.Bold).fontColor(this.forum ? '#151B20' : '#7A8086').backgroundColor(Color.Transparent).padding(0).onClick(() => this.forum = true)
      Blank()
      Text('演示版').fontSize(10).fontColor('#7A8086')
    }.width('100%').padding({ top: 10, bottom: 8 })
    if (this.forum) {
      this.search('寻找校园帖子', () => this.open('论坛搜索'))
    } else {
      this.search('寻找校园维修活动', () => this.open('活动搜索'))
    }
    Stack({ alignContent: Alignment.Start }) {
      Image($r('app.media.ref_activity_hero')).width('100%').height(205).objectFit(ImageFit.Cover)
      Column({ space: 9 }) {
        Text(this.forum ? '校园交流' : '一起服务校园').fontSize(24).fontWeight(FontWeight.Bold).fontColor('#6152BD')
        Text(this.forum ? '让经验在校园里流动' : '在交流中，找到解决方法').fontSize(12)
        Button(this.forum ? '我的帖子  ›' : '我的报名  ›').fontSize(11).height(30).fontColor('#6152BD').backgroundColor('#FFFFFF').onClick(() => this.guarded(this.forum ? '我的帖子' : '我的报名'))
      }.padding(18).alignItems(HorizontalAlign.Start)
    }.width('100%').height(205).linearGradient({ angle: 180, colors: [['#FFFFFF', 0], ['#D8D0FF', 1]] }).borderRadius(23).clip(true)
    this.dots()
    if (this.forum) {
      this.shortcuts(['我的帖子', '知识与帮助', '校园活动', '个人资料'], false)
      this.sectionTitle('最新帖子')
    } else {
      this.shortcuts(['我的报名', '活动现场', '知识与帮助', '校园选购'], false)
      this.sectionTitle('近期活动')
    }
    Column({ space: 12 }) {
      Image($r('app.media.ref_flag')).width(43).height(43)
      Text(this.forum ? '论坛功能建设中' : '尚未接入活动内容').fontSize(18).fontWeight(FontWeight.Medium)
      Text(this.forum ? '帖子将在功能接入后展示' : '演示版暂不展示真实活动与报名').fontSize(12).fontColor('#79828B')
    }.width('100%').padding({ top: 30, bottom: 35 }).backgroundColor('#FFFFFF').borderRadius(24)
  }
  @Builder
  profile() {
    this.top('我的')
    Column({ space: 17 }) {
      Row({ space: 12 }) {
        Image($r('app.media.profile_avatar')).width(53).height(53)
        Column({ space: 5 }) {
          Text('演示' + this.role).fontSize(21).fontWeight(FontWeight.Bold)
          Text('离线演示身份').fontSize(11).fontColor('#8B7B51')
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }.width('100%')
      Row() {
        Text('我的校园服务').fontSize(13).fontColor('#777D82').layoutWeight(1)
        Button('个人资料').fontSize(12).height(31).fontColor('#615133').backgroundColor('#DCC18C').onClick(() => this.guarded('个人资料'))
      }.width('100%')
    }.padding(18).width('100%').backgroundColor('#FFFFFF').borderRadius(25)
    Row({ space: 2 }) {
      Column({ space: 6 }) {
        Image(this.icon('我的报修')).width(29).height(29)
        Text('—').fontSize(18)
        Text('我的报修').fontSize(12)
        Text('待接入').fontSize(10).fontColor('#899197')
      }.layoutWeight(1).padding({ top: 16, bottom: 16 })
      Column({ space: 6 }) {
        Image(this.icon('我的报名')).width(29).height(29)
        Text('—').fontSize(18)
        Text('我的报名').fontSize(12)
        Text('待接入').fontSize(10).fontColor('#899197')
      }.layoutWeight(1).padding({ top: 16, bottom: 16 })
      Column({ space: 6 }) {
        Image(this.icon('我的收藏')).width(29).height(29)
        Text(this.savedIds.length.toString()).fontSize(18)
        Text('我的收藏').fontSize(12)
        Text(this.savedIds.length === 0 ? '暂无收藏' : '演示数据').fontSize(10).fontColor('#899197')
      }.layoutWeight(1).padding({ top: 16, bottom: 16 })
    }.padding(8).width('100%').backgroundColor('#FFFFFF').borderRadius(25)
    Text('报修与报名未接入真实数据；收藏计数来自演示内存，重启后重置。').fontSize(10).fontColor('#899197')
    Column({ space: 10 }) {
      this.sectionTitle('我的信息')
      this.shortcuts(['我的报修', '我的收藏', '我的报名', '站内消息'], false)
      this.shortcuts(['个人资料', '维修记录', '我的帖子', '购物订单'], false)
    }.width('100%').padding(14).backgroundColor('#FFFFFF').borderRadius(25)
    Column({ space: 9 }) {
      this.sectionTitle('交易与创作')
      this.shortcuts(['购物订单', '卖家订单', '我的商品', '我的帖子'], false)
      Text('选购与论坛建设中').fontSize(11).fontColor('#899197')
    }.width('100%').padding(14).backgroundColor('#FFFFFF').borderRadius(25)
    Column({ space: 6 }) {
      this.sectionTitle('常用服务')
      this.shortcuts(['知识与帮助', 'AI 问诊', '校园活动', '报修进度'], false)
      Button('退出演示身份').fontSize(12).height(35).fontColor('#697580').backgroundColor('#F1F4F8').onClick(() => this.reset('游客'))
    }.width('100%').padding(14).backgroundColor('#FFFFFF').borderRadius(25)
  }
  @Builder
  main(index: number) {
    if (index === 0) { this.home() }
    else if (index === 1) { this.community() }
    else if (index === 2) { this.service() }
    else if (index === 3) { this.shopping() }
    else { this.profile() }
  }
  @Builder
  knowledge(name: string) {
    Text('演示样本 · 不代表真实知识库').fontSize(12).fontColor('#956221')
    if (name === '知识中心') {
      Column({ space: 25 }) {
        Image($r('app.media.ref_shield')).width(58).height(66)
        Button('AI 故障问诊').width(185).height(43).fontSize(17).fontWeight(FontWeight.Medium).backgroundColor('#1157FA').onClick(() => this.open('AI 问诊'))
      }.width('100%').height(265).justifyContent(FlexAlign.Center)
      this.sectionTitle('获取帮助')
      Text('按故障类型查阅演示指南').fontSize(12).fontColor('#80888F')
      ForEach(CATEGORIES.slice(1), (title: string) => {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 13 }) {
            Image(this.icon(title)).width(25).height(25)
            Text(title + '故障').fontSize(17).fontWeight(FontWeight.Medium).layoutWeight(1)
            Text('›').fontSize(24).fontColor('#82909F')
          }.width('100%').padding(18)
        }.width('100%').height(66).backgroundColor('#FFFFFF').borderRadius(23).fontColor('#252B2F')
          .onClick(() => { this.category = title; this.query = ''; this.open('知识目录'); })
      })
      this.link('全部知识目录', '按分类浏览指南与案例', () => { this.category = '全部'; this.query = ''; this.open('知识目录'); })
      this.link('知识搜索', '搜索演示指南', () => this.open('知识搜索'))
    } else {
      if (name === '知识搜索') {
        TextInput({ text: this.query, placeholder: '搜索演示指南标题' }).onChange((value: string) => this.query = value)
      } else { this.link('搜索演示指南', '保留分类上下文', () => this.open('知识搜索')) }
      if (name === '知识目录') {
        Row({ space: 12 }) {
          Column({ space: 8 }) {
            ForEach(CATEGORIES, (title: string) => {
              Button(title).width('100%').height(43).fontSize(13).fontColor(this.category === title ? '#1569EE' : '#737E87')
                .backgroundColor(this.category === title ? '#FFFFFF' : Color.Transparent).borderRadius(12).onClick(() => this.category = title)
            })
          }.width(66).padding({ top: 8 })
          Column({ space: 12 }) {
            Text(this.category + '维修指南').fontSize(19).fontWeight(FontWeight.Bold).width('100%')
            ForEach(searchGuides(this.category, this.query), (guide: DemoGuide) => {
              this.link(guide.title, '演示指南 · 查看  ›', () => this.openGuide(guide.id))
            }, (guide: DemoGuide): string => guide.id)
            if (searchGuides(this.category, this.query).length === 0) { Text('暂无该类演示指南').fontSize(13).fontColor('#7E8891') }
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        }.width('100%').alignItems(VerticalAlign.Top).padding({ top: 12, bottom: 18 })
      } else {
        Row({ space: 5 }) {
          ForEach(CATEGORIES, (title: string) => {
            Button(title).fontSize(12).padding(9).backgroundColor(this.category === title ? '#1476ED' : '#FFFFFF')
              .fontColor(this.category === title ? '#FFFFFF' : '#223142').onClick(() => this.category = title)
          })
        }
        Row({ space: 5 }) {
          ForEach(['内容', '加载', '空态', '失败'], (state: string) => {
            Button(state).fontSize(11).backgroundColor(this.dataState === state ? '#DCEBFF' : '#FFFFFF').fontColor('#42648A').onClick(() => this.dataState = state)
          })
        }
      if (this.dataState === '加载') {
        LoadingProgress().width(40).height(40)
        Text('演示加载中 · 点击“内容”结束')
      } else if (this.dataState === '失败') {
        Text('演示读取失败，未发出真实请求').fontColor('#AB443D')
        Button('重试').onClick(() => this.dataState = '内容')
      } else if (this.dataState === '空态' || searchGuides(this.category, this.query).length === 0) {
        Text('暂无匹配的演示指南').fontSize(18).margin({ top: 30 })
        Button('查看全部').onClick(() => { this.dataState = '内容'; this.category = '全部'; this.query = ''; })
      } else {
        ForEach(searchGuides(this.category, this.query), (guide: DemoGuide) => {
          this.link(guide.title, '演示指南 · ' + guide.category, () => this.openGuide(guide.id))
        }, (guide: DemoGuide): string => guide.id)
      }
      }
      this.link('公开案例 / 内部案例', '公开与内部权限边界保持', () => this.open('案例可见性'))
    }
  }
  @Builder
  destination(name: string) {
    NavDestination() {
      Scroll() {
        Column({ space: 14 }) {
          Text('纯前端演示 · 未连接真实业务').fontSize(11).fontColor('#956221')
          if (name === '演示设置') {
            this.heading('演示控制', '只改内存状态，不改变真实账号权限')
            ForEach(['游客', '客户', '工作人员', '管理员'], (role: string) => {
              this.link('切换演示' + role, role === '管理员' ? '单独展示审核入口' : '返回主页面', () => this.reset(role))
            })
            Row() {
              Text('减少动态效果（演示）').layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.reduceMotion }).onChange((value: boolean) => this.reduceMotion = value)
            }.padding(15).backgroundColor('#FFFFFF').borderRadius(18)
            Text('关闭横滑和切换动画；没有读取系统设置。').fontSize(12)
          } else if (name === '登录') {
            this.heading('演示登录', '无账号密码，不访问鉴权服务')
            Text('原操作：' + (this.pending === '@my' ? '我的' : this.pending))
            this.link('作为演示客户继续', '成功后续接原入口一次', () => this.login('客户'))
            this.link('作为演示工作人员继续', '不自动获得管理员审核权限', () => this.login('工作人员'))
            Button('取消，回到原页面').onClick(() => { this.pending = ''; this.pendingGuideId = ''; this.stack.pop(); })
          } else if (name === '知识中心' || name === '知识目录' || name === '知识搜索') { this.knowledge(name) }
          else if (name === '个人资料') {
            Column({ space: 15 }) {
              Image($r('app.media.profile_avatar')).width(116).height(116)
              Text('演示' + this.role).fontSize(29).fontWeight(FontWeight.Bold)
              Text('离线演示身份 · 未连接账号').fontSize(14).fontColor('#7E888D')
            }.width('100%').height(270).justifyContent(FlexAlign.Center)
            this.link('个人信息', '演示版暂不可编辑真实资料', () => this.open('个人信息'))
          }
          else if (name === '阅读指南') {
            Stack({ alignContent: Alignment.Start }) {
              Image($r('app.media.reading_guide_hero')).width('100%').height(135).objectFit(ImageFit.Cover)
              Text('维修指南').fontSize(26).fontWeight(FontWeight.Bold).padding(20)
            }.width('100%').height(135).backgroundColor('#E9E6FF').borderRadius(22).clip(true)

            this.heading(this.guide().title, '演示指南 · ' + this.guide().category)
            Row({ space: 9 }) {
              Text('现象记录').fontSize(12).fontColor('#FFFFFF').padding({ left: 9, right: 9, top: 4, bottom: 4 })
                .backgroundColor('#1157FA').borderRadius(8)
              Text('排查说明   ·   来源').fontSize(13).fontColor('#657591')
            }.width('100%')
            Text(this.guide().body).fontSize(17).lineHeight(29)
            this.link('查看来源', '演示资料，不伪造引用', () => this.open('来源说明'))
            if (this.savedIds.includes(this.guideId)) {
              this.link('取消收藏这篇指南', '已收藏 · 仅保存在演示内存', () => this.guarded('收藏操作'))
            } else if (this.role === '游客') {
              this.link('收藏这篇指南', '仅当前篇目 · 游客按需登录', () => this.guarded('收藏操作'))
            } else {
              this.link('收藏这篇指南', '仅当前篇目 · 演示内存，未同步账号', () => this.guarded('收藏操作'))
            }
            if (this.notice !== '') { Text(this.notice).fontColor('#287752') }
            this.link('进入 AI 问诊', '只演示路由，不生成回答', () => this.open('AI 问诊'))
          } else if (name === '来源说明') {
            Text('来源：DemoData.ets 自编样本。不是文献、真实维修备案或 AI 回答。正式迁移保留引用 ID、可见性和原内容跳转。').fontSize(17).lineHeight(28)
          } else if (name === '我的收藏') {
            if (this.savedIds.length === 0) { Text('暂无演示收藏').fontSize(18) }
            ForEach(GUIDES.filter((guide: DemoGuide): boolean => this.savedIds.includes(guide.id)), (guide: DemoGuide) => {
              this.link(guide.title, '已收藏的演示指南 · ' + guide.category, () => this.openGuide(guide.id))
            }, (guide: DemoGuide): string => guide.id)
          } else if (name === '站内消息') {
            Text('演示消息深链入口，不代表真实消息或收藏。')
            this.link('打开演示指南', '指定 demo-boot 的演示消息链接', () => this.openGuide('demo-boot'))
          } else if (name === '案例可见性') {
            Text(this.staff() ? '演示工作人员可见内部案例入口；未加载内部内容。' : '游客/客户仅可读公开案例；不展示内部备案。').fontSize(18)
            Text('无真实案例；正式迁移保留服务端校验。')
          } else if (name === '工作人员权限') {
            Text('此入口需要工作人员身份').fontSize(20).fontWeight(FontWeight.Bold)
            Text('演示版未加载任何内部业务内容。')
          } else if (name === '备案审核' && this.role !== '管理员') {
            Text('演示工作人员无审核权限').fontSize(20).fontWeight(FontWeight.Bold)
            Text('真实权限由服务端核实，演示角色不授予权限。')
          } else {
            this.heading(name, name === 'AI 问诊' ? '对话服务未连接' : '入口结构演示')
            Text(futureModule(name)).fontSize(18)
            Text('演示版尚未接入此服务，暂不能提交操作。').fontSize(15).lineHeight(26)
          }
        }.padding(20).width('100%').alignItems(HorizontalAlign.Start)
      }.width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top)
    }.title(name).backgroundColor('#F0F4F7').onShown(() => this.setBarTone('light'))
      .onHidden(() => this.setBarTone(this.tab === 0 ? 'gold' : 'light')).onBackPressed((): boolean => {
        if (name === '登录') { this.pending = ''; this.pendingGuideId = ''; }
        return false;
      })
  }
  private navAsset(index: number, active: boolean): Resource {
    if (index === 0) return active ? $r('app.media.home_nav_home_active') : $r('app.media.home_nav_home');
    if (index === 1) return active ? $r('app.media.home_nav_activity_active') : $r('app.media.home_nav_activity');
    if (index === 2) return active ? $r('app.media.home_headset_active') : $r('app.media.home_headset');
    if (index === 3) return active ? $r('app.media.demo_shop_active') : $r('app.media.demo_shop');
    return active ? $r('app.media.home_nav_profile_active') : $r('app.media.home_nav_profile');
  }
  @Builder
  navItem(index: number, title: string, icon: Resource) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 3 }) {
        if (this.tab === index) { Image(this.navAsset(index, true)).width(23).height(23) }
        else { Image(this.navAsset(index, false)).width(23).height(23) }
        Text(index === 2 ? (this.staff() ? '工作台' : '服务') : title).fontSize(11).fontColor(this.tab === index ? '#076FF2' : '#27323C')
      }.width('100%').height(52).justifyContent(FlexAlign.Center)
    }.layoutWeight(1).backgroundColor(this.tab === index ? '#2086B7FF' : Color.Transparent).borderRadius(28)
      .accessibilityText(title).accessibilitySelected(this.tab === index).onClick(() => this.select(index))
  }
  build() {
    Navigation(this.stack) {
      Column() {
        Stack({ alignContent: Alignment.Bottom }) {
          Tabs({ index: this.tab, controller: this.tabs }) {
            ForEach([0, 1, 2, 3, 4], (index: number) => {
              TabContent() {
                Scroll() {
                  Column({ space: 12 }) { this.main(index) }
                    .width('100%').padding({ left: index === 0 ? 0 : 16, right: index === 0 ? 0 : 16, bottom: 105 }).alignItems(HorizontalAlign.Start)
                }.width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top)
              }
            })
          }.barHeight(0).scrollable(!this.reduceMotion).animationDuration(this.reduceMotion ? 0 : 260)
            .onContentWillChange((_current: number, next: number): boolean => {
              if (next === 4 && this.role === '游客') { this.select(4); return false; } return true;
            }).onChange((index: number) => this.tab = index).width('100%').height('100%')
          Stack() {
            Image($r('app.media.home_nav_glass')).width('100%').height('100%').hitTestBehavior(HitTestMode.None)
            Row() {
              this.navItem(0, '首页', this.tab === 0 ? $r('app.media.home_nav_home_active') : $r('app.media.home_nav_home'))
              this.navItem(1, '活动', this.tab === 1 ? $r('app.media.home_nav_activity_active') : $r('app.media.home_nav_activity'))
              this.navItem(2, this.staff() ? '工作台' : '服务', this.tab === 2 ? $r('app.media.home_headset_active') : $r('app.media.home_headset'))
              this.navItem(3, '选购', this.tab === 3 ? $r('app.media.demo_shop_active') : $r('app.media.demo_shop'))
              this.navItem(4, '我的', this.tab === 4 ? $r('app.media.home_nav_profile_active') : $r('app.media.home_nav_profile'))
            }.padding({ left: 8, right: 8 }).width('100%')
          }.width('88%').height(58).backgroundEffect({ radius: 11, saturation: 1.5, brightness: 1.03, color: '#30B6CDF6' })
            .border({ width: 1, color: '#DDF8FFFF' }).borderRadius(34).clip(true).shadow({ radius: 15, color: '#203C526F', offsetY: 6 }).margin({ bottom: 14 })
        }.layoutWeight(1).width('100%')
      }.width('100%').height('100%').backgroundColor('#F0F4F7')
    }.hideTitleBar(true).navDestination(this.destination)
  }
}
