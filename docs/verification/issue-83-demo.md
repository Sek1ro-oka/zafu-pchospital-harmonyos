# #83 Demo V2 终态验证 · 2026-10-19

分支 `feat/issue-83-navigation-demo-20261019`，基线 `upstream/main` `774145d`，已合并 PR #86 合入后的文档更新（`upstream/main` `d358571`，仅 `docs/` 与 `AGENTS.md`）。本页记录 V2 返修（V2-F1～V2-F8）完成后的最终 Demo，随 Draft PR 提交上游审查：**这是离线演示，不是正式业务实现，也不代表用户已确认满意**，项目未到验收阶段。

## 构建与设备

- 最终 HAP：`app/entry/build/default/outputs/default/entry-default-unsigned.hap`，3,500,625 字节（2026-10-20 00:38:40），SHA256 `EF58E3B5A84ED1865B47A7CDFF58213A93054D96326C3E6D15F3C8D1C96F9CEF`。
- 构建 `BUILD SUCCESSFUL in 43 s 864 ms`（33 tasks，20 executed，13 up-to-date），日志 `work/agent-tasks/T83-20261019/hap-build-v3.log`；只有未配置签名提示 `WARN: Will skip sign 'hos_hap'`，其余 `ArkTS:WARN` 均来自既有生产页面（`knowledge/`、`service/`、`profile/`、`repair/`），Demo 文件零告警。
- HAP 由 293,782 字节增大到 3,500,625 字节：生产入口 `pages/Index` 仍留在 `main_pages.json` 并参与全量编译（连同 `core/` 与各生产页面及其资源），这是入口守卫单测能继续读取生产 `Index.ets` 的前提。
- **入口结构（本版调整）**：新增 `app/entry/src/main/ets/pages/NavigationDemoEntry.ets`（`struct NavigationDemoEntry`，保留状态栏配色逻辑），在 `app/entry/src/main/resources/base/profile/main_pages.json` 注册，`app/entry/src/main/ets/entryability/EntryAbility.ets:25` 的 `loadContent` 指向 `pages/NavigationDemoEntry`；生产 `pages/Index.ets` **未改动、与 `upstream/main` 完全一致**，上游入口守卫单测 `backend/tests/unit/guest-login-app.test.ts`（读取生产 `Index.ets` 并在 VM 中跑 `boot()`）保持通过。正式实现时把 `loadContent` 指回 `pages/Index` 并删除 Demo 页即可完全还原。
- 设备：HarmonyOS 模拟器，hdc 目标 `127.0.0.1:5555`；`emulator 7.0.0.107(SP8DEVC00E999R4P11)`、API 26、x86_64、phone，截图 1256×2760。**没有真机验证**。
- 安装 `hdc -t 127.0.0.1:5555 install -r <HAP>` 返回 `install bundle successfully`；`aa start -a EntryAbility -b cn.zafu.pchospital.navigationdemo` 返回 `start ability successfully`。未卸载或清空正式 App 数据，未重启/重置模拟器。

## 实际操作（终态截图）

下表截图均为当前安装版本（含 F1–F8）实拍，位于 `issue-83-demo/final/`。

| 场景、步骤 | 预期与实际 | 证据/状态 |
| --- | --- | --- |
| 首页 | 金色 Hero 与状态栏同色连续、无独立白条；分类胶囊、快捷服务、玻璃底栏齐全 | [首页](issue-83-demo/final/home.png)，通过 |
| 入口页启动（本版新增） | `EntryAbility` 加载新 Demo 页 `pages/NavigationDemoEntry`，首页正常渲染，状态栏 `#FFDD8F` 与金色 Hero 连续、无断层；五栏底栏可切换 | [入口检查](issue-83-demo/final/entry-check.png)，通过 |
| 首页→活动，活动/论坛频道切换（V2-F1） | 三处论坛文案同时切换，回切活动复原；论坛态点快捷键「校园活动」直接回活动频道 | [活动](issue-83-demo/final/activities.png)、[论坛](issue-83-demo/final/forum.png)，通过。三处文案「寻找校园帖子」「我的帖子」「最新帖子」在同一张论坛截图内可读 |
| 服务（客户） | 设备上下文卡、2×2 服务 tile、精选服务与快捷服务 | [服务](issue-83-demo/final/service.png)，通过 |
| 演示设置→工作人员→服务 | 工作台四入口：处理报修、维修备案、备案审核、活动现场；审核标注单独权限 | [工作台](issue-83-demo/final/workbench.png)，通过 |
| 选购 | 八类分类 + 「校园好物」空态，无假商品、价格或订单 | [选购](issue-83-demo/final/shopping.png)，通过 |
| 知识中心→目录→阅读→来源 | 分类行「›」进入对应目录；左栏可切分类；「全部知识目录」进入即全部列表（V2-F8） | [知识中心](issue-83-demo/final/knowledge.png)、[目录](issue-83-demo/final/catalog.png)、[阅读](issue-83-demo/final/reading.png)，通过 |
| 收藏一篇→已收藏态 | 按钮变「取消收藏这篇指南」，副标题「已收藏 · 仅保存在演示内存」 | [已收藏](issue-83-demo/final/reading-saved.png)，通过 |
| 收藏两篇→我的收藏→逐篇取消 | 两篇按 ID 打开；逐篇取消后回到空态 | [两篇](issue-83-demo/final/favorites-two.png)、[空态](issue-83-demo/final/favorites-empty.png)，通过 |
| 我的 | 演示客户；收藏计数 1 标「演示数据」，报修/报名标「待接入」；顶部无重复「资料 ›」；交易与创作四列宫格中「我的商品」完整显示、不截断 | [我的](issue-83-demo/final/profile.png)、[交易与创作](issue-83-demo/final/profile-trade.png)（补充图，同页下滑区），通过 |
| 我的→个人资料 | 独立子页，演示身份不可编辑 | [个人资料](issue-83-demo/final/profile-sheet.png)，通过 |
| 游客服务→我的→取消 | 回原服务，身份不变 | 本轮未重复操作；上一轮原生通过，保留结论 |
| 搜索失败/空态/加载四态 | 未逐一做原生操作 | 仅浏览器预览验证，不冒充原生证据 |
| HTML 对照页 | V2 首版快照（返修前） | 不作为原生证据 |

## 返修与独立复核

- **V2-F1（阻断）**：活动/论坛切换时搜索占位、快捷入口、区块标题不刷新，根因是按值传参的 `@Builder`。改为 `if/else` 结构条件渲染后，实测三处文案双向切换正确（见上表与 `forum.png`）。
- **V2-F2**：状态栏白条。在 Demo 入口页 `pages/NavigationDemoEntry.ets` 用 `setWindowSystemBarProperties` 按当前 Tab 设置状态栏底色（首页 `#FFDD8F`，其他页 `#F0F4F7`）与深色内容；实测首页 y=0–135 为 `#FFDD8F`，y=136 起进入 Hero 渐变，无白色断层。
- **V2-F4**：知识中心分类行的「⌄」改为「›」，与「进入目录」的语义一致。
- **V2-F5**：阅读页去掉重复的「现象记录」标题；收藏副标题按游客/已收藏/未收藏三种状态切换；我的摘要显示演示收藏计数并注明「演示数据」，未接入项标「待接入」。
- **V2-F6**：删除与金色「个人资料」同目标的「资料 ›」入口。
- **V2-F7**：「我发布的商品」改为「我的商品」，四列不再截断。
- **V2-F8（复审发现）**：「全部知识目录」进入时不重置分类，已在该入口重置分类并清空搜索词。
- 独立审查（2026-10-19，审查者与写手不同上下文）结论「返修复审通过」，V2-W1、R83-F1 无回归。已知遗留：`我的报名` 与 `校园活动` 共用旗帜图标（见下方限制）。

## 参考对照与限制

[参考 / 原生并列对照](issue-83-demo/v2/comparison.html) 是 V2 首版快照（返修前），终态截图见 [final/](issue-83-demo/final/)。间距约 16vp、圆角 22–25vp、大标题 28sp，底栏沿用已有玻璃资源与原生模糊；未宣称逐像素一致。

限制：

- 未做真机验证；未验证深色模式、平板/折叠屏与大字体。
- 身份、登录、收藏、指南均为内存演示数据，重启或刷新即清空；真实登录、API、DB、模型与后端权限未接入，演示中的「无权限」不代表真实权限校验。
- HTML 对照页为首版快照，不代表终态。
- 模拟器期间曾被其他实验应用抢占前台；终态截图均重新拉起本 Demo 后拍摄，未操作他人应用。
- 已知视觉差异：`我的报名` 与 `校园活动` 复用同一旗帜图标（无新增素材）。
- 本版为演示包临时入口：`EntryAbility.loadContent` 指向 `pages/NavigationDemoEntry`。正式实现时应指回 `pages/Index` 并删除 Demo 入口页与其注册项，否则 App 启动会进入演示界面。

采集方法：`uitest screenCap` 写到唯一远端路径再 `file recv`，出现 0 字节或旧图时重拍，未用空图冒充通过；每页同时 `dumpLayout` 核对文本，避免只凭截图判断。
