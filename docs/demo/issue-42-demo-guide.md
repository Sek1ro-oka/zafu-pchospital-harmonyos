# Issue #42 演示指引：完整联调与课程演示

本指引按下面的 Issue #42 验收步骤组织演示顺序，供课程演示与后续验证（阶段2b 模型链路、装机）使用。
范围与业务链依据 [开发方案](../development-plan.md)、[AGENTS.md](../../AGENTS.md) 与
[backend/docs/local-development.md](../../backend/docs/local-development.md)。

> **使用口径**：文中每一步的「预期结果」来自**接口契约与 #37–#40 的开发库验证记录**。
> 每步末尾的「阶段2实测」有两种状态：
> **已填** = 已在本机做过设备之外、无模型的真实实测（记 HTTP 状态码与关键字段，原始汇总见
> [Issue #42 验证记录](../verification/issue-42.md) §2）；
> **待补（阶段2b：需模型 Key）** = 该步依赖 `AI_API_KEY` / `EMBEDDING_API_KEY`，本机没有，未执行。
> **本指引仍未在设备上运行**（无设备、无签名材料），**不构成装机验收证据**。已知边界见 §4。

验收步骤原文（Issue #42）：

- 从文档启动本地环境，手机正常连接；依次演示两种角色。
- 客户咨询并打开引用、确认报修；工作人员处理后客户查看变化。
- 提交维修备案、审核并发布案例；换一种问法检索到新案例。
- 展示一个无依据或无权访问的失败场景。
- 最终前后端构建通过，完整业务链在设备上实际跑通；只补本轮发现问题及相关回归。
- 材料中的完成状态、测试结果和贡献均与实际一致。

## 1. 角色与账号

| 角色 | QQ | 密码 | 服务端身份 | App 入口 |
| --- | --- | --- | --- | --- |
| 客户 | `100001` | `customer123` | 无角色、无成员档案 | 客户服务入口（`home=CUSTOMER`） |
| 工作人员 | `100002` | `staff123` | `MEMBER` + 有效成员档案 | 工作人员入口（`home=STAFF`） |
| 管理员 | `100003` | `admin123` | `ADMIN`（`repair:review` / `repair:flag`），**无成员档案** | 工作人员入口，但不等同于工作人员 |

准备命令（只操作课设库，可重复执行，会重置口令并把角色集合与成员档案收敛到目标值）：

```powershell
cd backend
corepack pnpm accounts:prepare
```

- **管理员账号（现状）**：客户与工作人员两个账号一直在该工具中；管理员 `100003` 已随**提交 `5f3291e`**
  进入 `backend/tools/prepare-test-accounts.ts`，账号说明同步在
  [native-client-api.md](../../backend/docs/native-client-api.md) §本地测试账号（两处改动同一提交）。
  **阶段2 已实测**：三个账号均可原生登录，`100003` 返回 `home=STAFF`、`roles=["ADMIN"]`、
  `memberProfileId=null`、`memberStatus=null`，与上表一致（来源见
  [Issue #42 验证记录](../verification/issue-42.md) §2.3 步骤 11a）。
  `accounts:prepare` 的**原始输出本轮未复跑**（账号已在开发库就绪，用登录逐一代为验证）；
  若演示前要在新机器上重建，仍按
  [Issue #38 验证记录](../verification/issue-38.md) §2 的方式在**开发库**执行该工具。
- **纯管理员语义（不要演示反了）**：管理员**没有成员档案**，因此
  - 不能受理报修单（`POST /staff/repair-orders/[id]/accept` → `403 MEMBER_REQUIRED`，见 §3 步骤 13c），
    也不能代替受理人建档（建档仅受理人本人）；
  - 可以审核备案、标记典型案例、推进/取消任何报修单、调整案例可见范围、撤回或恢复案例；
  - 管理员权限**不下放**给工作人员：`100002`（`MEMBER`）调管理端接口应得 `403 FORBIDDEN`。
  - 不要为了「让管理员也能受理」给它加成员档案 —— 那会变成「管理员 + 维修队成员」，
    演示不出上面的权限失败场景。
  - 依据：[native-repairs-api.md](../../backend/docs/native-repairs-api.md) §通道与鉴权、§报修处理。
- 账号角色与 `home` 映射依据：[native-client-api.md](../../backend/docs/native-client-api.md)。
  客户端提交 `roles` 不生效，业务权限一律由服务端逐接口判定。
- seed 只建立角色/分类/技能字典，**不提供测试账号与演示业务数据**；演示用的报修单、备案与案例
  由演示流程本身产生（见 §3 步骤 3 起）。

## 2. 环境启动口径

### 2.1 专用 MySQL 实例（`127.0.0.1:3308`）

当前电脑使用独立原生 MySQL 9.6.0 实例：`127.0.0.1:3308`，数据目录
`E:/codes/pchospital-local-mysql`，禁用 mysqlx，未注册 Windows 服务（见
[local-development.md](../../backend/docs/local-development.md) §当前电脑的专用实例）。

```powershell
cd backend
node tools/local-mysql.mjs start     # 启动专用实例（保留数据）
corepack pnpm db:health              # 确认开发库/测试库可连接
node tools/local-mysql.mjs stop      # 演示结束后停止实例（保留数据）
```

**`backend/.env.local-admin` 缺失时的等价做法**：`tools/local-mysql.mjs` 只会从
`backend/.env.local-admin` 读取 `LOCAL_MYSQL_ADMIN_URL` / `LOCAL_MYSQL_DATA_DIRECTORY`
（可选 `LOCAL_MYSQL_BIN_DIRECTORY`），并用 `LOCAL_MYSQL_DATA_DIRECTORY/auto.cnf` 校验数据目录；
文件缺失时该脚本直接抛错，**不能**用它启停实例。等价做法（按优先级）：

1. **实例已在监听时无需启动**：先用 `db:health` 或连接探测确认 `127.0.0.1:3308` 可连，
   直接进入 §2.2（本机写本指引时实测 3308 已在监听）。
2. **使用自己的 MySQL**：不用专用实例，按 `corepack pnpm setup:local` 在自己已运行的 MySQL 上
   建一套 `pchospital_exp_*` 课设库（默认 `127.0.0.1:3306`），后续命令相同。
3. **自行重建 `.env.local-admin`**：需要该实例的 root 凭证与数据目录路径；随机凭证属本机机密，
   **只写在本机被忽略的文件里，不进仓库、不写进演示材料**。

风险：不要在没有确认数据目录归属的情况下启动/停止别人的实例；`stop` 会影响该实例上的所有数据；
演示前后不得执行清库/重置类操作（`db:reset:test` 只影响 `_test` 库，也不是演示必需步骤）。

### 2.2 迁移、seed、健康检查与账号

```powershell
cd backend
corepack pnpm install --frozen-lockfile   # 首次或依赖变更后
corepack pnpm db:migrate:deploy
corepack pnpm db:seed
corepack pnpm db:health
corepack pnpm accounts:prepare
```

预期：迁移应用成功；seed 建立字典；`db:health` 报告两个库可达；账号准备输出客户/工作人员/管理员
三个账号（见 §1 的现状说明）。

**阶段2实测**：`corepack pnpm db:health` 实测 exit 0，原文
`{"ok":true,"product":"MySQL","version":"9.6.0","versionComment":"MySQL Community Server - GPL","databaseName":"pchospital_exp_local","timeZone":"+00:00","characterSet":"utf8mb4","collation":"utf8mb4_unicode_ci"}`。
`db:migrate:deploy` / `db:seed` / `accounts:prepare` 本轮**未执行**（3308 实例已在监听、账号已在开发库
就绪；任务要求不重启实例、不清库），三账号登录已逐一代为验证（见 §1）。

### 2.3 知识索引（演示「咨询/检索/案例命中」的前置，容易漏）

知识问答与检索**依赖本地索引文件** `backend/data/knowledge/index/knowledge-index.json`
（被 gitignore，机器相关）。索引缺失时 `/knowledge/chat`、`/knowledge/search` 返回
`503 KNOWLEDGE_INDEX_UNAVAILABLE`，案例检索同样不可用。

```powershell
cd backend
corepack pnpm knowledge:index   # 无 EMBEDDING_API_KEY 时生成关键词索引（不需要联网）
```

- 未配置 `EMBEDDING_API_KEY` → 生成 `retrieval: keyword-only` 索引，接口如实返回
  `retrievalMode: keyword`；配置后再跑一次即可升级为混合检索（见
  [knowledge-ai.md](../../backend/docs/knowledge-ai.md) §1、§6）。
- 索引版本（如 `k1.…`）应抄进验收记录以便核对本次运行用的是哪一份索引。
- **阶段2实测**：`backend/data/knowledge/index/knowledge-index.json` 仍不存在（索引尚未构建）；
  本轮**未执行** `knowledge:index`（本机无 `EMBEDDING_API_KEY`，且知识/案例链路属阶段2b 范围），
  因此索引版本与 `retrievalMode` 仍为「**待补（阶段2b：需模型 Key）**」。

### 2.4 后端启动与健康检查

```powershell
cd backend
corepack pnpm dev --port 13080
```

浏览器或 curl 检查 `http://localhost:13080/api/v1/health`，期望
`{ "success": true, "data": { "status": "ok", "database": "reachable" } }`。
停止后端用 Ctrl+C。

**阶段2实测**：`cd backend; corepack pnpm dev --port 13080` 启动成功（Next.js `15.5.25`、
`Local: http://localhost:13080`、`Environments: .env`）；`GET /api/v1/health` 返回 `200`，原文
`{"success":true,"data":{"status":"ok","database":"reachable"},"meta":{"requestId":"req_fa7c183e-85ea-4b5d-833e-721efc0f4fb2"}}`。
实测完成后已停止 dev server，`Test-NetConnection 127.0.0.1 -Port 13080` 为 `False`（端口已释放）。

### 2.5 App 侧：服务器地址与网络

- DevEco Studio 打开 `app/`，构建 `entry` 模块并安装到手机；工程路径必须是英文
  （中文父目录会触发 Hvigor `Invalid project path`）。
- 登录页可填写并保存服务器地址：`http://<电脑局域网IP>:13080`（如 `http://192.168.1.20:13080`），
  保存后重启保留；**手机与电脑必须连同一 Wi-Fi**，电脑防火墙需放行 13080。
  依据：[native-client-api.md](../../backend/docs/native-client-api.md) §手机联调。
- App 已声明 `ohos.permission.INTERNET`；真机上的 HTTP 明文策略未复验，若设备返回
  `2300997 Cleartext traffic not permitted`，按设备策略处理（本课设无设备复现）。
- 界面参考 [我的华为参考截图](../reference/my-huawei/README.md)（服务页、我的页为主）。

## 3. 演示顺序

步骤编号 `1`–`15` 即演示顺序；每步给出操作、预期结果、前置数据、依据，并留阶段2实测位。
标注「（工作人员）」「（客户）」「（管理员）」表示用哪个账号操作。
**本机无模型 Key 时**，步骤 2、9、10、11 与 13a 涉及真实模型/向量，只能演示如实失败或降级，
一律标注「待补（阶段2b：需模型 Key）」；13c 与 13b 只依赖权限与来源判定，**阶段2 已在本机实测通过**。
真实整理与带引用问答需在配置了 DeepSeek + bge-m3 的机器上执行（见 §4）。

**阶段2 实测覆盖说明**：步骤 3、4、5、6、7、8、13（13c/13b）与 14 的 HAP 构建已用真实 HTTP
在本机跑通并记录状态码；步骤 1 只实测了后端启动、健康检查与账号登录（迁移/seed 未跑）；
步骤 12 只实测了「客户越权调接口 → 403」这一条（案例可见性部分仍待补）；步骤 2、9、10、11 与
步骤 15 的四人贡献说明仍未跑。逐条结果见各步末行，汇总见
[Issue #42 验证记录](../verification/issue-42.md) §2 与 §7（含演示数据清单）。

### 1.（准备）启动本地环境

- 操作：按 §2.1–§2.4 启动数据库、应用迁移与 seed、构建索引、准备账号、启动后端；按 §2.5 装 App 并填服务器地址。
- 预期结果：`db:health` 两库可达；`/api/v1/health` 返回 `success: true` 且 `database: reachable`；App 登录页「保存地址并检测」显示后端可达。
- 前置数据：本机 MySQL 运行、`backend/.env` 存在（缺 `backend/.env.local-admin` 时按 §2.1 等价做法）。
- 依据：§2；`backend/docs/local-development.md`；`backend/docs/knowledge-ai.md` §1。
- 阶段2实测（部分）：`cd backend; corepack pnpm dev --port 13080` 启动成功（Next.js `15.5.25`），
  `GET /api/v1/health` → `200` + `{"status":"ok","database":"reachable"}`（原文见 §2.4）；
  `corepack pnpm db:health` → exit 0（MySQL `9.6.0`、`pchospital_exp_local`）；
  三个演示账号均实际登录成功（§1）。**未验证**：`db:migrate:deploy` / `db:seed` / `knowledge:index`
  本轮未执行；App 安装与「保存地址并检测」需要设备，**本机无设备无法验证**。

### 2.（客户）登录并咨询，打开引用

- 操作：客户用 `100001 / customer123` 登录 → 客户服务页 → 知识问答 → 提一个资料覆盖的问题
  （如「校园网认证失败应该怎么处理？」）→ 点开回答里的引用。
- 预期结果：登录进入客户入口；回答状态 `answer` 且带引用（引用编号用后端返回的 `label`，不按下标重编号）；
  引用详情显示正文、标题路径、来源与版本信息。
- 前置数据：知识索引已构建（§2.3）；配置了 `AI_API_KEY` 时才是真实模型回答；
  **未配置时本步只会得到 `503 AI_NOT_CONFIGURED`**。
- 依据：`app/entry/src/main/ets/features/knowledge/KnowledgePage.ets`、`CitationDetailPage.ets`；
  `backend/docs/knowledge-ai.md` §4、§5。
- 阶段2实测：**待补（阶段2b：需模型 Key）**。**本轮未执行**：知识索引未构建
  （`knowledge-index.json` 不存在）且本机无 `AI_API_KEY` —— 按 §4 第 4、5 条，未配置模型时本步预期
  退化为 `503 AI_NOT_CONFIGURED`，索引缺失时预期 `503 KNOWLEDGE_INDEX_UNAVAILABLE`；
  本轮**未调用** `/api/v1/knowledge/chat`，因此不宣称上面任一种实际返回。
  本步中「客户登录」这一部分已实测为 `200`（`home=CUSTOMER`，见步骤 3）。

### 3.（客户）确认报修

- 操作：客户在服务页/我的报修中填写设备与故障描述（若使用 AI 生成草稿，草稿只作可编辑输入）
  → **人工确认后**提交报修。
- 预期结果：提交成功，报修单状态 `SUBMITTED`；「我的报修」列表出现该单，详情显示进度时间线。
- 前置数据：客户会话有效；App 提交时携带 `Idempotency-Key`，服务端据此对重试返回原单、不重复创建。
- 依据：`features/repair/RepairOrderForm.ets`、`RepairOrdersPage.ets`；接口 `/api/v1/repair-orders`
  （见 [Issue #37 工作记录](../work/issue-37-客户报修与进度查询.md)）。AI 建单只生成草稿，提交由人确认。
- 阶段2实测：客户 `100001` 原生登录 `200`（`home=CUSTOMER`）；`POST /api/v1/repair-orders`
  （带 `Idempotency-Key`）→ `201`，报修单 ID `a60bd281-960c-450b-ab37-f2c6b3d55db9`、`status=SUBMITTED`
  （开发库真实数据）。**App 页面提交未验证**（无设备）：本轮走的是原生 HTTP 通道，不是 App 页面。

### 4.（工作人员）登录并受理

- 操作：工作人员用 `100002 / staff123` 登录 → 工作人员入口 → 待受理队列 →
  打开步骤 3 的单据 → 受理。
- 预期结果：队列 `scope=unassigned` 可见该单；受理后状态 `SUBMITTED → ACCEPTED`，
  受理人姓名由服务端计算并回显；时间线新增一条受理事件。他人先受理时返回
  `409 REPAIR_ORDER_STATE_CONFLICT`（刷新后可见），本人重复受理幂等。
- 前置数据：步骤 3 的报修单存在且为 `SUBMITTED`。
- 依据：`features/repair/StaffRepairOrdersPage.ets`、`StaffRepairOrderDetailPage.ets`；
  [native-repairs-api.md](../../backend/docs/native-repairs-api.md) §报修处理。
- 阶段2实测：工作人员 `100002` 登录 `200`（`home=STAFF`、`roles=["MEMBER"]`、`memberStatus=ACTIVE`）；
  `GET /api/v1/staff/repair-orders?scope=unassigned` → `200`，队列 9 条且含该单、`actions.canAccept=true`；
  `POST …/{id}/accept` → `200`，`SUBMITTED → ACCEPTED`、`assignee.name=测试工作人员`、时间线 `events=2`。
  **未验证**：他人先受理的 `409 REPAIR_ORDER_STATE_CONFLICT` —— 演示账号只有一个工作人员账号
  （`100002`），本机无法制造「他人」；本人重复受理实测为**幂等**（`200`，仍 `ACCEPTED`，见步骤 13）。

### 5.（工作人员）推进处理进度

- 操作：在详情页把状态推到 `REPAIRING`，维修完成后推到 `COMPLETED`。
- 预期结果：两次推进各产生一条时间线事件；完成不要求备案已提交或通过
  （允许**先完成、后补备案**）。非法转换返回 `409 REPAIR_ORDER_STATE_INVALID`。
- 前置数据：同一单据处于 `ACCEPTED`；操作者是受理人本人或管理员。
- 依据：`POST /api/v1/staff/repair-orders/[id]/progress`；同上接口文档。
- 阶段2实测：`toStatus=REPAIRING` → `200`（`events=3`）；`toStatus=COMPLETED` → `200`（`events=4`），
  两次推进各产生一条时间线事件，且完成不要求备案已提交或通过。
  **非法转换的真实表现**（演示时请区分三者）：受理人本人或管理员把 `ACCEPTED` 直接跳到 `COMPLETED`
  → `409 REPAIR_ORDER_STATE_INVALID`（`报修单不能从 ACCEPTED 变更为 COMPLETED`）；
  但**未被受理的单**上没有受理人，任何 `MEMBER` 调 `progress` 会先被身份校验拦下，得到
  `403 REPAIR_FORBIDDEN`（`只有受理人或管理员可以推进该报修单`）而不是 409；
  传不在枚举内的 `toStatus`（如 `SUBMITTED`）→ `400 VALIDATION_FAILED`（`toStatus 参数无效`）。
  详见 [验证记录 §8](../verification/issue-42.md)。

### 6.（客户）查看变化

- 操作：客户回到「我的报修」下拉刷新，打开该单详情。
- 预期结果：处理状态变为 `COMPLETED`，时间线出现受理与推进事件；客户侧**不显示**受理人、备案关联
  或其他用户资料；备案审核不写入客户时间线。
- 前置数据：步骤 5 已推进到 `COMPLETED`。
- 依据：`features/repair/RepairOrdersPage.ets`；[native-repairs-api.md](../../backend/docs/native-repairs-api.md) §两套状态相互独立。
- 阶段2实测：客户令牌 `GET /api/v1/repair-orders/{id}` → `200`，`status=COMPLETED`，时间线 `events=4`
  （`null→SUBMITTED`、`SUBMITTED→ACCEPTED`、`ACCEPTED→REPAIRING`、`REPAIRING→COMPLETED`，与工作人员侧操作一一对应）；
  返回字段只有 `id,deviceModel,deviceSerial,faultDescription,contactPhone,status,createdAt,updatedAt,lastProgressAt,events`
  —— **不含 `assignee`、不含 `record`**，客户看不到受理人与备案关联；后续备案审核通过（`APPROVED`）
  也没有写入客户时间线（客户详情仍为 4 条事件）。

### 7.（工作人员）建档、上传照片并提交审核

- 操作：受理人本人在详情页「建立备案」生成草稿 → 填写维修日期/分类/内容/结果/备注 →
  上传一张真实照片 → 提交审核。
- 预期结果：建档返回 `201` + 备案草稿（`DRAFT`，机型从报修单预填且只读，**维修结果不预置**）；
  编辑保存走 `POST /api/v1/repairs/[id]` 别名（`version` 必须匹配，否则 `409 REPAIR_VERSION_CONFLICT`）；
  照片按文件头复核 MIME（JPEG/PNG/WebP），默认单张 ≤10 MB、最多 9 张；
  提交后 `DRAFT → PENDING`，缺少必填项时 `400 REPAIR_SUBMISSION_INCOMPLETE`（带 `fieldErrors`）。
  非受理人建档返回 `403 REPAIR_FORBIDDEN`。
- 前置数据：报修单已受理（受理人=当前用户）；`Idempotency-Key` 用于建档与提交。
- 依据：`features/repair/StaffRepairRecordPage.ets`、`PhotoPicker.ets`；[native-repairs-api.md](../../backend/docs/native-repairs-api.md) §维修备案。
- 阶段2实测（接口层，真实 HTTP）：
  - 建档 `POST /api/v1/staff/repair-orders/{id}/record`（受理人本人 + `Idempotency-Key`）→ `201`，
    `id=36fb4958-e7f7-43d3-9af4-ca09577459bb`、`status=DRAFT`、`deviceModel=ThinkPad T14 Gen3`（预填）、
    **`result=null`（未预置成功值）**、`version=1`。
  - `GET /api/v1/repairs/{id}` → `200`，`version=1`、`canEdit=true`、`photoLimits={"maxBytes":10485760,"maxFiles":9}`。
  - 保存草稿 `POST /api/v1/repairs/{id}` → `200`，`version 1 → 2`、`repairDate=2026-10-11`（上海日历日）、
    `durationMinutes=90`、分类 `散热 / 清灰`（`10000000-0000-4000-8000-000000000001`）；
    再用**旧版本号**写 → `409 REPAIR_VERSION_CONFLICT`。
  - 上传照片 `POST /api/v1/repairs/{id}/photos`（multipart、字段名 `photos`，真实最小 PNG）→ `201`，
    `photos=1`、`id=bb37b964-5802-44c7-9556-5efe0b81725b`、`mimeType=image/png`（按**文件头**校验）、70 字节；
    带会话读回 `GET /api/v1/repair-photos/{photoId}/content` → `200` `image/png`（首 8 字节 `89504e470d0a1a0a`），
    匿名读 → `401`。
  - 提交审核 `POST /api/v1/repairs/{id}/submit`（`Idempotency-Key` + `version`）→ `200`，
    `DRAFT → PENDING`。
  - **缺必填项**：对空草案直接提交 → `400 REPAIR_SUBMISSION_INCOMPLETE`，`fieldErrors` 5 项
    （`repairDate`/`categoryId`/`content`/`result`/`photos`）。
  - **其他真实边界**：未受理人建档 → `403 REPAIR_FORBIDDEN`；同一 `Idempotency-Key` 重放与同一报修单换键
    都返回**同一**备案 ID（状态码 `201`，不新建第二份）。
  - **未验证**：App 页面的相册选择与 `@ohos.net.http` multipart 实现（**无设备**）。

### 8.（管理员）审核备案

- 操作：管理员用 `100003 / admin123` 登录 → 工作人员入口 → 审核页待审核列表 → 通过。
- 预期结果：备案 `PENDING → APPROVED`（幂等键在**请求体**，同键同决定重放返回原结果）；
  审核结果不自动改变报修处理状态，也不发布知识库。备选演示退回：
  `REJECTED` 必须带原因（缺原因 `400 REPAIR_REJECTION_NOTE_REQUIRED`），
  工作人员可修改后重提（`REJECTED → PENDING`）。
- 前置数据：步骤 7 的备案为 `PENDING`。
- 依据：`features/repair/AdminRepairReviewPage.ets`；[native-repairs-api.md](../../backend/docs/native-repairs-api.md) §App 内审核。
- 阶段2实测：管理员 `100003` 原生登录 `200`（`home=STAFF`、`roles=["ADMIN"]`、`memberProfileId=null`）；
  `GET /api/v1/admin/repairs?status=PENDING&pageSize=50` → `200`，`meta.pagination.total=1` 且含该备案；
  `POST /api/v1/admin/repairs/{id}/reviews`，请求体 `{decision:"APPROVED", idempotencyKey:"…"}`
  （幂等键在**请求体**，与契约一致）→ `200`，`PENDING → APPROVED`、`reviewedAt=2026-10-11T14:35:58.697Z`；
  复审详情 `GET /api/v1/repairs/{id}` → `200`，`status=APPROVED`、`reviews=1`（审核人 `测试管理员`）、
  `canEdit=false`；同时 `GET /api/v1/staff/repair-orders/{orderId}` → `status=COMPLETED` 未变，
  证明**审核结果不自动改变报修处理状态**。
  **未验证**：备选的 `REJECTED` 退回、缺原因 `400 REPAIR_REJECTION_NOTE_REQUIRED`、退回后重提与
  `409 REPAIR_STATE_CONFLICT`（本轮只跑了通过路径）。

### 9.（作者或审核人员）标记典型

- 操作：在备案详情页（作者视角）或审核页「已通过」范围（审核人员视角）点「标记为典型案例」。
- 预期结果：标记调 `/api/v1/knowledge-cases/records/[id]/typical` 并**同步整理**
  （可能等待模型约 1 分钟，App 读取超时 90s）；返回 `status=PUBLISHED`、默认
  `caseVisibility=STAFF`；按钮只按服务端能力标记（`canMark/canUnmark/canRetry`）显示。
  不适格（非本人/非审核范围、备案未通过）返回 `409 CASE_RECORD_NOT_ELIGIBLE`；
  **模型侧失败不是 4xx**，而是 `status=FAILED` + `failureCode`
  （如未配置模型时 `MODEL_NOT_CONFIGURED`，可重试）。
- 前置数据：备案为 `APPROVED`；整理需要 `AI_API_KEY`（本机未配置 → 只能演示 `FAILED`）。
- 依据：`features/knowledge/TypicalCasePanel.ets`；[knowledge-cases-api.md](../../backend/docs/knowledge-cases-api.md) §3。
- 阶段2实测：**待补（阶段2b：需模型 Key）**。**本轮未执行**：本机 `backend/.env` 无 `AI_API_KEY`，
  标记典型预期以 `status=FAILED` + `failureCode=MODEL_NOT_CONFIGURED` 返回（非 4xx）；
  本轮未调用该接口、未触碰案例链路。

### 10.（工作人员）AI 自动整理与去重/相似合并

- 操作：再对一条材料**完全相同**的备案标记典型；再对一条**相似**备案（同机型/同类故障、
  措辞不同）标记典型；在案例库查看结果。
- 预期结果：完全重复的材料指纹命中 → 直接复用已有来源的案例（不再调用模型，重复标记幂等）；
  相似备案经候选预筛（bge-m3 余弦 ≥ `CASE_SIMILARITY_MIN` 默认 0.5）后由模型判 `merge` →
  合并进已有案例并保留**多来源证据**；不一致处由服务端按实际来源生成差异说明；
  `result` 由来源结果强制推导（全完成/全未完成/`MIXED`）；未写明的事实保持空值。
  案例库/详情页展示结构化正文、`sources[]`（逐条引用）与来源计数。
  单案例来源上限 8，超限合并被拒（`CASE_SOURCE_LIMIT`）。
- 前置数据：至少两条 `APPROVED` 备案（其一的材料与步骤 9 相同或相似）；模型与向量可用。
- 依据：`features/knowledge/CaseLibraryPage.ets`、`CaseDetailPage.ets`；
  [knowledge-cases-api.md](../../backend/docs/knowledge-cases-api.md) §4、§5。
- 阶段2实测：**待补（阶段2b：需模型 Key）**。**本轮未执行**：需要模型与向量可用，本机既无
  `AI_API_KEY` 也无 `EMBEDDING_API_KEY`；且前置的至少两条 `APPROVED` 备案中只有主链那一条是
  本轮产生，未构造相似/重复材料。

### 11.（工作人员）换一种问法检索命中新案例并打开多来源证据

- 操作：在知识问答用**另一种措辞**提同类问题（不要照抄备案原文）→ 打开回答中的案例引用。
- 预期结果：`answer` 且引用里出现案例块（`kind=case`）→ 引用详情展示案例结构化正文与
  **逐条来源证据**（多来源时逐条列出）；案例块 ID 为 `kcase_<caseId>_v<contentVersion>`，
  内容版本变化后旧引用打开返回 404 并提示重新检索。发布案例在查询时并入检索，
  **无需重建索引文件**。
- 前置数据：步骤 10 已发布 `PUBLISHED` 案例；检索可用（索引已构建）。
- 依据：`CitationDetailPage.ets`；[knowledge-cases-api.md](../../backend/docs/knowledge-cases-api.md) §6。
- 阶段2实测：**待补（阶段2b：需模型 Key）**。**本轮未执行**：前置的 `PUBLISHED` 案例与知识索引
  本机都不具备（`backend/data/knowledge/index/knowledge-index.json` 不存在，`knowledge:index` 未跑）。

### 12.（客户）权限边界：内部案例不可见

- 操作：客户用 `100001` 登录，检索同一问题；再尝试直接打开上一步的内部案例来源。
- 预期结果：客户检索**不命中** `STAFF` 案例（客户语料中不含 STAFF 块）；
  直接打开内部案例来源返回 `404`（与「不存在」同码，不泄露内部资料存在性）；
  客户用令牌访问工作人员接口返回 `403 FORBIDDEN`。
  备选：管理员把案例改为 `PUBLIC` 后，客户可命中并打开，且来源中 `authorName`/`repairRecordId`
  为 `null`（脱敏）；改回 `STAFF` 立即对客户失效。
- 前置数据：步骤 9/10 的案例为 `STAFF`；客户会话有效。
- 依据：[knowledge-cases-api.md](../../backend/docs/knowledge-cases-api.md) §2、§3、§6；
  [native-client-api.md](../../backend/docs/native-client-api.md) §角色与入口。
- 阶段2实测（部分）：
  - **已实测**「客户越权调接口」：客户令牌 `GET /api/v1/staff/repair-orders?scope=all` → `403 FORBIDDEN`、
    `GET /api/v1/admin/repairs?status=PENDING` → `403 FORBIDDEN`、
    `GET /api/v1/knowledge-cases` → `403 FORBIDDEN`（工作人员 `100002` 与管理员 `100003` 调
    `/api/v1/knowledge-cases` 均为 `200`）。客户详情 DTO 实测也不含受理人与备案字段（见步骤 6）。
  - **待补（阶段2b：需模型 Key）**：客户检索不命中 `STAFF` 案例、直接打开内部案例来源返回 `404`、
    管理员改 `PUBLIC` 后客户可见且 `authorName`/`repairRecordId` 脱敏为 `null` —— 这些都需要
    已发布案例与知识索引，本机都没有，本轮未执行。

### 13.（客户 / 管理员）失败场景（任选其一为主，其余为备选）

- 操作：
  - 主选 · **13c 纯管理员受理被拒**：用 `100003`（无成员档案的管理员）打开一条待受理单并点受理。
  - 备选 · **13a 无依据问答**：客户问一个资料未覆盖的问题（如「帮我把打印机墨盒换成彩色的」）。
  - 备选 · **13b 越权访问**：客户打开 `STAFF` 资料或内部案例来源；客户令牌调工作人员接口。
- 预期结果：
  - 13c → `403 MEMBER_REQUIRED`：管理员不能凭空成为受理人；同一账号仍可推进/取消任何报修单、
    审核备案，用来说明「工作人员 ≠ 管理员」。
  - 13a → `insufficient_evidence`：不给编造答案，可引导报修，且**不是** 5xx。
  - 13b → 内部资料/内部案例来源 `404`（与「不存在」同码，不泄露存在性）；越权调接口 `403 FORBIDDEN`。
- 前置数据：13a 需模型可用（无 Key 时退化为 `503 AI_NOT_CONFIGURED`，不能当作「资料不足」演示）；
  13c 只依赖权限判定，本机就能演示。
- 依据：[knowledge-cases-api.md](../../backend/docs/knowledge-cases-api.md) §6、§错误码；
  [native-repairs-api.md](../../backend/docs/native-repairs-api.md) §错误码补充。
- 阶段2实测：
  - **13c（主选）→ 已通过**：`100003`（纯管理员、无成员档案）对一条待受理单调 `accept`
    → `403 MEMBER_REQUIRED`（`需要有效成员身份`），**不是 500**；同一账号对**未被受理**的单调
    `record` 建档同样 `403 MEMBER_REQUIRED`；而**已有受理人**的单据，`100003` 调 `progress`
    可以成功推进（`200 REPAIRING`）—— 正好演示「管理员 ≠ 工作人员」。
  - **13b（备选）→ 已通过（接口层）**：客户令牌调工作人员 / 管理员 / 知识案例接口均为
    `403 FORBIDDEN`；写请求缺 `X-Client-Type` → `403 FORBIDDEN`（`请求来源无效`）。
    内部资料 / 内部案例来源的 `404` 属阶段2b（案例链路未跑）。
  - **13a（备选）→ 待补（阶段2b：需模型 Key）**：无 Key 时问答应为 `503 AI_NOT_CONFIGURED`，
    不能用它演示「资料不足」；本轮未调用 `/knowledge/chat`。

### 14. 构建通过（前后端）

- 操作：后端 `corepack pnpm lint`、`corepack pnpm test:unit`、`corepack pnpm build`
  （必要时 `corepack pnpm test:db`）；App 在英文路径执行 `assembleHap`。
- 预期结果：后端 lint 0 错误、单测与构建通过；HAP 构建以 `BUILD SUCCESSFUL` 结束。
  具体数字与输出**不预填**，按实测记录。
- 前置数据：依赖已安装；数据库可用（`test:db` 只写 `_test` 库）。
- 依据：[backend/README.md](../../backend/README.md) §开发范围与检查；[AGENTS.md](../../AGENTS.md)。
- 阶段2实测：
  - **App `assembleHap` → 已通过**（DevEco 在本机 `E:\DevEco Studio`，不是 D 盘）：
    `ohpm install` exit 0（末行 `install completed in 0s 132ms`，含 ohpm 启动实测 25.9 s）；
    `hvigorw --mode module -p product=default assembleHap` exit 0，末尾原文：
    `> hvigor Finished :entry:default@SignHap... after 3 ms`、
    `> hvigor Finished :entry:assembleHap... after 1 ms`、
    `> hvigor BUILD SUCCESSFUL in 1 min 20 s 971 ms`、
    `33 tasks in total: 17 executed, 16 up-to-date`（完整输出见
    [验证记录](../verification/issue-42.md) §2.6）。
    产物 `app/entry/build/default/outputs/default/entry-default-unsigned.hap`，**1 197 149 字节**。
    签名被跳过，原文 `WARN: Will skip sign 'hos_hap'. No signingConfigs profile is configured in current project.`
    → **未签名、未装机**（`hdc list targets` = `[Empty]`，无设备）。
    ArkTS 有 3 条 `Function may throw exceptions` 警告（非错误），构建仍成功。
    构建后工作区干净（`ohpm install` 改动的 `app/oh-package-lock.json5` 已还原）。
  - **后端 `lint` / `test:unit` / `test:db` / `build` → 引用指挥 2026-10-11 实测**：
    `lint` exit 0、`test:unit` 441/441、`test:db` 197/197、`build` exit 0。
    本轮**未复跑**：任务书禁止 `next dev` 与 `pnpm build` 同时运行（同一 `.next` 会互相破坏），
    而阶段2 需要 dev server 跑真实 HTTP 链路；因此这些数字是**引用**，不是本轮复现。

### 15. 材料核对

- 操作：按 §5 清单核对演示材料，确认完成状态、测试结果与四人贡献与实际一致。
- 预期结果：清单全部勾选，或未完成项明确留空并标注原因。
- 前置数据：前 14 步的实测记录。
- 依据：Issue #42 验收步骤第 5、6 条。
- 阶段2实测（部分）：后端健康检查、权限与失败场景、HAP 产物与演示数据清单均已按实际填写
  （见 §5 已完成勾选项）；**仍缺**：设备型号与系统版本（无设备，`hdc list targets` = `[Empty]`）、
  逐步截图 / 录像、四人实际贡献说明 —— 这三项保持「待补」，不以其他项替代。

## 4. 已知缺口与验收边界

**必须与演示材料一起声明的边界，不允许把下列内容写成已通过。**

1. **无设备 → 装机验收不成立**。`hdc list targets` 在阶段1 与阶段2 各实测一次，均为 `[Empty]`（无设备）。
   App 侧「登录 → 咨询与引用 → 确认报修 → 受理推进 → 建档照片 → 审核 → 标记典型 →
   案例检索与多来源证据」的**页面链路**只有代码、接口与构建证据，不能算装机验收。
   阶段2 已在**接口层**用真实 HTTP 跑通「确认报修 → 受理推进 → 客户查看变化 → 建档与照片 →
   提交审核 → 管理员审核 → 权限与失败场景」（逐条见 §3 各步的「阶段2实测」与
   [验证记录](../verification/issue-42.md) §2）；**但这仍是设备之外的验证，不替代装机**：
   未签名 HAP 构建成功也不等于可安装、可运行。
2. **模拟器不可用**。本机已部署 4 个模拟器机型配置（Mate X7、MateBook Pro、MatePad Pro 13、
   Pura 90 Pro），但**系统镜像目录不存在**（`.emu_config` 的 `imagePath`
   `C:\Users\MR\AppData\Local\Huawei\Sdk` 未创建），且该配置中两份协议为 `disagree`；
   模拟器**不能**用来替代装机验收。
3. **无签名材料**。阶段2 复测 `Test-Path "$env:USERPROFILE\.ohos"` 仍为 `False`，DevEco 未配置签名
   → 无法把 HAP 装到设备/模拟器；构建日志本身明确跳过签名
   （`WARN: Will skip sign 'hos_hap'. No signingConfigs profile is configured in current project.`），
   产物名即 `entry-default-unsigned.hap` → 「未签名 HAP 构建成功」只能作为**编译通过**证据。
4. **无模型 Key → 真实整理/向量能力在本机无法复现**。本机 `backend/.env` 未配置 `AI_API_KEY` /
   `EMBEDDING_API_KEY`（实测无任何 `AI_*`、`EMBEDDING_*` 键）：标记典型会以 `MODEL_NOT_CONFIGURED`
   如实失败，问答返回 `503 AI_NOT_CONFIGURED`，向量不可用时检索**降级为关键词**
   （接口如实返回 `retrievalMode: keyword`）。步骤 2、9–11 与 13a 的真实模型结果只能来自配置了
   DeepSeek `deepseek-flash` 与硅基流动 `BAAI/bge-m3` 的机器。
5. **知识索引未构建**。阶段2 复测 `backend/data/knowledge/index/knowledge-index.json` 仍不存在
   （索引机器相关、被 gitignore）；本轮**未跑** `knowledge:index`（无 `EMBEDDING_API_KEY`，且
   知识/案例链路属阶段2b）。未构建前问答与搜索预期返回 `503 KNOWLEDGE_INDEX_UNAVAILABLE`，
   案例检索同样不可用 —— 这是演示前必须补的前置，**不是功能缺陷**；
   本记录不宣称实际请求过 `/knowledge/*`。
6. **`backend/.env.local-admin` 缺失** → `tools/local-mysql.mjs` 不可用；当前 3308 实例已在监听，
   因此不需要启动（见 §2.1）。
7. **构建 ≠ 装机、接口 ≠ 页面**：阶段2 已确证 HAP 可构建（`BUILD SUCCESSFUL`）、业务主链在
   **接口层**可跑通；但构建成功 ≠ 装机运行正确，接口成功 ≠ App 页面真实可用。
   材料中必须把「接口实测」「编译通过」「装机运行」三者分开陈述。
8. **预期结果的性质**：§3 的「预期结果」来自接口契约与既有验证记录（#37/#38/#39/#40）；
   「阶段2实测」行是本机真实观察到的值（设备之外、无模型），两者来源不同，不可混用。
   模型链路（步骤 2、9、10、11、13a）与步骤 12 的案例部分在填入前一律为「待补」。
9. **范围**：只补本轮发现的问题及相关回归，不新增功能、不硬编码演示结果或用户身份。
10. **后端检查数字是引用，不是本轮复现**。`lint` / `test:unit` / `test:db` / `build` 的数字来自
    指挥 2026-10-11 实测；阶段2 未复跑（`next dev` 与 `next build` 不能同时运行，见 §3 步骤 14）。
    材料中引用时必须注明来源。
11. **只有一个工作人员账号 → 部分并发/冲突场景无法演示**。演示账号只有 `100002` 一个 `MEMBER`
    账号，因此「他人抢先受理 → `409 REPAIR_ORDER_STATE_CONFLICT`」「同一幂等键跨报修单复用
    → `409 IDEMPOTENCY_CONFLICT`」「并发抢审 `409 REPAIR_STATE_CONFLICT`」在本机无法复现；
    本人重复操作的幂等（`accept` / `progress`）已实测为 `200`。
12. **开发库遗留数据会影响演示观感**。开发库现有 11 条报修单（`SUBMITTED` 8 / `REPAIRING` 1 /
    `COMPLETED` 2），其中 8 条 `SUBMITTED` 是 #37/#38 里程碑遗留，**本轮未清理**（不清库、不破坏数据），
    故演示时待受理队列会比全新环境长（本轮 `scope=unassigned` 实测 9 条）。
    本轮新产生对象的 ID 与状态见 [验证记录](../verification/issue-42.md) §7。

## 5. 演示材料清单

未完成项留空并标注「待补」；只有整项完全达成才勾选，部分达成保持未勾选并写明缺哪一部分。

- [ ] 本地启动文档：[local-development.md](../../backend/docs/local-development.md)、[knowledge-ai.md](../../backend/docs/knowledge-ai.md)（含索引构建）、本指引 §2。
  —— **部分完成（未勾）**：§2.2 的 `db:health`、§2.4 的 dev server 与 `/api/v1/health` 已实测；
  §2.3 的 `knowledge:index` 仍**待补（阶段2b：需模型 Key）**。
- [ ] 演示数据：报修单/备案/案例的 ID 与状态清单（由 §3 流程实际产生，不预置）。
  —— **部分完成（未勾）**：报修单、备案与照片的 ID/状态已实测，见
  [验证记录](../verification/issue-42.md) §7；**案例 ID 待阶段2b**（案例链路未跑）。
- [ ] 设备信息：手机型号、系统版本、`hdc list targets` 输出（待补；本机无设备）。
  —— 阶段2 复测 `hdc list targets` = `[Empty]`，**无设备故无型号/系统版本可记**。
- [x] 应用包：HAP 路径与签名状态（未签名项要写明「未签名、未装机」）。
  —— 已完成：`app/entry/build/default/outputs/default/entry-default-unsigned.hap`，1 197 149 字节，
  **未签名、未装机**（构建日志 `Will skip sign 'hos_hap'`）。
- [ ] 截图/录像：按 §3 步骤逐项，文件名与步骤号对应。
  —— 待补：设备之外的链路未采集截图/录像。
- [ ] 四人实际贡献说明（与仓库提交、Issue 记录一致）。
  —— 待补。
- [x] 后端检查输出：lint / test:unit / build（必要时 test:db）的实际结果与数字。
  —— 已完成（**指挥 2026-10-11 实测**，阶段2 未复跑）：`lint` exit 0、`test:unit` 441/441、
  `test:db` 197/197、`build` exit 0。
- [x] 后端健康检查证据：`/api/v1/health` 返回内容。
  —— 已完成：`200` `{"success":true,"data":{"status":"ok","database":"reachable"},...}`（原文见 §2.4）。
- [ ] 失败场景记录（§3 步骤 13 的主选与备选实际表现）。
  —— **部分完成（未勾）**：主选 13c（`403 MEMBER_REQUIRED`）与备选 13b（越权/来源校验
  `403 FORBIDDEN`）已实测；备选 13a 仍待补（阶段2b：需模型 Key）。
  另附步骤 5/7/8 的冲突与缺项实测（`409` / `400`）。
- [x] 已知缺口与未验证项声明（§4 原文随材料提交）。
