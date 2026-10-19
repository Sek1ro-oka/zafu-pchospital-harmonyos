# #83 导航 Demo V2 · 操作与反馈清单

2026-10-19；分支 `feat/issue-83-navigation-demo-20261019`、基线 `upstream/main 774145d`，已合并 PR #86 合入后的文档更新（`d358571`）。这是 V2 返修（V2-F1～V2-F8）后的最终 Demo，以 **Draft PR 提交上游审查**（不直接合并，说明见 PR 描述）。内部检查不等于用户满意或 #83 正式完成，项目未到验收阶段。

## 审阅与运行

- 原生主成果：模拟器（hdc `127.0.0.1:5555`）已安装独立包 `cn.zafu.pchospital.navigationdemo`，保留运行，未动正式 App 数据。API24 unsigned HAP：`app/entry/build/default/outputs/default/entry-default-unsigned.hap`，3,500,625 字节，SHA256 `EF58E3B5A84ED1865B47A7CDFF58213A93054D96326C3E6D15F3C8D1C96F9CEF`。
- 入口：本版新增 `app/entry/src/main/ets/pages/NavigationDemoEntry.ets` 并在 `main_pages.json` 注册，`EntryAbility` 的 `loadContent` 指向 `pages/NavigationDemoEntry`；生产 `pages/Index.ets` 与 `upstream/main` 完全一致、未改动，上游入口守卫单测保持通过。上线前把 `loadContent` 指回 `pages/Index` 并删除 Demo 页。HAP 因此由 293,782 字节增至 3,500,625 字节（生产入口与其页面、资源仍在编译范围内）。
- 辅助 [浏览器预览](http://127.0.0.1:18483/docs/demo/issue-83-preview.html) 与原生构图同步，**非 HAP 画面**。仓库根运行 `python -m http.server 18483 --bind 127.0.0.1`，仅本机静态服务。无外部框架或业务请求。
- 构建：在 app/ 设置 `DEVECO_SDK_HOME=E:/DevEco Studio/sdk`，PATH 前置 `E:/DevEco Studio/tools/node`，执行 `E:/DevEco Studio/tools/hvigor/bin/hvigorw.bat` `--mode module -p product=default assembleHap`；终态构建 `BUILD SUCCESSFUL in 43 s 864 ms`（33 tasks，20 executed），日志在任务目录 `hap-build-v3.log`。未读取/复制主树签名配置。
- 顶部圆形宫格按钮是“演示设置”；可切游客/客户/工作人员/管理员、减少动态效果。身份/登录/收藏/指南均为内存演示，重启或刷新清空。正式用户、API、DB、模型未接入。

## 当前检查清单

| 编号 | 场景与步骤、预期 | 实际结果 | 状态 |
| --- | --- | --- | --- |
| V2-01 | 五栏点击与横滑，角色只改第三栏 | 原生首页横滑到活动；全部底栏实际点击，蓝图标标签同步；工作台四入口存在（[活动](../verification/issue-83-demo/final/activities.png)、[工作台](../verification/issue-83-demo/final/workbench.png)） | 待上游审查 |
| V2-02 | 游客服务→我的→取消回服务；收藏登录取消/成功续接原篇 | 原生实际通过；取消不写收藏，成功续接网络篇一次；HTML 也通过取消我的/成功收藏续接 | 待上游审查 |
| V2-03 | 知识中心→网络→左右栏目录→阅读→来源→系统返回原阅读/目录/服务 | 原生实际通过，指南与来源明确自编演示；HTML 路径也操作通过 | 待上游审查 |
| V2-04 | 两篇独立收藏与逐篇取消，列表点篇打开原 ID | 原生保存网络+开机，两篇列表截图；逐篇取消后空态；V2-W1 修复后按钮随收藏状态刷新（[两篇](../verification/issue-83-demo/final/favorites-two.png)、[空态](../verification/issue-83-demo/final/favorites-empty.png)） | 待上游审查 |
| V2-05 | 工作人员工作台，审核拒绝，知识仍可访问 | 原生实际进入工作台、审核拒绝；通过顶部帮助继续知识 | 待上游审查 |
| V2-06 | 打开减少动态效果，横滑不切换，底栏仍可点 | 原生打开开关后横滑留工作台，点选购成功。该开关是演示，不是系统设置读取 | 待上游审查 |
| V2-07 | 选购类别和商品空态；活动论坛建设中；我的摘要/宫格 | 终态模拟器图可查（[选购](../verification/issue-83-demo/final/shopping.png)、[我的](../verification/issue-83-demo/final/profile.png)）；无假商品/价格/帖子/作者/统计 | 待上游审查 |
| V2-08 | 搜索失败重试/空态/加载 | V2 浏览器实际失败→重试恢复样本；原生本轮未逐一操作所有四态，不沿用构建当操作证据 | 待上游审查 |
| V2-09 | 活动↔论坛频道切换（V2-F1） | 三处文案双向切换；论坛态点「校园活动」快捷键回活动频道（[论坛](../verification/issue-83-demo/final/forum.png)） | 待上游审查 |

完整参考对照、终态截图与限制见 [V2 实际验证](../verification/issue-83-demo.md)。真机与真实业务/权限/数据接口未验证；审查意见在 Draft PR 中收集。

## 历史保留

V1 收藏错篇 R83-F1 在前轮独立复审已解决；V2-W1（`@Builder` 按值标题不随状态刷新）本轮改为 `if/else` 结构条件渲染，V2-F1～V2-F8 已修并由独立审查复核「返修复审通过」。原始写手与审查报告保留在任务目录，不用旧通过覆盖本轮重构。
