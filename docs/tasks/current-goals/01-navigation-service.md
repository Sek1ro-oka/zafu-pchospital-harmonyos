# 当前01：五栏导航调整与知识迁入服务

对应 [#83](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/83)；入口协作方为 [选购 #84](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/84) 和 [活动/论坛 #85](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/85)，最终统一验收为 [#42](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/42)。

## 状态与目标

**本 Issue 只完成规划，等待维护者通知开工，不预分配负责人。** 先读根 AGENTS.md、README 和 [当前目标](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/blob/main/docs/current-goals.md)。目标是把导航、知识入口及后续选购/论坛接线边界调整清楚，保留现有真实维修与知识能力。优先级 P0，阶段：入口与结构。

## 交付

- [ ] 客户五栏为首页｜活动｜服务｜选购｜我的；工作人员中间栏为工作台，第四栏统一为选购。保留液态玻璃底栏、滑动动画与减少动态效果设置。
- [ ] 将现有知识分类、目录、搜索、指南/案例阅读和 AI 问诊从顶层知识 Tab 迁入服务子入口；客户与工作人员均可访问其权限内知识。工作人员工作台不能因迁移失去处理/备案/审核/活动现场入口。
- [ ] 保留来源引用、收藏/消息跳转、首页旧知识入口和返回路径；知识案例与内部维修备案权限不放宽。登录取消留在原页，登录成功续接原操作。
- [ ] 与交易/论坛模块约定路由、Tab、首页和我的入口名称，由实际模块交付接线；未交付入口明确说明尚未接入，不写假商品/帖子。可先约定、后分 PR 集成，不等待所有后端完成才开始整理。
- [ ] 建立简短页面对照表（可以放 docs/ 下）：原图→目标页面→入口→现状/差异，补校园场景需求分析。商品详情/结算缺参考图时先补证或说明样式来源。
- [ ] 核对“我的”后续购物订单/卖家订单/本人发布/帖子入口布局；仅本人交易能力与已有成员/管理权限分开展示。

## 代码起点与参考

`app/entry/src/main/ets/features/home/HomePage.ets`、`HomeReferenceVisuals.ets`、`HomeTab.ets`，`features/service/ServicePage.ets`，`features/knowledge/KnowledgeLibraryPage.ets`、`KnowledgeSearchPage.ets`、`PublicGuidesPage.ets`，`features/profile/ProfilePage.ets`、`core/ui/Routes.ets` 与现有登录意图守卫。

参考 [服务](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/blob/main/docs/reference/my-huawei/service-my-products-repair-entry.jpg)、[检测与帮助](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/blob/main/docs/reference/my-huawei/service-diagnostics-help.jpg)、[首页导航](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/blob/main/docs/reference/my-huawei/home-navigation.jpg)。现有知识页面已还原的布局继续复用，不删除功能后重建。

## 依赖与必要验收

原有知识/维修基础已存在，无需等待新模块；交易和论坛只依赖本 Issue 的入口约定，最终集成互相核对。

1. 游客进入服务→浏览公开指南；从受保护入口登录→续接原页面，取消留在原页面。
2. 客户和工作人员分别从服务/工作台到分类→搜索→详情→返回；AI 对话、引用及原收藏跳转不丢失。客户不能打开内部案例/备案。
3. 实际点击及滑动切换五栏，确认标签、选中态、返回和系统减少动态效果处理正常；未接入的交易/论坛如实标记。
4. 构建 HAP，提交双角色模拟器截图、设备信息和简短结果；只跑导航/登录/知识相关回归，不重跑全库或收费模型链路。

PR 写 Refs 当前 Issue，普通 Merge，不直接推 main。交付时保持模拟器开启供维护者审查，不自行合并。可分“入口/迁移”与“模块接线”两次 PR。
