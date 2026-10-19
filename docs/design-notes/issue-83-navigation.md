# #83 五栏导航与服务知识入口 · Demo 设计 v2

2026-10-19；基线 d356297f（PR #86 文档 tip，尚未合入 main）。维护者已通知开工，当前为纯前端 Demo，用户确认待收集，未进入统一验收。

## 需求和边界

校园用户需要修电脑、查知识、参加活动、交易闲置配件与维修耗材。客户五栏为首页、活动、服务、选购、我的；工作人员第三栏为工作台。知识收进服务，保留公开/内部边界、引用和收藏消息深链。工作人员保留处理、备案、审核与现场入口，审核需要单独权限。

本轮仅在 features/navigationDemo 集中模拟数据和身份，Index 为隔离启动壳，不接 API、数据库、鉴权或模型。原正式 Index 可从 git show d356297f:app/entry/src/main/ets/pages/Index.ets 查看。不得将 Demo 壳直接合入生产。商品/论坛不造样本、不伪造计数，明确 #84/#85 尚未接入。

## 原图→目标→入口→差异

V2 再次逐张打开首页、服务、检测帮助、选购、花粉、我的、账号资料七张原图。复用项目自有插画、灰底白卡、圆角和玻璃底栏；没有搬用品牌商业数据。

| 原图 | 目标与入口 | 差异 |
| --- | --- | --- |
| home-navigation.jpg | 首页；知识搜索、问诊、报修、活动、选购 | 暖黄主视觉，校园服务，不显示会员日/通知数 |
| service-my-products-repair-entry.jpg | 服务/工作台；设备、知识与帮助、报修进度、四个工作入口 | 未连接设备，不造报修数 |
| service-diagnostics-help.jpg | 知识中心→分类目录→搜索→阅读→来源/问诊 | 不叫自动检测；样本显式演示 |
| shopping-category-navigation.jpg | 选购、发布、本人交易入口 | #84 待交付，不造商品价格；详情/下单缺参考，本阶段不设计交易结果 |
| community-huafen-feed.jpg | 同一 Tab 的活动/论坛频道 | #85 论坛待接入，无假帖子活动 |
| my-account-service-record-entry.jpg | 我的；资料/报修/报名/收藏/消息、购物/卖家订单/商品/帖子 | 不显示积分；身份明显演示 |

## 拟定生产入口契约（规划，非现有实现）

Tab 索引固定 0首页/1活动/2服务/3选购/4我的。角色只改变第三栏标签；子页使用 NavPathStack 逐级返回。首页搜索只搜知识，旧知识入口归服务知识子页，深链保留内容 ID。

| 协作方 | 建议路由与参数 | 接点及守卫 |
| --- | --- | --- |
| #84 | shopping-product(productId)、shopping-orders、shopping-seller-orders、shopping-my-products、shopping-publish | 选购 Tab / 我的订单、卖家订单、本人商品；公开浏览，本人/写操作按需登录 |
| #85 | forum-post(postId)、forum-publish、forum-my-posts；activity-* 保持 | 活动 Tab 论坛频道 / 我的帖子；游客浏览，写操作/本人记录登录 |

新名称实施前在相应 Issue 对齐，当前不写 Routes.ets。已有 public-guides(guideId)、knowledge-search(query)、knowledge、knowledgeSource、public-cases/public-case-detail、knowledge-case-library/knowledge-case-detail 保持值、参数与权限，复用真实页面。repair-orders 是客户报修，repair-records 是维修备案，购物订单另建，不复用状态。论坛不公开内部备案评论。工作人员不自动等于管理员。

守卫保存目标路由/参数或 Tab；取消清意图、原页/栈不动；成功续接一次。Demo 全部内存身份，重启游客；正式迁移复用现有认证守卫。Demo 减少动态效果开关仅模拟，关闭横滑/动画；生产沿用现有系统设置监听。

## 阶段与检查

本次官方来源：[Tabs](https://github.com/openharmony/docs/blob/master/en/application-dev/ui/arkts-navigation-tabs.md)、[背景模糊](https://github.com/openharmony/docs/blob/master/en/application-dev/ui/arkts-blur-effect.md)。API24 unsigned HAP 本轮已构建成功；V2 已安装独立包并实际模拟器操作，见验证记录。

当前：纯前端 Demo、文档、HAP/设备记录、独立审查。用户明确满意后另派正式迁移；#84/#85 就绪再接真实入口；#42 后续统一打磨，当前不承接验收。

复用指挥本次 2026-10-19 调研：官方 OpenHarmony docs master arkts-navigation-tabs.md（Tabs 切换/scrollable）和 arkts-blur-effect.md（模糊），只参考设计，无引入代码/依赖。复用现有 Tabs、Navigation 与资源；API24 由本轮 HAP 核实。必要检查：五栏点击/滑动、角色入口、知识路径与返回、登录取消/续接、加载空失败、减少动态效果、无业务依赖、unsigned HAP 和模拟器；不跑无关 DB/模型/全库测试。操作与结果分别见 docs/demo/issue-83-navigation-demo.md、docs/verification/issue-83-demo.md。


## V2 视觉迭代（2026-10-19）

用户明确不满意首版，要求参考远端映射页面；V1 内部通过不作为 V2 视觉确认。V2 仍为纯前端 Demo，等待用户明确满意，未进入真实业务或项目验收。

| 页面 | V2 实际构图 | 校园适配与剩余差异 |
| --- | --- | --- |
| 首页 | 顶部贯通金色渐变、大标题和圆工具、胶囊搜索、大电脑主视觉、指示线、频道胶囊、四列快捷服务、灰底后续区 | 原品牌会员促销换项目电脑插画；无通知计数和商业日期，插画细节不复制原品牌素材 |
| 服务/工作台 | 浅灰白底、白设备上下文卡、2列×2行图标服务卡、精选知识横幅、四列快捷服务 | 设备为空且明确演示；工作台四入口保留，审核单独权限。没有设备绑定接口结果 |
| 知识中心 | 原生返回标题、宽松盾图标、蓝胶囊问诊动作、故障类别卡；目录左右栏、搜索筛选、阅读横幅/章节/来源 | 故障卡点击进入类别目录，展开箭头作为进入提示；不是自动硬件检测。指南自编并标明演示 |
| 选购 | 大标题与胶囊搜索、大幅暖色校园二手横幅、两行四列类别、商品区域空态 | 交易功能建设中，暂无商品/价格/订单；分类为导航展示，暂无法下单，无假促销 |
| 活动 | 活动/论坛频道、工具和搜索、紫蓝横幅、紧凑快捷分类、白色内容空态 | 没有假作者/时间/帖子/报名数；内容和搜索尚未接业务 |
| 我的 | 紧凑头像白卡、紫默认头像和金操作胶囊、独立白色三列摘要、我的信息宫格、交易创作/常用服务分卡 | 摘要用 —/待接数据；不用积分会员统计。资料子页居中大头像，全部身份仍演示 |
| 五栏 | 图标＋短标签、蓝选中态、原生背景模糊、玻璃素材/反光边、固定悬浮胶囊 | 保留横滑/点击与演示减少动态效果；不是声称已读取系统设置 |

间距约16vp，主要白卡圆角22–25vp，主标题28sp；内容底部105vp留白，可滚动露出最后入口。原生与HTML各自实现同一演示状态/构图，HTML不是原生证据。正式业务接线和交易/论坛仍不属于这版交付。
