import { accessibility } from '@kit.AccessibilityKit';
import { curves } from '@kit.ArkUI';
import { ActivityPage } from '../activity/ActivityPage';
import { KnowledgeLibraryPage } from '../knowledge/KnowledgeLibraryPage';
import { TAB_SLIDE_DURATION } from '../../core/ui/ReferencePage';
import { SessionIdentity, HOME_CUSTOMER, PasswordChangeData } from '../../core/auth/AuthContract';
import { LoginIntent, routeAfterLogin } from '../../core/auth/LoginIntent';
import { SessionService } from '../../core/auth/SessionService';
import { LoginPage } from '../auth/LoginPage';
import { RegisterCustomerPage } from '../auth/RegisterCustomerPage';
import { RegisterStaffPage } from '../auth/RegisterStaffPage';
import { PasswordChangePage } from '../auth/PasswordChangePage';
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
const ROUTE_REGISTER_CUSTOMER: string = 'register-customer';
const ROUTE_REGISTER_STAFF: string = 'staff-register';
const ROUTE_PASSWORD_CHANGE: string = 'password-change';

/**
 * 登录 / 注册 / 改密整条流程的页面名（Issue #60 第三批）。
 *
 * 游客触达需要登录的能力时先压登录页，需要注册时再从登录页压注册页，
 * 强制改密账号则被压到改密页 —— 成功后要一次把这些页面都弹掉，
 * 否则栈底会残留一个登录页，用户每次返回都会再看到它。
 */
const AUTH_ROUTES: string[] = [ROUTE_LOGIN, ROUTE_REGISTER_CUSTOMER, ROUTE_REGISTER_STAFF, ROUTE_PASSWORD_CHANGE];

/**
 * `routeAfterLogin` 的兜底身份：只在内存身份缺失（理论上不会发生）时使用。
 * **不伪造角色、不缓存任何真实身份** —— 续接的语义只取决于「客户入口还是
 * 工作人员入口」，而这个值在登录成功后必然已由服务端身份给出；
 * 这里是类型兜底，不是业务数据。
 */
class LoginFallbackIdentity implements SessionIdentity {
  userId: string = '';
  displayName: string | null = null;
  roles: string[] = [];
  permissions: string[] = [];
  memberProfileId: string | null = null;
  memberStatus: string | null = null;
  mustChangePassword: boolean = false;
  home: string = HOME_CUSTOMER;
}

@Component
export struct HomePage {
  @Prop authenticated: boolean = false;
  onLoggedIn: (identity: SessionIdentity) => void = () => {};
  onProfileSaved: (name: string) => void = () => {};
  private loginIntent: LoginIntent = new LoginIntent();
  private loginBusy: boolean = false;
  private expiring: boolean = false;
  @State sessionTransition: boolean = false;
  /** 改密页是否处于「强制改密」模式：true 时禁用返回跳过（契约：必须先改密）。 */
  @State passwordChangeForced: boolean = false;
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
    // 启动恢复会话后发现是强制改密账号：进主页的同时引导到改密页（不清续接目标）。
    if (this.authenticated && this.needsPasswordChange(this.mustChangePassword)) {
      this.openPasswordChange(true);
    }
  }

  aboutToDisappear(): void {
    try { accessibility.offAnimationReduceStateChange(this.motionChanged); } catch (_) {}
  }

  @Prop displayName: string = '';
  @Prop roleText: string = '';
  @Prop home: string = '';
  @Prop permissions: string[] = [];
  /**
   * 强制改密账号标记（Issue #60 第三批）。
   *
   * 契约：`mustChangePassword = true` 的账号只能访问 session / logout / 原生改密 / Web 改密，
   * 其余业务接口一律 `403 PASSWORD_CHANGE_REQUIRED`。因此这里在**进主页时**就把它
   * 引导到改密页，而不是等用户点进业务页撞到 403 再解释。
   */
  @Prop mustChangePassword: boolean = false;
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

  /**
   * 当前身份是否属于「强制改密账号」。
   *
   * 契约：`mustChangePassword = true` 的账号只能访问 session / logout / 原生改密 / Web 改密，
   * 其余业务接口一律 `403 PASSWORD_CHANGE_REQUIRED`。因此这里在进主页 / 切 tab / 开路由时
   * 都先把它送到改密页，而不是等用户点进业务页撞到 403 再解释。
   *
   * 为什么刻意不做成跨文件共用函数（与 `core/auth/AuthMessages` 里的同名纯函数并存）：
   * 1. 它只是 `mustChangePassword` 的直传，没有复用价值，抽出去只会给 HomePage 多一条外部依赖。
   * 2. `backend/tests/unit/guest-login-app.test.ts` 用「源码拼接 + eval」的方式加载本文件，
   *    只带 `LoginIntent.ets` 一个依赖文件，不解析 import；新增任何跨文件 import 都会让
   *    eval 环境缺符号而直接抛 ReferenceError。
   * 3. 全仓目前只有本页这一个调用方。
   */
  private needsPasswordChange(mustChangePassword: boolean): boolean {
    return mustChangePassword;
  }

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

  /**
   * 进入注册页（登录页的「注册账号」/「工作人员注册（需邀请码）」）。
   *
   * **保留续接目标**：loginIntent 不清空，注册成功 / 取消返回登录页后仍能续接原操作。
   */
  private openRegister(route: string): void {
    if (this.pathStack.getAllPathName().includes(route)) return;
    this.pathStack.pushPathByName(route, null);
  }

  private cancelLogin(): void {
    this.loginIntent = new LoginIntent();
    this.pathStack.pop();
  }

  /** 取消注册：回到登录页而不是直接回游客首页，保持「登录 → 注册 → 登录」的回路。 */
  private cancelRegister(): void {
    if (this.pathStack.getAllPathName().includes(ROUTE_LOGIN)) {
      this.pathStack.pop();
      return;
    }
    this.requestLogin(new LoginIntent());
  }

  /**
   * 登录 / 注册成功后的续接（Issue #60 第三批）。
   *
   * 先应用身份，再按 intent 恢复原操作；**强制改密账号例外** ——
   * 契约规定它只能访问 session / logout / 改密，因此先送改密页，
   * 改密成功后由 onPasswordChanged 再走同一套续接（intent 不清空）。
   */
  private completeLogin(identity: SessionIdentity): void {
    const intent = this.loginIntent;
    this.onLoggedIn(identity);
    this.dismissLoginStack();
    if (this.needsPasswordChange(identity.mustChangePassword)) {
      this.openPasswordChange(true);
      return;
    }
    this.resumeIntent(intent, identity);
  }

  /**
   * 收起登录 / 注册 / 改密整条流程：从栈顶逐个弹掉这些页面，回到 tab 根。
   *
   * 为什么不能只 pop 一次：从登录页进注册页时栈是 [根, 登录, 注册]，
   * 只弹一次会把用户留在登录页上，之后每次返回都会再次看到登录页。
   * 带步数上限兜底，避免异常栈结构导致死循环。
   */
  private dismissLoginStack(): void {
    for (let step: number = 0; step < 8; step += 1) {
      const names: string[] = this.pathStack.getAllPathName();
      const top: string = names.length > 0 ? names[names.length - 1] : '';
      if (!AUTH_ROUTES.includes(top)) {
        return;
      }
      this.pathStack.pop();
    }
  }

  /**
   * 按 intent 恢复游客原本想做的操作（tab 或路由二选一，互斥）。
   *
   * `identity` 由调用方直接传入（登录 / 注册 / 改密刚拿到的服务端身份），
   * 不再回头读 `SessionService.current()`：那一读既冗余（同一个身份对象刚刚才交上来），
   * 也让本文件多一条跨文件依赖。身份由服务端认定，这里只读不改写。
   */
  private resumeIntent(intent: LoginIntent, identity: SessionIdentity | null): void {
    this.loginIntent = new LoginIntent();
    if (intent.tab >= 0) {
      this.admittedTab = intent.tab;
      this.currentTab = intent.tab;
      this.tabController.changeIndex(intent.tab);
      return;
    }
    if (intent.route !== '') {
      // routeAfterLogin 只读 identity.home；兜底用只读的 fallback 身份，不篡改任何真实身份字段。
      const current: SessionIdentity = identity === null ? new LoginFallbackIdentity() : identity;
      this.pathStack.pushPathByName(routeAfterLogin(intent.route, current), intent.param);
    }
  }

  /** 改密成功（新令牌已由 SessionService 保存）：刷新身份并续接原操作。 */
  private onPasswordChanged(): void {
    // mustChangePassword 已由 SessionService.changePassword 置 false，这里只把最新身份交回上层。
    const identity: SessionIdentity | null = SessionService.current();
    if (identity !== null) {
      this.onLoggedIn(identity);
    }
    this.dismissLoginStack();
    this.resumeIntent(this.loginIntent, identity);
  }

  /** 进入原生改密页；forced = 强制改密账号（不允许跳过，返回键拦截）。 */
  private openPasswordChange(forced: boolean): void {
    if (this.pathStack.getAllPathName().includes(ROUTE_PASSWORD_CHANGE)) return;
    this.passwordChangeForced = forced;
    this.pathStack.pushPathByName(ROUTE_PASSWORD_CHANGE, null);
  }

  private openRoute(route: string, param: Object | null): void {
    if (this.sessionTransition) return;
    // 强制改密账号：契约规定只能访问 session / logout / 原生改密 / Web 改密，
    // 其余业务路由一律不放进栈（否则用户点进去只会看到 403 PASSWORD_CHANGE_REQUIRED）。
    // 公开维修指南对游客也开放，属于公共浏览，不拦。
    if (this.authenticated && this.needsPasswordChange(this.mustChangePassword) && route !== ROUTE_PUBLIC_GUIDES) {
      this.openPasswordChange(true);
      return;
    }
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
          onBusyChange: (busy: boolean): void => { this.loginBusy = busy; },
          onRegisterCustomer: (): void => { this.openRegister(ROUTE_REGISTER_CUSTOMER); },
          onRegisterStaff: (): void => { this.openRegister(ROUTE_REGISTER_STAFF); }
        });
      } else if (name === ROUTE_REGISTER_CUSTOMER) {
        RegisterCustomerPage({
          onRegistered: (identity: SessionIdentity): void => { this.completeLogin(identity); },
          onCancel: (): void => { this.cancelRegister(); },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_REGISTER_STAFF) {
        RegisterStaffPage({
          onRegistered: (identity: SessionIdentity): void => { this.completeLogin(identity); },
          onCancel: (): void => { this.cancelRegister(); },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_PASSWORD_CHANGE) {
        PasswordChangePage({
          forced: this.passwordChangeForced,
          onChanged: (_data: PasswordChangeData): void => { this.onPasswordChanged(); },
          onCancel: (): void => { this.cancelLogin(); },
          onSessionExpired: (): void => { this.expireSession(); }
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
      if (name === ROUTE_PASSWORD_CHANGE) {
        // 强制改密账号不能跳过：返回键拦截（契约：必须先改密才能访问业务接口）。
        if (this.passwordChangeForced) return true;
        this.loginIntent = new LoginIntent();
      }
      return false;
    })
    .backgroundColor($r('app.color.start_window_background'))
  }

  /** 同时拦截底栏、手势和控制器切换；拒绝切换后取消登录保持原 tab。 */
  private canChangeTab(index: number): boolean {
    if (this.sessionTransition && index !== TAB_INDEX_HOME) return false;
    // 强制改密账号：只留在首页 tab，其余 tab 都是业务数据（契约边界），
    // 反复引导到改密页而不是让用户切过去看一片 403。
    if (this.authenticated && this.needsPasswordChange(this.mustChangePassword) && index !== TAB_INDEX_HOME) {
      this.openPasswordChange(true);
      return false;
    }
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
    if (this.authenticated && this.needsPasswordChange(this.mustChangePassword) && index !== TAB_INDEX_HOME) {
      this.openPasswordChange(true);
      return;
    }
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
