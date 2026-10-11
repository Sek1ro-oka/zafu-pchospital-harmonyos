import {
  CARD_GAP,
  CARD_PADDING_LG,
  CONTROL_HEIGHT_MD,
  FONT_TEXT,
} from './Theme';

/**
 * 面板级状态组件（Issue #41 状态处理统一）。
 *
 * 列表 / 详情的整块「加载中」「失败可重试」区域在这里统一样式：
 * 转圈规格、宽松内边距与重试按钮只定义一次，各页按需决定是否再包一层
 * surface 卡片（嵌在已有卡片里的详情区就不必再包）。
 * 错误文案由调用方直接传 `ApiRequestError.message` —— 网络错误
 * （NETWORK_ERROR，客户端拼接的连接提示）与业务错误（后端信封 error 的
 * message）天然是两套可区分的提示文本，这里不做二次加工。
 */

/** 加载面板：转圈 + 说明文字，用于请求发出后的整块加载区。 */
@Component
export struct LoadingPanel {
  @Prop text: string = '正在加载…';

  build() {
    Column({ space: CARD_GAP }) {
      LoadingProgress()
        .width(28)
        .height(28)
        .color($r('app.color.brand'))
      Text(this.text)
        .fontSize(FONT_TEXT)
        .fontColor($r('app.color.text_secondary'))
    }
    .width('100%')
    .padding(CARD_PADDING_LG)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
  }
}

/** 失败面板：错误信息 + 重试按钮；是否加卡片底色由调用方决定。 */
@Component
export struct ErrorPanel {
  @Prop message: string = '';
  @Prop retryText: string = '重试';
  onRetry: () => void = () => {
  };

  build() {
    Column({ space: CARD_GAP }) {
      Text(this.message === '' ? '加载失败，请重试' : this.message)
        .fontSize(FONT_TEXT)
        .fontColor($r('app.color.danger'))
        .width('100%')
        .textAlign(TextAlign.Center)
      Button(this.retryText)
        .fontSize(FONT_TEXT)
        .height(CONTROL_HEIGHT_MD)
        .backgroundColor($r('app.color.brand'))
        .fontColor(Color.White)
        .onClick(() => {
          this.onRetry();
        })
    }
    .width('100%')
    .padding(CARD_PADDING_LG)
    .alignItems(HorizontalAlign.Center)
  }
}
