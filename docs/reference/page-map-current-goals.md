# 页面对照表：参考图 → 目标页面 → 入口 → 现状（#83 / #84）

2026-10-20 建表，2026-10-21 按 #84 更新。依据 [当前目标](../current-goals.md) 的页面映射编写：
[#83](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/83) 交付导航结构与知识迁入服务；
[#84](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/84) 交付选购交易的真实页面、
接口与验证（见 [issue-84 验证记录](../verification/issue-84.md)）。论坛（#85）仍待交付，
表中「待交付」不是已完成。参考图索引见 [my-huawei/README.md](my-huawei/README.md)。

## 1. 五栏导航

客户：**首页｜活动｜服务｜选购｜我的**；工作人员：**首页｜活动｜工作台｜选购｜我的**
（中间栏同名组件按 `home` 显示「服务 / 工作台」，第四栏统一「选购」）。
底栏仍是 `HomeReferenceVisuals.ets` 的液态玻璃悬浮栏，切换沿用 ArkUI 原生 `Tabs` 滑动动画
（260ms），系统开启减少动态效果时 `scrollable(false)` + `animationDuration(0)`。

| 参考图 | 目标页面 | 入口 | 现状 | 差异 / 待办 |
| --- | --- | --- | --- | --- |
| [首页](my-huawei/home-navigation.jpg) | 首页 | 底栏第 1 栏 | 已还原：大标题、搜索、金色主视觉、问诊/报修/进度/活动快捷卡、进行中报修；游客态与工作人员态分开 | 搜索仍只指向公开维修指南（不聚合商品/帖子）；#84 已交付商品接口但本轮未加首页购物聚合入口，论坛入口待 #85 |
| [花粉](my-huawei/community-huafen-feed.jpg) | 活动＋论坛 | 底栏第 2 栏 | 已还原活动：推荐/维修活动/服务公告/经验分享频道、活动卡、详情、报名、本人报名、现场看板与管理页（真实接口） | 论坛未交付：服务公告/经验分享仍是「暂未接入」，**没有帖子、评论、点赞数据**；待 #85 |
| [服务](my-huawei/service-my-products-repair-entry.jpg)、[检测与帮助](my-huawei/service-diagnostics-help.jpg) | 服务 / 工作台 | 底栏第 3 栏 | 客户：设备卡（本人报修派生）、AI 问诊/我要报修/报修进度/维修指南四张卡、**新增「知识与帮助」**、精选服务与快捷服务；工作人员：工作台卡、报修工作台/知识问答/典型案例库、成员活动、管理、备案审核/维修备案 | 设备卡是报修单 `deviceModel` 派生，不是独立设备绑定接口；无保修权益数据 |
| [选购](my-huawei/shopping-category-navigation.jpg)、[订单空态](my-huawei/shopping-orders-empty-state.jpg) | 选购 | 底栏第 4 栏（游客可进） | 已交付真实交易：分类/关键词列表（分页）、商品详情、发布/编辑、下架、下单、我的购物订单、卖家订单、我发布的商品；数据来自真实接口，空态/失败态如实显示 | 无参考图的页面沿用现有 App 样式（见第 3 节）；购物车、线上支付、配送未做；分类按商品类目字段，不是参考图的完整频道 |
| [我的](my-huawei/my-account-service-record-entry.jpg)、[账号资料](my-huawei/account-profile-sheet.jpg) | 我的 | 底栏第 5 栏（游客点击先登录） | 已还原：资料卡与退出、报修统计（注明口径）、入口宫格「我的报修/我的报名/我的购物订单/我发布的商品/卖家订单/收藏/消息/修改密码/个人资料」，工作人员另有备案、审核、案例库、工作台 | 「维修记录」标「暂未接入」；「我的帖子」入口待 #85；购物入口与报修/备案分卡，状态文案不复用维修单 |

## 2. 知识入口迁入服务（本轮完成）

原来第 4 栏的「知识」Tab 已移除，知识相关页面全部改为**导航子页**：从服务/工作台压栈进入，
页内返回按钮与系统返回都只弹栈，落回打开它的服务页，**不再跳回首页**。
知识目录页原来的 `onBack → selectNavigation(0)` 已换成 `pathStack.pop()`。

| 参考图 | 页面 / 路由常量 | 入口名称 | 现状 | 差异 / 说明 |
| --- | --- | --- | --- | --- |
| [检测与帮助](my-huawei/service-diagnostics-help.jpg) | 知识分类/目录 `ROUTE_KNOWLEDGE_LIBRARY`（`KnowledgeLibraryPage`） | 服务·工作台「知识与帮助 → 分类目录」 | 已从 Tab 迁入；故障分类折叠卡、全部指南、已审核案例区保留；游客可读公开指南 | 分类按标题粗分，不是后端分类字段；工作人员案例区仍按 `repair:read` 权限 |
| [社区搜索结果](my-huawei/search-community-results.jpg) | 知识搜索 `ROUTE_KNOWLEDGE_SEARCH` | 「知识与帮助 → 知识搜索」、目录页放大镜、首页搜索 | 已保留，游客可进 | 只搜公开指南/公开案例，不含成员、商品或帖子 |
| [升级指南](my-huawei/harmonyos-upgrade-guide.jpg) | 公开维修指南 `ROUTE_PUBLIC_GUIDES` | 「维修指南」卡、目录「全部指南」、精选服务横幅、快捷服务 | 已保留，游客可进 | 指南正文与收藏来自真实接口 |
| [帖子详情](my-huawei/community-event-post-detail.jpg)、[圈子信息流](my-huawei/community-circle-detail-feed.jpg) | 案例阅读 `ROUTE_PUBLIC_CASES`（客户）/ `ROUTE_CASE_LIBRARY` + `ROUTE_CASE_DETAIL`（工作人员） | 「知识与帮助 → 公开案例 / 典型案例库」 | 已保留；案例按既有规则要求登录，游客点击后登录成功自动续接案例页 | 案例与内部维修备案权限不放宽；不公开备案正文/照片 |
| 同上（检测与帮助主按钮） | 带来源 AI 问诊 `ROUTE_KNOWLEDGE`（`KnowledgePage`） | 「AI 故障问诊」卡、页面标题耳机按钮、快捷服务「故障问诊」 | 已保留；对话是离开即销毁的子页，引用详情走 `ROUTE_KNOWLEDGE_SOURCE` | 无独立参考图，按服务页主行动按钮定位 |

首页旧知识入口全部保留：标题耳机按钮、问诊频道胶囊、AI 问诊快捷卡，以及搜索框进入公开指南；
它们都仍是子页，不依赖已移除的知识 Tab。

## 3. 缺图与样式来源

- 参考图只有 [选购分类页](my-huawei/shopping-category-navigation.jpg) 和
  [订单空态](my-huawei/shopping-orders-empty-state.jpg)；**商品列表、商品详情、下单结算、
  卖家操作、购物订单列表都没有参考图**。#84 在缺图页面上沿用现有 App 样式（白色圆角卡片、
  品牌色主按钮、`DetailNotice` 提示条、底栏留白），不做猜测性的频道横幅/购物车；
  具体取舍与差异见 [issue-84 验证记录 §10](../verification/issue-84.md)。
- 选购页沿用原有空态页的视觉语言：浅灰底 `REFERENCE_BACKGROUND`、白色 18–20 圆角卡片、
  标题 28 粗体（`ReferenceTitle` 同规格）、`DetailNotice` 说明条、底栏留白（列表页 96）。
  空列表复用 `DetailEmptyOrders`，主图标仍是项目自有 SVG，不使用生成商品图冒充真实商品。
- 论坛列表/详情可参考圈子信息流与帖子详情图，但当前没有帖子接口，未做页面。

## 4. #84 / #85 接线约定

以下为入口与路由口径：#84 已按此实现真实交易（见 [验证记录](../verification/issue-84.md)），
#85（论坛）仍待实现；后续接线以本表为准，避免各模块自造名称。

### 选购与交易（#84，已交付）

| 项目 | 约定与现状 |
| --- | --- |
| 底栏 | 第 4 栏固定「选购」，索引 3，图标 `home_nav_shopping.svg` / `home_nav_shopping_active.svg`（已交付） |
| Tab 组件 | `app/entry/src/main/ets/features/shopping/ShoppingPage.ets`：真实商品列表（分类、关键词、分页）、发布入口、空态/失败态；保留原空态页的标题与底栏留白 |
| 游客 | 索引 3 不在 `canChangeTab` 的登录拦截内，游客直接浏览；发布/下单/我的订单等写操作走 `HomePage.openRoute` 的登录意图续接，不另建登录门槛 |
| 子页路由 | 已按约定落地：`ROUTE_SHOPPING_GOODS_DETAIL`（商品详情）、`ROUTE_SHOPPING_GOODS_EDIT`（发布/编辑商品）、`ROUTE_SHOPPING_ORDERS`（我的购物订单）、`ROUTE_SHOPPING_SELLER_ORDERS`（卖家订单），另加 `ROUTE_SHOPPING_MY_PRODUCTS`（我发布的商品）；`routeTitle` 与 `HomePage.destination` 同步 |
| 游客可读子页 | 仅商品详情公开，加入 `HomePage.openRoute` 的游客放行与强制改密放行条件；**路由值写成 `'shopping-goods-detail'` 字面量**，原因同第 5 节第 1 条（测试注入符号表）。列表在选购 Tab 内，游客可直接进 |
| 我的入口 | 名称「我的购物订单」「我发布的商品」「卖家订单」，客户与工作人员宫格都有；与报修/备案分卡，购物订单不借用 `RepairOrder`/`RepairRecord` 的状态文案 |
| 首页入口 | 未在本轮加入；首页搜索仍只指向公开维修指南。后续有需要再加，未接入前不加空入口 |
| 交易规则 | 线下付款取货，不做线上支付/配送/退款资金流；下单弹窗与页面明确「本应用不承诺线上支付」，订单状态只有待取货/已完成/已取消，不显示「支付成功」 |

### 活动＋论坛（#85）

| 项目 | 约定 |
| --- | --- |
| 底栏 | 不新增栏目，论坛并入第 2 栏「活动」（索引 1）的频道 |
| Tab 组件 | `features/activity/ActivityPage.ets`；现有频道「推荐 / 维修活动 / 服务公告 / 经验分享」中把公告/分享替换为真实论坛频道，或新增「论坛」频道 |
| 子页路由 | 建议 `ROUTE_FORUM_POST`（帖子详情）、`ROUTE_FORUM_COMPOSE`（发帖）。游客可读列表/详情则按「公开浏览」加进 `HomePage.openRoute` 的游客放行条件（本轮没有 `GUEST_ROUTES` 这样的集中常量，条件内联），写操作走登录续接 |
| 我的入口 | 名称「我的帖子」，与「我的报名」并列；帖子评论与维修备案评论是不同对象，不得公开内部备案正文/照片 |
| 活动 | 复用现有报名、本人状态、现场与管理员页面，不重建报名模型 |

## 5. 本轮已知偏差与限制

1. **公开子页路由值用字面量**：`HomePage` 里用常量 `GUEST_KNOWLEDGE_ROUTE = 'knowledge-library'`
   与字面量 `'shopping-goods-detail'`，而不是引用 `core/ui/Routes.ets` 的
   `ROUTE_KNOWLEDGE_LIBRARY` / `ROUTE_SHOPPING_GOODS_DETAIL`。
   原因：`backend/tests/unit/guest-login-app.test.ts` 用「源码切片 + eval」转译 `HomePage.ets` 后
   **真实调用** `openRoute('public-guides' / 'repair-orders' / 'knowledge')`，而它注入沙箱的符号表
   只有几个旧路由常量；条件里多引用一个未注入的标识符，这条回归就会在 `openRoute` 处抛
   ReferenceError（与文件里 `needsPasswordChange` 的取舍同源）。另一个 eval 用例
   `native-auth-app.test.ts` 只调用 `interceptBack`、不会执行到本条件，但它同样整段求值该文件，
   所以这里也只能是字面量，不能是模块级表达式。两边不一致时退化为「要求登录」，是安全方向。
   要升级成真常量引用，必须同时补这两个测试的注入符号表。
2. 强制改密账号仍只能停在首页 tab；知识目录刻意不在 `openRoute` 的强制改密放行名单里 ——
   这类账号点知识目录会被送到改密页。**该方法不写 `loginIntent`，所以改密成功后会回到 tab 根页，
   不会自动打开知识目录**；安全行为（半受限账号不直接进知识页撞 403）保留。
3. 知识目录页底部留白从 96vp 改为 24vp：它不再是常驻 Tab，没有悬浮底栏需要让位。
4. 选购页底部仍保留工作人员出口按钮（「去『服务』/『工作台』查看维修与知识」），
   `HomePage` 传 `this.home === HOME_STAFF`；它现在位于商品列表下方，是辅助入口，不再是空态页主体。
5. 未做设备/真机验证的部分见 [验证记录](../verification/issue-83.md)；#84 的设备验证、
   构建与截图见 [issue-84 验证记录](../verification/issue-84.md)。
