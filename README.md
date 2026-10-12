# 鸿蒙电脑医院

四人课程项目，前后端放在同一公开仓库。ArkTS / ArkUI 原生 App 的界面参考“我的华为”，Next.js 后端连接本机 MySQL，不使用 Docker。功能范围见 [开发方案](docs/development-plan.md)，使用模块 Issue 记录目标与进度，由团队认领和安排，不设固定周计划或成员审批。

## 模块任务

- [01 基础联通与登录验收 #36](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/36)：代码已完成，设备验证待补。
- [02 客户报修与进度查询 #37](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/37)
- [03 工作人员处理与维修备案 #38](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/38)
- [04 知识检索与 AI 问答 #39](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/39)
- [05 典型案例自动整理与知识回流 #40](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/40)：代码已完成待审查，设备验证待补（PR 待技术主线审查）。
- [06 界面与交互完善 #41](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/41)
- [07 完整联调与课程演示 #42](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/42)：本地环境与演示账号就绪，设备之外的完整链路与构建已实测（PR #53 待合入）；设备装机验收与模型链路待补。

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

## 启动后端

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
4. 打开 App 登录页：填服务器地址 `http://192.168.1.20:13080`（点“保存地址并检测”，状态显示“后端可达”），
   用测试账号登录：客户 `100001 / customer123`，工作人员 `100002 / staff123`。
5. 启动时 App 会先向服务器验证本机会话：有效进入对应入口，失效回登录页；退出后令牌在服务端吊销。

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

## 协作与来源

前后端接口变更可在同一提交中完成。提交前运行相关检查，分别记录构建、接口和真机结果。克隆公开仓库不需要邀请；向本仓库推送功能分支需要写入权限，由维护者添加 Collaborator，也可从个人 fork 提交 PR。

`main` 已启用 [main-protection](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/rules/24866387)：必须通过 PR，且仅使用普通 Merge（Create a merge commit）；禁止直接推送、强推和删除主分支，无绕过名单。合入前解决审查讨论并通过 `backend-check`，不要求另一位成员批准或每次同步最新 `main`；不使用 Squash 或 Rebase，未启用与普通 Merge 冲突的线性历史要求。

[最简 CI](.github/workflows/ci.yml) 在每个指向 `main` 的 PR 创建、更新或重新打开时运行，使用 Ubuntu / Node.js 24 和仓库锁定的 pnpm 依赖，依次执行后端 `pnpm lint`、`pnpm test:unit`。不按文件路径跳过，不需要数据库、服务器或额外凭证。CI 通过仅表示这两项检查通过；HAP/后端构建、数据库集成测试和真机验证仍按改动需要在本机执行。

- [开发方案](docs/development-plan.md)
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

2026-10-12（五图 UI 重设计）：登录后采用首页 / 服务 / 我的三页 Tab 和彩色图标砖。首页展示快捷入口及最近报修预览，服务页从最近 20 条本人报修按机型合并设备卡，我的页展示真实身份和最近一页报修统计；工作人员保留工作台与权限控制的审核入口。新数据区具备加载、空态、失败重试与刷新。未签名 HAP 构建成功，页面状态模拟检查与 4 项既有回归通过，未真机验证。详情见 [验证记录](docs/verification/ui-redesign-20261012.md)。

2026-10-12（首页与导航对照调整）：按维护者新映射，导航外观为「首页 / 活动 / 服务 / 知识 / 我的」，工作人员中间为「工作台」。仅调整首页与导航，其他页面未重构；首页保留真实报修数据，活动尚未接入，知识导航暂复用现有问答页。HAP 构建、模拟器装机及双角色导航已检查，未验证实体手机。见 [本次验证与截图](docs/verification/home-reference-20261012.md)。
