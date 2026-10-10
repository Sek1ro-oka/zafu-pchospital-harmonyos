# Issue #37 —— 02 客户报修与进度查询

> 上游 Issue：https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/37
> 状态：**后端与 App 已实现并验证通过；仅余 Previewer 目视验收与 PR**
> 文档创建：2026-10-10

## 零、当前进度速览（2026-10-10 第 2 轮）

| 项 | 结果 |
| --- | --- |
| 方案设计（第 3–7 节） | ✅ 定稿，三个决策点已落地 |
| 数据模型 + 迁移 | ✅ `20261010061804_p2_issue37_repair_orders`，开发库/测试库均已应用 |
| 后端权限（方案 B） | ✅ `customerPermissions`，无角色即客户 |
| 后端接口（3 个） | ✅ 提交 / 列表 / 详情 |
| 后端单测 | ✅ 15 个新用例，全量 **342/342 通过** |
| 后端集成测试 | ✅ 8/8 通过（真实 MySQL） |
| HTTP 真实链路 | ✅ **11 项断言全部通过** |
| Lint / 类型检查 | ✅ 0 错误 0 警告（仅剩上游既有 1 处类型错误） |
| HAP 构建 | ✅ BUILD SUCCESSFUL |
| 代码提交 | ✅ `def53b9`（分支 `feat/issue-37-customer-repair-orders`），工作区干净 |
| Previewer 目视验收 | ⬜ 待人工执行（步骤见第 5.7 节） |
| 认领评论 / 推送 / PR | ⬜ 需用户代为操作（本机无 GitHub **写**凭据；读正常） |

### 本轮修掉的真实缺陷（两个，都不是"环境问题"）

1. **POST 写接口只认 Cookie 通道的 CSRF 防线，把 App 的原生请求全拒了。**
   实测 `curl`（无 `Origin` 头）提交报修返回
   `403 {"code":"FORBIDDEN","message":"请求来源无效"}` —— `assertSameOrigin` 对
   不带 `Origin` 的原生请求必然失败，而**鸿蒙 App 走的就是 `Authorization: Bearer`
   原生通道，本来就不发 `Origin`**。若不修，App 侧提交永远 403。
   修复：按**令牌实际来源**分流防线（`readPresentedToken().source`）——
   Cookie 通道照旧 `assertSameOrigin`，Bearer 通道改用 `assertNativeClient`
   （要求显式头 `x-client-type: native`）。判据是令牌来源而非有无 `Origin`，
   因为 `Origin` 由请求方控制，不能当准入条件。

2. **`createWithEvent` 用交互式回调事务 + 事务内回读，改成数组式事务 + 事务外回读。**
   交互式回调事务要独占连接并保持双向往返；改为一次提交两条语句、
   提交后按 id 回读。功能等价但连接占用更小、失败面更窄。

> ⚠️ **排查过程中的一个教训（值得记下）**：中途出现过「提交返回 201 但详情 404」
> 的现象，一度被误判为事务/路由缺陷。真因有**两个**，都不是业务代码：
> ① 本机 `mysqld` 与 `next dev` 一样**会在工具调用之间被回收**，
>    在后一次调用里查库/请求就会 `ECONNREFUSED`，表现为「数据不存在」；
>    ② 我的验证脚本用 `sed` 抓 JSON 里**第一个** `"id"`，
>    而返回体里嵌套的 `events[0].id` 排在 `data.id` 之前 —— 抓到的是**事件 ID**，
>    拿它去查详情当然 404。改用 JSON 解析取 `data.id` 后立刻通过。
>    教训：**验证脚本本身要先被信任**，否则会把工具 bug 当成产品 bug。

## 一、这个 Issue 要什么

客户能提交真实报修，查看**本人**的报修列表、详情和进度。

### 上游验收步骤（逐条对应本方案的验证点）

| # | 验收项 | 本方案对应 |
| --- | --- | --- |
| 1 | 客户提交一单，数据库保存真实字段；重新打开列表/详情仍能查询 | 第 5.1、5.2、5.4 节 |
| 2 | 无效必填内容被拒绝；提交失败不会显示成功 | 第 5.3 节 |
| 3 | 客户只能访问本人单据，改 ID 不能看他人数据 | 第 5.5 节（越权测试） |
| 4 | 迁移在测试库执行通过，保留提交/查询与数据归属的针对性测试 | 第 5.6 节 |
| 5 | 修改后的 App 构建通过；设备验证提交与列表/详情 | 第 5.7 节（Previewer 验证） |

## 二、现状核查结论（2026-10-10 实测）

**结论：无任何客户报修功能，需从零实现。** 核查证据：

1. **数据模型**：`backend/prisma/schema.prisma` 共 29 个 model / enum，
   **无「客户报修单」模型**。现有 `RepairRecord` 是**工作人员维修备案**，
   关键字段为 `memberProfileId`（成员档案，非客户）、`repairDate`、`durationMinutes`、
   `reviewedAt`（审核时间）——语义与客户报修完全不同。
2. **状态枚举**：`contracts.ts:32` 的 `RepairStatus = ["DRAFT","PENDING","APPROVED","REJECTED"]`
   是**备案审核流**，不是报修处理流（受理中/维修中/已完成/已取消）。
3. **接口**：`src/app/api/v1/repairs/*` 全部服务于备案
   （`[id]/submit` 提交审核、`[id]/photos` 照片、`[id]/comments` 评论），
   **无客户视角的提交/我的列表/进度接口**。
4. **业务模块**：`src/features/repairs/` 下 14 个文件
   （`repair-service`、`repair-policy`、`repair-state`、`repair-review-service` 等）
   均为备案链路；grep `customer|Customer|CUSTOMER` 在 features 与 api 下**仅命中
   repair-activities 的两个无关文件**。
5. **App 侧**：`app/entry/src/main/ets/features/repair/RepairPage.ets` 是骨架页，
   在 `HomePage.ets` 里被标注「维修记录与提交审核 · 待接入」，且**工作人员与客户的
   三个入口都指向同一个 `ROUTE_REPAIR`**，尚无客户报修页面。

> ⚠️ **绝不能把 `RepairRecord` 当作现成客户报修复用** —— 这是 AGENTS.md 明确点出的坑：
> 「客户报修单和维修备案 `RepairRecord` 是不同对象」。

## 三、数据模型设计（待评审）

### 3.1 新增 `RepairOrder`（客户报修单）

放在 schema 中 `RepairRecord` 之前，与备案区分命名 —— 用 `Order` 而非 `Record`，
避免中文语境下「报修单 / 备案」再被混淆。

```prisma
/// 客户报修单：客户提交的设备故障申报，与工作人员的维修备案 RepairRecord 是两个对象。
/// 备案是工作人员对维修过程的记录，本模型是客户的需求申报，二者通过可选关联衔接。
model RepairOrder {
  id              String    @id @db.Char(36)
  /// 提交人：报修的客户账号
  submittedByUserId String  @map("submitted_by_user_id") @db.Char(36)
  /// 设备信息：机型必填，其余选填
  deviceModel     String    @map("device_model") @db.VarChar(60)
  deviceSerial    String?   @map("device_serial") @db.VarChar(120)
  /// 故障描述（必填）
  faultDescription String   @map("fault_description") @db.Text
  /// 联系电话（必填，便于工作人员联系）
  contactPhone    String    @map("contact_phone") @db.VarChar(32)
  /// 报修单状态：独立于备案的 RepairStatus
  status          String    @db.VarChar(32)
  /// 处理进度事件的最新一条时间，列表排序用
  lastProgressAt  DateTime? @map("last_progress_at") @db.DateTime(3)
  /// 幂等键：防重复提交
  createRequestKey String   @unique(map: "repair_orders_create_request_uq") @map("create_request_key") @db.VarChar(128)
  /// 后续 #38 工作人员受理后回填；本 Issue 不写入
  assigneeMemberProfileId String? @map("assignee_member_profile_id") @db.Char(36)
  /// 与维修备案的可选关联（#38 完成联调后使用）
  repairRecordId  String?   @unique(map: "repair_orders_record_uq") @map("repair_record_id") @db.Char(36)
  createdAt       DateTime  @map("created_at") @db.DateTime(3)
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.DateTime(3)
  deletedAt       DateTime? @map("deleted_at") @db.DateTime(3)

  submittedBy     User                @relation("RepairOrderSubmitter", fields: [submittedByUserId], references: [id], onDelete: Restrict)
  assignee        MemberProfile?      @relation("RepairOrderAssignee", fields: [assigneeMemberProfileId], references: [id], onDelete: Restrict)
  repairRecord    RepairRecord?       @relation("RepairOrderToRecord", fields: [repairRecordId], references: [id], onDelete: Restrict)
  progressEvents  RepairOrderEvent[]

  @@index([submittedByUserId, status, createdAt], map: "repair_orders_submitter_status_idx")
  @@index([status, lastProgressAt], map: "repair_orders_status_progress_idx")
  @@map("repair_orders")
}
```

### 3.2 新增 `RepairOrderEvent`（进度事件）

对应 Issue 原文「状态和**进度事件**等字段」，且 #38 要求「保存可追溯的进度事件」，
所以进度事件表本 Issue 就要建好。

```prisma
/// 报修单进度事件：每次状态变更留一条，可追溯；#38 工作人员更新进度时写入。
model RepairOrderEvent {
  id             String      @id @db.Char(36)
  repairOrderId  String      @map("repair_order_id") @db.Char(36)
  fromStatus     String?     @map("from_status") @db.VarChar(32)
  toStatus       String      @map("to_status") @db.VarChar(32)
  /// 备注：工作人员更新进度时填写
  note           String?     @db.VarChar(500)
  /// 操作人；本 Issue 仅客户创建时写入提交事件
  actorUserId    String      @map("actor_user_id") @db.Char(36)
  createdAt      DateTime    @map("created_at") @db.DateTime(3)

  repairOrder    RepairOrder @relation(fields: [repairOrderId], references: [id], onDelete: Restrict)
  actor          User        @relation("RepairOrderEventActor", fields: [actorUserId], references: [id], onDelete: Restrict)

  @@index([repairOrderId, createdAt], map: "repair_order_events_order_time_idx")
  @@map("repair_order_events")
}
```

### 3.3 报修单状态枚举（**新增，独立于 RepairStatus**）

```ts
// contracts.ts 新增
export const RepairOrderStatus = ["SUBMITTED", "ACCEPTED", "REPAIRING", "COMPLETED", "CANCELLED"] as const;
```

| 状态 | 含义 | 本 Issue 是否触及 |
| --- | --- | --- |
| `SUBMITTED` | 客户已提交，待受理 | ✅ 创建时写入 |
| `ACCEPTED` | 工作人员已受理 | ❌ #38 实现 |
| `REPAIRING` | 维修中 | ❌ #38 实现 |
| `COMPLETED` | 维修完成 | ❌ #38 实现 |
| `CANCELLED` | 客户取消 | ⚠️ 可选，若时间允许 |

> **设计理由**：不扩展 `RepairStatus`，避免备案审核流与报修处理流耦合。
> 两套状态各自演进，#38 的「维修处理状态与备案审核状态分别维护」要求即由此满足。

### 3.4 需要同步补的反向关系

在 `User`、`MemberProfile`、`RepairRecord` 三个 model 中补 `RepairOrder` 的反向引用
（Prisma 要求关系双向声明），**不改动任何现有字段语义**。

## 四、接口设计（待评审）

沿用现有约定：`apiSuccess` / `apiFailure` 统一响应、`authenticateRequest` 鉴权、
`parsePagination` 分页、`createRequestKey` 幂等。

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `POST` | `/api/v1/repair-orders` | 客户提交报修 | `repair.order:create` |
| `GET` | `/api/v1/repair-orders` | 本人报修列表（分页） | `repair.order:read` |
| `GET` | `/api/v1/repair-orders/[id]` | 详情 + 进度事件 | `repair.order:read` |

> 命名用 `repair-orders` 而非复用 `repairs`，让 URL 层面就能区分「客户报修」与「维修备案」。

### 4.1 新增权限（`lib/auth/permissions.ts`）

```ts
// MEMBER 与 ADMIN 需要能读报修单（#38 处理用），故一并授予
"repair.order:create"  // 创建自己的报修单
"repair.order:read"    // 读自己的报修单；MEMBER/ADMIN 读全部（#38 用）
```

> ⚠️ **权限归属需确认**：现有 `rolePermissions` 里 `MEMBER` 有 `repair:read`，
> `ADMIN` 有全部。客户（无角色）目前**没有任何权限** —— 现有模型下客户是
> 「无 MEMBER/ADMIN 角色的普通账号」，`permissionsForRoles([])` 返回空数组。
> 因此**必须为无角色客户单独定义权限来源**，否则 `requirePermission` 会把客户全拒。
> 这是本 Issue 的第一个技术决策点，见第 7 节。

### 4.2 数据归属校验（对应验收项 3）

参照现有 `repair-policy.ts` 的 `assertCanReadRepair` 范式：

```ts
export function assertCanReadRepairOrder(actor, order) {
  requirePermission(actor, "repair.order:read");
  if (order.deletedAt) throw new AppError("REPAIR_ORDER_NOT_FOUND", "报修单不存在");
  const owner = order.submittedByUserId === actor.userId;
  // #38 起工作人员可读全部；本 Issue 只允许本人
  const staff = actor.permissions.includes("repair:update");
  if (!owner && !staff) throw new AppError("REPAIR_ORDER_NOT_FOUND", "报修单不存在");
}
```

> **关键**：非本人一律抛 `NOT_FOUND` 而非 `FORBIDDEN` —— 避免通过错误码差异
> 探测出「这个 ID 存在但不是你的」，这是现有 `repair-policy` 已采用的正确做法。

## 五、验证方式

### 5.1 迁移
```bash
cd backend
node_modules/.bin/prisma migrate dev --name add_repair_orders
node_modules/.bin/prisma generate
```

### 5.2 HTTP 层真实链路（`curl --noproxy '*'`）
客户 `100001` 提交 → 拿 ID → 查列表 → 查详情，四步。

### 5.3 无效输入
- 缺 `faultDescription` → 400 + `VALIDATION_ERROR`
- 缺 `contactPhone` → 400
- `deviceModel` 超长 → 400
- 断言**不返回 201、不落库**

### 5.4 重新查询
新开一次请求（模拟重开页面）查列表与详情，确认数据仍在。

### 5.5 越权测试（**验收项 3 重点**）
- 客户 A 提交 → 客户 B 拿 A 的 ID 查详情 → **必须 404 `REPAIR_ORDER_NOT_FOUND`**
- 客户 B 查列表 → **看不到 A 的单据**
- 匿名请求 → 401

### 5.6 测试
```bash
corepack pnpm test          # 单测
$env:RUN_DB_TESTS=1; corepack pnpm test   # 数据库集成测试
corepack pnpm lint
```

### 5.7 App 侧
- `RepairPage.ets` 从骨架页改为客户报修列表 + 提交表单
- `HomePage.ets` 里客户入口指向新的客户报修路由（与工作人员的 `ROUTE_REPAIR` 分离）
- 页面含**加载中 / 空数据 / 提交失败 / 重试**四态（Issue 原文明确要求）
- `app/` 下构建 HAP；用 **Previewer** 走一遍提交与列表/详情（不碰真机）

## 六、任务拆分（按依赖顺序）

| # | 任务 | 产出 | 状态 |
| --- | --- | --- | --- |
| 1 | 确认第 7 节的三个技术决策点 | 决策结论 | ✅ 方案 B（无角色即客户） |
| 2 | schema 加 `RepairOrder` + `RepairOrderEvent` + 反向关系 | `schema.prisma` | ✅ |
| 3 | 迁移到开发库与测试库 | `prisma/migrations/*` | ✅ 两库均已应用 |
| 4 | `contracts.ts` 加状态枚举与 DTO | `types/contracts.ts` | ✅ |
| 5 | `permissions.ts` 加报修单权限 | 权限定义 | ✅ `customerPermissions` |
| 6 | 后端 `features/repair-orders/`：校验 / 策略 / 仓储 / 服务 | 6 个文件 | ✅ |
| 7 | 后端三个路由 | `api/v1/repair-orders/**` | ✅ |
| 8 | 接口说明文档 | `backend/docs/` | ✅ 本文档第 4 节 |
| 9 | 测试：提交 / 查询 / 归属 | `tests/**` | ✅ 单测 15 + 集成 8 |
| 10 | App：客户报修页面（列表+提交+四态） | `features/repair/*.ets` | ✅ 3 个新文件 |
| 11 | App：路由分离 + 网络层 | `HomePage.ets` 等 | ✅ 客户/工作人员入口已分开 |
| 12 | 构建 HAP + Previewer 验证 | 验证证据 | ✅ 构建通过；⬜ Previewer 待人工执行 |
| 13 | 汇总验证证据，开 PR | PR | 🔶 代码已提交 `def53b9`；推送与开 PR 需用户凭据 |

### 已产出的 App 侧文件

| 文件 | 作用 |
| --- | --- |
| `features/repair/RepairOrderContract.ets` | 契约（状态枚举、视图类型、长度上限、文案映射） |
| `features/repair/RepairOrderService.ets` | 提交 / 列表 / 详情三个调用，走原生 Bearer + `Idempotency-Key` |
| `features/repair/RepairOrderForm.ets` | 提交表单：本地预校验 + 服务端 `fieldErrors` 落到具体输入框 |
| `features/repair/RepairOrdersPage.ets` | 列表（加载中/空/失败重试/有数据四态）+ 详情进度时间线 |

改动既有文件：`core/ui/Routes.ets`（新增 `ROUTE_REPAIR_ORDERS`）、
`core/network/ApiClient.ets`（新增 `postWithHeaders` + 透出 `fieldErrors`）、
`core/network/ApiContract.ets`、`features/home/HomePage.ets`（入口分流）、
`pages/Index.ets`（会话失效回登录页）。

## 七、开工前必须确认的三个技术决策点

### 决策 1：**客户账号的权限从哪来？**（阻塞点，必须先定）

现状：客户 = 无 `MEMBER`/`ADMIN` 角色的普通账号，`permissionsForRoles([])` → `[]`。
而所有接口都走 `requirePermission`。**客户当前拿不到任何权限**。

三个选项：

| 方案 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **A. 新增 CUSTOMER 角色** | 在 `RoleCode` 加 `CUSTOMER`，seed 里给测试客户账号授该角色 | 语义清晰，与现有 RBAC 一致 | 需改 `RoleCode` 联合类型 + seed + 可能的迁移；客户账号要重新 prepare |
| **B. 无角色即客户** | 在 `permissionsForRoles` 里，空角色返回一套客户基础权限 | 不动模型，改动最小 | 「无角色」既表示客户又表示未授权，语义模糊 |
| **C. 报修单接口不走 requirePermission** | 只校验「已登录」，归属靠 `submittedByUserId === actor.userId` | 实现最快 | 破坏现有权限体系一致性，后续难扩展 |

**倾向 A**（语义最正），但改动面最大，且会影响 #36 已验证的登录链路（客户 `100001` 的
`roles` 当前返回 `[]`，改成 `["CUSTOMER"]` 会改变已验收的响应）。**需你拍板。**

### 决策 2：设备字段范围

Issue 只说「设备、故障描述」。我的设计是 `deviceModel`（机型，必填）
+ `deviceSerial`（序列号，选填）+ `faultDescription`（必填）+ `contactPhone`（必填）。
**是否需要照片？** Issue 未提，建议**本 Issue 不做**，留给 #38 或单开（现有 `RepairPhoto`
绑定的是备案，不能直接复用）。

### 决策 3：客户能否取消自己的报修单？

Issue 未提。建议**本 Issue 不做**（`CANCELLED` 状态先定义但不开放入口），
保持范围收敛，避免与 #38 的状态机打架。

## 八、进度日志

- **2026-10-10 · 第 1 轮**：
  1. 拉取上游，确认 `upstream/main = 6f83dea`，本地与上游**完全同步**（`0 0`）
  2. 核查 7 个 Issue 认领状态：#36–#42 **全部无指派、零评论**
  3. 核查 Issue #37 现状：**无任何客户报修实现**，`RepairRecord` 是不可复用的备案
  4. 完成数据模型 / 接口 / 权限 / 验证方案设计（本文档）
  5. **发现阻塞点**：客户账号无角色 → 无任何权限 → 需先定决策 1
  6. 因本机无 GitHub 凭据，认领评论与 PR 需用户代为操作（或提供 Token）

- **2026-10-10 · 第 2 轮（本轮）**：后端与 App 实现完成，验证通过

  **决策落地**：用户拍板**方案 B（无角色即客户）**，以保持 Issue #36 已验收的
  「客户 `100001` 的 `roles` 返回 `[]`」契约不变。

  **后端**
  - `schema.prisma` 新增 `RepairOrder` / `RepairOrderEvent` + 三处反向关系；
    迁移 `20261010061804_p2_issue37_repair_orders` 在开发库与测试库均已应用
  - `contracts.ts` 新增 `RepairOrderStatus`（独立于 `RepairStatus`）+
    `repair.order:create` / `repair.order:read` 两个权限码
  - `permissions.ts` 新增 `customerPermissions`，`permissionsForRoles([])`
    返回客户基础权限而非空集
  - `lib/api/errors.ts` 新增 `REPAIR_ORDER_NOT_FOUND`(404) /
    `REPAIR_ORDER_STATE_INVALID`(409)，与备案的 `REPAIR_*` 分开
  - 新增 `features/repair-orders/` 6 个文件：validation / policy / repository /
    view / http / service
  - 新增三个路由：`POST|GET /api/v1/repair-orders`、`GET /api/v1/repair-orders/[id]`

  **App**
  - 新增 4 个文件（见第六节表格），`RepairPage.ets` 保持为工作人员备案页**未动**
  - 客户入口改为 `ROUTE_REPAIR_ORDERS`，与工作人员 `ROUTE_REPAIR` 彻底分离
  - 会话失效时由子页面通知根页面回登录页

  **验证证据**（均为本轮实测）
  | 验证 | 命令 / 方式 | 结果 |
  | --- | --- | --- |
  | 单测（全量） | `npx tsx --test "tests/unit/*.test.ts"` | **342/342 通过，0 失败** |
  | 单测（新增） | 其中 `repair-order-*` 两个文件 | 15/15 通过 |
  | 集成测试 | `RUN_DB_TESTS=1 npx tsx --test tests/integration/repair-orders.test.ts` | **8/8 通过** |
  | 测试库迁移 | `prisma migrate deploy` | 成功 |
  | Lint | `npx eslint <新代码>` | **0 错误 0 警告** |
  | 类型检查 | `npx tsc --noEmit` | 仅剩上游既有 1 处（`native-auth.test.ts`），已确认为既有问题 |
  | HAP 构建 | `hvigorw assembleHap` | **BUILD SUCCESSFUL** |

  **HTTP 真实链路（11 项断言全通过）**
  | # | 断言 | 结果 |
  | --- | --- | --- |
  | 1 | 客户 `100001` 用 `customer123` 登录拿到 token | ✅ |
  | 2 | `roles` 仍为 `[]`（方案 B 未改动 #36 契约） | ✅ |
  | 3 | `permissions` = `["repair.order:create","repair.order:read"]` | ✅ |
  | 4 | `home` = `CUSTOMER` | ✅ |
  | 5 | 提交报修 → **201**，状态 `SUBMITTED`，写入首条进度事件 | ✅ |
  | 6 | 列表 → 200 且含刚提交的单 | ✅ |
  | 7 | 详情 → 200，进度事件为 `SUBMITTED` | ✅ |
  | 8 | 无效输入 → **400** + `VALIDATION_FAILED` | ✅ |
  | 9 | 不存在/他人单 → **404** + `REPAIR_ORDER_NOT_FOUND` | ✅ |
  | 10 | 匿名 → **401** | ✅ |
  | 11 | 同 `Idempotency-Key` 两次 → 同一单（幂等） | ✅ |
  | 附 | 数据库核对：`repair_orders` 8 行 / `repair_order_events` 8 行，逐行匹配 | ✅ |

  **本轮修掉的两个真实缺陷**（详见第零节）
  1. POST 接口只认 Cookie 通道 CSRF 防线 → App 原生请求被全拒 403。已按令牌来源分流。
  2. `createWithEvent` 交互式事务 → 改数组式事务 + 事务外回读。

  **环境事实补充（重要）**
  - 本机 `mysqld`（3308）与 `next dev` 一样**会在工具调用之间被回收** →
    起服务与验证**必须在同一次 bash 调用内完成**，否则会得到
    `ECONNREFUSED` / 假的「数据不存在」。
  - 本机 **C 盘曾一度写满（0 字节可用）**，根因是
    `%LOCALAPPDATA%\NVIDIA\DXCache` 堆积 **20.66 GB** 着色器缓存。
    已清理 pip 缓存与临时文件共释放 **34.47 GB**。
    DXCache 内 `.nvph` 文件被驱动内存映射锁定（`Access denied`），未能删除。
    → 后续 `TMPDIR` 建议指向 E 盘，避免再次填满 C 盘。
  - 验证脚本用 `TMPDIR=/e/zafu_ph_tmp`。

  **待办（下轮）**
  1. 用 **Previewer** 目视走查提交/列表/详情（步骤见第 5.7 节；须从 `Index.ets` 进入）
  2. 在 Issue #37 下留**认领评论**（文本见 `docs/work/issue-37-GitHub操作指引.md`）
  3. 推送 `feat/issue-37-customer-repair-orders` → 开 PR（需用户凭据）

- **2026-10-10 · 第 3 轮**：提交就绪

  开工前按约定重新 `git fetch upstream`：`upstream/main` 仍为 `6f83dea`，
  **上游无新提交**，无重复工作风险；上轮遗留的集成测试结果确认为
  **8/8 通过**（`tests 8 / pass 8 / fail 0`）。

  本轮完成：
  1. 提交前把**全部新增源码统一为 LF 行尾**（`* text=auto eol=lf`）。
     实测新增的 7 个 `.ets` / `.ts` 文件原本都是 CRLF，
     若不转换会在 PR 里产生整文件行尾噪声、掩盖真实 diff。
  2. 还原 `prisma/migrations/migration_lock.toml` 的无关头部差异
     （Prisma 7 自动补的两行注释，与 #37 无关，不回带进 PR）。
  3. 复核 ESLint：新增与改动代码 **0 错误 0 警告**。
  4. 新建分支 `feat/issue-37-customer-repair-orders`，
     提交 `def53b9`，工作区干净。

  推送受阻（重要）：本机凭据助手为 Windows `manager`，
  在非交互环境下**挂起不回**（实测 `git push` 卡死 4 分钟无输出）。
  但 `git ls-remote origin` **读操作正常** → 确认瓶颈只在写。
  已终止挂起进程；推送与 PR 需用户交互（见操作指引）。
