# Issue #42 验证记录：完整联调与课程演示

日期：2026-10-11。分支：`feat/issue-42-demo-integration`（基点 `upstream/main` @ `2c60449`，
即 #40 经 PR #52 合入后的 main；分支另含 `5f3291e`、`935e1bf` 两笔 #42 提交）。
环境：本机专用 MySQL `127.0.0.1:3308`（开发库 `pchospital_exp_local`）；**未连接设备**。

本文件含两轮记录：

- **阶段1（文档轮）**：落盘演示与验证文档时核对的环境事实，见 §2.1，通过项见 §3.1。
- **阶段2（实测轮）**：**设备之外、无模型的真实 HTTP 链路实测**（开发库真实数据）、HAP 构建与文档回填，
  见 §2.2–§2.7、§3.2、§7。阶段2 只修改了本文件与
  [演示指引](../demo/issue-42-demo-guide.md)；未改 `backend/`、`app/` 源码，未改根 `README.md`、
  `docs/development-plan.md` 或其他写手的文件；临时脚本只写在 `%TEMP%`，仓库内无临时文件
  （构建后 `git status --short` 无输出）。
- **阶段2b（未执行）**：模型与知识案例链路（咨询与引用、标记典型、自动整理合并、换问法检索、
  无依据问答）需要 `AI_API_KEY` / `EMBEDDING_API_KEY`，本机没有，**不在本轮范围**，仍为待补（见 §5、§6）。

## 1. 范围与依据

- 范围：Issue #42「07 完整联调与课程演示」的演示顺序、材料清单与验证记录；只记录**实际执行**的检查。
  阶段1 只落盘文档与环境事实；阶段2 补设备之外的真实功能链路、权限/失败场景与 HAP 构建（模型链路除外）。
- 验收依据：Issue #42 验收步骤（原文见演示指引开头）、[开发方案](../development-plan.md)、
  [AGENTS.md](../../AGENTS.md)。
- 接口与环境依据：[backend/docs/local-development.md](../../backend/docs/local-development.md)、
  [native-client-api.md](../../backend/docs/native-client-api.md)、
  [native-repairs-api.md](../../backend/docs/native-repairs-api.md)、
  [knowledge-cases-api.md](../../backend/docs/knowledge-cases-api.md)、
  [knowledge-ai.md](../../backend/docs/knowledge-ai.md)。
- 既有记录：[issue-38.md](issue-38.md)、[issue-40.md](issue-40.md)（其数字属各自里程碑的实测，
  本轮**不复用、不转述为 #42 的通过项**）。
- 阶段1 未执行 lint、单测、集成测试、后端构建与任何数据库命令（另一名写手正在使用 `backend/` 与数据库，避免抢占）。
- 阶段2 执行了：后端 dev server（`13080`）+ 真实 HTTP 链路（开发库）、`db:health`、App HAP 构建；
  **未复跑** `lint` / `test:unit` / `test:db` / `build`（数字直接引用指挥 2026-10-11 实测，见 §2.7）；
  未跑 `knowledge:index`、未做任何真实模型调用、未做装机验证。
- 阶段2 依据（除 §1 已列文档外）：[native-repairs-api.md](../../backend/docs/native-repairs-api.md)、
  [native-client-api.md](../../backend/docs/native-client-api.md)、`backend/src/app/api/v1/` 路由结构。

## 2. 实际执行的检查与结果

### 2.1 阶段1（文档轮）已核对的环境事实

下表全部为阶段1 实际运行并观察到的结果；未在表中的项目即未验证。

| 检查 | 命令 / 方式 | 结果 |
| --- | --- | --- |
| 当前分支 | `git branch --show-current` | `feat/issue-42-demo-integration` |
| 基点与最近提交 | `git log --oneline -3` / `git log -1 --format=%P` | `2c60449 Merge pull request #52 from Xiaoyuan-114/feat/issue-40-typical-cases`（两父提交 `6c8fbcb`、`1ad82b8`）、`1ad82b8`、`db1b243`（后两笔均为 #40 审查修复提交） |
| HEAD 与 upstream 关系 | `git rev-parse upstream/main` / `git merge-base HEAD upstream/main` | `upstream/main` = `2c604498ba2da028a12deee50715d809e4e97a4c` = HEAD 的 merge-base（分支正好基于该提交，无额外合并） |
| HEAD | `git log -1 --format=%H %ad` | `2c604498ba2da028a12deee50715d809e4e97a4c`（2026-10-11 20:22 +0800） |
| 工作区 | `git status --short` | 写本记录开始时无输出（干净）；记录结束时出现并行写手在 `backend/` 的 2 个改动（见下方备注） |
| 设备 | `hdc list targets`（`E:\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe`） | `[Empty]`（无设备） |
| DevEco 位置 | `Test-Path 'D:\DevEco Studio'` / 列目录 | `D:\DevEco Studio` 不存在；实际在 `E:\DevEco Studio`（含 `bin/jbr/lib/modules/plugins/sdk/tools` 等） |
| SDK | 列目录 | `E:\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe` 存在 |
| 模拟器机型 | 列 `%LOCALAPPDATA%\Huawei\Emulator\deployed` | 4 个机型配置：Mate X7、MateBook Pro、MatePad Pro 13、Pura 90 Pro；每个只有 `config.ini`（前两者外另有 `Camera.properties`） |
| 模拟器系统镜像 | 读 `.emu_config` 的 `imagePath` 并检查 | `C:\Users\MR\AppData\Local\Huawei\Sdk` **不存在** → 无系统镜像；`.emu_config` 中 `HarmonyOS_Software_Service_Agreement`、`HarmonyOS_SDK_Agreement` 均为 `disagree` |
| 签名材料 | `Test-Path "$env:USERPROFILE\.ohos"` | `False`（无签名配置，无法装机） |
| 模型/向量 Key | 读 `backend/.env` 的键名 | 仅 `EXPERIMENT_DEV_DB/TEST_DB`、`DATABASE_URL`、`TEST_DATABASE_URL`、`AUTH_SECRET`、`INVITE_CODE_PEPPER`、`PII_AUDIT_PEPPER`、`APP_BASE_URL`、`RECRUITMENT_CYCLE`、`ACADEMIC_TERM_START/END`；**无任何 `AI_*`、`EMBEDDING_*` 键** |
| 数据库目标 | 解析 `DATABASE_URL` / `TEST_DATABASE_URL`（不打印凭证） | `127.0.0.1:3308/pchospital_exp_local`（用户 `pch_local`）、`127.0.0.1:3308/pchospital_exp_local_test`（用户 `pch_local_test`） |
| 专用实例端口 | `Test-NetConnection 127.0.0.1 -Port 3308` | `True`（实例在监听；本轮未执行任何数据库命令） |
| 后端端口 | `Test-NetConnection 127.0.0.1 -Port 13080` | `False`（后端未启动，属本轮预期状态） |
| 实例管理配置 | `Test-Path backend/.env.local-admin` | `False` → `tools/local-mysql.mjs` 不可用（暂无影响，实例已在运行） |
| 知识索引 | `Test-Path backend/data/knowledge/index/knowledge-index.json` | `False`（`data/knowledge/` 下只有 `snapshot/`、`internal-test/`、`knowledge.sources.json`、`README.md`） |
| 测试账号工具 | 读 `backend/tools/prepare-test-accounts.ts` | 基点 `2c60449` 上只有 `100001`（客户）、`100002`（工作人员）两个账号；写本记录时并行的写手已在**工作区**把管理员 `100003`（`ADMIN`、无成员档案）加入该工具（未提交），并同步进 `backend/docs/native-client-api.md` |
| 文档目录 | 列 `docs/` | 无 `docs/demo/`，本轮新建 |

备注（阶段1 发现的文档与实机差异，不改文件）：`backend/.env` 的库用户是 `pch_local` /
`pch_local_test`，而 `local-development.md` 的实例表中开发库用户写作 `pchospital_local`
（测试库一致）。不影响连接，已另行报告。
另有并行写手的 2 个改动（`backend/docs/native-client-api.md`、`backend/tools/prepare-test-accounts.ts`）
在阶段1 时尚未提交，**阶段2 时已确认作为 `5f3291e` 提交进本分支**（`git show --stat 5f3291e`：两文件，
+61/−13）；阶段1 未修改它们、未纳入其结果项。

### 2.2 阶段2 环境与口径（设备之外、无模型）

| 项 | 命令 / 方式 | 实测结果 |
| --- | --- | --- |
| 后端启动 | `cd backend; corepack pnpm dev --port 13080`（后台） | Next.js `15.5.25`；`Local: http://localhost:13080`、`Network: http://26.141.243.27:13080`、`Environments: .env`；启动无报错 |
| 健康检查 | `GET http://127.0.0.1:13080/api/v1/health` | `200`，原文：`{"success":true,"data":{"status":"ok","database":"reachable"},"meta":{"requestId":"req_fa7c183e-85ea-4b5d-833e-721efc0f4fb2"}}` |
| 数据库健康 | `cd backend; corepack pnpm db:health` | exit 0，原文：`{"ok":true,"product":"MySQL","version":"9.6.0","versionComment":"MySQL Community Server - GPL","databaseName":"pchospital_exp_local","timeZone":"+00:00","characterSet":"utf8mb4","collation":"utf8mb4_unicode_ci"}` |
| 通道口径 | 原生通道 | 写接口带 `Authorization: Bearer <token>` + `X-Client-Type: native`，**未发送 Origin**；读接口只带令牌与原生头 |
| 链路脚本 | `%TEMP%\issue42-chain.mjs`、`issue42-chain-supplement.mjs`、`issue42-evidence.mjs` | 只通过 HTTP 访问本机后端（真实开发库），原始结果另存同目录 JSON；未入库 |
| 端口释放 | 停止 dev server 后 `Test-NetConnection 127.0.0.1 -Port 13080` | `False`（`Get-NetTCPConnection -LocalPort 13080 -State Listen` 无结果）→ 13080 已释放 |
| 设备（复测） | `hdc list targets`（`E:\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe`） | `[Empty]`（无设备）；`Test-Path "$env:USERPROFILE\.ohos"` = `False`（无签名材料） |
| DevEco 位置（复测） | `Test-Path 'E:\DevEco Studio'` / `'D:\DevEco Studio'` | `True` / `False` |
| 知识索引（复测） | `Test-Path backend/data/knowledge/index/knowledge-index.json` | `False`（未构建，见 §5） |
| 工作区 | `git status --short`（写入本文件前、HAP 构建后） | 无输出（干净）；`app/oh-package-lock.json5` 被 `ohpm install` 改动后已用 `git checkout -- app/oh-package-lock.json5` 还原 |

**未执行（如实声明，不做任何推断）**：真实模型调用、`knowledge:index`、`/api/v1/knowledge/*`、
案例整理链路（阶段2b 范围）；`lint` / `test:unit` / `test:db` / `build` 未复跑（见 §2.7）；
数据库启停、迁移与 seed 未执行（3308 实例已在监听，按任务要求不重启/不停止）。

### 2.3 阶段2 主链路逐步实测（开发库真实数据）

脚本按顺序执行，下表为每一步的**真实**状态码与关键字段（开发库 `pchospital_exp_local`）。

| 步骤 | 请求 | HTTP | 关键字段 / 错误码 |
| --- | --- | --- | --- |
| 1 | `POST /api/v1/auth/native/login`（`100001` / `customer123`） | 200 | `home=CUSTOMER`、`roles=[]`、`memberProfileId=null`、`displayName=测试客户`、`userId=30000000-0000-4000-8000-000000000001`、`mustChangePassword=false` |
| 2 | `POST /api/v1/repair-orders`（客户令牌 + `Idempotency-Key`） | 201 | `id=a60bd281-960c-450b-ab37-f2c6b3d55db9`、`status=SUBMITTED` |
| 3a | `POST /api/v1/auth/native/login`（`100002` / `staff123`） | 200 | `home=STAFF`、`roles=["MEMBER"]`、`memberProfileId=9288ec5a-bb76-4c00-824c-648508f48858`、`memberStatus=ACTIVE`、`permissions` 17 项 |
| 3b | `GET /api/v1/staff/repair-orders?scope=unassigned&pageSize=50` | 200 | 列表 9 条且含该单；`actions.canAccept=true`、`status=SUBMITTED` |
| 4a | `POST /api/v1/staff/repair-orders/{id}/accept` | 200 | `status=ACCEPTED`、`assignee={memberProfileId:"9288ec5a-…",name:"测试工作人员"}`、`events=2` |
| 4b | `POST /api/v1/staff/repair-orders/{id}/progress` `toStatus=REPAIRING` | 200 | `status=REPAIRING`、`events=3` |
| 4c | `POST /api/v1/staff/repair-orders/{id}/progress` `toStatus=COMPLETED` | 200 | `status=COMPLETED`、`events=4` |
| 5 | `GET /api/v1/repair-orders/{id}`（客户令牌） | 200 | `status=COMPLETED`、时间线 `events=4`（`null→SUBMITTED`、`SUBMITTED→ACCEPTED`、`ACCEPTED→REPAIRING`、`REPAIRING→COMPLETED`）；客户 DTO 字段仅 `id,deviceModel,deviceSerial,faultDescription,contactPhone,status,createdAt,updatedAt,lastProgressAt,events` —— **无 `assignee`、无 `record`** |
| 6 | `POST /api/v1/staff/repair-orders/{id}/record`（受理人本人 + `Idempotency-Key`） | 201 | `id=36fb4958-e7f7-43d3-9af4-ca09577459bb`、`status=DRAFT`、`deviceModel=ThinkPad T14 Gen3`（从报修单预填）、`result=null`（**未预置成功值**）、`version=1`、`photos=[]` |
| 7a | `GET /api/v1/repair-categories` | 200 | 10 个启用分类；取首个 `id=10000000-0000-4000-8000-000000000001`、`code=COOLING_CLEANING`、`name=散热 / 清灰` |
| 7b | `GET /api/v1/repairs/{recordId}` | 200 | `version=1`、`canEdit=true`、`photoLimits={"maxBytes":10485760,"maxFiles":9}` |
| 8a | `POST /api/v1/repairs/{recordId}`（`version` + `repairDate` + `durationMinutes` + `categoryId` + `content` + `result`） | 200 | `version 1 → 2`、`repairDate=2026-10-11`（上海日历日，等于当天）、`durationMinutes=90`、`categoryId=10000000-0000-4000-8000-000000000001` |
| 8b | 同接口再写一次（`version: 1` 旧版本号） | 409 | `REPAIR_VERSION_CONFLICT`，message `记录已被更新，请刷新后重试` |
| 9 | `POST /api/v1/repairs/{recordId}/photos`（multipart，字段名 `photos`） | 201 | `photos=1`、`id=bb37b964-5802-44c7-9556-5efe0b81725b`、`originalName=issue42-verify-photo.png`、`mimeType=image/png`、`sizeBytes=70`（最小合法 PNG，按文件头校验通过） |
| 9b（补充） | `GET /api/v1/repair-photos/{photoId}/content` 匿名 / 带会话 | 401 / 200 | 匿名 `401`（JSON 错误体）；带令牌 `200`、`Content-Type: image/png`、70 字节、首 8 字节 `89504e470d0a1a0a`（PNG 文件头） |
| 10 | `POST /api/v1/repairs/{recordId}/submit`（`Idempotency-Key` + `{version:2}`） | 200 | `status=PENDING` |
| 11a | `POST /api/v1/auth/native/login`（`100003` / `admin123`） | 200 | `home=STAFF`、`roles=["ADMIN"]`、`memberProfileId=null`、`memberStatus=null`、`displayName=测试管理员`；`permissions` 含 `repair:review`、`repair:flag` |
| 11b | `GET /api/v1/admin/repairs?status=PENDING&pageSize=50` | 200 | `meta.pagination.total=1` 且列表含该备案（`status=PENDING`） |
| 11c | `POST /api/v1/admin/repairs/{recordId}/reviews` `{decision:"APPROVED",idempotencyKey:"…"}` | 200 | `status=APPROVED`、`reviewedAt=2026-10-11T14:35:58.697Z`（幂等键在**请求体**，按契约） |
| 12a | `GET /api/v1/repairs/{recordId}` | 200 | `status=APPROVED`、`reviews=1`（`decision=APPROVED`、审核人 `测试管理员`）、`canEdit=false`、`version=4`、`photos=1`、`timeline=5` |
| 12b | `GET /api/v1/staff/repair-orders/{orderId}` | 200 | `status=COMPLETED`（**审核未改变报修处理状态**）、`record.status=APPROVED`、`events=4` |

备注（避免过度解读）：备案 `version` 的中间递增点未逐步记录，只确证「建档 `1` → 保存草稿后 `2` → 结束时 `4`」。

### 2.4 阶段2 权限与来源边界实测

| 场景 | 请求 | HTTP | 错误码 / 原文 |
| --- | --- | --- | --- |
| 客户令牌调工作人员队列 | `GET /api/v1/staff/repair-orders?scope=all` | 403 | `FORBIDDEN`（`没有执行该操作的权限`） |
| 写请求缺 `X-Client-Type`（同时未带 Origin） | `POST /api/v1/repair-orders`（客户令牌） | 403 | `FORBIDDEN`（`请求来源无效`） |
| 客户令牌调管理员审核列表 | `GET /api/v1/admin/repairs?status=PENDING` | 403 | `FORBIDDEN` |
| 工作人员令牌调管理员审核列表 | `GET /api/v1/admin/repairs?status=PENDING` | 403 | `FORBIDDEN` |
| 客户令牌调知识案例列表 | `GET /api/v1/knowledge-cases` | 403 | `FORBIDDEN` |
| 工作人员令牌调知识案例列表 | `GET /api/v1/knowledge-cases` | 200 | —（未深入案例内容，属阶段2b） |
| 管理员令牌调知识案例列表 | `GET /api/v1/knowledge-cases` | 200 | —（同上） |

### 2.5 阶段2 失败场景实测

为不破坏演示主链数据，失败场景使用**另建的两条报修单**：
`06170d34-1520-4bb4-8944-70cbca22567c`（`REPAIRING`，无备案）与
`37982cac-cc7c-41e6-a146-87066027e0da`（`COMPLETED`，附空草案备案）。

| 场景 | 请求 | HTTP | 错误码 / 结果 |
| --- | --- | --- | --- |
| 纯管理员受理 | `POST /api/v1/staff/repair-orders/06170d34…/accept`（`100003`） | 403 | `MEMBER_REQUIRED`（`需要有效成员身份`）——**不是 500** |
| 纯管理员建档 | `POST /api/v1/staff/repair-orders/06170d34…/record`（`100003` + `Idempotency-Key`） | 403 | `MEMBER_REQUIRED` |
| 未受理人建档 | `POST /api/v1/staff/repair-orders/37982cac…/record`（`100002`，该单仍 `SUBMITTED`） | 403 | `REPAIR_FORBIDDEN`（`只有受理人可以为该报修单建立备案`） |
| 「跳过受理直接推进」 | `POST /api/v1/staff/repair-orders/06170d34…/progress`（未受理的单，非受理人） | 403 | `REPAIR_FORBIDDEN`（`只有受理人或管理员可以推进该报修单`）——身份校验先于状态校验，见 §8 |
| 跳过 `REPAIRING` 直接完成 | `POST /api/v1/staff/repair-orders/37982cac…/progress` `toStatus=COMPLETED`（当前 `ACCEPTED`） | 409 | `REPAIR_ORDER_STATE_INVALID`（`报修单不能从 ACCEPTED 变更为 COMPLETED`） |
| 非法 `toStatus` 取值 | `POST /api/v1/staff/repair-orders/06170d34…/progress` `toStatus=SUBMITTED` | 400 | `VALIDATION_FAILED`（`toStatus 参数无效`） |
| 同一受理人重复受理 | `POST /api/v1/staff/repair-orders/06170d34…/accept`（第二次） | 200 | 幂等：仍返回 `ACCEPTED` |
| 重复推进同一状态 | `POST /api/v1/staff/repair-orders/37982cac…/progress` `toStatus=REPAIRING`（第二次） | 200 | 幂等：仍返回 `REPAIRING` |
| 管理员推进他人受理的单 | `POST /api/v1/staff/repair-orders/06170d34…/progress` `toStatus=REPAIRING`（`100003`） | 200 | `status=REPAIRING`（管理员可推进任何报修单） |
| 客户令牌推进 | `POST /api/v1/staff/repair-orders/37982cac…/progress`（客户令牌） | 403 | `FORBIDDEN` |
| 空草案直接提交 | `POST /api/v1/repairs/7e77976b…/submit` `{version:1}` | 400 | `REPAIR_SUBMISSION_INCOMPLETE`（`请补全维修记录后再提交`），`fieldErrors` 5 项：`repairDate`/`categoryId`/`content`/`result`/`photos` |
| 建档幂等（同键重放 / 同单换键） | `POST /api/v1/staff/repair-orders/37982cac…/record` ×2 | 201 / 201 | 两次都返回**同一**备案 ID `7e77976b-2ee0-494b-9cd4-8743a2a5b68a`，不产生第二份备案 |

### 2.6 阶段2 HAP 构建实测

命令（DevEco 在本机 `E:\DevEco Studio`）：

```powershell
cd E:\zafu_ph\app
$env:DEVECO_SDK_HOME='E:/DevEco Studio/sdk'
$env:Path='E:/DevEco Studio/tools/node;'+$env:Path
& 'E:/DevEco Studio/tools/ohpm/bin/ohpm.bat' install
& 'E:/DevEco Studio/tools/hvigor/bin/hvigorw.bat' --mode module -p product=default assembleHap
```

| 项 | 实测结果 |
| --- | --- |
| `ohpm install` | exit 0；末行原文 `install completed in 0s 132ms`；含 ohpm 自身启动，实测耗时 **25.9 s** |
| `hvigorw … assembleHap` | exit 0；末尾原文（逐行照抄，末尾为 `BUILD SUCCESSFUL`）：<br>`> hvigor Finished :entry:default@SignHap... after 3 ms`<br>`> hvigor Finished :entry:default@CollectDebugSymbol... after 3 ms`<br>`> hvigor Finished :entry:assembleHap... after 1 ms`<br>`> hvigor BUILD SUCCESSFUL in 1 min 20 s 971 ms`<br>（空行）`33 tasks in total: 17 executed, 16 up-to-date` |
| 耗时 | `ohpm install` 25.9 s + `assembleHap` 99.0 s（脚本内分别计时）；`BUILD SUCCESSFUL in 1 min 20 s 971 ms`；整段命令合计 **125.1 s** |
| 签名步骤跳过提示 | 原文：`WARN: Will skip sign 'hos_hap'. No signingConfigs profile is configured in current project.` 次行 `If needed, configure the signingConfigs in E:\zafu_ph\app\build-profile.json5.` |
| 产物 | `E:\zafu_ph\app\entry\build\default\outputs\default\entry-default-unsigned.hap`，**1 197 149 字节**（约 1.14 MiB），LastWriteTime `2026-10-11 22:38:30`，SHA256 `7D434C01C00FB4971B9E08E2FEF485FCA071C04E9C915AD33C63B62D629C38D2` |
| 编译警告（非错误） | ArkTS 3 条：`CitationDetailPage.ets:103:45`、`KnowledgePage.ets:131:45`、`ServicePage.ets:50:45`，均为 `Function may throw exceptions. Special handling is required.` |
| 工作区影响 | `ohpm install` 改动了 `app/oh-package-lock.json5`（不属本任务），已按任务要求 `git checkout -- app/oh-package-lock.json5` 还原；构建后 `git status --short` 无输出 |
| 装机 | **未做**：`hdc list targets` = `[Empty]`（无设备），且 `~/.ohos` 不存在（无签名材料） |

### 2.7 后端检查（指挥实测，本轮引用未复跑）

| 检查 | 结果 | 来源 |
| --- | --- | --- |
| `corepack pnpm lint` | exit 0 | **指挥 2026-10-11 实测** |
| `corepack pnpm test:unit` | 441/441 | 同上 |
| `corepack pnpm test:db` | 197/197 | 同上 |
| `corepack pnpm build` | exit 0 | 同上 |

本轮**未复跑**的原因：任务书明确禁止同时运行 `next dev` 与 `pnpm build`（同一 `.next` 会互相破坏），
而阶段2 需要 dev server 跑真实 HTTP 链路；`test:db` 只写 `_test` 库，与本次开发库链路无关。
因此上表数字是**引用**，不是阶段2 的复现。

## 3. 真实通过项（可确证的事实）

### 3.1 阶段1（文档轮）

1. **分支与基点正确**：阶段1 时 `feat/issue-42-demo-integration` 的 HEAD 是 `2c60449`；
   阶段2 时 HEAD 为 `935e1bf`（其父提交为 `5f3291e`，再往下是 `2c60449`），
   即 #40 功能经 PR #52 以普通 Merge 合入 `upstream/main` 的合并提交（两父提交
   `6c8fbcb`、`1ad82b8`），且 `upstream/main` 正指向该提交、HEAD 的 merge-base 也是它；
   其前两笔 `db1b243`、`1ad82b8` 是 #40 两轮审查修复提交 —— 即 **#40 已合入 main，
   合入前含两笔审查修复**。
2. **工作区状态已核对**：写本记录开始时 `git status --short` 无输出（干净）。本轮未改动 `backend/`、
   `app/`、根 `README.md`、`docs/development-plan.md` 或其他写手的文件。
3. **本机环境事实核对完成**：无设备（`[Empty]`）、模拟器只有机型配置且无系统镜像、
   无签名材料（`~/.ohos` 不存在）、`backend/.env` 无模型/向量 Key、专用 MySQL 3308 正在监听、
   缺 `backend/.env.local-admin`、知识索引未构建。以上均与 Issue #42 任务书列出的本机事实一致。
4. **交付文档就位**：演示指引覆盖角色与账号、环境启动口径、15 步分角色演示顺序
   （含失败场景）、已知缺口与验收边界、材料清单；本记录如实区分「已核对事实」与「待补实测」。

### 3.2 阶段2（实测轮）—— 设备之外、无模型

5. **健康检查通过**：`GET /api/v1/health` = `200`，`data.status=ok`、`data.database=reachable`；
   同一实例上 `corepack pnpm db:health` exit 0，报告 MySQL `9.6.0`、库 `pchospital_exp_local`（§2.2）。
6. **三个演示账号均可原生登录，`home` 与角色符合 §1 账号表**：客户 `home=CUSTOMER`（无角色、无档案）；
   工作人员 `home=STAFF` + `MEMBER` + 有效成员档案（`memberStatus=ACTIVE`）；
   管理员 `home=STAFF` + `ADMIN` + `memberProfileId=null`（**纯管理员，无成员档案**）。
   即 `100003` 在**已提交**的 `5f3291e` 中就位后按预期登录成功，阶段1 的「待确认」已解除。
7. **完整业务主链在真实 HTTP + 真实开发库上跑通**（§2.3 步骤 1–12）：
   客户提交报修 → 工作人员队列可见（`canAccept=true`）并受理 → 推进至 `COMPLETED` →
   客户侧看到 `COMPLETED` 与 4 条真实时间线事件 → 受理人建档（`DRAFT`，机型预填、`result` 留空）→
   保存草稿（`version` 1→2）→ 旧版本号写 `409 REPAIR_VERSION_CONFLICT` →
   上传真实 PNG 照片（按文件头校验，可带会话读回）→ 提交 `PENDING` →
   **真实管理员 `100003`** 审核通过 `APPROVED`（含 1 条审核记录）→
   报修处理状态仍为 `COMPLETED`（两套状态独立确证）。
8. **权限与来源边界全部命中契约**：§2.4 的 7 个场景状态码与错误码逐一符合预期。
9. **失败场景全部按契约返回 4xx，无 5xx**（§2.5）：纯管理员受理/建档 `403 MEMBER_REQUIRED`、
   未受理人建档 `403 REPAIR_FORBIDDEN`、跳过 `REPAIRING` `409 REPAIR_ORDER_STATE_INVALID`、
   非法 `toStatus` `400 VALIDATION_FAILED`、空草案提交 `400 REPAIR_SUBMISSION_INCOMPLETE`（5 项
   `fieldErrors`）、重复受理与建档幂等。
10. **HAP 构建通过**（§2.6）：`ohpm install` exit 0 + `hvigorw assembleHap` 以
    `BUILD SUCCESSFUL in 1 min 20 s 971 ms` 结束；产物
    `app/entry/build/default/outputs/default/entry-default-unsigned.hap`，1 197 149 字节；
    **未签名**（`Will skip sign 'hos_hap'`），未装机。构建后工作区干净（lock 文件已还原）。
11. **演示数据由本次链路真实产生**（§7），非 seed 预置、非硬编码。
12. **文档回填**：本文件 §2–§8 与 [演示指引](../demo/issue-42-demo-guide.md) 的阶段2实测位按本轮
    真实结果填写；模型链路（步骤 2、9、10、11、13a）保持「待补（阶段2b：需模型 Key）」并写明原因。

## 4. 失败项

**阶段2：无失败项。** 阶段2 共发出 55 次 HTTP 请求（链路脚本 36 次 = 主链与环境 22 次 + 边界 6 次 +
失败场景 8 次；补充探针 11 次；证据核对 7 次；手工健康探测 1 次）：凡预期成功的均返回 2xx，
凡预期被拒的均返回契约规定的 4xx（`403` / `409` / `400`），**没有任何 5xx、超时或脚本异常**；
HAP 构建与 `ohpm install` 均 exit 0。
`127.0.0.1:13080` 在停止 dev server 后不再监听，是本轮收尾的预期状态，不是失败。

两处**与任务书表述不完全一致**的观察（不是失败、不涉及改代码）列在 §8，供演示时准确表述。

**阶段1**：未执行功能、构建或测试，没有可记录的失败项。指引步骤 13 的失败场景（无依据问答 /
越权访问 / 纯管理员受理被拒）在阶段1 只是**演示内容**；阶段2 已实测其中 13c 与 13b，13a 仍待补。

## 5. 未验证项（如实声明）

- **真机 / 模拟器：全部未验证**。阶段2 复测 `hdc list targets` 仍为 `[Empty]`（无设备）、
  `~/.ohos` 不存在（无签名材料）；阶段1 另测得模拟器只有机型配置、无系统镜像。
  因此 App 侧「登录 → 咨询与引用 → 确认报修 → 受理推进 → 建档照片 → 审核 → 标记典型 →
  检索与多来源证据」的**页面链路**仍未在设备上跑通；未签名 HAP 也不能安装，
  构建成功 ≠ 装机运行正确。
- **App 端的 multipart 上传 / 相册选择 / 照片解码**：未验证。§2.3 步骤 9 的 multipart 照片上传是用
  Node 的 `FormData` 走的**真实 HTTP**，不是 `@ohos.net.http` + 相册选择器的实现路径。
- **后端 `lint` / `test:unit` / `test:db` / `build`**：本轮**未复跑**（原因见 §2.7），
  §2.7 的数字为**引用指挥实测**，不是阶段2 的复现结果。
- **真实模型与向量能力**：本机 `backend/.env` 无 `AI_API_KEY` / `EMBEDDING_API_KEY`
  （阶段1 已核实，本轮未改 `.env`）→ DeepSeek 整理、bge-m3 向量、相似合并与带引用问答
  **无法在本机复现**；标记典型在本机预期以 `MODEL_NOT_CONFIGURED` 失败，问答预期
  `503 AI_NOT_CONFIGURED`，向量不可用时检索降级为关键词。**阶段2b 范围**。
- **知识索引**：阶段2 复测 `backend/data/knowledge/index/knowledge-index.json` 仍不存在；
  未执行 `knowledge:index`（无向量 Key，且属阶段2b）→ 未构建前问答/搜索预期
  `503 KNOWLEDGE_INDEX_UNAVAILABLE`。**本记录不宣称实际请求过 `/knowledge/chat`、`/knowledge/search`**。
- **案例可见性与客户脱敏**（指引步骤 12 的案例部分）：未验证（属阶段2b 模型/案例链路）。
  阶段2 只实测了「客户令牌调 `GET /api/v1/knowledge-cases` → `403 FORBIDDEN`」这一条边界。
- **`REPAIR_ORDER_STATE_CONFLICT`（他人抢先受理）**：未验证。演示账号只有一个 `MEMBER` 账号
  （`100002`），本机无法制造「他人已受理」；本人重复受理的**幂等**已实测（§2.5）。
  同理未验证：同一 `Idempotency-Key` 跨报修单复用 → `409 IDEMPOTENCY_CONFLICT`、
  管理员取消报修单、`REJECTED` 退回与重提、并发抢审 `409 REPAIR_STATE_CONFLICT`。
- **数据库启停、迁移与 seed**：未执行（3308 实例已在监听，按任务要求不重启/不停止；
  未跑 `db:migrate:deploy` / `db:seed` / `accounts:prepare`）。
- **演示材料**：逐步截图/录像、设备型号与系统版本、四人实际贡献说明仍缺（见 §6）。
- **未签名 HAP 与装机**：即使构建通过，本机无签名材料与设备，也无法安装、无法验证运行期行为。

## 6. 待补项状态（阶段2 回填后）

| 待补项 | 状态 | 落点 |
| --- | --- | --- |
| 指引 §3 步骤 1–15 的「阶段2实测」 | **部分完成**：步骤 1（后端启动与健康检查）、3、4、5、6、7、8、12（越权接口部分）、13、14 已填本轮真实结果；步骤 2、9、10、11 与 12（案例可见性部分）**仍待补**（阶段2b：需模型 Key）；步骤 15 见下方「四人贡献」 | `docs/demo/issue-42-demo-guide.md` §3 |
| `/api/v1/health` 的实际返回 | **已完成**：`200` + `{"status":"ok","database":"reachable"}` | 本文件 §2.2；指引 §2.4 |
| `db:health` 的实际输出 | **已完成**：exit 0，MySQL `9.6.0`、`pchospital_exp_local` | 本文件 §2.2 |
| 数据库启停、迁移/seed 的实际输出 | **未执行**：3308 已在监听（不启动/不停止）；未跑 `db:migrate:deploy` / `db:seed` | 本文件 §2.2；指引 §2.1、§2.2 |
| 各步权限边界与失败场景的实际表现（含 HTTP 状态与错误码） | **已完成**：§2.4 七项边界 + §2.5 十二项失败场景，状态码与错误码均为真实值 | 本文件 §2.4/§2.5；指引 §3 步骤 12、13 |
| 后端 `lint` / `test:unit` / `test:db` / `build` 的实际数字与输出末尾 | **已完成（引用指挥实测，本轮未复跑）**：lint exit 0、441/441、197/197、build exit 0 | 本文件 §2.7、§3.2 |
| App `assembleHap` 输出、产物路径与签名状态 | **已完成**：`BUILD SUCCESSFUL`、未签名 HAP 1 197 149 字节、签名跳过提示原文已录 | 本文件 §2.6、§3.2；指引 §3 步骤 14 |
| `accounts:prepare` 实际输出（是否三个账号）与 `100003/admin123` 登录结果 | **部分完成**：三账号登录结果**已实测按预期**（含 `100003` → `ADMIN`/无档案）；`accounts:prepare` 的原始输出本轮**未复跑**（账号已在开发库就绪，登录即验证） | 本文件 §2.3 步骤 1/3a/11a；指引 §1 |
| `knowledge:index` 的索引版本与检索模式（`hybrid` / `keyword-only`） | **未执行**（阶段2b：需向量 Key，任务范围外） | 指引 §2.3 |
| 设备型号/系统/`hdc list targets` 输出 | **部分完成**：阶段2 复测 `hdc list targets` = `[Empty]`（无设备，故无型号/系统可记） | 本文件 §2.2、§5；指引 §5 |
| 逐步截图或录像（文件名与步骤号对应） | **未完成**：设备之外的链路未采集截图/录像 | 指引 §5 |
| 四人实际贡献说明（与提交、Issue 记录核对） | **未完成** | 指引 §5 |
| 阶段2b 模型链路：咨询与引用、标记典型、自动整理合并、换问法检索命中、无依据问答 | **未执行**：本机无 `AI_API_KEY` / `EMBEDDING_API_KEY` | 指引 §3 步骤 2、9、10、11、13a |

**本文件中没有「未实测却写成已完成」的项目**：实测值一律标注来源（本轮实测 / 指挥实测 / 阶段1 核对），
模型链路、装机与未跑命令一律保留「待补 / 未执行 / 未验证」并写明原因。

## 7. 演示数据清单（本轮真实产生，供演示复现）

以下对象全部由 §2.3 的真实 HTTP 链路在**开发库 `pchospital_exp_local`** 中产生，**不是 seed 预置**
（seed 只建角色/分类/技能字典，不提供业务数据）。演示前若重新执行一遍 §2.3，会得到新的 ID；
下表是**本轮实测留下的那一份**，可直接用于演示复现与截图对照。

| 对象 | ID | 状态 | 说明 |
| --- | --- | --- | --- |
| 报修单（演示主链） | `a60bd281-960c-450b-ab37-f2c6b3d55db9` | `COMPLETED` | 客户 `100001` 提交；机型 `ThinkPad T14 Gen3`、序列号 `SN-ISSUE42-0001`；受理人 = `100002`（`测试工作人员`，`memberProfileId` `9288ec5a-bb76-4c00-824c-648508f48858`）；时间线 4 条事件 |
| 维修备案（演示主链） | `36fb4958-e7f7-43d3-9af4-ca09577459bb` | `APPROVED` | 由上面报修单建档；`repairDate=2026-10-11`、`durationMinutes=90`、分类 `散热 / 清灰`（`COOLING_CLEANING`）、`result=COMPLETED`；结束时 `version=4`、`reviews=1`（审核人 `100003` `测试管理员`，`2026-10-11T14:35:58.697Z`） |
| 维修照片 | `bb37b964-5802-44c7-9556-5efe0b81725b` | 有效（1 张） | `image/png`、70 字节（最小合法 PNG）；`contentUrl=/api/v1/repair-photos/bb37b964-5802-44c7-9556-5efe0b81725b/content`（需会话，匿名 `401`） |
| 报修单（失败场景专用） | `06170d34-1520-4bb4-8944-70cbca22567c` | `REPAIRING` | 用于纯管理员受理 `403 MEMBER_REQUIRED`、跳过受理推进 `403`、非法 `toStatus` `400`、重复受理幂等；**无关联备案** |
| 报修单（幂等 / 缺项探针专用） | `37982cac-cc7c-41e6-a146-87066027e0da` | `COMPLETED` | 用于 `ACCEPTED→COMPLETED` `409 REPAIR_ORDER_STATE_INVALID`、未受理人建档 `403`、建档幂等 |
| 维修备案（空草案，供演示现场展示缺项校验） | `7e77976b-2ee0-494b-9cd4-8743a2a5b68a` | `DRAFT` | 机型 `MateBook X Pro`、`result=null`；空草案提交得到 `400 REPAIR_SUBMISSION_INCOMPLETE`（5 项 `fieldErrors`） |

管理端列表计数（`GET /api/v1/admin/repairs`，管理员令牌实测）：`DRAFT` total=1、`PENDING` total=0、
`APPROVED` total=1、`REJECTED` total=0（即开发库现有 2 份备案，均由本轮链路产生）。
工作人员 `GET /api/v1/staff/repair-orders?scope=all` 实测 11 条：`SUBMITTED` 8、`REPAIRING` 1、`COMPLETED` 2；
其中 `SUBMITTED` 的 8 条是 #37/#38 里程碑遗留的既有数据，**不是本轮产生**，本轮未清理（不清库）。

## 8. 与预期不一致的地方、偏差与范围外发现

**A. 与任务书/指引表述不完全一致的两处（不是失败，未改源码）**

1. **「跳过受理直接推进」的错误码是 403 而非 409**。对一条**未被任何人受理**的报修单，
   `100002` 调 `progress` 得到 `403 REPAIR_FORBIDDEN`（`只有受理人或管理员可以推进该报修单`），
   而不是 `409 REPAIR_ORDER_STATE_INVALID`：服务端**先校验身份（受理人/管理员）再校验状态机**，
   未受理的单没有受理人，任何 `MEMBER` 都不满足身份条件。
   `native-repairs-api.md` §progress 写的正是「受理人本人或管理员；其他人 403」，因此
   **接口文档准确**；需要修正的是演示指引步骤 5 的口径 —— 「非法转换返回 409」的前提是
   **操作者已是受理人本人或管理员**。要让 409 复现，用受理人把 `ACCEPTED` 直接跳到 `COMPLETED`（本轮已实测 409）。
2. **「非法 `toStatus` 取值」与「非法状态转换」是两个不同错误码**：传
   `toStatus=SUBMITTED`（不在枚举内）先被入参校验拦下，返回 `400 VALIDATION_FAILED`
   （`toStatus 参数无效`），不会走到状态机。演示时若要展示 409，必须传合法枚举值（如
   `ACCEPTED → COMPLETED`），否则观众看到的是 400。

**B. 实现细节观察（与契约文字一致，但客户端需注意）**

3. **建档对「同单换键」也返回 201 + 原备案**：对同一报修单用**不同** `Idempotency-Key` 再次建档，
   返回 `201` 与**同一**备案 ID（`7e77976b-…`），不新建第二份、也不报 409。
   这与契约「已关联（返回原备案）」一致，但**状态码仍是 201**；客户端不应把 201 单独当作
   「本次新建成功」的判据，应以返回的备案 ID 是否已存在为准。

**C. 发现但与本任务无关的问题（均未修改文件，仅记录）**

4. `app/oh-package-lock.json5` 会被 `ohpm install` 改写（本轮已按任务要求 `git checkout --` 还原）。
   若他人本地或 CI 也执行 `ohpm install`，会产生无实际意义的 lock 变更噪声。
5. ArkTS 编译有 3 条警告（非错误，构建仍成功）：
   `features/knowledge/CitationDetailPage.ets:103:45`、`features/knowledge/KnowledgePage.ets:131:45`、
   `features/service/ServicePage.ets:50:45`，均为 `Function may throw exceptions. Special handling is required.`。
   属他人代码范围，本轮未改。
6. 开发库中 8 条 `SUBMITTED` 报修单为 #37/#38 里程碑遗留数据，本轮未清理（任务要求不清库、不破坏数据）；
   它们会让演示时的「待受理队列」比全新环境更长（本轮实测 `scope=unassigned` 9 条）。
7. `backend/.env` 的库用户名（`pch_local` / `pch_local_test`）与
   `local-development.md` 实例表中的 `pchospital_local` 不一致（阶段1 已记录）。不影响连接，未改文档。
8. `app/` 目录下 HAP 构建产物（`app/entry/build/`）不受版本控制（`git status` 干净），
   演示材料中引用产物路径时请注明它由本机构建产生、仓库不含产物。
