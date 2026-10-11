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

五张参考图与实际页面（ArkTS/ArkUI，`app/entry/src/main/ets/`）的对应关系如下，仅记录已落地的部分。

| 参考图 | App 对应位置 | 借鉴了什么 |
| --- | --- | --- |
| [服务](service-my-products-repair-entry.jpg) | 首页「常用功能」网格（`features/home/HomePage.ets`）、客户服务页（`features/service/ServicePage.ets`） | 浅蓝灰底色 + 白卡网格、左侧图标砖 + 右侧标题与说明的卡片结构；服务页按「我的设备 → 常用服务 → 服务记录」分区 |
| [我的](my-account-service-record-entry.jpg) | 客户服务页的「服务记录」入口，指向「我的报修」（`features/repair/RepairOrdersPage.ets`） | 服务记录入口独立成行、可点击进入记录列表 |
| [首页](home-navigation.jpg) | 顶层入口分流（首页问候 + 客户/工作人员两套入口卡片） | 顶层导航的信息层级与快捷入口聚合 |
| [选购](shopping-category-navigation.jpg) | 客户服务页的分类网格（`EntryCard` 复用组件） | 分类网格布局与卡片内标题/说明的层级 |
| [花粉社区](community-huafen-feed.jpg) | 知识问答页的对话列表（`features/knowledge/KnowledgePage.ets`） | 内容列表的排布与信息密度 |

未落地（如实标注，未接入即不伪造数据）：

- **设备卡片**：服务页的「我的设备」只显示「设备信息未接入」，设备绑定与保修查询等接口确定后再接入。
- **商城 / 分类导航**：选购参考图对应的商城入口没有接入，仅借用其分类网格的布局语言。
- **预约服务**：服务页中标注为「待接口确定后接入」，点击给出提示而不跳转。
- **顶部导航栏（Tab）**：首页未采用参考图的底部/顶部分栏导航，改由首页入口卡片 + `NavDestination` 二级页承载。

