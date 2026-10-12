import { SessionIdentity } from '../../core/auth/AuthContract';
import { LoginIntent, routeAfterLogin } from '../../core/auth/LoginIntent';
import { LoginPage } from '../auth/LoginPage';
import { PublicGuidesPage } from '../knowledge/PublicGuidesPage';
import { HOME_STAFF } from '../../core/auth/AuthContract';
import { NavPusher, RepairOrderFocusParam, routeTitle, ROUTE_SERVICE, ROUTE_PUBLIC_GUIDES, ROUTE_CASE_DETAIL, ROUTE_CASE_LIBRARY, ROUTE_KNOWLEDGE, ROUTE_KNOWLEDGE_SOURCE, ROUTE_REPAIR_ORDERS, ROUTE_STAFF_ORDERS, ROUTE_STAFF_ORDER_DETAIL, ROUTE_STAFF_RECORD, ROUTE_STAFF_REVIEW } from '../../core/ui/Routes';
import { HomeReferenceTabBar } from './HomeReferenceVisuals';
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

/** 现有内容页保持：首页 / 服务（工作人员为工作台）/ 我的。
 * 五栏外观按参考图映射；知识复用导航目的页，活动如实提示未接入。
 */
const TAB_INDEX_HOME: number = 0;
const ROUTE_LOGIN: string = 'login';

@Component
export struct HomePage {
  @Prop authenticated: boolean = false;
  onLoggedIn: (identity: SessionIdentity) => void = () => {};
  private loginIntent: LoginIntent = new LoginIntent();
  private loginBusy: boolean = false;
  private expiring: boolean = false;
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
  private pusher: NavPusher = new NavPusher();

  /** 会话失效的统一出口：清空导航栈再回登录页，避免栈底残留子页。 */
  private async expireSession(): Promise<void> {
    if (this.expiring) return;
    this.expiring = true;
    this.pathStack.clear();
    this.currentTab = TAB_INDEX_HOME;
    await this.onSessionExpired();
    this.requestLogin(new LoginIntent());
    this.expiring = false;
  }

  private requestLogin(intent: LoginIntent): void {
    if (this.pathStack.getAllPathName().includes(ROUTE_LOGIN)) return;
    this.loginIntent = intent;
    this.pathStack.pushPathByName(ROUTE_LOGIN, null);
  }

  private cancelLogin(): void {
    this.loginIntent = new LoginIntent();
    this.pathStack.pop();
  }

  private completeLogin(identity: SessionIdentity): void {
    const intent = this.loginIntent;
    this.loginIntent = new LoginIntent();
    this.onLoggedIn(identity);
    this.pathStack.pop();
    if (intent.tab >= 0) {
      this.currentTab = intent.tab;
      this.tabController.changeIndex(intent.tab);
    } else if (intent.route !== '') {
      this.pathStack.pushPathByName(routeAfterLogin(intent.route, identity), intent.param);
    }
  }

  private openRoute(route: string, param: Object | null): void {
    if (!this.authenticated && route !== ROUTE_PUBLIC_GUIDES) {
      const intent = new LoginIntent();
      intent.route = route;
      intent.param = param;
      this.requestLogin(intent);
      return;
    }
    this.pusher.push(this.pathStack, route, param);
  }

  private async logoutToGuest(): Promise<void> {
    this.loginIntent = new LoginIntent();
    this.pathStack.clear();
    this.currentTab = TAB_INDEX_HOME;
    this.tabController.changeIndex(TAB_INDEX_HOME);
    await this.onLogout();
  }

  @Builder
  destination(name: string, param: object) {
    NavDestination() {
      if (name === ROUTE_LOGIN) {
        LoginPage({
          onLoggedIn: (identity: SessionIdentity): void => { this.completeLogin(identity); },
          onCancel: (): void => { this.cancelLogin(); },
          onBusyChange: (busy: boolean): void => { this.loginBusy = busy; }
        });
      } else if (name === ROUTE_PUBLIC_GUIDES) {
        PublicGuidesPage({
          onConsult: (): void => { this.openRoute(ROUTE_KNOWLEDGE, null); }
        });
      } else if (name === ROUTE_SERVICE) {
        ServicePage({
          home: this.home, permissions: this.permissions, pathStack: this.pathStack,
          authenticated: this.authenticated,
          onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
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
    .title(name === ROUTE_LOGIN ? '登录' : routeTitle(name))
    .onBackPressed((): boolean => {
      if (name === ROUTE_LOGIN) {
        if (this.loginBusy) return true;
        this.loginIntent = new LoginIntent();
      }
      return false;
    })
    .backgroundColor($r('app.color.start_window_background'))
  }

  private selectNavigation(index: number): void {
    if (index === -1) {
      this.getUIContext().getPromptAction().showToast({ message: '活动模块暂未接入' });
    } else if (index === -2) {
      // 仍用导航目的页，离开即销毁本次问答，避免常驻 Tab 留存会话。
      this.openRoute(this.authenticated ? ROUTE_KNOWLEDGE : ROUTE_PUBLIC_GUIDES, null);
    } else if (index === 2 && !this.authenticated) {
      const intent = new LoginIntent();
      intent.tab = 2;
      this.requestLogin(intent);
    } else if (this.currentTab !== index) {
      this.tabController.changeIndex(index);
    }
  }

  build() {
    Navigation(this.pathStack) {
      Stack({ alignContent: Alignment.Bottom }) {
        if (this.currentTab === TAB_INDEX_HOME) {
          // 只将首页底色延伸至系统状态栏，保留系统时钟和真实状态图标。
          Rect().width('100%').height('100%').fill('#FFDE8F')
            .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP])
        }
        Tabs({ index: this.currentTab, controller: this.tabController }) {
          TabContent() {
            HomeTab({
              displayName: this.displayName,
              roleText: this.roleText,
              home: this.home,
              permissions: this.permissions,
              authenticated: this.authenticated,
              onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
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
              authenticated: this.authenticated,
              onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
              pathStack: this.pathStack,
              onSessionExpired: (): void => {
                this.expireSession();
              }
            })
          }

          TabContent() {
            if (this.authenticated) {
              ProfilePage({
                displayName: this.displayName,
                roleText: this.roleText,
                home: this.home,
                permissions: this.permissions,
                pathStack: this.pathStack,
                onLogout: (): Promise<void> => this.logoutToGuest(),
                onSessionExpired: (): void => {
                  this.expireSession();
                }
              })
            } else {
              Column() { Text('登录后查看个人记录') }
            }
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

        HomeReferenceTabBar({
          currentTab: this.currentTab,
          staff: this.home === HOME_STAFF,
          onSelect: (index: number): void => { this.selectNavigation(index); }
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
