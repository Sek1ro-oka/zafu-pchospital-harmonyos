# “我的华为”参考截图

本目录共有 16 张项目组提供的参考截图：最初五张主页面图，及 [PR #70](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/pull/70) 补充的 11 张子页面图。最初五张原文件名日期标记为 2026-09-29；补充图片原始名称为 hash，2026-10-14 按实际画面重命名，图片字节保持原样。用于界面设计参考；App 版本和设备信息未记录。

| 截图 | 本项目参考点 |
| --- | --- |
| [首页](home-navigation.jpg) | 顶层导航和快捷服务入口 |
| [我的](my-account-service-record-entry.jpg) | 个人页中的服务记录入口 |
| [选购](shopping-category-navigation.jpg) | 分类网格与信息层级 |
| [服务](service-my-products-repair-entry.jpg) | 主要参考：设备卡片、维修服务和服务进度入口 |
| [花粉社区](community-huafen-feed.jpg) | 内容列表、搜索和频道布局 |

客户服务首页主要参考“服务”截图，个人页参考“我的”截图。报修表单、服务记录和进度详情按 [开发方案](../../development-plan.md)与实际业务设计；这些入口后的完整流程没有包含在现有截图中。

## PR #70 补充截图索引

文件名描述原图内容；下列参考点及后面的三个映射是设计建议，不代表页面已按新图改造。五个主页面及角色导航仍遵循下方原基线。

| 原文件名 | 重命名后的图片 / 原图页面 | 可参考的组织方式 |
| --- | --- | --- |
| `2eb5c08e89b358eddad677839eed9fc1.jpg` | [service-device-benefits.jpg：权益查询](service-device-benefits.jpg) | 设备概要、状态卡片、有效/失效层级，可用于服务页设备上下文；本项目没有保修权益接口 |
| `7133d345c48e776c76df1e855b252d2b.jpg` | [community-event-checkin-detail.jpg：活动帖子与每日打卡](community-event-checkin-detail.jpg) | 活动标题、发布信息、长图和底部操作；每日积分打卡不等于社团活动签到 |
| `7c4132fc5318480b9d3a28125117bc4d.jpg` | [community-event-post-detail.jpg：活动帖子详情](community-event-post-detail.jpg) | 大标题、发布信息、正文图片区、底部收藏，适合活动详情或案例阅读 |
| `7d96aa631f365b78fb7c10d356c3a6fe.jpg` | [community-circle-detail-feed.jpg：XMAGE 圈子详情](community-circle-detail-feed.jpg) | 主题头图、快捷分类、置顶、筛选和图文卡片；活动首版仍由社团发布 |
| `9002876e6f51c7a920e08ab842df172e.jpg` | [service-diagnostics-help.jpg：检测与帮助](service-diagnostics-help.jpg) | 主行动按钮、图标、故障分类折叠卡片，推荐映射③ |
| `a65ec9377d5706291f2150cee5b1b238.jpg` | [community-circles-category-list.jpg：全部圈子](community-circles-category-list.jpg) | 左侧分类、右侧分组条目，可用于知识分类目录；不引入加入圈子或发帖人数 |
| `b29b5c354bc0be61e4fd4b6994e7a798.jpg` | [harmonyos-upgrade-guide.jpg：升级尝鲜指南](harmonyos-upgrade-guide.jpg) | 横幅、快捷入口、说明正文、分组行动卡片，可用于指南阅读；不引入系统升级功能 |
| `b4ccd032c6739b6cd3aeebdbc66ae067.jpg` | [shopping-orders-empty-state.jpg：线下门店订单空态](shopping-orders-empty-state.jpg) | 状态筛选、说明条、居中空态，推荐映射② |
| `cca21fc3171ddc95ebcba42df9cdd41b.jpg` | [account-profile-sheet.jpg：华为账号资料面板](account-profile-sheet.jpg) | 大圆角面板、头像、昵称与信息入口，推荐映射① |
| `d1b45ae653de764fd6271646697d42c5.jpg` | [search-community-results.jpg：社区搜索结果](search-community-results.jpg) | 顶部搜索、类型筛选、分组结果、关键词强调，可用于指南/案例检索；成员结果只在已有授权目录展示 |
| `e79b0a66c42ab6e9702e6f2aa5ef8a88.jpg` | [service-battery-replacement-campaign.jpg：换电池活动专题](service-battery-replacement-campaign.jpg) | 全宽活动主视觉、时间与说明、底部行动区，可用于维修活动详情；不照搬购买或收费承诺 |

## 三个优先推荐映射

**实施状态（2026-10-14）：** 维护者已要求实施以下三个映射，本分支已完成页面改造、HAP 构建和模拟器操作。入口、双角色截图及限制见 [实际验证记录](../../verification/three-reference-pages-20261014.md)。下表保留 PR #72 时的映射说明。

以下以 `main` 的 PR #70 合入提交 `9ac3226` 中的真实页面为起点。仅安排视觉改造时优先采用这三个映射；PR #72 当时只整理图片与说明，页面后续实施状态见上方记录。

| 推荐 | 参考图 → 当前功能页面 | 具体改法 | 代码起点 |
| --- | --- | --- | --- |
| ① | [账号资料面板](account-profile-sheet.jpg) → **我的 / 个人资料** | 保留浅灰底、大圆角、居中头像与昵称层级。头像沿用项目默认资源，名称与联系电话来自当前账号；信息入口进入现有资料编辑。客户显示昵称/电话，成员显示本人有权查看的资料和技能。半屏面板可以后续选择，当前导航层级无需因截图改变 | [ProfilePage.ets](../../../app/entry/src/main/ets/features/profile/ProfilePage.ets)、[PersonalProfilePage.ets](../../../app/entry/src/main/ets/features/profile/PersonalProfilePage.ets) |
| ② | [订单空态](shopping-orders-empty-state.jpg) → **我的报修 / 工作人员报修列表** | 保留大标题、横向状态筛选、提示条及空态留白；使用真实报修状态（待受理、已受理、维修中、已完成、已取消）。列表有数据时显示机型、问题摘要和更新时间；空态提示「暂无报修」，客户可去报修。筛选需对应真实结果，分页/失败/加载态继续保留。维修备案仍是独立对象，不与报修混成一张订单列表 | [RepairOrdersPage.ets](../../../app/entry/src/main/ets/features/repair/RepairOrdersPage.ets)、[StaffRepairOrdersPage.ets](../../../app/entry/src/main/ets/features/repair/StaffRepairOrdersPage.ets) |
| ③ | [检测与帮助](service-diagnostics-help.jpg) → **知识库故障分类与 AI 问诊入口** | 保留主行动按钮和圆角故障类别卡；按钮改成「AI 故障问诊」，点击进入现有对话。类别改为开机、系统、网络、磁盘、散热等，展开或点击浏览真实指南，再打开指南/有效案例。这里是目录与入口，AI 对话仍为独立子页；不要将主按钮命名为自动硬件检测 | [KnowledgeLibraryPage.ets](../../../app/entry/src/main/ets/features/knowledge/KnowledgeLibraryPage.ets)、[PublicGuidesPage.ets](../../../app/entry/src/main/ets/features/knowledge/PublicGuidesPage.ets)、[KnowledgePage.ets](../../../app/entry/src/main/ets/features/knowledge/KnowledgePage.ets) |

三个映射均复用当前数据、角色与入口；参考图的昵称、电话、设备、计数和状态不是项目数据。其余八张作为补充构图参考，活动详情/报名等按 #62 的实际交付再接入，不因有参考图就扩大当前功能范围。

## 页面映射与开发基线

### 第 14 模块：活动详情与本人报名（2026-10-15）

| 实际参考原图 | 本项目页面 | 还原与真实字段 |
| --- | --- | --- |
| [换电池专题](service-battery-replacement-campaign.jpg) | 活动详情 / 报名入口 | 全宽浅蓝主视觉、居中可换行标题、真实时间/地点、电脑主题插画、名额/窗口/条款分区、固定底部行动区 |
| [活动打卡详情](community-event-checkin-detail.jpg) | 本人报名详情 | 暖色头部与左对齐大标题、白色大圆角现场状态卡、报名/签到/接待三格、掩码联系信息与允许的编辑 |

两张原图已打开逐页观察，实际 HAP 截图与比例差异见 [#77 验证记录](../../verification/issue-77.md)。蓝色插画由项目已有 `ref_laptop_hero.svg` 调色并适配取景，暖色沿用该资源；均为主题插画。活动状态、节点时间、条款和操作来自 #62 接口，不迁移其数据库业务；不添加购买、收费、积分、每日签到、作者/关注/点赞等字段。已接待不代表维修完成，未知节点保持中性；“我的报名”沿用完整分页，不从第一页推定唯一或不存在。最终视觉效果待维护者审查。

### 第 13 模块：目录与搜索（2026-10-15）

| 参考原图 | 本项目页面 | 实施状态 |
| --- | --- | --- |
| [全部圈子](community-circles-category-list.jpg) | 全部维修指南目录 | 左分类、右分组、图标、查看按钮；按标题粗分，空分类如实展示 |
| [社区搜索结果](search-community-results.jpg) | 知识搜索结果 | 搜索框、全部/指南/案例、关键词强调、分组结果；使用真实来源及权限 |

[Issue #76](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/76) 本轮实现及模拟器证据见 [验证记录](../../verification/issue-76.md)，案例接口见 [契约](../../../backend/docs/knowledge-browse-api.md)。新增案例查询尚未部署共享服务器；不引入成员、话题或联网搜索。最终视觉效果待维护者确认。

### 第 12 模块：阅读链路（2026-10-15）

| 参考原图 | 当前对应页面 | 实施状态 |
| --- | --- | --- |
| [权益查询](service-device-benefits.jpg) | 客户/工作人员报修详情 | 设备卡、状态/备案/联系人/时间线分卡；保留受理、进度和建档 |
| [升级指南](harmonyos-upgrade-guide.jpg) | 维修指南详情 | 横幅、真实章节快捷定位、正文与收藏/AI 入口 |
| [帖子详情](community-event-post-detail.jpg) | 公开/内部 AI 案例详情 | 大标题、来源、正文/结果、证据与底栏；工作人员可打开原始备案 |
| [圈子信息流](community-circle-detail-feed.jpg) | 公开/工作人员案例库 | 深色头图、圆角浅底、状态筛选与真实案例卡片 |

[Issue #75](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/75) 本轮已实现上述布局，HAP 与模拟器通过；[实际截图、操作、数据口径与限制](../../verification/issue-75.md)。这是按电脑医院业务替换后的还原，最终视觉效果待维护者确认。无真实图片/作者/来源计数的字段不补造，不照搬点赞、关注和加入圈子。

### 五个主页面基线

统一要求见 [根 README 页面映射](../../../README.md#页面映射与参考图)和 [开发方案页面映射与交互要求](../../development-plan.md#页面映射与交互要求)。参考图编号固定，客户底部顺序为 **首页｜活动｜服务｜知识｜我的**，工作人员中间改为 **工作台**。

| 截图 | 我的华为页面 / 参考图片 | 电脑医院页面 | 开发时按此改造 |
| --- | --- | --- | --- |
| ① | [首页](home-navigation.jpg) | **首页** | 保留大标题、搜索框、主视觉卡片和快捷服务布局。主卡文案为「电脑出问题？先问诊或预约维修」；快捷入口为 **AI 问诊、我要报修、进度查询、近期活动** |
| ② | [我的](my-account-service-record-entry.jpg) | **我的** | 保留头像信息卡和「我的信息」宫格，内容为 **我的报修、维修记录、活动报名、收藏、消息、个人资料**；工作人员账号提供 **进入工作台** 入口 |
| ③ | [选购](shopping-category-navigation.jpg) | **知识（知识库）** | 保留搜索框、横幅和分类宫格的组织方式；分类改为 **开机故障、系统软件、网络、磁盘、散热等**，下方展示维修指南及已审核备案形成的有效案例；不实现购物 |
| ④ | [服务](service-my-products-repair-entry.jpg) | **服务 / 工作台** | **最重要的仿照页面。** 客户侧「我的产品」改为 **当前报修设备／我的电脑**；「检测与帮助」对应 **AI 故障问诊**，「维修服务」对应 **预约报修**，「服务进度」对应 **报修进度**；工作人员侧组织为工作台 |
| ⑤ | [花粉](community-huafen-feed.jpg) | **活动** | 保留顶部分类、活动横幅和信息流，内容为 **社团维修活动、服务公告、维修经验分享**；首版由社团发布，不实现人人发帖的社区 |

2026-10-12：五个独立主页面已落地。本轮继续对照②～⑤，改造我的、知识、服务/工作台、活动；宣传内容换成电脑医院主题插画，未把原品牌会员福利、购物或社区功能搬入项目。缺失功能明确标注，布局完成不代表全部业务完成。

### 导航实现

- `features/home/HomePage.ets` 使用五个真实 `TabContent`，顺序为首页、活动、服务/工作台、知识、我的；底栏不随内容滑动。
- 底栏点击与左右手势使用 ArkUI 原生切换动画（260ms、ease-out 曲线），不会自制不可中断的过场。系统启用减少动态效果时关闭动画及横向手势，仍可点击底栏。
- 游客进入「我的」在切换前触发登录；取消留在原页。受保护业务入口继续按需登录，成功按服务端角色续接目标。
- 知识首页是分类目录，不把常驻 Tab 当作 AI 对话。AI 问答仍通过 `NavPathStack` 打开，离开销毁本次会话。
- 活动页复用公开维修活动 GET 接口；公告和经验分享显示「暂未接入」，不伪造帖子、点赞或报名记录。当前共享库无活动，模拟器验证的是空态。
- 客户知识页可读公开指南（标题筛选与粗分类），公开案例仍从登录后的问答引用访问。有 `repair:read` 的工作人员可读最近一页已发布案例，并打开现有案例详情。未新增公开案例目录接口。
- 服务入口实际显示「我要报修」，未增加预约时段。我的六个客户入口中，只有我的报修已接入；维修记录不把客户报修单改名冒充维修备案。
- 客户进度、设备与统计仍使用本人报修接口；工作人员的审核入口仍按服务端权限展示。
- 共用比例组件位于 `core/ui/ReferencePage.ets`；四页主题 SVG 为 `resources/base/media/ref_*.svg`，液态玻璃底栏沿用 `home_nav_glass.svg`。插画不是业务数据或现场照片。

### 设备卡数据来源说明

- 服务 tab「我的设备」**不是独立的设备绑定接口**：从客户最近 20 条本人报修单（`RepairOrderService.listMine`，服务端按令牌判定归属）的 `deviceModel` 字段派生去重，每个机型取最近一张单展示状态 chip（按机型合并不代表独立物理设备）；点击进对应报修单详情。
- 我的 tab 统计行的计数同样来自本人报修单最近一页（每页 20 条）；后端把分页总数放在信封 meta 里、客户端暂未取到，界面如实标注统计口径。

### 验证

四页 HAP 构建、模拟器截图及双角色操作见 [四页验证](../../verification/four-reference-pages-20261012.md)；首页此前证据见 [首页与导航验证](../../verification/home-reference-20261012.md)。没有实体手机验证。历史三页 Tab 版本的验证保留于 [原 UI 重设计记录](../../verification/ui-redesign-20261012.md)，其布局描述以本页的新映射为准。
