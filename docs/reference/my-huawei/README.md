# “我的华为”参考截图

项目组提供的五张截图，原文件名日期标记为 2026-09-29，图片保持原样。用于界面设计参考；App 版本和设备信息未记录。

| 截图 | 本项目参考点 |
| --- | --- |
| [首页](home-navigation.jpg) | 顶层导航和快捷服务入口 |
| [我的](my-account-service-record-entry.jpg) | 个人页中的服务记录入口 |
| [选购](shopping-category-navigation.jpg) | 分类网格与信息层级 |
| [服务](service-my-products-repair-entry.jpg) | 主要参考：设备卡片、维修服务和服务进度入口 |
| [花粉社区](community-huafen-feed.jpg) | 内容列表、搜索和频道布局 |

客户服务首页主要参考“服务”截图，个人页参考“我的”截图。报修表单、服务记录和进度详情按 [开发方案](../../development-plan.md)与实际业务设计；这些入口后的完整流程没有包含在现有截图中。

## App 落地对照

五张参考图与实际页面（ArkTS/ArkUI，`app/entry/src/main/ets/`）的对应关系如下。本轮 UI 重设计（Tab 壳 + 彩色图标砖）落地后的结构：

| 参考图 | App 对应位置 | 借鉴了什么 |
| --- | --- | --- |
| [首页](home-navigation.jpg) | 底部 Tab 壳（`features/home/HomePage.ets`，Tabs 三页）+ 首页 tab（`features/home/HomeTab.ets`） | 底部悬浮胶囊导航（本项目落地为「首页 / 服务 / 我的」三页）；大标题问候 + 身份信息；「常用功能」四列白卡网格（图标在上、文字在下）。参考图的搜索框没有对应接口，**不放假搜索框**；banner 区用真实「进行中的报修」横向预览卡替代，不放假活动 banner |
| [服务](service-my-products-repair-entry.jpg) | 服务 tab（`features/service/ServicePage.ets`） | 「我的设备 → 常用服务 → 服务记录」分区；左彩色图标砖 + 右标题与说明的 2×2 功能卡（检测与帮助 / 我要换电池样式）；设备卡的「图标砖 + 设备名 + 状态 chip」结构 |
| [我的](my-account-service-record-entry.jpg) | 我的 tab（`features/profile/ProfilePage.ets`） | 白色个人卡（圆形头像 + 姓名与角色标识）、「我的信息」四列图标入口网格、统计行 |
| [选购](shopping-category-navigation.jpg) | 未做对应 tab；分类网格布局语言由 `EntryCard` / `QuickEntry` 承载 | 分类网格布局与卡片内标题/说明的层级 |
| [花粉社区](community-huafen-feed.jpg) | 知识问答页的对话列表（`features/knowledge/KnowledgePage.ets`） | 内容列表的排布与信息密度 |

### Tab 壳落地说明

- 登录后的主壳为 `Tabs` 三页：**首页 / 服务 / 我的**；参考图的「花粉」「选购」没有对应业务，不做假 Tab。
- Tab 栏为自绘悬浮胶囊（`Tabs.barHeight(0)` 收起自带栏 + Stack 底部叠加白底圆角胶囊），选中态品牌蓝，尺寸走 `core/ui/Theme.ets` 的 `TAB_BAR_*` 令牌。
- 子页仍由 `HomePage` 的 `NavPathStack` + `NavDestination` 承载，路由名（`ROUTE_*`）、`routeTitle`、`NavPusher` 防抖跳转与返回行为不变。
- 会话过期从任意 tab 回登录页：各 tab 页统一回调 `HomePage.expireSession()`（清栈 + 登出）。

### 设备卡数据来源说明

- 服务 tab「我的设备」**不是独立的设备绑定接口**：从客户最近 20 条本人报修单（`RepairOrderService.listMine`，服务端按令牌判定归属）的 `deviceModel` 字段派生去重，每个机型取最近一张单展示状态 chip（按机型合并不代表独立物理设备）；点击进对应报修单详情。
- 我的 tab 统计行的计数同样来自本人报修单最近一页（每页 20 条）；后端把分页总数放在信封 meta 里、客户端暂未取到，界面如实标注统计口径。

未落地（如实标注，未接入即不伪造数据）：

- **商城 / 分类导航**：选购参考图对应的商城入口没有接入，仅借用其分类网格的布局语言；Tab 壳也不设「选购」项。
- **花粉社区**：没有对应业务，不做该 Tab。
- **预约服务**：服务页功能卡中标注为「待接口确定后接入」，点击给出提示而不跳转。
- **参考图的搜索框、活动 banner、会员/积分等能力**：无对应接口与业务，不做假入口、不放假数据。

验证与限制见 [UI 重设计验证记录](../../verification/ui-redesign-20261012.md)：HAP 构建通过，页面方法模拟检查与 4 项既有回归通过；无设备，未真机验证。工作人员不展示客户设备与统计区，审核入口按服务端权限显示。各数据区提供手动刷新。
