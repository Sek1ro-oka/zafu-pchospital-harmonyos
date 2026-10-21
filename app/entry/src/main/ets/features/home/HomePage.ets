import { ActivityDetailPage } from '../activity/ActivityDetailPage';
import { ActivityLookupPage } from '../activity/ActivityLookupPage';
import { MyRegistrationsPage } from '../activity/MyRegistrationsPage';
import { MyRegistrationPage } from '../activity/MyRegistrationPage';
import { ActivityWorkspacePage } from '../activity/ActivityWorkspacePage';
import { ActivityBoardPage } from '../activity/ActivityBoardPage';
import { ActivityEditPage } from '../activity/ActivityEditPage';
import { ActivityRegistrationAdminPage } from '../activity/ActivityRegistrationAdminPage';
import { ActivityParam, RegistrationParam } from '../activity/ActivityContract';
import { ROUTE_ACTIVITY_DETAIL, ROUTE_ACTIVITY_SIGNUP, ROUTE_ACTIVITY_LOOKUP, ROUTE_MY_REGISTRATIONS, ROUTE_MY_REGISTRATION,
  ROUTE_STAFF_ACTIVITIES, ROUTE_ACTIVITY_BOARD, ROUTE_MANAGEMENT, ROUTE_ACTIVITY_ADMIN, ROUTE_ACTIVITY_EDIT, ROUTE_ACTIVITY_REGISTRATION_ADMIN } from '../../core/ui/Routes';
import { accessibility } from '@kit.AccessibilityKit';
import { curves } from '@kit.ArkUI';
import { ActivityPage } from '../activity/ActivityPage';
import { KnowledgeLibraryPage } from '../knowledge/KnowledgeLibraryPage';
import { KnowledgeSearchPage } from '../knowledge/KnowledgeSearchPage';
import { KnowledgeSearchParam } from '../knowledge/KnowledgeBrowse';
import { ROUTE_KNOWLEDGE_SEARCH } from '../../core/ui/Routes';
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
import { NavPusher, GuideFocusParam, RepairOrderFocusParam, routeTitle, ROUTE_SERVICE, ROUTE_PUBLIC_GUIDES, ROUTE_CASE_DETAIL, ROUTE_CASE_LIBRARY, ROUTE_KNOWLEDGE, ROUTE_KNOWLEDGE_LIBRARY, ROUTE_KNOWLEDGE_SOURCE, ROUTE_REPAIR_ORDERS, ROUTE_STAFF_ORDERS, ROUTE_STAFF_ORDER_DETAIL, ROUTE_STAFF_RECORD, ROUTE_STAFF_REVIEW } from '../../core/ui/Routes';
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
import { ShoppingPage } from '../shopping/ShoppingPage';
import { ProductDetailPage } from '../shopping/ProductDetailPage';
import { ProductEditPage } from '../shopping/ProductEditPage';
import { OrdersPage } from '../shopping/OrdersPage';
import { SellerOrdersPage } from '../shopping/SellerOrdersPage';
import { MyProductsPage } from '../shopping/MyProductsPage';
import { ShoppingGoodsParam } from '../shopping/ShoppingTypes';
import { ROUTE_SHOPPING_GOODS_DETAIL, ROUTE_SHOPPING_GOODS_EDIT, ROUTE_SHOPPING_ORDERS, ROUTE_SHOPPING_SELLER_ORDERS, ROUTE_SHOPPING_MY_PRODUCTS } from '../../core/ui/Routes';
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

/**
 * 五个真实根页面：首页｜活动｜服务（工作人员：工作台）｜选购｜我的。
 * 知识分类、搜索、指南、案例与 AI 对话都是离开即销毁的导航子页（#83）。
 */
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
 * 知识目录（#83 从顶层 Tab 迁入服务）在**游客放行条件**里用的路由值。
 *
 * 为什么写字面量而不是引用 `core/ui/Routes.ets` 的 `ROUTE_KNOWLEDGE_LIBRARY`：
 * `backend/tests/unit/guest-login-app.test.ts` 用「源码切片 + eval」转译本类，
 * 然后**真实调用** `openRoute('public-guides' / 'repair-orders' / 'knowledge')`，
 * 而它注入沙箱的符号表只有几个旧路由常量（没有本常量，也没有 `LoginIntent` 之外的新符号）；
 * 条件里多引用一个未注入的标识符，这条回归就会在 `openRoute` 处抛 ReferenceError，
 * 与业务行为无关（同 `needsPasswordChange` 的处理思路）。
 * 另一个 eval 用例 `native-auth-app.test.ts` 只调用 `interceptBack`，不会走到这里，
 * 但它同样整段求值本文件，所以这里只能是字面量，不能是模块级表达式。
 * 改 `Routes.ets` 里该路由值时必须同步本行；不一致时退化为「要求登录」，是安全方向。
 */
const GUEST_KNOWLEDGE_ROUTE: string = 'knowledge-library';

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
  private customerOrderBackHandler: () => boolean = () => false;
  @State knowledgeSearchRevision: number = 0;
  private registerBusy: boolean = false;
  private expiring: boolean = false;
  @State sessionTransition: boolean = false;
  /** 改密页是否处于「强制改密」模式：true 时禁用返回跳过（契约：必须先改密）。 */
  @State passwordChangeForced: boolean = false;
  /**
   * 改密请求是否在途（由 `PasswordChangePage` 通过 `onBusyChange` 上报）。
   *
   * 普通改密（非强制）在途时返回键同样不能放行：离开页面后迟到的响应会把令牌写成
   * 这个已被放弃的账号（账号串用）。与 `loginBusy` / `registerBusy` 同一机制。
   */
  private passwordChangeBusy: boolean = false;
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
  @State activityRevision: number = 0;
  @State recordsRevision: number = 0;
  @State workbenchRevision: number = 0;
  @State favoritesRevision: number = 0;
  @State messagesRevision: number = 0;
  @State publicCasesRevision: number = 0;
  @State publicCaseRevision: number = 0;
  @State shoppingRevision: number = 0;
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
    // 强制改密到此结束：复位强制标记，避免之后自愿进入改密页时被残留的 true 困住。
    this.passwordChangeForced = false;
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
    // 公开维修指南 / 知识搜索 / 活动详情对这类账号也放行，属于公共浏览，不拦。
    // 知识目录（#83 迁入服务）刻意**不**在这个放行名单里：先把账号送到改密页。
    // 注意这里没有写 `loginIntent`，所以改密成功后不会自动打开知识目录，
    // 而是回到 tab 根页（安全行为：半受限账号不直接进入知识页撞 403）。
    if (this.authenticated && this.needsPasswordChange(this.mustChangePassword) && route !== ROUTE_PUBLIC_GUIDES && route !== ROUTE_KNOWLEDGE_SEARCH && route !== ROUTE_ACTIVITY_DETAIL && route !== ROUTE_ACTIVITY_LOOKUP && route !== 'shopping-goods-detail') {
      this.openPasswordChange(true);
      return;
    }
    // 游客只能浏览公开页面；其余路由压登录页并记住目标，登录成功后续接。
    // `GUEST_KNOWLEDGE_ROUTE` 是 `ROUTE_KNOWLEDGE_LIBRARY` 的字面量镜像，原因见该常量注释。
    if (!this.authenticated && route !== ROUTE_PUBLIC_GUIDES && route !== ROUTE_KNOWLEDGE_SEARCH
      && route !== ROUTE_ACTIVITY_DETAIL && route !== ROUTE_ACTIVITY_LOOKUP && route !== GUEST_KNOWLEDGE_ROUTE
      && route !== 'shopping-goods-detail') {
      const intent = new LoginIntent();
      intent.route = route;
      intent.param = param;
      this.requestLogin(intent);
      return;
    }
    // 自愿进入改密页（如个人资料页「修改密码」）：清掉可能残留的强制标记。
    // 否则上一次强制改密遗留的 true 会让本次自愿进入被返回键拦截（困在改密页）。
    if (route === ROUTE_PASSWORD_CHANGE) {
      this.passwordChangeForced = false;
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

  /**
   * 系统返回键是否需要被拦截（true = 消费掉这次返回，页面不离开）。
   *
   * 为什么拦：认证类**写请求进行中**（登录 / 注册 / 改密）时离开本页，迟到的响应仍会把
   * 令牌与内存身份写成这个已被放弃的账号，而界面已经在登录另一个账号 ——
   * 后续请求就用了错误身份（账号串用）。拦下返回键是代价最小的做法：
   * 页面还在，迟到的响应写的正是它自己。
   * 改密分两种：普通改密靠 `passwordChangeBusy` 拦「请求在途」；
   * 强制改密则是另一条理由：契约规定必须先改密才能访问业务接口，不允许用返回键跳过
   * （`passwordChangeForced`），两者都要拦，且互不替代。
   *
   * 为什么抽成方法而不是直接写在 `onBackPressed` 里：`onBackPressed` 位于 `@Builder`
   * 内，后端 `guest-login-app.test.ts` 的「源码切片 + eval」不覆盖它，抽出来才能被回归测到。
   */
  private interceptBack(name: string): boolean {
    if (name === ROUTE_LOGIN) return this.loginBusy;
    if (name === ROUTE_REGISTER_CUSTOMER || name === ROUTE_REGISTER_STAFF) return this.registerBusy;
    if (name === ROUTE_PASSWORD_CHANGE) return this.passwordChangeForced || this.passwordChangeBusy;
    return false;
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
          onBusyChange: (busy: boolean): void => { this.registerBusy = busy; },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_REGISTER_STAFF) {
        RegisterStaffPage({
          onRegistered: (identity: SessionIdentity): void => { this.completeLogin(identity); },
          onCancel: (): void => { this.cancelRegister(); },
          onBusyChange: (busy: boolean): void => { this.registerBusy = busy; },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_PASSWORD_CHANGE) {
        PasswordChangePage({
          forced: this.passwordChangeForced,
          onChanged: (_data: PasswordChangeData): void => { this.onPasswordChanged(); },
          onCancel: (): void => { this.cancelLogin(); },
          onSessionExpired: (): void => { this.expireSession(); },
          onBusyChange: (busy: boolean): void => { this.passwordChangeBusy = busy; }
        });
      } else if (name === ROUTE_ACTIVITY_DETAIL || name === ROUTE_ACTIVITY_SIGNUP) {
        ActivityDetailPage({ param: param as ActivityParam, signup: name === ROUTE_ACTIVITY_SIGNUP, refreshVersion: this.activityRevision,
          onOpen: (route: string, target: Object | null): void => { this.openRoute(route, target); },
          onSessionExpired: (): void => { this.expireSession(); } });
      } else if (name === ROUTE_ACTIVITY_LOOKUP) {
        ActivityLookupPage({ param: param as ActivityParam });
      } else if (name === ROUTE_MY_REGISTRATIONS) {
        MyRegistrationsPage({ refreshVersion: this.activityRevision,
          onOpen: (route: string, target: Object | null): void => { this.openRoute(route, target); },
          onSessionExpired: (): void => { this.expireSession(); } });
      } else if (name === ROUTE_MY_REGISTRATION) {
        MyRegistrationPage({ param: param as RegistrationParam, refreshVersion: this.activityRevision,
          onSessionExpired: (): void => { this.expireSession(); } });
      } else if (name === ROUTE_STAFF_ACTIVITIES || name === ROUTE_ACTIVITY_ADMIN) {
        ActivityWorkspacePage({ admin: name === ROUTE_ACTIVITY_ADMIN, refreshVersion: this.activityRevision,
          onOpen: (route: string, target: Object | null): void => { this.openRoute(route, target); },
          onSessionExpired: (): void => { this.expireSession(); } });
      } else if (name === ROUTE_ACTIVITY_BOARD) {
        ActivityBoardPage({ param: param as ActivityParam, refreshVersion: this.activityRevision,
          onOpen: (route: string, target: Object | null): void => { this.openRoute(route, target); },
          onSessionExpired: (): void => { this.expireSession(); } });
      } else if (name === ROUTE_ACTIVITY_EDIT) {
        ActivityEditPage({ param: param as ActivityParam, onSessionExpired: (): void => { this.expireSession(); } });
      } else if (name === ROUTE_ACTIVITY_REGISTRATION_ADMIN) {
        ActivityRegistrationAdminPage({ param: param as ActivityParam, refreshVersion: this.activityRevision,
          onSessionExpired: (): void => { this.expireSession(); } });
      } else if (name === ROUTE_MANAGEMENT) {
        Column({ space: 18 }) {
          Text('管理').fontSize(26).fontWeight(FontWeight.Bold)
          if (this.permissions.includes('activity:admin')) {
            Button('活动管理').width('100%').onClick(() => { this.openRoute(ROUTE_ACTIVITY_ADMIN, null); })
          } else { Text('当前账号没有活动管理权限') }
        }.width('100%').padding(24)
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
          onBack: (): void => { this.pathStack.pop(); },
          refreshVersion: this.publicCasesRevision,
          onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_PUBLIC_CASE_DETAIL) {
        PublicCaseDetailPage({
          onBack: (): void => { this.pathStack.pop(); }, param: param as PublicCaseParam, refreshVersion: this.publicCaseRevision,
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_PERSONAL_PROFILE) {
        PersonalProfilePage({
          home: this.home, permissions: this.permissions, param: param as PersonalProfileParam | null,
          onBack: (): void => { this.pathStack.pop(); },
          onSaved: (name: string): void => { this.onProfileSaved(name); },
          onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_MEMBER_DIRECTORY) {
        MemberDirectoryPage({
          onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_KNOWLEDGE_SEARCH) {
        KnowledgeSearchPage({ authenticated: this.authenticated && !this.mustChangePassword, home: this.home, permissions: this.permissions,
          initialQuery: param === null || param === undefined ? '' : (param as KnowledgeSearchParam).query,
          refreshVersion: this.knowledgeSearchRevision, onBack: (): void => { this.pathStack.pop(); },
          onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
          onLogin: (): void => { if (this.mustChangePassword) this.openPasswordChange(true); else this.requestLogin(new LoginIntent()); },
          onSessionExpired: (): void => { this.expireSession(); } });
      } else if (name === ROUTE_PUBLIC_GUIDES) {
        PublicGuidesPage({
          onBack: (): void => { this.pathStack.pop(); },
          onSearch: (): void => { this.openRoute(ROUTE_KNOWLEDGE_SEARCH, null); },
          onOpenGuide: (id: string): void => { const focus: GuideFocusParam = { guideId: id }; this.openRoute(ROUTE_PUBLIC_GUIDES, focus); },
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
          onBack: (): void => { this.pathStack.pop(); },
          onRegisterBackHandler: (handler: () => boolean): void => { this.customerOrderBackHandler = handler; },
          initialDetailId: param !== null && param !== undefined
            ? (param as RepairOrderFocusParam).orderId
            : '',
          onSessionExpired: (): void => {
            this.expireSession();
          }
        });
      } else if (name === ROUTE_STAFF_ORDERS) {
        StaffRepairOrdersPage({
          onBack: (): void => { this.pathStack.pop(); },
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
      } else if (name === ROUTE_KNOWLEDGE_LIBRARY) {
        // #83：知识分类 / 目录从顶层 Tab 迁入服务与工作台。
        // 返回键与页内返回按钮都只弹栈，落回打开它的服务页，不再跳回首页。
        KnowledgeLibraryPage({
          onBack: (): void => { this.pathStack.pop(); },
          authenticated: this.authenticated, home: this.home, permissions: this.permissions,
          onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
          onSessionExpired: (): void => { this.expireSession(); }
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
          onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
          onBack: (): void => { this.pathStack.pop(); },
          param: param as CaseDetailParam,
          onSessionExpired: (): void => {
            this.expireSession();
          }
        });
      } else if (name === ROUTE_SHOPPING_GOODS_DETAIL) {
        ProductDetailPage({
          param: param as ShoppingGoodsParam,
          authenticated: this.authenticated && !this.mustChangePassword,
          refreshVersion: this.shoppingRevision,
          onBack: (): void => { this.pathStack.pop(); },
          onOpen: (route: string, target: Object | null): void => { this.openRoute(route, target); },
          onLogin: (): void => {
            if (this.mustChangePassword) this.openPasswordChange(true);
            else this.requestLogin(new LoginIntent());
          },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_SHOPPING_GOODS_EDIT) {
        ProductEditPage({
          param: param === null || param === undefined ? null : param as ShoppingGoodsParam,
          onBack: (): void => { this.pathStack.pop(); },
          onSaved: (productId: string): void => {
            this.pathStack.pop();
            const target: ShoppingGoodsParam = { id: productId };
            this.openRoute(ROUTE_SHOPPING_GOODS_DETAIL, target);
          },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_SHOPPING_ORDERS) {
        OrdersPage({
          role: 'buyer',
          refreshVersion: this.shoppingRevision,
          onBack: (): void => { this.pathStack.pop(); },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_SHOPPING_SELLER_ORDERS) {
        SellerOrdersPage({
          refreshVersion: this.shoppingRevision,
          onBack: (): void => { this.pathStack.pop(); },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      } else if (name === ROUTE_SHOPPING_MY_PRODUCTS) {
        MyProductsPage({
          refreshVersion: this.shoppingRevision,
          onBack: (): void => { this.pathStack.pop(); },
          onOpen: (route: string, target: Object | null): void => { this.openRoute(route, target); },
          onSessionExpired: (): void => { this.expireSession(); }
        });
      }
    }
    .hideTitleBar(name === ROUTE_PERSONAL_PROFILE || name === ROUTE_REPAIR_ORDERS || name === ROUTE_STAFF_ORDERS
      || name === ROUTE_STAFF_ORDER_DETAIL || name === ROUTE_PUBLIC_GUIDES || name === ROUTE_CASE_DETAIL
      || name === ROUTE_CASE_LIBRARY || name === ROUTE_PUBLIC_CASES || name === ROUTE_PUBLIC_CASE_DETAIL || name === ROUTE_KNOWLEDGE_SEARCH
      || name === ROUTE_KNOWLEDGE_LIBRARY || name.indexOf('shopping') >= 0)
    .title(name === ROUTE_LOGIN ? '登录' : routeTitle(name))
    .onShown(() => {
      if (name === ROUTE_KNOWLEDGE_SEARCH) this.knowledgeSearchRevision += 1;
      this.workbenchRevision += 1;
      if (name.indexOf('activity') >= 0 || name === ROUTE_STAFF_ACTIVITIES) this.activityRevision += 1;
      if (name === ROUTE_REPAIR_RECORDS) this.recordsRevision += 1;
      if (name === ROUTE_FAVORITES) this.favoritesRevision += 1;
      if (name === ROUTE_MESSAGES) this.messagesRevision += 1;
      if (name === ROUTE_PUBLIC_CASES) this.publicCasesRevision += 1;
      if (name === ROUTE_PUBLIC_CASE_DETAIL) this.publicCaseRevision += 1;
      if (name.indexOf('shopping') >= 0) this.shoppingRevision += 1;
    })
    .onBackPressed((): boolean => {
      // 认证写请求进行中 / 强制改密未完成：拦下返回，避免迟到响应把会话写成另一个账号。
      if (this.interceptBack(name)) return true;
      if (name === ROUTE_REPAIR_ORDERS && this.customerOrderBackHandler()) return true;
      if (name === ROUTE_LOGIN || name === ROUTE_PASSWORD_CHANGE) {
        // 放弃登录 / 改密即作废续接意图；注册路由刻意不清，注册页取消后要回登录页续接原操作。
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
            ActivityPage({ onOpen: (route: string, target: Object | null): void => { this.openRoute(route, target); } })
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
            ShoppingPage({
              refreshVersion: this.shoppingRevision,
              onService: (): void => { this.selectNavigation(2); },
              onOpen: (route: string, param: Object | null): void => { this.openRoute(route, param); },
              onSessionExpired: (): void => { this.expireSession(); },
              staff: this.home === HOME_STAFF
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
          if (index === 3) this.shoppingRevision += 1;
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
