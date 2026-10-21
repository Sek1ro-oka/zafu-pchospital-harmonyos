# Issue #83：五栏导航调整与知识迁入服务（验证记录）

2026-10-20。按 T83 任务书（`work/agent-tasks/T83-20261020/task.md`，本机路径，不在仓库内）在任务工作树
`E:\zafu_ph\.worktrees\issue83-navigation-20261020`（分支 `feat/issue-83-navigation-20261020`，
基线 `main d358571`）实施，Refs #83。**本轮只是入口与结构交付**：交易（#84）、论坛（#85）
未实现，Issue 状态由维护者判定。页面对照与接线约定见
[页面对照表](../reference/page-map-current-goals.md)。

本文在审查（`work/agent-tasks/T83-20261020/review-report.md`）后做了第二轮修订：R-83-01（归因写错）、
R-83-02（强制改密后续接说法不成立）、R-83-03（截图与最终包的对应关系）逐条说明见第 7 节；
与事实不符的旧表述已从正文删除。

## 1. 基线与范围

- 未改动：`app/AppScope/app.json5`（`bundleName` 仍为 `cn.zafu.pchospital.course`）、
  `entryability/EntryAbility.ets`（仍指向 `pages/Index`）、`pages/Index.ets`、`backend/**`、
  其他 feature 的业务实现。`app/build-profile.json5`（本机签名材料）只在构建期临时使用，
  收尾已 `git checkout --` 还原，不进提交。
- 改动：`features/home/HomePage.ets`（五个 Tab、知识目录路由、游客放行常量、选购页接线）、
  `HomeReferenceVisuals.ets`（底栏第 4 栏）、`features/service/ServicePage.ets`（知识与帮助入口）、
  `features/knowledge/KnowledgeLibraryPage.ets`（迁入后的返回与底部留白）、
  `core/ui/Routes.ets`（新增 `ROUTE_KNOWLEDGE_LIBRARY` 与标题）、
  新增 `features/shopping/ShoppingPage.ets`、新增底栏图标 `home_nav_shopping[_active].svg`。
- 底栏、滑动动画、`reduceMotion`、`canChangeTab` 的强制改密拦截与登录意图续接、`onChange` 里的
  `workbenchRevision += 1` 均保留；`openRoute` 只把知识目录加进**游客**放行名单。

## 2. 构建（HAP）

先停掉机器上遗留的 hvigor 守护进程（16 GB 内存，多守护进程会让 es2abc/java 初始化失败）：

```powershell
Get-Process node | Where-Object { $_.Path -like '*DevEco*node*' } | Stop-Process -Force
cd E:\zafu_ph\.worktrees\issue83-navigation-20261020\app
$env:DEVECO_SDK_HOME='E:/DevEco Studio/sdk'; $env:Path='E:\DevEco Studio\tools\node;'+$env:Path
& 'E:\DevEco Studio\tools\hvigor\bin\hvigorw.bat' --mode module -p product=default assembleHap
```

最终一次构建（含第二轮全部改动，2026-10-20 **17:29:00**）：`BUILD SUCCESSFUL in 27 s 419 ms`
（33 tasks，26 executed），exit 0，日志 `work/agent-tasks/T83-20261020/hap-build-round2.log`。

| 产物 | 大小 | SHA-256 |
| --- | --- | --- |
| `entry-default-signed.hap` | **3,371,319 字节** | **`CA7F5F532C2E06EF001600F37C52C3BD9E23638EEC6B8B232800337245A0846F`** |
| `entry-default-unsigned.hap` | 3,309,302 字节 | `D254C4C312788CB1C1FFA6E3FED7EBBB0A93DF77A2764959E17CE1629842628E` |

ArkTS 警告仍是既有 4 处 `Function may throw exceptions`（`CitationDetailPage.ets`、`KnowledgePage.ets`、
`ServicePage.ets`、`ProfilePage.ets`），与 main 一致，本轮无新增警告（日志里唯一的 `error` 字样是
PowerShell 对 hvigor stderr 的 `NativeCommandError` 包装，不是构建错误）。

## 3. 后端单元测试

在 `backend/`（`node_modules` 是指向主工作树的 junction，未 `npm install`、未连数据库、未改 `.env`）：

```powershell
npm run test:unit
```

| 轮次 | tests | pass | fail | 说明 |
| --- | --- | --- | --- | --- |
| 第一轮 ① | 414 | 399 | 15 | 13 个是本工作树缺生成物（`Cannot find module '@/generated/prisma/client'` ×12、`'@/data/doc-manifest.json'` ×1），与本次改动无关；2 个由本次改动引起（见第 7 节 R-83-01） |
| 第一轮 ② | 414 | 401 | 13 | 修掉自己引入的问题后，只剩缺生成物造成的文件级失败 |
| 第一轮 ③ | **568** | **568** | **0** | 用仓库自带脚本补齐生成物后全绿 |
| 第二轮 | **568** | **568** | **0** | 17:51 重跑，日志 `unit-tests-round2.log` |

生成物用仓库自带脚本本机补齐（只写 gitignore 路径，不动源码、不连库）：

```powershell
node tools/ensure-doc-manifest.mjs
node node_modules\prisma\build\index.js generate
```

两个「源码切片 + eval」用例单独跑 **35/35 pass**（`guest-login-app.test.ts` 13 + `native-auth-app.test.ts` 22），
含「游客公开指南不登录」「取消登录保留原页」「强制改密只在首页」「改密成功复位强制标记」等与本轮直接相关的用例。

## 4. 模拟器验证

### 4.1 设备

- 原实例 `Pura 90 Pro` 的 `/data` 只读：`Error opening file: read-only file system`、
  `bm install` 报 `code:301 error: user not exist.`，内核日志为
  `EXT4-fs error (device vdd) in ext4_setattr:5629: Journal has aborted` →
  `EXT4-fs (vdd): Remounting filesystem read-only`（此前被强杀留下的 ext4 日志损坏）。
  **没有擦除或重置该实例**，以免破坏其他人已有的模拟器状态。
- 改用同镜像新建独立实例 `T83Nav`（`-create T83Nav -deviceType phone -osVersion "HarmonyOS 7.0.0(26.0.0)" -screenProfile "Pura 90 Pro"`），
  冷启动后 `/data` 可写；`hdc tconn 127.0.0.1:5555` 连通。
- 设备信息：`param get const.product.software.version` → `emulator 7.0.0.107(SP8DEVC00E999R4P11)`，
  分辨率 1256 × 2760，API 26。
- 安装最终包：`hdc install -r entry-default-signed.hap` → `install bundle successfully`。
- App 连接共享实验后端（默认 `https://harmony-api.pczafu.cn`）：公开指南页加载出真实指南条目
  （`开机黑屏`、`操作系统与文件系统`、`驱动安装与更新`、`认证相关` 等），活动页返回真实空态
  `暂未发布维修活动`，说明用的是真实接口数据。
- 第二轮补充：共享实验后端的登录接口实测 **13.9–21.6 s**（见第 6 节），超过 App 默认 8 s
  read/connect 超时，无法在共享后端完成登录。为补齐工作人员与续接验证，另起本机课程库实例：
  MySQL 9.6.0（`127.0.0.1:3308`，数据目录 `E:\codes\pchospital-local-mysql`，库
  `pchospital_exp_local`）+ 同一提交的 backend `npm run dev`（`http://10.205.195.4:13080`），
  **未改 backend 源码、未动共享库**；App「连接设置」改为该地址后「保存地址并检测」显示
  「后端可达 · 数据库可达」。18 张截图中 13 张来自共享实验后端（17:29–17:31），
  5 张来自本机实例（第 5 节标「本机实例」的 4 张 + 第 4.2 节替换取证的公开案例登录门槛图）。

### 4.2 截图与构建的对应关系（逐张核对）

本节 13 张在最终构建（17:29:00）**之后**用共享实验后端重拍，文件时间为 17:29:40–17:31:21。
`public-cases-requires-login.jpeg` 原先与 `mine-guest-login.jpeg` **字节完全相同**（两处入口打开的是
同一个登录页，无面包屑，状态栏同为同一分钟），为避免「一张图充当两步」的歧义，已于 23:11
在本机实例上沿同一路径（游客 → 服务 → 公开案例 → 登录页）重新取证并替换，18 张截图现两两不同：

| 截图文件（`docs/verification/issue-83/`） | 拍摄时间 | 内容 |
| --- | --- | --- |
| `nav-home-tabs.jpeg` | 17:29:40 | 五栏 首页｜活动｜服务｜选购｜我的，首页选中 |
| `nav-activity.jpeg` | 17:29:54 | 点「活动」切换，选中态跟随 |
| `service-guest-knowledge-section.jpeg` | 17:29:58 | 服务页新增「知识与帮助」四项与说明 |
| `knowledge-library-from-service.jpeg` | 17:30:03 | 游客从服务进入知识目录（未跳登录） |
| `knowledge-back-to-service.jpeg` | 17:30:07 | 页内返回落在服务页（底栏仍选「服务」） |
| `knowledge-search-from-service.jpeg` | 17:30:12 | 服务 → 知识搜索 |
| `public-guides-from-service.jpeg` | 17:30:24 | 服务 → 公开指南，真实条目已加载 |
| `shopping-building-empty-state.jpeg` | 17:30:48 | 选购建设中空态，无商品/价格/订单 |
| `shopping-bottom-cta.jpeg` | 17:30:58 | 选购页底部出口与说明（游客文案「去「服务」」） |
| `shopping-cta-to-service.jpeg` | 17:31:02 | 点出口切到服务页 |
| `swipe-to-shopping.jpeg` | 17:31:13 | 左滑切栏动画落到选购 |
| `mine-guest-login.jpeg` | 17:31:17 | 游客点「我的」弹登录 |
| `cancel-login-stays-shopping.jpeg` | 17:31:21 | 「暂不登录，继续浏览」留在原页（选购） |
| `public-cases-requires-login.jpeg` | 23:11:51（本机实例） | 服务 → 公开案例，按既有权限要求登录（替换取证，原因见本节开头） |

上述截图都来自同一个 `entry-default-signed.hap`（3,371,319 字节，
SHA-256 `CA7F5F532C2E06EF001600F37C52C3BD9E23638EEC6B8B232800337245A0846F`，构建 17:29:00；
本机实例安装的是同一签名包）。
验证过程中另有若干黑屏帧（模拟器锁屏 / 软键盘遮住 snapshot）与工作人员登录失败画面，
**不作为证据收录进仓库**，失败画面只留在本机 `work/agent-tasks/T83-20261020/`。

## 5. 设备操作结果（游客 / 客户 / 工作人员）

| 检查 | 结果 |
| --- | --- |
| 五栏顺序与选中态 | 通过：底栏「首页｜活动｜服务｜选购｜我的」，点击与左滑都能切换，选中态与滑动动画正常 |
| 服务页知识入口 | 通过：分类目录／知识搜索／维修指南／公开案例四项均可点开 |
| 返回路径 | 通过：知识目录页内返回落在**服务页**（不是首页） |
| 知识目录游客可达 | 通过：游客直接打开知识目录，未触发登录 |
| 公开案例登录门槛 | 通过：游客点击进入登录页（既有权限规则，未放宽） |
| 选购空态 | 通过：诚实「建设中」，无商品/价格/库存/订单；游客可进；出口按钮切到服务页 |
| 取消登录 | 通过：留在原页（选购），未跳到「我的」 |
| 工作人员底栏与工作台（本机实例） | 通过：`100002 / staff123` 登录 → 底栏「首页｜活动｜工作台｜选购｜我的」，第 3 栏为工作台；「我的」页显示「测试工作人员」与工作人员徽标，可进入工作台（`staff-workbench-local-backend.jpeg`） |
| 选购按角色文案（本机实例） | 通过：工作人员在选购页底部看到「去「工作台」查看维修与知识」（`staff-shopping-cta-workbench-local-backend.jpeg`）；游客/客户仍是「去「服务」…」（`shopping-bottom-cta.jpeg`） |
| 登录后续接原页（本机实例） | 通过：游客在服务页点「公开案例」→ 登录页 → `100001 / customer123` 登录成功 → 自动进入「公开维修案例」页（已加载 0 条、暂无有效公开案例），未停在「我的」（`a005-resume-after-login-local-backend.jpeg`） |

## 6. 未完成的设备项

1. **共享实验后端登录超时（环境限制，不是实现缺陷）**：17:32–17:52 在 `T83Nav` 上用
   `100002 / staff123` 多次登录失败，界面报 **「连接超时，请检查网络与服务器地址（请检查服务器地址与网络）」**
   （客户端 `describeNetworkError` 的 `2300028` 分支）。本机直连同一接口为 HTTP 200 但耗时
   8,508 / 9,849 / 12,395 / 13,505 / 21,170 ms，复测 13,902 / 17,902 / 18,295 / 18,895 /
   20,983 / 21,572 / 21,579 ms（返回体 `home=STAFF`、`roles=["MEMBER"]`、
   `mustChangePassword=false`），而 App 默认 connect/read 均为 **8 s**，超时来自服务端延迟。
   **已改用本机课程库实例完成 A-002 与 A-005 后半的设备验证**（第 4.1 节、第 5 节），
   但共享后端上的登录路径仍未在设备上跑通，交付时按已知环境限制记录。
2. **强制改密账号（A-006）**：没有此类账号，**未做设备验证**，也没有为此造账号。
3. **`reduceMotion`**：系统无障碍开关未在设备上切换验证；代码路径未改
   （`scrollable(!this.reduceMotion)`、`animationDuration(reduceMotion ? 0 : TAB_SLIDE_DURATION)`）。

## 7. 第二轮：审查意见处理

| 编号 | 审查意见 | 处理 |
| --- | --- | --- |
| R-83-01 | 游客放行处注释把「会被破坏的回归」写成 `native-auth-app.test.ts` 加载时；实际受限的是 `guest-login-app.test.ts` | 已改正。最终实现是 `HomePage` 内的命名常量 `const GUEST_KNOWLEDGE_ROUTE: string = 'knowledge-library';`，注释写明：`guest-login-app.test.ts` eval 后会**真实调用** `openRoute('public-guides' / 'repair-orders' / 'knowledge')`，其注入符号表没有本常量，条件里引用 `ROUTE_KNOWLEDGE_LIBRARY` 会让该回归在 `openRoute` 处抛 ReferenceError；`native-auth-app.test.ts` 只调用 `interceptBack`、**不会执行到该条件**，但它同样整段求值本文件，所以这里只能是字面量、不能是模块级表达式。该常量必须与 `Routes.ets` 的 `ROUTE_KNOWLEDGE_LIBRARY` 同步，失配时退化为「要求登录」（安全方向）。`Routes.ets` 注释与页面对照表 §5.1 同步改写 |
| R-83-02 | 强制改密分支没有写 `loginIntent`，「改密成功后再由登录续接打开知识目录」不成立 | 已改正注释与文档：该分支只调用 `openPasswordChange(true)`，**不写 `loginIntent`**；改密成功后回到服务/工作台 tab 根页，**不会**自动打开知识目录。安全行为保留：强制改密账号点知识目录先改密，不直接进知识页撞 403 |
| R-83-03 | 14 张截图里 9 张早于最终 HAP，「同一最终包」表述过强 | 已按逐张时间戳核对并用最终包重拍：第二轮记录为 13 张共享后端截图 17:29:40–17:31:21，晚于 17:29:00 的构建（SHA-256 `CA7F5F53…A0846F`）；公开案例登录门槛图因与「我的」登录图字节相同，已于 23:11:51 在本机实例沿同一路径重新取证替换（第 4.2 节逐张列出拍摄时间，删除了未核实的「同一最终包」式表述） |
| 非阻断建议 #1 | 选购出口按钮写死「去『服务』」，工作人员底栏是「工作台」 | 已改：`ShoppingPage` 新增 `staff: boolean` 与 `serviceLabel()`，按钮按角色显示「去「服务」…」/「去「工作台」…」，`HomePage` 传 `staff: this.home === HOME_STAFF`。工作人员文案已在设备上看到：`staff-shopping-cta-workbench-local-backend.jpeg`（本机实例）显示「去「工作台」查看维修与知识」 |

第二轮仍**未完成**：强制改密账号（A-006）设备验证、`reduceMotion` 开关验证；
交易与论坛内容未实现。

## 8. 交付状态

- 未推送到远端、未建 PR、未合并，Issue 状态未改。
- `app/build-profile.json5`、`app/oh-package-lock.json5` 已还原，`git status --porcelain -uall`
  只剩 **28** 个预期路径（5 改 + 3 新增源码/资源 + 2 文档 + 18 张截图：共享后端 13 张 + 本机实例 5 张）。
