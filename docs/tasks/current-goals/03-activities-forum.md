# 当前03：活动＋论坛——保留报名闭环，新增公开交流

对应 [#85](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/85)；依赖 [#83](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/83) 的入口约定，复用已合入的 #62/#77，与 [#84](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/84) 可并行，统一验收见 [#42](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/42)。

## 状态与目标

**等待维护者通知开工，不预分配负责人。** 先读根 AGENTS.md、README 和 [当前目标](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/blob/main/docs/current-goals.md)。优先级 P1，阶段：主要功能闭环。活动 Tab 改为活动与论坛两类内容，按“花粉”的频道、信息流和详情组织，复用已有活动，新增真实发帖/评论。

## 已确认规则

社团发布活动；登录用户可发帖和评论，作者可删除自己的内容，管理员可管理。游客浏览公开内容，写操作按需登录并续接；首版不做私信、关注、积分和推荐算法，普通评论即可。

## 交付

- [ ] 活动 Tab 内明确活动/论坛切换和搜索范围；真实活动保留列表→详情→报名→我的报名/状态，工作人员保留现场/出勤/管理入口，不重建报名模型或丢掉 #62/#77 成果。
- [ ] 论坛帖子列表、基本分类/关键词搜索、分页、图文发布、详情、评论列表与提交、我的帖子；标题/正文/图片有明确限制与失败反馈，图片走真实上传及预览。
- [ ] 作者删除本人帖子/评论，管理员可管理帖子及评论；删除/管理后列表、详情与评论状态一致。非作者/非管理员越权操作由服务端拒绝，客户端不能传作者 ID 冒充身份。
- [ ] 论坛帖子和评论使用独立业务对象及契约，复用用户身份、网络/上传技术；不把内部维修备案评论、照片或个人消息直接开放为论坛内容。
- [ ] 论坛详情按参考图组织标题、作者/发布时间、正文图片区、底部评论入口和真实操作；原图点赞/收藏/关注等未列入本轮的能力不放假按钮或假计数。
- [ ] 我的页面接入我的帖子，与当前01协作接线。更新参考对照、真实 API、必要迁移与课设样本说明；页面样式在本模块内完成，不全留给最终打磨。

## 代码起点、参考与依赖

活动复用 `features/activity/ActivityPage.ets`、`ActivityDetailPage.ets`、`MyRegistrationsPage.ets`、`MyRegistrationPage.ets`、`ActivityService.ets`，后端 `src/features/repair-activities/` 及 `backend/docs/native-activities-api.md`。论坛建议独立 `features/forum/` 与后端 `src/features/forum/`；`features/profile/CommunityService.ets` 当前是收藏/消息等个人服务，不代表已有论坛。内部备案的 RecordComments 不能直接改成公共论坛。

参考 [花粉信息流](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/blob/main/docs/reference/my-huawei/community-huafen-feed.jpg)、[圈子信息流](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/blob/main/docs/reference/my-huawei/community-circle-detail-feed.jpg)、[帖子详情](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/blob/main/docs/reference/my-huawei/community-event-post-detail.jpg)。保留活动详情与本人状态已经采用的专题/状态卡参考。

先与当前01约定频道和路由，随后可与交易并行；不依赖商品订单。模块内可以分“论坛接口/基础页面”和“活动整合/视觉收尾”几个 PR，不额外拆大量 Issue。

## 必要验收

1. 游客浏览帖子→发帖或评论触发登录→续接；A发帖上传图片→B能看到并评论→A查看本人帖子。重试/重复点击不产生明显重复内容。
2. A不能删除B的帖子/评论；作者与管理员的删除/管理在其他账号刷新后生效，已移除详情不继续展示旧正文/图片。
3. 已有活动浏览→详情→账号报名→本人查询仍真实可用，工作人员现场入口保留；只验证整合受影响路径，不重跑原活动全套容量/并发测试。
4. 实际检查长标题/正文、图片、分类无结果、空评论、失败重试和返回，保存列表/详情/发布/双账号交互截图。
5. 运行论坛相关 API/权限/状态检查，构建 HAP，实际模拟器验收；不对无关模块做全面审计或调用收费模型。共享部署另行记录。

PR 写 Refs 当前 Issue，普通 Merge，不直接推 main；报告构建、模拟器、真机/部署分别做了什么，交付保持模拟器开启供维护者审查，不自行合并。
