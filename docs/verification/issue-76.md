# 第 13 模块 / Issue #76：指南目录与知识搜索

2026-10-15，基于合并 PR #78 后的 `main@186b7883f04d3044850ba0bb5fb9d602d38085a6`，分支 `feat/issue76-guide-search`。复用上轮工作目录及阅读页面，未改变五栏导航、AI 对话或原始维修备案业务。

## 参考与交付

| 参考图 | 本轮页面 | 实际模拟器截图 |
| --- | --- | --- |
| [全部圈子](../reference/my-huawei/community-circles-category-list.jpg) | 全部维修指南：左侧分类、右侧分组条目、图标、查看按钮和分隔线 | [全部目录](issue-76/guide-directory-all.png)、[磁盘分类](issue-76/guide-category-disk.png)、[真实空分类](issue-76/guide-category-empty.png) |
| [社区搜索结果](../reference/my-huawei/search-community-results.jpg) | 知识搜索：搜索框、清空、全部/指南/案例、分组圆角卡、关键词蓝色强调及真实来源信息 | [公开案例结果](issue-76/customer-case-search.png)、[内部案例结果](issue-76/staff-internal-search.png)、[无命中](issue-76/search-no-results.png)、[清空](issue-76/search-cleared.png) |

目录替换原有简单指南目录，不叠加另一套目录。知识与帮助主页面保留折叠故障分类和 AI 主按钮，「全部指南」进入目录，帮助区搜索图标进入新搜索页；目录右上角也可搜索。参考图中的成员、话题、加入圈子、发帖数及图片未复制成假业务。

指南使用现有完整公开快照，本机 **15 份**，版本 `48f43637c8f4be87a7a751feb04defd7e0426849`。分类复用 `GuideCategory.ts`，界面标注「按指南标题粗分」。搜索指南标题，不宣称全文或语义检索；目录接口没有摘要，不补造。

案例新增一个鉴权只读搜索接口，按完整授权集合的实际标题/正文匹配，先复核来源，再分页。摘要从正文截取；客户端不拿最近一页冒充全库。未改变原 AI 检索和证据复核，未调用模型或向量服务。[接口契约](../../backend/docs/knowledge-browse-api.md)含权限、分页、目标确认与部署要求。

## 实际环境

- Windows 本机构建，DevEco SDK 6.1.1 / API 24。
- Pura 90 模拟器，1320 × 2856，系统 `emulator 6.1.0.126(SP1DEVC00E120R4P11)`；`hdc` 目标 `127.0.0.1:5555`。
- 本分支后端实际完成生产构建，在 **13089** 运行；App 保存地址 **http://10.0.2.2:13089**。健康接口 `200 / database=reachable`。上轮 13088 不用于本轮新增搜索验收。
- 独立本机 MySQL 3308，开发库 `pchospital_exp_issue61_1013`、测试库 `pchospital_exp_issue61_1013_test`。通过既有闸门补齐 main 已存在的 remember-me、账号活动、出勤取消三项迁移；没有新建迁移、清库或导入生产数据。
- 复用现有知识索引，未重建向量。首次相关 DB 回归因本工作目录缺少未跟踪索引导致 2 项失败；补齐既有索引后 **11/11** 通过，没有修改断言掩盖环境缺失。

## 已操作

1. 游客从知识主页面的「全部指南」进入左右目录；切换磁盘、系统软件、硬件外设。硬件外设当前无指南，显示真实空态；四字分类可完整显示。点「驱动安装与更新」进入上轮指南详情，再返回仍选中系统软件（[打开详情](issue-76/directory-guide-detail.png)、[返回选中态](issue-76/directory-category-return.png)）。
2. 游客在目录搜索「系统」，显示真实标题匹配及高亮、版本；案例提示登录（[截图](issue-76/guest-search-results.png)）。改搜「线缆」并选择案例，登录客户 `100001` 后继续原查询与类型，显示 1 条有效公开案例；没有另压一份搜索页。
3. 客户点击案例打开真实公开详情，返回保留查询及类型（[详情](issue-76/search-case-detail.png)、[返回](issue-76/search-return-preserved.png)）。输入不存在的词显示两组真实零结果，清空按钮移除旧结果。
4. 对本地已有「合成验证案例61（非模型生成）」临时执行 PUBLIC → STAFF；客户点击尚留在屏幕上的旧卡片，目标确认接口返回无可访问结果，App 显示说明并刷新为 0 条，没有打开旧内容（[截图](issue-76/customer-stale-case-blocked.png)）。随后恢复 PUBLIC。
5. 工作人员 `100002` 在该本地案例临时设为 STAFF 时搜索「线缆」，能看见「内部 AI 案例」并打开工作人员详情（[详情](issue-76/staff-search-case-detail.png)）；验证后已恢复 PUBLIC。未撤回该开发样本、未生成新案例。
6. 工作人员改搜「系统」、切到指南，打开「操作系统与文件系统」后返回仍保留查询及指南筛选（[详情](issue-76/search-guide-detail.png)、[返回](issue-76/guide-search-return.png)）。

案例仍为上轮明确标记的合成样本，不代表本轮真实模型调用；图片取自实际运行的 App。模拟器时间与主机北京时间存在差异，业务时间不以状态栏为准。

## 必要检查

```powershell
# backend/
node --import tsx --test tests/unit/knowledge-browse-app.test.ts tests/unit/public-guides.test.ts tests/unit/guest-login-app.test.ts tests/unit/customer-community-app.test.ts
node tools/db-task.mjs test tests/integration/knowledge-browse.test.ts tests/integration/customer-community.test.ts
node node_modules/eslint/bin/eslint.js src/features/knowledge/case-search.ts src/features/customer-community/customer-case-service.ts src/app/api/v1/knowledge/cases/search/route.ts tests/unit/knowledge-browse-app.test.ts tests/unit/guest-login-app.test.ts tests/integration/knowledge-browse.test.ts
node tools/ensure-doc-manifest.mjs
node node_modules/next/dist/bin/next build
```

- 相关单测 **33/33**：换词/清空、切类型、分页失败后同页重试/去重、旧分页不污染新请求、离开/返回、失败与游客、字面高亮、实际搜索页异步目标确认，以及原有登录/公开内容状态回归。
- 相关 DB 回归 **11/11**：新增 6 项搜索，使用真实独立测试库、24 条合成案例，其中 22 条有效公开、一条内部、一条撤回；验证第一页 20 / 第二页 2、大小写/正文匹配、参数、公开/内部权限、旧结果、撤回和来源哈希变化。复用 5 项原公开内容/收藏回归检查共用有效性路径。测试夹具完成后清理，没有向开发库灌入分页样本。
- 变更服务/路由/测试 ESLint **exit 0**；后端生产构建 **exit 0**。
- `next build` 的 Web 文档清单使用现有工具生成的明确占位清单，不代表 Web 文档站验证完成；App 指南来自另行加载的真实知识索引。

```powershell
# app/
$env:DEVECO_SDK_HOME='D:/DevEco Studio/sdk'
$env:Path='D:/DevEco Studio/tools/node;'+$env:Path
& 'D:/DevEco Studio/tools/hvigor/bin/hvigorw.bat' --mode module -p product=default assembleHap
```

HAP **BUILD SUCCESSFUL**，已用 `hdc install -r` 安装并实际操作。未签名产物 3,168,739 字节，SHA-256：`83ce4545ce0cf89d9087a5ddb1c274b17a8d2d40b533042cd8449d42d1671855`。保留原有四处 PromptAction 异常警告，没有新增警告。过程中清除旧搜索字段时曾漏一处主页面引用导致编译失败，补齐后上述最终构建通过。

## 边界与后续

- **未部署共享服务器**；共享服务器旧后端没有新增案例查询，需合入后按本机构建方式同步部署。失败显示实际错误，不静默退成最近一页或模拟搜索。
- 无实体手机验证；仅当前模拟器尺寸。页面比例与电脑医院内容按映射替换，最终视觉效果由维护者审查，不宣称逐像素差异为零。
- 慢响应、失败重试与跨查询竞态由可执行控制器/页面方法的模拟依赖回归覆盖，非设备断网证据；模拟器未额外生成 20+ 案例进行 UI 分页，实际分页使用真实 DB 回归与客户端控制器测试组合验证。
- 没有联网搜索、成员搜索、原始备案全文搜索或新模型调用。案例查询在课设规模扫描完整可见集合，数据扩大时再优化。
- 完成后保留模拟器、新本机后端和 MySQL 运行。DevEco 继续使用原工作目录 `E:/codes/pchospital-issue75-ui-20261015/app`，当前代码分支已切到 `feat/issue76-guide-search`。截图、查询与数据范围均供维护者复查，PR 不自动合并或关闭 Issue。
