import { HOME_STAFF } from '../../core/auth/AuthContract';
import { RepairOrderFocusParam, routeTitle, ROUTE_SERVICE, ROUTE_CASE_DETAIL, ROUTE_CASE_LIBRARY, ROUTE_KNOWLEDGE, ROUTE_KNOWLEDGE_SOURCE, ROUTE_REPAIR_ORDERS, ROUTE_STAFF_ORDERS, ROUTE_STAFF_ORDER_DETAIL, ROUTE_STAFF_RECORD, ROUTE_STAFF_REVIEW } from '../../core/ui/Routes';
import {
  CARD_GAP,
  FONT_CHIP,
  GAP_LG,
  TAB_BAR_HEIGHT,
  TAB_BAR_MARGIN,
  TAB_BAR_RADIUS,
  TAB_ICON_SIZE,
} from '../../core/ui/Theme';
import { CaseDetailPage } from '../knowledge/CaseDetailPage';
import { CaseLibraryPage } from '../knowledge/CaseLibraryPage';
import { CitationDetailPage } from '../knowledge/CitationDetailPage';
import { CaseDetailParam } from '../knowledge/KnowledgeCaseContract';
import { KnowledgeSourceParam } from '../knowledge/KnowledgeContract';
import { KnowledgePage } from '../knowledge/KnowledgePage';
import { RepairOrdersPage } from '../repair/RepairOrdersPage';
import { AdminRepairReviewPage } from '../repair/AdminRepairReviewPage';
import { StaffRecordParam, StaffOrderParam } from '../repair/StaffRepairContract';
import { StaffRepairOrderDetailPage } from '../repair/StaffRepairOrderDetailPage';
import { StaffRepairOrdersPage } from '../repair/StaffRepairOrdersPage';
import { StaffRepairRecordPage } from '../repair/StaffRepairRecordPage';
import { ServicePage } from '../service/ServicePage';
import { HomeTab } from './HomeTab';
import { ProfilePage } from '../profile/ProfilePage';

/** Tab 下标：首页 / 服务 / 我的（对照参考图底部胶囊导航，花粉、选购无对应业务不做）。 */
const TAB_INDEX_HOME: number = 0;
const TAB_INDEX_SERVICE: number = 1;
const TAB_INDEX_PROFILE: number = 2;

/**
 * 登录后的主壳（本轮重设计）。
 *
 * 根结构对照 docs/reference/my-huawei/ 五图共有的底部悬浮胶囊 Tab 栏，
 * 落地为 Tabs 三页：首页 / 服务 / 我的；子页仍由本组件的 NavPathStack +
 * NavDestination 承载，routeTitle / NavPusher / 返回行为与 #41 保持一致。
 * 参考图的「花粉」「选购」没有对应业务，不做假 Tab（偏差记录在参考图 README）。
 *
 * Tab 栏用自绘胶囊（Tabs 的 barHeight(0) 收起自带栏，Stack 底部叠悬浮胶囊），
 * 白底圆角、选中态品牌蓝，尺寸全部走 Theme 令牌。
 * 登录/启动流程不变：会话过期时由各 tab 页回调 expireSession 清栈回登录页。
 */
@Component
export struct HomePage {
  @Prop displayName: string = '';
  @Prop roleText: string = '';
  @Prop home: string = '';
  @Prop permissions: string[] = [];
  onLogout: () => Promise<void> = async () => {
  };
  /** 子页面发现会话失效时，通知根页面回登录页。 */
  onSessionExpired: () => void = () => {
  };
  @State pathStack: NavPathStack = new NavPathStack();
  @State currentTab: number = TAB_INDEX_HOME;
  private tabController: TabsController = new TabsController();

  /** 会话失效的统一出口：清空导航栈再回登录页，避免栈底残留子页。 */
  private async expireSession(): Promise<void> {
    this.pathStack.clear();
    await this.onLogout();
  }

  @Builder
  destination(name: string, param: object) {
    NavDestination() {
      if (name === ROUTE_SERVICE) {
        ServicePage({
          home: this.home, permissions: this.permissions, pathStack: this.pathStack,
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_REPAIR_ORDERS) {
        RepairOrdersPage({
          initialDetailId: param !== null && param !== undefined
            ? (param as RepairOrderFocusParam).orderId
            : '',
          onSessionExpired: (): void => {
            this.expireSession();
          }
        });
      } else if (name === ROUTE_STAFF_ORDERS) {
        StaffRepairOrdersPage({
          pathStack: this.pathStack,
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_STAFF_ORDER_DETAIL) {
        StaffRepairOrderDetailPage({
          pathStack: this.pathStack,
          param: param as StaffOrderParam,
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_STAFF_RECORD) {
        StaffRepairRecordPage({
          param: param as StaffRecordParam,
          pathStack: this.pathStack,
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_STAFF_REVIEW) {
        AdminRepairReviewPage({
          pathStack: this.pathStack,
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_KNOWLEDGE) {
        KnowledgePage({
          pathStack: this.pathStack,
          onSessionExpired: (): void => {
            this.expireSession();
          }
        });
      } else if (name === ROUTE_KNOWLEDGE_SOURCE) {
        CitationDetailPage({
          param: param as KnowledgeSourceParam,
          onSessionExpired: (): void => {
            this.expireSession();
          }
        });
      } else if (name === ROUTE_CASE_LIBRARY) {
        CaseLibraryPage({
          pathStack: this.pathStack,
          onSessionExpired: (): void => {
            this.expireSession();
          }
        });
      } else if (name === ROUTE_CASE_DETAIL) {
        CaseDetailPage({
          param: param as CaseDetailParam,
          onSessionExpired: (): void => {
            this.expireSession();
          }
        });
      }
    }
    .title(routeTitle(name))
    .backgroundColor($r('app.color.start_window_background'))
  }

  /** 底部胶囊栏的单个 tab：图标字 + 文字，选中态品牌蓝。 */
  @Builder
  tabItem(index: number, icon: string, label: string) {
    Column({ space: 2 }) {
      Text(icon)
        .fontSize(TAB_ICON_SIZE)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.currentTab === index ? $r('app.color.brand') : $r('app.color.text_secondary'))
      Text(label)
        .fontSize(FONT_CHIP)
        .fontColor(this.currentTab === index ? $r('app.color.brand') : $r('app.color.text_secondary'))
    }
    .layoutWeight(1)
    .alignItems(HorizontalAlign.Center)
    .justifyContent(FlexAlign.Center)
    .height('100%')
    .onClick(() => {
      if (this.currentTab !== index) {
        this.tabController.changeIndex(index);
      }
    })
  }

  build() {
    Navigation(this.pathStack) {
      Stack({ alignContent: Alignment.Bottom }) {
        Tabs({ index: this.currentTab, controller: this.tabController }) {
          TabContent() {
            HomeTab({
              displayName: this.displayName,
              roleText: this.roleText,
              home: this.home,
              permissions: this.permissions,
              pathStack: this.pathStack,
              onSessionExpired: (): void => {
                this.expireSession();
              }
            })
          }

          TabContent() {
            ServicePage({
              home: this.home,
              permissions: this.permissions,
              pathStack: this.pathStack,
              onSessionExpired: (): void => {
                this.expireSession();
              }
            })
          }

          TabContent() {
            ProfilePage({
              displayName: this.displayName,
              roleText: this.roleText,
              home: this.home,
              permissions: this.permissions,
              pathStack: this.pathStack,
              onLogout: (): Promise<void> => this.onLogout(),
              onSessionExpired: (): void => {
                this.expireSession();
              }
            })
          }
        }
        .barPosition(BarPosition.End)
        .barHeight(0)
        .scrollable(false)
        .onChange((index: number) => {
          this.currentTab = index;
        })
        .width('100%')
        .height('100%')

        // 悬浮胶囊 Tab 栏：白底、大圆角，距屏幕边缘留出悬浮边距（对照参考图）。
        Column() {
          Row({ space: CARD_GAP }) {
            this.tabItem(TAB_INDEX_HOME, '首', '首页')
            this.tabItem(TAB_INDEX_SERVICE, '服', '服务')
            this.tabItem(TAB_INDEX_PROFILE, '我', '我的')
          }
          .width('100%')
          .height(TAB_BAR_HEIGHT)
          .padding({ left: GAP_LG, right: GAP_LG })
          .backgroundColor($r('app.color.surface'))
          .borderRadius(TAB_BAR_RADIUS)
        }
        .width('100%')
        .padding({
          left: TAB_BAR_MARGIN,
          right: TAB_BAR_MARGIN,
          bottom: TAB_BAR_MARGIN
        })
      }
      .width('100%')
      .height('100%')
      // 页面四周留白由各 tab 页自行处理，栈壳不叠加内边距避免双重留白。
    }
    .hideTitleBar(true)
    .navDestination(this.destination)
  }
}
