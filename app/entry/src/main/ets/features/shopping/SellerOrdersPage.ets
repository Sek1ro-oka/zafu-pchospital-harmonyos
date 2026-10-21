import { OrdersPage } from './OrdersPage';

/**
 * 卖家订单页：复用买家订单列表的布局，只把 `role` 固定为 `seller`。
 * 单独导出是为了让路由与页面名一一对应，后续扩展卖家操作时不用改调用方。
 */
@Component
export struct SellerOrdersPage {
  onBack: () => void = () => {};
  onSessionExpired: () => void = () => {};
  @Prop @Watch('onRefreshChanged') refreshVersion: number = 0;

  onRefreshChanged(): void {
  }

  build() {
    OrdersPage({
      role: 'seller',
      onBack: this.onBack,
      onSessionExpired: this.onSessionExpired,
      refreshVersion: this.refreshVersion
    })
  }
}
