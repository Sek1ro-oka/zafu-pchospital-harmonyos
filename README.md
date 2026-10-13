# 鸿蒙电脑医院

四人课程项目，前后端放在同一公开仓库。ArkTS / ArkUI 原生 App 的界面参考“我的华为”，Next.js 后端连接独立课设 MySQL，不使用 Docker；App 默认使用共享实验服务器，后端开发可选本地环境。功能范围见 [开发方案](docs/development-plan.md)，使用模块 Issue 记录目标与进度，由团队认领和安排，不设固定周计划或成员审批。

## 页面映射与参考图

**以下为 2026-10-12 确认的页面开发基线。** 开发每一页前先打开该行参考图片，再阅读 [开发方案中的页面映射与交互要求](docs/development-plan.md#页面映射与交互要求)。五张图参考布局、层级和材质，内容改为电脑医院业务，不照搬购物或社交功能。

| 截图 | 我的华为页面 / 参考图片 | 电脑医院页面 | 开发时按此改造 |
| --- | --- | --- | --- |
| ① | [首页](docs/reference/my-huawei/home-navigation.jpg) | **首页** | 保留大标题、搜索框、主视觉卡片和快捷服务布局。主卡文案为「电脑出问题？先问诊或预约维修」；快捷入口为 **AI 问诊、我要报修、进度查询、近期活动** |
| ② | [我的](docs/reference/my-huawei/my-account-service-record-entry.jpg) | **我的** | 保留头像信息卡和「我的信息」宫格，内容为 **我的报修、维修记录、活动报名、收藏、消息、个人资料**；工作人员账号提供 **进入工作台** 入口 |
| ③ | [选购](docs/reference/my-huawei/shopping-category-navigation.jpg) | **知识（知识库）** | 保留搜索框、横幅和分类宫格的组织方式；分类改为 **开机故障、系统软件、网络、磁盘、散热等**，下方展示维修指南及已审核备案形成的有效案例；不实现购物 |
| ④ | [服务](docs/reference/my-huawei/service-my-products-repair-entry.jpg) | **服务 / 工作台** | **最重要的仿照页面。** 客户侧「我的产品」改为 **当前报修设备／我的电脑**；「检测与帮助」对应 **AI 故障问诊**，「维修服务」对应 **预约报修**，「服务进度」对应 **报修进度**；工作人员侧组织为工作台 |
| ⑤ | [花粉](docs/reference/my-huawei/community-huafen-feed.jpg) | **活动** | 保留顶部分类、活动横幅和信息流，内容为 **社团维修活动、服务公告、维修经验分享**；首版由社团发布，不实现人人发帖的社区 |

### 双角色导航与权限

- **客户： 首页｜活动｜服务｜知识｜我的**。「服务」是报修主入口，「我的」查看本人记录；知识只展示客户有权访问的指南与公开案例。
- **工作人员： 首页｜活动｜工作台｜知识｜我的**。保持相近外观，中间「服务」改为「工作台」，组织待处理报修、处理中、维修备案及审核相关入口；「我的」也提供进入工作台入口，知识可展示其有权查看的内部案例。
- 工作台中的「待审核案例」按现有业务口径衔接**维修备案审核**：审核入口只向服务端授权的人员展示，不因工作人员身份就授予审核权限。已审核备案被标记典型后仍按 #40 自动整理、合并并发布，**不新增典型案例二次审核**。
- 导航名称统一为「知识」，页面内容可以称知识库；截图③选购 → 知识、截图⑤花粉 → 活动，图片编号不是底部导航顺序。

### 设计目标与已实现范围

2026-10-12：五个独立主页面已按对应参考图完成布局改造，底栏点击与左右手势使用原生横向滑动，液态玻璃底栏保持悬浮。服务/工作台、我的复用已有业务；知识新增公开指南分类浏览，工作人员可查看授权案例；活动读取真实维修活动接口。

本轮范围经维护者确认：只改造四个主页面与导航，已有功能连接真实接口；缺失功能如实标注。**活动报名、服务公告、经验分享、收藏、消息、客户维修备案记录、个人资料编辑仍未接入 App**。知识分类按公开指南标题粗分，案例目录仍只开放给有 `repair:read` 的工作人员；客户通过 AI 问答引用查看公开案例，本轮未新增客户/游客案例列表接口。

五栏顺序固定为首页、活动、服务/工作台、知识、我的；切换时长 260ms，支持系统减少动态效果设置（关闭切换动画和横向手势，保留底栏点击）。游客点击或滑动进入「我的」均触发登录，取消留在原页。AI 问答仍是独立子页，离开后销毁本次对话。

预约时段仍是后续能力。本轮按维护者确认，服务入口实际显示「我要报修」并复用已有报修流程，不把当前接口标成已实现预约。设备卡目前由本人报修记录派生，不代表已有独立设备绑定功能。入口未接入时明确提示，不能用假数据或仅能点击的占位页宣称完成。

四页截图、构建与模拟器操作见 [四页验证记录](docs/verification/four-reference-pages-20261012.md)。首页历史记录见 [首页与导航验证](docs/verification/home-reference-20261012.md)，参考图片见 [图片索引](docs/reference/my-huawei/README.md)。未接入功能按真实接口继续开发。

## 模块任务

- [01 基础联通与登录验收 #36](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/36)：代码已完成，设备验证待补。
- [02 客户报修与进度查询 #37](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/37)
- [03 工作人员处理与维修备案 #38](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/38)
- [04 知识检索与 AI 问答 #39](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/39)
- [05 典型案例自动整理与知识回流 #40](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/40)：代码已完成待审查，设备验证待补（PR 待技术主线审查）。
- [06 界面与交互完善 #41](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/41)
- [07 完整联调与课程演示 #42](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/42)：本地环境与演示账号就绪，设备之外的完整链路与构建已实测（PR #53 待合入）；设备装机验收与模型链路待补。

### Web 功能迁移与客户扩展（2026-10-12 已确认，待开发）

| 顺序 | 可认领 Issue | 范围与任务书 |
| --- | --- | --- |
| 08 | [公共接口与账号 #60](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/60) | [客户自主注册、邀请码工作人员注册、原生写通道、改密/强制改密、保持登录](docs/tasks/web-migration/01-public-api-account.md) |
| 09 | [个人中心与备案 #61](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/61) | [客户资料/指南与公开案例收藏/报修消息，成员资料/通知/收藏、独立备案、评论与备案案例库](docs/tasks/web-migration/02-personal-records.md) |
| 10 | [活动闭环 #62](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/62) | [登录报名、账号关联与我的报名、旧匿名查询、工作人员签到接待、活动管理](docs/tasks/web-migration/03-activities.md) |
| 11 | [统计与管理 #63](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/63) | [统计排行榜、成员/客户账号/邀请/招新/备案/字典/审计管理、导出、关于与手册、维护工具](docs/tasks/web-migration/04-analytics-admin.md) |

先读 [四模块公共基线与开工说明](docs/tasks/web-migration/README.md)，再认领对应 Issue；每份任务书含代码起点、交付清单、依赖、权限、必要验收和写手提示词。未预分配负责人，一个模块可分几个 PR 交付。#60 先提供基础契约，其他模块按所需接口接入，不必等待整个模块关闭。

客户自主注册产生客户身份；邀请码用于工作人员注册。客户收藏指南和有效公开 AI 案例，消息为站内报修通知。游客可看活动，App 报名先登录，新报名绑定账号；旧匿名报名仍用手机号查询，不自动认领。**原 Web 数据库数据不迁移**，只复用代码/规则和必要结构，保留现有课设数据。以上为新增目标，未接通入口继续如实标注。

依赖和必要验收写在各模块内。接口就绪后可以并行推进，不必等前一个 Issue 全部关闭。测试与审查只覆盖本次改动及受影响链路。

## 克隆与目录

```powershell
git clone https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos.git E:/codes/pchospital-harmonyos
cd E:/codes/pchospital-harmonyos
```

请使用英文路径，中文父目录会触发 Hvigor `Invalid project path`。

```text
app/                     HarmonyOS 原生工程，DevEco 打开此目录
  entry/src/main/ets/    core 会话/网络/导航/主题，features 业务模块
backend/                 Next.js API、Prisma 模型/迁移/seed 和测试
docs/development-plan.md 功能范围与已核实业务基础
docs/reference/my-huawei/ 五张参考截图
AGENTS.md                项目开发规则
```

## App 开发默认使用共享后端

默认 API 地址为 **https://harmony-api.pczafu.cn**。组员只需用 DevEco 打开 `app/`、构建运行，不必安装 MySQL 或每次启动本地后端。修改后端接口/数据库结构时仍在本机独立库验证，再统一部署稳定版本；不要将清库测试指向共享库。

App 未登录直接进入游客首页，服务介绍、活动列表和公开维修指南可浏览；点击报修、进度、AI 问诊或「我的」再登录。登录成功继续原操作，工作人员按服务器角色进入工作台；取消登录返回原页面，退出回游客首页。活动报名尚未接入，由 #62 完成。公开指南按标题粗分并提供原文浏览，完整阅读体验及新增个人功能按各模块实际交付记录。

课设测试账号为客户 `100001/customer123`、工作人员 `100002/staff123`、管理员 `100003/admin123`；组员联调尽量使用各自账号，避免操作同一张单。服务器地址已内置，新安装无需填写；已有自定义地址保留，可在登录页的「连接设置」切换为共享地址或本机地址。数据库密码和模型 Key 只在后端配置。

维护与部署见 [共享后端说明](backend/docs/shared-deployment.md)，游客接口见 [公开指南与登录入口契约](backend/docs/guest-access.md)。

## 本地启动后端（接口开发时使用）

安装 Node.js 24、Corepack 和本机 MySQL。进入 `backend/`，按 [后端快速开始](backend/README.md)完成首次配置、迁移和 seed 后启动。完整配置见 [本地开发说明](backend/docs/local-development.md)。数据库账号各自在电脑上配置，组员无需访问旧服务器或原维护者的数据库。

```powershell
cd backend
corepack pnpm accounts:prepare   # 准备 App 登录测试账号（只操作课设库，可重复执行）
corepack pnpm dev --port 13080
```

健康接口为 `http://localhost:13080/api/v1/health`。手机联调时使用电脑局域网 IP 和端口，同一网络内访问 API；手机的 `localhost` 指向手机自身。原生登录接口与角色说明见 [原生客户端接口](backend/docs/native-client-api.md)。

## 手机连接步骤（App ↔ 本机后端）

1. 电脑启动后端（上节），确认 `http://localhost:13080/api/v1/health` 返回 `success: true`；手机与电脑连同一 Wi-Fi。
2. 查电脑局域网 IPv4（`ipconfig`，如 `192.168.1.20`），放行防火墙 13080 端口。
3. 手机安装 App（DevEco 运行；注意工程路径需为英文，中文父目录会触发 Hvigor `Invalid project path`）。
4. App 默认先进入首页；点击「我的」打开登录页，在「连接设置」填服务器地址 `http://192.168.1.20:13080`（点“保存地址并检测”，状态显示“后端可达”），
   用测试账号登录：客户 `100001 / customer123`，工作人员 `100002 / staff123`。
5. 启动时验证已有会话：有效恢复身份，无会话/失效则进入游客首页；恢复遇到网络问题保留令牌并以游客浏览，受保护功能需重新登录。退出后清除本地会话，并尽力吊销服务端令牌。

客户端不伪造 Origin，走独立的 `X-Client-Type: native` 通道；HTTP 明文访问在真机上的具体策略尚未验证（无设备），详见接口说明。

## 构建 App

工程使用 HarmonyOS 6.1.1 / API 24，用 DevEco Studio 打开 `app/`，安装依赖，构建 `entry`。连接设备并配置本机签名后运行。当前电脑的 DevEco Studio 位于 `D:/DevEco Studio`，命令行示例：

```powershell
cd app
$env:DEVECO_SDK_HOME = 'D:/DevEco Studio/sdk'
$env:Path = 'D:/DevEco Studio/tools/node;' + $env:Path
& 'D:/DevEco Studio/tools/ohpm/bin/ohpm.bat' install
& 'D:/DevEco Studio/tools/hvigor/bin/hvigorw.bat' --mode module -p product=default assembleHap
```

## 当前实际进度

2026-10-13（#61 第一批，个人资料）：客户本人昵称/联系电话与默认头像、成员昵称/技能、授权成员目录及只读资料已接真实接口；昵称保存后更新「我的」卡片。客户档案独立于成员，版本冲突不覆盖他人更新，历史报修联系电话保持原快照。后端 lint、必要单测/独立库回归、后端及 HAP 构建通过，DevEco 模拟器已操作客户/成员资料、保存/返回/重启/网络失败重试，未验证实体手机。接口见 [个人资料契约](backend/docs/personal-profile-api.md)，结果及截图见 [验证记录](docs/verification/issue-61-profile.md)。本批待技术主线审查，未部署共享服务器；收藏、消息、完整独立备案与工作摘要是后续批次，#61 保持开放。

App 已接入真实登录与会话：登录页、启动恢复会话、退出、按服务端返回的角色进入客户服务/工作人员入口；客户报修（我的报修：提交、列表、进度时间线，#37）与工作人员处理链路（报修队列、受理、推进/取消、维修备案草稿/照片/提交、App 内备案审核，#38）已接入真实接口；知识问答已接入真实语料与模型：混合检索、带引用回答、追问与引用详情（[说明](backend/docs/knowledge-ai.md)），本次对话只存页面内存。后端提供原生 Bearer 会话通道（`/api/v1/auth/native/*`，[接口说明](backend/docs/native-client-api.md)）与报修处理/备案接口（[说明](backend/docs/native-repairs-api.md)），Web Cookie 登录行为保持原样。`RepairRecord` 是工作人员维修备案，不等于客户报修单。

2026-10-11（#40 典型案例自动整理与知识回流）：新增典型案例模型/迁移、备案典型标记（作者/审核人员）、
真实模型整理与自动去重/相似合并（并发不丢来源）、来源失效与管理员撤回控制、案例并入混合检索与引用详情
（客户脱敏）、案例库页面与备案页典型面板；lint 0 警告、单测 424/424、数据库集成测试 193/193、
后端构建与未签名 HAP 构建通过；在开发库用真实 DeepSeek/bge-m3 跑通「建单→建档→真实审核→标记→
整理→换措辞命中案例引用并打开」，其中真实合并样本（D 并入 B）保留两来源。**无设备：App 的典型面板、
案例库与引用案例分支均未装机验证**；真实模型两次未达预期（A×B 判为不同故障、客户问答判资料不足）
如实记录在 [验证记录](docs/verification/issue-40.md)，接口说明见 [典型案例接口](backend/docs/knowledge-cases-api.md)。

2026-10-11（#38 工作人员处理与维修备案）：新增工作人员队列/受理/推进/取消、报修单→备案关联建档、备案编辑走原生通道、App 内管理员审核与照片链路；后端 lint、生产构建通过，单测 397 项、数据库集成测试 175 项全部通过；在本机开发库跑通「客户建单 → 受理 → 处理中 → 完成未建档 → 建档 → 真照片上传 → 提交 → 退回 → 修改重提 → 通过」24 项断言的真实 API 链路；未签名 HAP 构建成功。**无设备（`hdc list targets` 为 `[Empty]`）：受理、备案、照片与审核页面均未装机验证**，详见 [验证记录](docs/verification/issue-38.md)。

2026-10-09（登录里程碑）：在英文路径副本重新构建未签名 HAP 成功；后端 lint、生产构建通过，327 项单测、150 项数据库集成测试全部通过（含新增 22 项鉴权用例）；在 13080 端口以真实开发库验证 health → 客户/工作人员原生登录 → 会话查询 → 退出后令牌失效，以及错误密码、缺失令牌、缺失客户端标识、伪造角色无效、客户/工作人员越权访问均被拒。`hdc list targets` 仍为 `[Empty]`：App 的 health → 登录 → 重启恢复 → 退出链路**未真机验证**（构建成功不等于装机成功）。

2026-10-09 主线修正：启动恢复成功时返回服务器身份；本地令牌保存失败则尽力撤销新令牌并报 `LOCAL_STORAGE_ERROR`，不进入主页。临时 TypeScript 转译配合平台/网络模拟依赖的 5 项行为检查通过（有效恢复、失效清理、断网保留、保存失败、撤销失败），修改后的工程在 `E:/codes/pchospital-native-auth-check-20261009/app` 构建未签名 HAP 成功。模拟依赖检查不等于系统 Asset Store 或真机验证，设备会话链路仍待验证。

2026-10-11（Issue #41 界面统一与状态处理完善）：在写手A 已统一主题令牌（`core/ui/Theme.ets`）、子页标题与防重复入栈（`core/ui/Routes.ets`）的基础上，本轮补齐各页的加载 / 空数据 / 失败 / 重试 / 防重复交互。

- 新增共用状态组件 `core/ui/StatePanel.ets`（`LoadingPanel` / `ErrorPanel`），列表与详情的整块加载区、失败重试区只定义一次；未新增 `EmptyPanel`（各页空态文案与引导各不相同，包一层共用组件只会增加间接层）。
- 登录页：服务器地址「保存 + 检测」全程加 `checking` 标志防连点；登录按钮改为内嵌 `LoadingProgress` 的复合按钮，请求期间禁用；网络错误与业务错误分开提示，失败后按钮文案变为「重试登录」。
- 我的报修：列表首次加载加请求中标志，防重试连点并发；列表错误态复用 `ErrorPanel`（保留卡片底色与前手外观一致）；网络错误补排查引导，与业务错误提示可区分；提交表单失败后按钮文案变为「重试提交」，网络与业务错误分开提示。
- 知识问答：发送按钮改为内嵌加载指示的复合按钮，发送中禁用；失败卡复用 `ErrorPanel` 并保留重试；资料不足 / 追问回答补空数据引导文案，引导文案按回答状态展示，澄清追问不从无引用推断检索无命中；发送失败区分网络错误（补排查引导）与业务错误（后端信封文案）。
- 引用详情：加载态复用 `LoadingPanel`、失败态复用 `ErrorPanel`，重试加请求中标志防连点；「引用已过期或不存在」（404）仍与网络失败分开提示。
- 会话过期统一走 `HomePage.expireSession`（清空导航栈再回登录页）；本轮改动未发现新增遗漏页面。

未签名 HAP 构建通过（`hvigorw assembleHap` 结束为 `BUILD SUCCESSFUL`，仅签名步骤按预期跳过）。`hdc list targets` 仍为 `[Empty]`，本轮交互状态改动**未真机验证**（构建成功不等于装机与运行时行为正确）。

2026-10-11（PR #49 审查修复）：提交成功时若首次列表仍在请求，将刷新排队到当前请求结束后执行，保留普通点击防重；问答页依据 clarify / insufficient_evidence 状态展示追问或资料不足提示，通用说明使用当前账号可访问的资料范围。实际页面方法配合模拟网络的时序回归及既有问答状态测试共 4 项通过，测试文件 lint 通过，未签名 HAP 构建成功；无设备，未做真机验证。

2026-10-11（#42 完整联调与课程演示）：分支 `feat/issue-42-demo-integration` 基于含 #40 的 `upstream/main @ 2c60449`，PR #53 以 `Refs #42` 打开（**未合并、未关闭 Issue**）。本轮在开发库与测试库应用 #40 迁移 `20261011130000_p2_issue40_knowledge_cases`，`db:health` 通过（MySQL 9.6.0 @ `127.0.0.1:3308`）；演示账号用 `corepack pnpm accounts:prepare`（幂等）准备就绪：客户 `100001/customer123`、工作人员 `100002/staff123`（MEMBER + 有效成员档案）、管理员 `100003/admin123`（ADMIN，含 `repair:review`/`repair:flag`，**刻意无成员档案 → 不能受理报修单**）。设备之外的真实链路在开发库跑通：55 次 HTTP 请求无一 5xx，主链 22 步、失败场景 12 项 —— 报修 → 受理 → 推进 → 客户看到变化 → 建档 → 旧版本号写入 409 → 真实照片上传 → 提交审核 → 管理员审核通过，且报修处理状态与备案审核状态相互独立；失败场景含纯管理员受理 `403 MEMBER_REQUIRED`、跳过状态 `409 REPAIR_ORDER_STATE_INVALID`、非法 `toStatus` `400 VALIDATION_FAILED`、空草案提交 `400 REPAIR_SUBMISSION_INCOMPLETE`。演示数据由本轮链路真实产生：报修单 `a60bd281-960c-450b-ab37-f2c6b3d55db9`（COMPLETED）、维修备案 `36fb4958-e7f7-43d3-9af4-ca09577459bb`（APPROVED v4）、照片 `bb37b964-5802-44c7-9556-5efe0b81725b`（image/png 70B）。检查：`pnpm lint` exit 0、`pnpm test:unit` 441/441、`pnpm test:db` 197/197、`pnpm build` exit 0；HAP `hvigorw assembleHap` 以 `BUILD SUCCESSFUL in 1 min 20 s 971 ms` 结束，产物 `app/entry/build/default/outputs/default/entry-default-unsigned.hap`（1 197 149 字节，SHA256 `7D434C01C00FB4971B9E08E2FEF485FCA071C04E9C915AD33C63B62D629C38D2`，**未签名**）。**三项未完成如实记录**：① **未装机** —— 本机 `hdc list targets` 为 `[Empty]`，DevEco 已部署 4 个模拟器机型但无系统镜像、无签名材料（`~/.ohos` 不存在），#42 验收要求的「完整业务链在设备上跑通」目前不成立，**构建成功不等于装机运行正确**；② **模型链路（阶段2b）未执行** —— 本机 `backend/.env` 无 `AI_API_KEY`/`EMBEDDING_API_KEY`，「标记典型 → AI 自动整理/去重或相似合并 → 发布 → 换一种问法检索命中新案例并打开多来源证据」与「无依据问答」已交由具备 Key 的一方接力；③ 演示截图/录像、设备型号与系统版本、四人贡献说明依赖设备，待补。详见 [演示指引](docs/demo/issue-42-demo-guide.md) 与 [验证记录](docs/verification/issue-42.md)。

2026-09-30 合仓后已在英文路径从新克隆的 `app/` 构建未签名 HAP；新 `backend/` 安装依赖、生产构建通过，并临时在 13081 端口启动验证健康接口 HTTP 200、数据库可达。迁移前后端的 318 项单测与 137 项数据库测试已通过；初始化命令另做首次配置与重复运行验证。旧云端实验服务已停用，数据卷保留。

2026-10-12（共享后端与游客入口）：新增共享 HTTPS 默认地址、游客首页/服务介绍/公开指南浏览，受保护功能触发登录并续接目标，取消与退出回公共页面。部署与实际验证见 [本轮记录](docs/verification/shared-backend-guest-login-20261012.md)。

## 协作与来源

前后端接口变更可在同一提交中完成。提交前运行相关检查，分别记录构建、接口和真机结果。克隆公开仓库不需要邀请；向本仓库推送功能分支需要写入权限，由维护者添加 Collaborator，也可从个人 fork 提交 PR。

`main` 已启用 [main-protection](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/rules/24866387)：必须通过 PR，且仅使用普通 Merge（Create a merge commit）；禁止直接推送、强推和删除主分支，无绕过名单。合入前解决审查讨论并通过 `backend-check`，不要求另一位成员批准或每次同步最新 `main`；不使用 Squash 或 Rebase，未启用与普通 Merge 冲突的线性历史要求。

[最简 CI](.github/workflows/ci.yml) 在每个指向 `main` 的 PR 创建、更新或重新打开时运行，使用 Ubuntu / Node.js 24 和仓库锁定的 pnpm 依赖，依次执行后端 `pnpm lint`、`pnpm test:unit`。不按文件路径跳过，不需要数据库、服务器或额外凭证。CI 通过仅表示这两项检查通过；HAP/后端构建、数据库集成测试和真机验证仍按改动需要在本机执行。

- [开发方案](docs/development-plan.md)
- [Web 功能迁移四模块基线与开工说明](docs/tasks/web-migration/README.md)（#60–#63，每份任务书含开工提示词）
- [Issue #38 工作人员处理与维修备案任务书](docs/tasks/issue-38-staff-repair-records.md) · [写手开工提示词](docs/tasks/issue-38-writer-prompt.md)
- [Issue #38 验证记录：工作人员处理与维修备案](docs/verification/issue-38.md) · [原生工作人员处理与备案接口](backend/docs/native-repairs-api.md)
- [Issue #39 知识问答任务书](docs/tasks/issue-39-knowledge-ai.md) · [写手开工提示词](docs/tasks/issue-39-writer-prompt.md)
- [Issue #40 典型案例自动整理与知识回流任务书](docs/tasks/issue-40-typical-case-feedback.md) · [写手开工提示词](docs/tasks/issue-40-writer-prompt.md)
- [Issue #40 验证记录：典型案例自动整理与知识回流](docs/verification/issue-40.md) · [典型案例与知识回流接口](backend/docs/knowledge-cases-api.md)
- [Issue #42 验证记录：完整联调与课程演示](docs/verification/issue-42.md) · [Issue #42 课程演示指引](docs/demo/issue-42-demo-guide.md)
- [知识问答配置与验证记录](backend/docs/knowledge-ai.md)（知识快照、混合检索、引用与命令）
- [五张参考截图](docs/reference/my-huawei/README.md)
- [Agent 开发规则](AGENTS.md)

业务基础由原维护者授权复用 [电脑医院 Web 项目](https://github.com/ZAFU-PCHospital/zafu-pchospital-web)。后端导入基点为 `6f2ec0c188e8afbe60401b16f7c3634286f14749`，App 原提交历史保留；迁移前两仓库另有本机 Git bundle 备份。原项目许可证由维护者决定，未添加扩大授权范围的许可证。

2026-10-12（初版 UI 重设计，历史记录）：当时采用首页 / 服务 / 我的三页 Tab 和彩色图标砖；后续导航以本文上方的五栏方案为准。首页展示快捷入口及最近报修预览，服务页从最近 20 条本人报修按机型合并设备卡，我的页展示真实身份和最近一页报修统计；工作人员保留工作台与权限控制的审核入口。新数据区具备加载、空态、失败重试与刷新。未签名 HAP 构建成功，页面状态模拟检查与 4 项既有回归通过，未真机验证。详情见 [验证记录](docs/verification/ui-redesign-20261012.md)。

2026-10-12（首页与导航对照调整）：按维护者新映射，导航外观为「首页 / 活动 / 服务 / 知识 / 我的」，工作人员中间为「工作台」。仅调整首页与导航，其他页面未重构；首页保留真实报修数据，活动尚未接入，知识导航暂复用现有问答页。HAP 构建、模拟器装机及双角色导航已检查，未验证实体手机。见 [本次验证与截图](docs/verification/home-reference-20261012.md)。
