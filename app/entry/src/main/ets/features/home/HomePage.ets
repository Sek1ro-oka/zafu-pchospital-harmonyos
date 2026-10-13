import { accessibility } from '@kit.AccessibilityKit';
import { curves } from '@kit.ArkUI';
import { ActivityPage } from '../activity/ActivityPage';
import { KnowledgeLibraryPage } from '../knowledge/KnowledgeLibraryPage';
import { TAB_SLIDE_DURATION } from '../../core/ui/ReferencePage';
import { SessionIdentity } from '../../core/auth/AuthContract';
import { LoginIntent, routeAfterLogin } from '../../core/auth/LoginIntent';
import { LoginPage } from '../auth/LoginPage';
import { PublicGuidesPage } from '../knowledge/PublicGuidesPage';
import { HOME_STAFF } from '../../core/auth/AuthContract';
import { NavPusher, GuideFocusParam, RepairOrderFocusParam, routeTitle, ROUTE_SERVICE, ROUTE_PUBLIC_GUIDES, ROUTE_CASE_DETAIL, ROUTE_CASE_LIBRARY, ROUTE_KNOWLEDGE, ROUTE_KNOWLEDGE_SOURCE, ROUTE_REPAIR_ORDERS, ROUTE_STAFF_ORDERS, ROUTE_STAFF_ORDER_DETAIL, ROUTE_STAFF_RECORD, ROUTE_STAFF_REVIEW } from '../../core/ui/Routes';
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
import { RepairRecordsPage, RecordListParam } from '../repair/RepairRecordsPage';
import { ROUTE_REPAIR_RECORDS } from '../../core/ui/Routes';
import { StaffRepairRecordPage } from '../repair/StaffRepairRecordPage';
import { ServicePage } from '../service/ServicePage';
import { HomeTab } from './HomeTab';
import { ProfilePage } from '../profile/ProfilePage';
import { PersonalProfilePage } from '../profile/PersonalProfilePage';
import { MemberDirectoryPage } from '../profile/MemberDirectoryPage';
import { PersonalProfileParam } from '../profile/PersonalProfileContract';
import { ROUTE_PERSONAL_PROFILE, ROUTE_MEMBER_DIRECTORY } from '../../core/ui/Routes';
import { ROUTE_FAVORITES, ROUTE_MESSAGES, ROUTE_PUBLIC_CASES, ROUTE_PUBLIC_CASE_DETAIL } from '../../core/ui/Routes';
import { FavoritesPage } from '../profile/FavoritesPage';
import { MessagesPage } from '../profile/MessagesPage';
import { PublicCasesPage } from '../profile/PublicCasesPage';
import { PublicCaseDetailPage } from '../profile/PublicCaseDetailPage';
import { PublicCaseParam } from '../profile/CommunityContract';

/** 五个真实根页面；AI 对话仍是离开即销毁的导航子页。 */
const TAB_INDEX_HOME: number = 0;
const ROUTE_LOGIN: string = 'login';

@Component
export struct HomePage {
  @Prop authenticated: boolean = false;
  onLoggedIn: (identity: SessionIdentity) => void = () => {};
  onProfileSaved: (name: string) => void = () => {};
  private loginIntent: LoginIntent = new LoginIntent();
  private loginBusy: boolean = false;
  private expiring: boolean = false;
  @State sessionTransition: boolean = false;
  private admittedTab: number = -1;
  @State reduceMotion: boolean = false;
  private motionChanged: (enabled: boolean) => void = (enabled: boolean): void => { this.reduceMotion = enabled; };

  aboutToAppear(): void {
    try {
      this.reduceMotion = accessibility.isAnimationReduceEnabledSync();
      accessibility.onAnimationReduceStateChange(this.motionChanged);
    } catch (_) {
      // 平台无障碍查询不可用时仍用原生导航，不阻止页面展示。
    }
  }

  aboutToDisappear(): void {
    try { accessibility.offAnimationReduceStateChange(this.motionChanged); } catch (_) {}
  }

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
  @State recordsRevision: number = 0;
  @State workbenchRevision: number = 0;
  @State favoritesRevision: number = 0;
  @State messagesRevision: number = 0;
  @State publicCasesRevision: number = 0;
  @State publicCaseRevision: number = 0;
  private tabController: TabsController = new TabsController();
  private pusher: NavPusher = new NavPusher();

  /** 会话失效的统一出口：清空导航栈再回登录页，避免栈底残留子页。 */
  private async expireSession(): Promise<void> {
    if (this.expiring || this.sessionTransition) return;
    this.expiring = true;
    this.admittedTab = -1;
    this.pathStack.clear();
    this.currentTab = TAB_INDEX_HOME;
    this.tabController.changeIndex(TAB_INDEX_HOME);
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
      this.admittedTab = intent.tab;
      this.currentTab = intent.tab;
      this.tabController.changeIndex(intent.tab);
    } else if (intent.route !== '') {
      this.pathStack.pushPathByName(routeAfterLogin(intent.route, identity), intent.param);
    }
  }

  private openRoute(route: string, param: Object | null): void {
    if (this.sessionTransition) return;
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
    if (this.sessionTransition) return;
    this.sessionTransition = true;
    this.admittedTab = -1;
    this.loginIntent = new LoginIntent();
    this.pathStack.clear();
    this.currentTab = TAB_INDEX_HOME;
    this.tabController.changeIndex(TAB_INDEX_HOME);
    try {
      await this.onLogout();
    } finally {
      this.currentTab = TAB_INDEX_HOME;
      this.tabController.changeIndex(TAB_INDEX_HOME);
      this.sessionTransition = false;
    }
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
      } else if (name === ROUTE_FAVORITES) {
        FavoritesPage({ home: this.home, refreshVersion: this.favoritesRevision,
          onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_MESSAGES) {
        MessagesPage({ home: this.home, refreshVersion: this.messagesRevision,
          onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_PUBLIC_CASES) {
        PublicCasesPage({
          refreshVersion: this.publicCasesRevision,
          onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_PUBLIC_CASE_DETAIL) {
        PublicCaseDetailPage({ param: param as PublicCaseParam, refreshVersion: this.publicCaseRevision,
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_PERSONAL_PROFILE) {
        PersonalProfilePage({
          home: this.home, permissions: this.permissions, param: param as PersonalProfileParam | null,
          onSaved: (name: string): void => { this.onProfileSaved(name); },
          onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_MEMBER_DIRECTORY) {
        MemberDirectoryPage({
          onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_PUBLIC_GUIDES) {
        PublicGuidesPage({
          authenticated: this.authenticated, home: this.home,
          onSessionExpired: (): void => { this.expireSession(); },
          initialGuideId: param !== null && param !== undefined ? (param as GuideFocusParam).guideId : '',
          onConsult: (): void => { this.openRoute(ROUTE_KNOWLEDGE, null); }
        });
      } else if (name === ROUTE_SERVICE) {
        ServicePage({
          onActivities: (): void => { this.pathStack.clear(); this.selectNavigation(1); },
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
      } else if (name === ROUTE_REPAIR_RECORDS) {
        RepairRecordsPage({ param: param as RecordListParam, refreshVersion: this.recordsRevision,
          onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
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
    .onShown(() => {
      this.workbenchRevision += 1;
      if (name === ROUTE_REPAIR_RECORDS) this.recordsRevision += 1;
      if (name === ROUTE_FAVORITES) this.favoritesRevision += 1;
      if (name === ROUTE_MESSAGES) this.messagesRevision += 1;
      if (name === ROUTE_PUBLIC_CASES) this.publicCasesRevision += 1;
      if (name === ROUTE_PUBLIC_CASE_DETAIL) this.publicCaseRevision += 1;
    })
    .onBackPressed((): boolean => {
      if (name === ROUTE_LOGIN) {
        if (this.loginBusy) return true;
        this.loginIntent = new LoginIntent();
      }
      return false;
    })
    .backgroundColor($r('app.color.start_window_background'))
  }

  /** 同时拦截底栏、手势和控制器切换；拒绝切换后取消登录保持原 tab。 */
  private canChangeTab(index: number): boolean {
    if (this.sessionTransition && index !== TAB_INDEX_HOME) return false;
    if (index === 4 && !this.authenticated) {
      // 登录成功的单次通行，覆盖父组件 Prop 尚未刷新的一帧；不携带业务权限。
      if (this.admittedTab === index) {
        this.admittedTab = -1;
        return true;
      }
      const intent = new LoginIntent();
      intent.tab = 4;
      this.requestLogin(intent);
      return false;
    }
    this.admittedTab = -1;
    return true;
  }

  private selectNavigation(index: number): void {
    if (this.sessionTransition) return;
    if (index === 4 && !this.authenticated) {
      const intent = new LoginIntent();
      intent.tab = 4;
      this.requestLogin(intent);
    } else if (this.currentTab !== index) {
      this.tabController.changeIndex(index);
    }
  }

  build() {
    Navigation(this.pathStack) {
      Stack({ alignContent: Alignment.Bottom }) {
        // 延伸当前页面底色，系统时钟和状态图标仍由系统绘制。
        Rect().width('100%').height('100%').fill(this.currentTab === TAB_INDEX_HOME ? '#FFDE8F' : '#F0F5F8')
          .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP])
        Tabs({ index: this.currentTab, controller: this.tabController }) {
          TabContent() {
            HomeTab({
              onActivities: (): void => { this.selectNavigation(1); },
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
            ActivityPage()
          }

          TabContent() {
            ServicePage({
              refreshVersion: this.workbenchRevision,
              onActivities: (): void => { this.selectNavigation(1); },
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
            KnowledgeLibraryPage({
              authenticated: this.authenticated, home: this.home, permissions: this.permissions,
              onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
              onSessionExpired: (): void => { this.expireSession(); }
            })
          }

          TabContent() {
            if (this.authenticated) {
              ProfilePage({
                onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
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
        .scrollable(!this.reduceMotion)
        .animationDuration(this.reduceMotion ? 0 : TAB_SLIDE_DURATION)
        .animationCurve(curves.cubicBezierCurve(0.23, 1, 0.32, 1))
        .onContentWillChange((_current: number, coming: number): boolean => this.canChangeTab(coming))
        .onChange((index: number) => {
          this.currentTab = index;
          if (index === 2) this.workbenchRevision += 1;
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
