# 我的页面布局与后端连接（2026-10-12）

分支：codex/profile-backend-20261012；上游基点：bab74e6（PR #58）。
工作目录：E:/zafu_ph/.worktrees/profile。原工作区的多页未提交改动未覆盖、未带入。

## 范围与布局

仅调整我的页面，并补充它需要的分页网络能力。不更改首页、活动、服务/工作台、知识页面及底栏。
沿用上游 ReferencePage 组件、ref_* 图标与②参考图；头像使用紫色通用头像 SVG（不冒充用户上传头像），身份来自既有登录会话。
信息入口改为三列，客户六项为我的报修、维修记录、活动报名、收藏、消息、个人资料；保留工作人员工作台/典型案例/问答与按权限显示的备案审核。
个人资料为真实会话查询弹窗，展示姓名、角色及初始密码修改提示，不提供资料编辑。
客户维修记录、活动报名、收藏、消息、扫码仍明确未接入，不将客户报修改名冒充维修备案。

## 真实连接

- GET /api/v1/auth/native/session：个人资料只读查看。
- GET /api/v1/repair-orders?pageSize=1：从 meta.pagination.total 读取全部本人报修数。
- 同一列表按 SUBMITTED / ACCEPTED / REPAIRING / COMPLETED 查询总数：前三项合计处理中，COMPLETED 为已完结。取消单计入总数但不计入后两项，删除记录由服务端排除。
- 五次读取并行请求，期间有业务更新时各计数并非同一数据库快照，用户可显式刷新；没有伪称新增聚合接口。
- 沿用原生头和 Bearer 会话，用户归属由服务端认定，不提交 userId。
- 既有退出回调仍使用 SessionService.logout，服务端吊销后回游客首页。
- 公共 ApiClient 新增 getWithMeta；既有 get、POST、上传等调用仍只返回 data，错误信封处理保持一致。
- 统计缺失/异常、请求失败显示错误及重试，不冒充零条；防重复请求，离开页面后忽略迟到响应，失效通知根页面。

## 验证

- E:/DevEco Studio SDK，API24，独立目录 app/ 执行 ohpm install、hvigorw --mode module -p product=default assembleHap，BUILD SUCCESSFUL。未签名；保留上游的 PromptAction 异常提示告警，本轮资料失败提示新增一条同类告警。
- profile-app + reference-pages-app + guest-login-app：18/18；追加公共客户端兼容测试后 profile-app：5/5。测试执行真实 ArkTS 状态/服务方法，平台和网络是模拟依赖，不等同于装机运行。
- 新增测试 ESLint 通过，git diff --check 通过。
- 真实本地课设 API http://127.0.0.1:13080：测试客户会话200，全部11、处理中9、已完结2；测试退出200且吊销成功。未写入报修或用户业务数据，未使用生产数据库。
- hdc list targets 为 [Empty]；未装机或真机验证，没有本轮新页面真实截图。上游截图仅作原布局参考，不作为本轮截图。
- 无服务端接口、模型或迁移变更；未部署共享服务器，未运行数据库清理套件。

尚未创建或推送 PR，等待界面确认后按用户要求推进。
