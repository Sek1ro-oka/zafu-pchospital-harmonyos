import { REFERENCE_BACKGROUND } from '../../core/ui/ReferencePage';
import { DetailNotice } from '../../core/ui/ReferenceDetail';

/**
 * 选购 tab（#83 入口，交易本体属 #84）。
 *
 * 本页只有一个职责：如实告诉用户交易模块还没交付，并且不冒充商品页。
 * 因此这里**没有**任何示例商品、价格、库存、订单或“立即购买”按钮 ——
 * 那些数据要等 #84 的真实接口（商品、库存、下单、我的购物订单）接入后
 * 由该模块补进本页；缺数据时页面保持这个空态，而不是填演示数据。
 *
 * 游客可直接浏览本页（底栏第 4 栏）；需要登录的写操作（发布、下单、
 * 我的订单）在 #84 接入时沿用 `HomePage.openRoute` 的登录意图续接，
 * 不在本页自建登录门槛。
 */
@Component
export struct ShoppingPage {
  /** 由 HomePage 注入：建设中页面给用户一个真实可用的出口（服务 / 工作台 tab）。 */
  onService: () => void = () => {};
  /** 与底栏一致：工作人员第 3 栏叫「工作台」，出口文案跟着角色走，不写死「服务」。 */
  staff: boolean = false;

  private serviceLabel(): string {
    return this.staff ? '工作台' : '服务';
  }

  @Builder
  statusRow(title: string, state: string, note: string) {
    Column({ space: 6 }) {
      Row({ space: 8 }) {
        Text(title).fontSize(15).fontWeight(FontWeight.Medium).fontColor('#191D20').layoutWeight(1)
        Text(state).fontSize(11).fontColor('#8A5A00')
          .padding({ left: 9, right: 9, top: 3, bottom: 3 })
          .backgroundColor('#FFF1D6').borderRadius(12)
      }.width('100%')
      Text(note).fontSize(12).fontColor('#6D757B').lineHeight(19).width('100%')
    }
    .width('100%').padding(16).backgroundColor(Color.White).borderRadius(18)
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Scroll() {
      Column({ space: 14 }) {
        Row({ space: 10 }) {
          Text('选购').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#101416').layoutWeight(1)
          Text('建设中').fontSize(12).fontWeight(FontWeight.Medium).fontColor('#8A5A00')
            .padding({ left: 11, right: 11, top: 5, bottom: 5 })
            .backgroundColor('#FFF1D6').borderRadius(14)
        }.width('100%').height(50)

        // 主卡片：主题插画（项目自有 SVG）+ 真实状态说明，不是商品图。
        Row({ space: 14 }) {
          Image($r('app.media.home_nav_shopping_active')).width(52).height(52).objectFit(ImageFit.Contain)
            .accessibilityText('选购图标')
          Column({ space: 6 }) {
            Text('交易模块建设中').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#141A1F')
            Text('二手电脑配件与维修耗材的选购由交易模块（#84）交付，当前还没有商品。')
              .fontSize(13).fontColor('#646D75').lineHeight(20)
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        }
        .width('100%').padding(18)
        .linearGradient({ angle: 140, colors: [['#FFF6E6', 0], ['#FFFFFF', 0.55], ['#F1F6F9', 1]] })
        .borderRadius(20).alignItems(VerticalAlign.Center)

        DetailNotice({ text: '本页不展示示例商品、价格或订单：商品与订单只能来自交易接口，交易模块交付前保持空态，避免用假数据冒充已完成功能。' })

        Text('开放状态').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#101416').margin({ top: 4 })
        this.statusRow('看到商品', '待开放', '商品列表、分类与搜索随 #84 接入；现在打开选购不会看到任何商品。')
        this.statusRow('发布与下单', '待开放', '登录后发布二手商品、下单与查询“我的购物订单”依赖交易接口，尚未接入。')
        this.statusRow('取货与付款', '规则已定', '线下付款取货；不接线上支付、配送与退款资金流，也不会显示“支付成功”。')

        Row({ space: 8 }) {
          Image($r('app.media.detail_info')).width(18).height(18)
          Text('交易在 #84 交付前，维修与知识能力照常可用。').fontSize(12).fontColor('#6D757B').layoutWeight(1)
        }.width('100%').padding({ top: 2 })

        Button(`去「${this.serviceLabel()}」查看维修与知识`)
          .width('100%').height(44).fontSize(15).fontColor(Color.White)
          .backgroundColor('#0755FF').borderRadius(22)
          .onClick(() => { this.onService(); })

        Text('购物订单、报修单与维修备案是不同对象；本页不会借用维修进度表示商品交易。')
          .fontSize(10).fontColor('#8C949A').lineHeight(16)
      }
      .width('100%').padding({ left: 16, right: 16, bottom: 90 })
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top)
    .backgroundColor(REFERENCE_BACKGROUND)
  }
}
