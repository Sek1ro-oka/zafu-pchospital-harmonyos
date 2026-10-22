# Issue #84：选购平台后端 + App（验证记录）

2026-10-21。按 T84 任务书在任务工作树
`E:\zafu_ph\.worktrees\issue84-shopping-20261021`（分支 `feat/issue-84-shopping-20261021`，
基线 `main 2870955`）实施，Refs #84。第一轮交付后端 P1+P2：数据模型与迁移、游客可读的商品
浏览、商品发布/编辑/下架、商品图上传与公开读取、下单/订单列表/取消/完成、服务端权限与动作计算，
以及单测、数据库集成测试和真实 HTTP 演示。第二轮（同日晚）交付 App 选购页面并在模拟器完成
端到端验收，修复游客购买入口、商品卡图片点击、售罄标识与空底栏四处缺漏；App 部分见 §10。
第三轮（PR #89 审查修复）：编辑接口的库存与旧快照防护（`stock` 可选 + `stockBase` 基线、
二手订单锁定）、事务内幂等命中分支统一走 `replayOrder` 校验、新增
`POST + X-HTTP-Method-Override: PATCH` 兼容入口；本文 §1–§9 已按最终代码同步。
第四轮（PR #89 审查修复·PWVolcano 第三轮 P2）：把商品图配额复核移入建行事务，堵住并发上传
绕过每商品图片上限（8→10）的窗口；本文 §1、§5 已同步。

## 1. 基线与范围

- 未改动：`app/**`、维修/知识/社区既有业务、`prisma/seed.ts` 既有数据语义、`backend/.env`、
  部署脚本、主工作树 `E:\zafu_ph`。未 commit、未 push、未建 PR。
- 修改（tracked）：
  - `backend/prisma/schema.prisma`：`User` 增加商品/买入订单/卖出订单三条关系；新增
    `Product`、`ProductImage`、`ShoppingOrder`。
  - `backend/src/lib/api/errors.ts`：新增选购错误码与 HTTP 状态。
  - `backend/src/lib/auth/permissions.ts`：MEMBER 增加耗材维护；ADMIN 增加耗材维护与商品治理。
  - `backend/src/types/contracts.ts`：`Permission` 增加
    `shopping.consumable:manage`、`shopping.product:moderate`。
- 新增：
  - `backend/prisma/migrations/20261021120000_issue84_shopping/migration.sql`
  - `backend/src/features/shopping/`（types / validation / http / policy / repository / view /
    product service / order service / 商品图 storage 与 service，共 10 个文件）
  - `backend/src/app/api/v1/shopping/` 下 10 个路由文件
  - `backend/tests/unit/shopping-validation.test.ts`
  - `backend/tests/integration/shopping.test.ts`
- 迁移只 `CREATE TABLE` / 索引 / 外键，不改既有表；回滚需手工删三张新表（未写 down 脚本，
  与仓库现有迁移风格一致）。
- 第三轮（PR #89 审查修复）追加改动：`backend/src/lib/api/errors.ts`（新增
  `STOCK_CONFLICT`/`STOCK_ORDER_LOCKED`/`METHOD_NOT_ALLOWED`）、
  `backend/src/features/shopping/shopping-validation.ts`、`shopping-http.ts`、
  `shopping-repository.ts`、`shopping-product-service.ts`、`shopping-order-service.ts`、
  `backend/src/app/api/v1/shopping/products/[id]/route.ts`（新增 POST 兼容入口），
  以及 `backend/tests/unit/shopping-validation.test.ts`、
  `backend/tests/integration/shopping.test.ts` 增补；未改数据模型与迁移。
- 第四轮（PR #89 审查修复·图片配额事务）追加改动：`shopping-repository.ts`（`createProductImages`
  改为在同一 Serializable 事务内先复核有效图片数再建行，返回 `created`/`limit-exceeded` 结果）、
  `shopping-product-image-service.ts`（注入仓储切片 `ProductImageRepository`、事务外预检查保留为
  快速失败、事务内 `limit-exceeded` 在 `try` 内抛 `PRODUCT_IMAGE_LIMIT_EXCEEDED` 以复用文件清理），
  新增 `backend/tests/unit/shopping-product-image-quota.test.ts`，
  `backend/tests/integration/shopping.test.ts` 增补并发配额回归；未改数据模型、迁移与错误码文案。

## 2. 数据模型与迁移

三张表（MySQL，金额均为整数分，状态均为 `VARCHAR(32)`，不使用 Prisma enum/Decimal）：

- `products`：`title`、`description`、`price_cents`、`category`（`SECONDHAND`/`CONSUMABLE`）、
  `condition`、`stock`、`status`（`ON_SALE`/`DELISTED`）、`pickup_note`、`delist_reason`、
  `delisted_by`、`delisted_at`、`created_at`、`updated_at`、`seller_id`。
  索引 `(status, category, created_at)`、`(seller_id, created_at)`；`seller_id` 外键
  `ON DELETE RESTRICT`。
- `product_images`：`product_id`、`url`、`storage_key`（唯一）、`mime_type`、`size_bytes`、
  `sort_order`、`created_at`、`deleted_at`。索引 `(product_id, sort_order)`。
  `deleted_at` 是任务书字段外的补充：订单快照保存图片 URL，后续若提供移除图片能力，
  软删行可让历史订单的图片仍按 ID 读取，避免 404；**本轮没有删除商品图接口**，
  该列暂为后续扩展预留。
- `shopping_orders`：`product_id`、`buyer_id`、`seller_id`、`quantity`、`unit_price_cents`、
  `total_cents`、`title_snapshot`、`image_snapshot`、`status`
  （`PENDING_PICKUP`/`COMPLETED`/`CANCELLED`）、`cancel_reason`、`cancelled_by`、
  `idempotency_key`、`created_at`、`completed_at`、`cancelled_at`、`updated_at`。
  唯一 `(buyer_id, idempotency_key)`；索引 `(buyer_id, created_at)`、
  `(seller_id, created_at)`、`(product_id, created_at)`。
- 订单快照在创建时写入 `title/unit_price_cents/image_snapshot`，后续商品编辑、下架或换图
  都不回写订单；`total_cents = unit_price_cents × quantity`。
- 时间字段用 `@db.DateTime(3)`、`@map` 蛇形列名、显式索引名；外键全部 `RESTRICT`，
  避免删用户/商品时级联丢掉交易凭证。

迁移命令与结果：

```powershell
cd backend
npm run db:generate
npm run db:migrate:test      # pchospital_exp_local_test
npm run db:migrate:dev       # pchospital_exp_local
npx prisma migrate status
```

- `db:generate`：Prisma Client 7.10.0 生成成功。
- `db:migrate:test`：19 个迁移（含 `20261021120000_issue84_shopping`）全部应用，
  `All migrations have been successfully applied.`。
- `db:migrate:dev`：迁移已应用到开发库（`_prisma_migrations` 有记录，三张表已建）；
  本机该命令在应用完成后未自行退出（5 分钟超时转后台后终止），因此**不以退出码作为成功证据**，
  以 `prisma migrate status` 复核：`19 migrations found`、`Database schema is up to date!`。
- 测试库随后被集成测试反复使用；测试数据由 `shopping.test.ts` 的 `before/after` 清理，
  固定测试用户/商品 ID 不进入开发库样本。

## 3. API 契约

统一响应沿用仓库约定：成功 `{ success: true, data, meta: { requestId, pagination? } }`；
失败 `{ success: false, error: { code, message, fieldErrors? }, meta: { requestId } }`。
列表的 `data` 是数组，分页在 `meta.pagination`（`page/pageSize/total/totalPages`）。
`pageSize` 上限 100，`page` 从 1 开始。

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/shopping/products` | 游客 | 在售商品列表；`category`、`q`、`page`、`pageSize` |
| GET | `/api/v1/shopping/products/{id}` | 游客 | 商品详情；`DELISTED` 仍可读，带图片/卖家/状态/动作 |
| POST | `/api/v1/shopping/products` | 登录 | 发布；`sellerId` 服务端取登录人；耗材需权限 |
| PATCH | `/api/v1/shopping/products/{id}` | 登录 | 本人修改；仅在售；耗材另需权限。`stock` 可选：不传则库存不动；传则必须带 `stockBase`（见 §4.2） |
| POST | `/api/v1/shopping/products/{id}` | 登录 | 编辑兼容入口（API 24 客户端无 PATCH 枚举）：仅当请求头 `X-HTTP-Method-Override: PATCH`（值大小写不敏感）时委托给同一更新 handler（同一鉴权/校验/业务）；缺头或头值不是 PATCH 返回 405 `METHOD_NOT_ALLOWED` |
| POST | `/api/v1/shopping/products/{id}/delist` | 登录 | 本人或管理员；管理员下架必须带 `reason`（含本人商品） |
| POST | `/api/v1/shopping/products/{id}/images` | 登录 | multipart，字段名 `photos`，1–9 张 |
| GET | `/api/v1/shopping/product-images/{imageId}/content` | 游客 | 公开图片字节，`nosniff`，缓存 1 天 |
| GET | `/api/v1/shopping/me/products` | 登录 | 我发布的商品（含已下架），分页 |
| POST | `/api/v1/shopping/orders` | 登录 | `{productId,quantity>=1,idempotencyKey}`，201 |
| GET | `/api/v1/shopping/orders?role=buyer\|seller&status=` | 登录 | 我的购物订单 / 卖家订单，分页 |
| GET | `/api/v1/shopping/orders/{id}` | 登录 | 买家或卖家可见；第三人 404 |
| POST | `/api/v1/shopping/orders/{id}/cancel` | 登录 | 买家可不填原因；卖家必须 `reason` |
| POST | `/api/v1/shopping/orders/{id}/complete` | 登录 | 仅卖家；待取货→完成 |

商品详情与订单详情都由服务端计算动作并下发，客户端只渲染，不作为授权依据：

- 商品：`actions { canBuy, canEdit, canDelist, canUploadImages }`。
- 订单：`actions { canCancel, canComplete }`。

新增错误码（`backend/src/lib/api/errors.ts`）：

| code | HTTP | 场景 |
| --- | --- | --- |
| `PRODUCT_NOT_FOUND` | 404 | 商品不存在 |
| `PRODUCT_DELISTED` | 409 | 下单时商品已下架 |
| `OUT_OF_STOCK` | 409 | 下单时库存不足 |
| `SELF_PURCHASE` | 400 | 购买自己发布的商品 |
| `ORDER_NOT_FOUND` | 404 | 订单不存在或当前用户不是买卖一方 |
| `INVALID_STATUS` | 409 | 当前状态不允许取消/完成/编辑 |
| `STOCK_CONFLICT` | 409 | 编辑传 `stock` 时当前库存与提交的 `stockBase` 不一致（已被订单调整），需重新加载 |
| `STOCK_ORDER_LOCKED` | 409 | 二手商品已存在订单（任意状态），库存由订单链路管理，不接受手动改库存 |
| `METHOD_NOT_ALLOWED` | 405 | POST 兼容入口缺少或带了错误的 `X-HTTP-Method-Override: PATCH` 头 |
| `PRODUCT_IMAGE_LIMIT_EXCEEDED` | 400 | 单商品图片超过上限 |
| `PRODUCT_IMAGE_TYPE_UNSUPPORTED` | 415 | 非 JPEG/PNG/WebP，或魔数与声明类型不一致 |
| `PRODUCT_IMAGE_TOO_LARGE` | 413 | 单张超过 `UPLOAD_MAX_BYTES` |
| `PRODUCT_IMAGE_STORAGE_FAILED` | 500 | 落盘/读取失败（不泄露路径） |

请求校验失败沿用 `VALIDATION_FAILED` + `fieldErrors`（更新时传 `stock` 缺 `stockBase`
或基线非法，报 `fieldErrors.stockBase`）；未登录为 `UNAUTHENTICATED`；
无权限为 `FORBIDDEN`；幂等键复用为 `IDEMPOTENCY_CONFLICT`（409）。

## 4. 权限与状态机

### 4.1 权限

| 身份 | 能力 |
| --- | --- |
| 游客 | 商品列表、商品详情、商品图 |
| 登录用户（含客户） | 发布二手；买他人商品；查看本人买卖订单；本人商品编辑/下架；取消本人待取货订单 |
| 工作人员（MEMBER） | 上述全部 + 发布/编辑耗材（`shopping.consumable:manage`） |
| 管理员（ADMIN） | 上述全部 + 下架任意商品（`shopping.product:moderate`），管理员下架原因必填（含本人商品） |

- 工作人员身份不新造角色，沿用 MEMBER + 权限码；管理员不会因耗材权限自动成为工作人员，
  工作人员也不会自动获得管理员权限。
- 第三人写商品/订单由服务层拒绝：商品编辑/下架 403；订单详情、取消、完成按不存在处理
  （404 `ORDER_NOT_FOUND`），避免探测订单存在性。
- 公开卖家展示名取 `customerProfile.nickname ?? memberProfile.nickname ?? displayName ??
  "校园用户"`，不返回 `realName`/学号。

### 4.2 商品与订单状态

- 商品：创建 `ON_SALE`；下架 `ON_SALE → DELISTED`，终态，不提供重新上架。
  下架只影响新订单；既有 `PENDING_PICKUP` 订单仍可取消/完成，订单详情中的商品 `status`
  如实显示 `DELISTED`。
- 订单：创建 `PENDING_PICKUP`；卖家完成 → `COMPLETED`；买卖任一方取消 → `CANCELLED`。
  完成后不能再取消，取消后不能再完成；**重复取消返回 409 `INVALID_STATUS`，只有第一次条件更新
  成功才回补库存**。完成重复调用仍幂等返回原单。
- 库存口径：二手商品固定单件，发布缺省 `stock=1`，显式传大于 1 返回 400
  `fieldErrors.stock`；编辑只允许 0 或 1（0 表示已售出）。耗材允许 0..999，可多件下单，
  `condition`（成色/规格）可为空。取消回补后二手库存回到 1，不会超过 1。
- 编辑与库存调整分开（PR #89 审查 P1）：更新 body 的 `stock` 可选。**不传 `stock`**
  时库存完全不动 —— 编辑加载与保存之间发生下单/取消，旧表单快照也不会覆盖已扣减/回补的
  库存；**传 `stock`** 必须同时带 `stockBase`（客户端加载时看到的库存，整数 >= 0，缺失报
  `fieldErrors.stockBase`），服务端在 Serializable 事务内比对当前库存，不一致返回 409
  `STOCK_CONFLICT` 且不写入；写入条件为 `id + sellerId + status=ON_SALE + stock=stockBase`，
  与下单/取消事务互斥。SECONDHAND 商品只要已存在至少一笔订单（任意状态，含已取消），
  传 `stock` 一律 409 `STOCK_ORDER_LOCKED`，库存只由订单链路扣减/回补；耗材带正确基线
  的补货即普通编辑路径。
- 下单在 Serializable 事务内先做 `(buyer_id, idempotency_key)` 查询，再执行条件更新：
  `UPDATE products SET stock = stock - ? WHERE id = ? AND status = 'ON_SALE' AND stock >= ?`。
  影响 0 行则回读商品，区分 `PRODUCT_NOT_FOUND`/`PRODUCT_DELISTED`/`OUT_OF_STOCK`；订单与
  扣库存同一事务提交，不会出现“扣了库存没有订单”。
- 取消同样用条件更新：仅 `PENDING_PICKUP → CANCELLED` 成功（`count === 1`）才执行
  `stock = stock + quantity`；只改库存、不改商品状态，已下架商品不会因此复活。
- 同一 `(buyer_id, idempotency_key)` 并发由唯一索引兜底；输掉的事务整体回滚，捕获
  `P2002` 后回读原单返回。**事务内命中同键既有单的分支（仓储返回 `reserved=false`）
  与事务外查重一样，统一由服务层走 `replayOrder` 校验**（PR #89 审查 P2）：
  `productId/quantity` 必须与本次请求一致（`buyerId` 由查询键天然一致），一致才返回原单，
  不一致返回 409 `IDEMPOTENCY_CONFLICT`，同键不同参数的并发请求不会拿到他人商品的成功订单。

## 5. 自动测试

在 `backend/` 执行；`node_modules` 为指向主工作树的目录联接，未安装依赖、未改 `.env`。

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm run lint` | 通过 | `eslint .` 无输出 |
| `npm run test:unit` | **581 pass / 0 fail** | 含 `tests/unit/shopping-validation.test.ts` 11 例与新增 `tests/unit/shopping-product-image-quota.test.ts` 2 例（第四轮图片配额并发回归）；先运行 `node tools/ensure-doc-manifest.mjs` 补齐既有生成物 |
| `npm run test:db -- tests/integration/shopping.test.ts` | **17 pass / 0 fail** | 真实 MySQL `pchospital_exp_local_test`；第三轮增补 4 例审查回归（13–16），第四轮增补图片配额并发回归（17） |
| `npm run test:db`（全量） | 300 pass / 6 fail（共 306） | 6 个失败均为既有环境/测试库状态问题，见下 |

表中为第四轮（PR #89 审查修复·图片配额事务）落地后的重跑结果；本机以 `corepack pnpm <script>` 执行。

新增单测覆盖：字段归一化与长度/价格/库存边界、二手固定单件与耗材多库存/空成色、
PATCH 部分更新与清空 `pickupNote`、更新时 `stock` 可缺省 / 传 `stock` 必须带合法
`stockBase`（缺失、负数、非整数均报 `fieldErrors.stockBase`）、下单参数、列表参数、
展示名不取 `realName`、商品/订单动作、权限策略。

集成测试 17 例覆盖（1–12 为第一、二轮，13–16 为第三轮审查回归，17 为第四轮图片配额并发回归）：

1. 游客读列表/详情/商品图，写操作 401；
2. 普通用户发布二手成功且缺省库存 1、显式 stock=5 被 400 拒绝；工作人员发布耗材成功，
   普通用户发布耗材 403；
3. 非本人编辑/下架 403，管理员下架必须带原因（含本人商品）；
4. 商品图上传、类型/张数校验、公开读取、`nosniff`；
5. 下单扣库存并写入标题/单价/首图快照；
6. 买家/卖家订单列表与角色过滤、第三人 404；
7. 卖家完成、买家看到 `COMPLETED`；
8. 重复幂等键返回原单且不二次扣库存；
9. 自购、缺货、已下架、商品不存在；
10. 取消只回补一次、卖家取消必须带原因、下架商品取消后不复活、重复取消 409；
11. 取消/完成竞争、并发抢最后一件、并发同幂等键；
12. 耗材空成色、多件库存下单扣减与取消回补；
13. 编辑与下单/取消交错：卖家读取商品（快照 stock=1）后买家下单扣到 0，卖家只改标题
    （不传 stock）保存，库存保持 0；随后取消回补到 1，不出现翻倍；
14. 库存编辑防护：二手已存在订单（下单后、取消后）传 stock → 409 `STOCK_ORDER_LOCKED`
    且不写库存；耗材过期 `stockBase` → 409 `STOCK_CONFLICT` 且不写库存；带正确基线补货
    成功且库存为所传值；传 stock 缺 stockBase → 400 `fieldErrors.stockBase`；
15. 并发同幂等键不同商品：一单 201、另一单 409 `IDEMPOTENCY_CONFLICT`，库存只扣成功
    那笔，另一商品库存不变，两商品合计只落一单；
16. POST 兼容入口：`POST + X-HTTP-Method-Override: PATCH` 与 PATCH 同效（头值大小写
    不敏感），缺头/头值错误 → 405 `METHOD_NOT_ALLOWED` 且不改商品，第三人走该入口同样 403。
17. 商品图配额并发（第四轮，PWVolcano 第三轮 P2）：先铺满 8 张（上限 9），两个并发请求
    各传 1 张；事务外预检查都会读到 8 并通过，必须由建行事务内复核拦截其一。断言恰好一个
    201、另一个 400 `PRODUCT_IMAGE_LIMIT_EXCEEDED`，最终有效图片恰好 9 张（不得 8→10），
    且该商品图片行总数仍为 9（失败方不留孤儿数据库行）。

第四轮图片配额修复说明：审查指出 `countProductImages` 在建行事务外执行，初始 8 张时两次并发
各上传 1 张都读到 8 并通过 9 张上限，随后 `createProductImages` 只计算 `sortOrder`、不复核数量，
最终保存 10 张，多窗口/并发可绕过每商品资源配额。修复把「有效图片数配额复核 + 插入」放进同一个
Serializable 事务：事务内重新 `count`（只算 `deletedAt: null` 的有效行），`existing + rows.length
> maxFiles` 时返回 `limit-exceeded` 且不写入任何行；服务层在 `try` 内把它翻译成既有错误码
`PRODUCT_IMAGE_LIMIT_EXCEEDED`（消息不变），由既有 `catch` 删除本次已 `storage.put` 的文件，
不留孤儿文件。事务外的预检查保留为快速失败，但不再是唯一防线。新增单测
`tests/unit/shopping-product-image-quota.test.ts`（内存仓储 + 严格串行化建行事务复现 8→9 只成一、
失败方无孤儿文件；已达上限时事务外快速失败不落盘）与集成回归（上表 17）覆盖。

全量 DB 的 6 个失败与购物无关，未改相关代码：

- `customer-community.test.ts` 2 个：`KNOWLEDGE_INDEX_UNAVAILABLE`，本机缺
  `data/knowledge/index/knowledge-index.json`（需 `pnpm knowledge:index`）。
- `native-activities.test.ts` 3 个：测试库成员档案/账号状态导致 403 与期望 404/201 不符。
- `personal-profile.test.ts` 1 个：成员目录期望 1 实际 20，测试库已有其他数据，非干净库。

本轮没有宣称全仓 `tsc --noEmit` 全绿：它仍会报仓库既有的测试 `params` 泛型等类型错误；
shopping 新文件在改动时的单独检查未出现新错误。CI 以 lint + 单测为准。

## 6. 真实 HTTP 验证

### 6.1 环境与账号

- 本机 MySQL 9.6，`127.0.0.1:3308`，开发库 `pchospital_exp_local`。
- `PORT=13080 npm run dev`（Next.js，Ready in 9.3 s）。
- 账号由 `npm run accounts:prepare` 准备：
  - A：`100001 / customer123`，客户，发布二手；
  - B：`100002 / staff123`，工作人员（MEMBER），买家；
  - C：`100003 / admin123`，管理员。
- 原生登录：`POST /api/v1/auth/native/login`，请求头 `X-Client-Type: native`，
  body `{"qq":"100001","password":"customer123"}`，取 `data.token` 作 Bearer。
- 以下响应均为实际 curl 输出（UTF-8 原始文件在证据目录），为篇幅删去 `requestId` 等字段。
- 本地 dev 库保留了这两个演示商品与两笔订单作为课设样本；不是生产数据。

### 6.2 游客浏览

以下列表是同一商品在 **6.3 下单之后**的快照（库存已扣为 0；下单前为 1）。

```powershell
curl.exe -s --get "http://localhost:13080/api/v1/shopping/products" `
  --data-urlencode "category=SECONDHAND" --data-urlencode "q=显示器" `
  --data "page=1" --data "pageSize=10"
```

```json
{
  "success": true,
  "data": [{
    "id": "e6df485d-d5e0-4a0c-a3bd-ad4a952e326e",
    "title": "毕业季二手显示器",
    "priceCents": 12000,
    "category": "SECONDHAND",
    "condition": "9成新",
    "stock": 0,
    "status": "ON_SALE",
    "pickupNote": "东湖校区菜鸟驿站",
    "seller": { "id": "30000000-…-0001", "displayName": "测试客户" },
    "actions": { "canBuy": false, "canEdit": false, "canDelist": false, "canUploadImages": false }
  }],
  "meta": { "pagination": { "page": 1, "pageSize": 10, "total": 1, "totalPages": 1 } }
}
```

商品详情无需登录；上传图片后 `images`/`coverUrl` 返回公开地址：

```json
{
  "id": "e6df485d-d5e0-4a0c-a3bd-ad4a952e326e",
  "title": "毕业季二手显示器",
  "images": [{
    "id": "ca1adf50-8846-4698-b7df-d3cd029a51fb",
    "url": "/api/v1/shopping/product-images/ca1adf50-8846-4698-b7df-d3cd029a51fb/content",
    "sortOrder": 0
  }],
  "coverUrl": "/api/v1/shopping/product-images/ca1adf50-8846-4698-b7df-d3cd029a51fb/content",
  "actions": { "canBuy": false, "canEdit": false, "canDelist": false, "canUploadImages": false }
}
```

### 6.3 A 发布 → B 下单 → A 完成 → B 见完成

A 发布（`sellerId` 不接受客户端传值）：

```json
POST /api/v1/shopping/products
{ "title": "毕业季二手显示器", "description": "24 寸 IPS，无坏点，自提",
  "priceCents": 12000, "category": "SECONDHAND", "condition": "9成新",
  "stock": 1, "pickupNote": "东湖校区菜鸟驿站" }
```

B 下单：

```json
POST /api/v1/shopping/orders
{ "productId": "e6df485d-d5e0-4a0c-a3bd-ad4a952e326e", "quantity": 1,
  "idempotencyKey": "demo-complete-curl" }
```

```json
{
  "success": true,
  "data": {
    "id": "1bbfb5ec-6b3b-4b13-945d-b1f7a175bc91",
    "quantity": 1,
    "unitPriceCents": 12000,
    "totalCents": 12000,
    "titleSnapshot": "毕业季二手显示器",
    "imageSnapshot": null,
    "status": "PENDING_PICKUP",
    "buyer": { "id": "30000000-…-0002", "displayName": "测试工作人员" },
    "seller": { "id": "30000000-…-0001", "displayName": "测试客户" },
    "product": { "id": "e6df485d-…", "title": "毕业季二手显示器", "status": "ON_SALE" },
    "actions": { "canCancel": true, "canComplete": false }
  }
}
```

A 的卖家订单列表可见同一单，`actions.canComplete=true`；A 执行：

```json
POST /api/v1/shopping/orders/1bbfb5ec-6b3b-4b13-945d-b1f7a175bc91/complete
```

```json
{
  "id": "1bbfb5ec-6b3b-4b13-945d-b1f7a175bc91",
  "status": "COMPLETED",
  "completedAt": "2026-10-21T08:12:56.693Z",
  "actions": { "canCancel": false, "canComplete": false }
}
```

B 再查同一订单，`status` 为 `COMPLETED`，完成时间为上述同一值。买家 `actions.canCancel`
在完成后变为 `false`。

### 6.4 下单 → 卖家取消 → 库存回补

> 本节 curl 证据采集于审查收紧之前；商品 B 是当时创建的二手遗留样本（库存 2）。当前接口
> 二手发布固定单件，新的取消回归以 `stock=1` 在集成测试中覆盖（下单后 0、取消后 1、
> 重复取消 409 且库存仍为 1），文档 4.2 与测试清单已同步。

B 对商品 B（库存 2，3500 分）下单后，A 以卖家身份取消并附原因：

```json
POST /api/v1/shopping/orders/2aadbbe9-bb2d-4ddf-b420-9bbe891d3a66/cancel
{ "reason": "买家改约，卖家同意取消" }
```

```json
{
  "id": "2aadbbe9-bb2d-4ddf-b420-9bbe891d3a66",
  "status": "CANCELLED",
  "cancelReason": "买家改约，卖家同意取消",
  "cancelledBy": "30000000-…-0001",
  "cancelledAt": "2026-10-21T08:13:11.103Z",
  "actions": { "canCancel": false, "canComplete": false }
}
```

再次查询商品 B：`stock` 回到 `2`，`status` 仍为 `ON_SALE`；B 查订单看到 `CANCELLED`。
当前回归口径：二手 `stock=1` 下单后变 0，第一次取消回补为 1；再次取消返回 409
`INVALID_STATUS`，库存保持 1，不会二次回补。商品已下架时取消只回补库存、不会把商品改回在售。

### 6.5 三页请求/响应示例

**（1）我的购物订单**（买家 B）：

```powershell
curl.exe -s "http://localhost:13080/api/v1/shopping/orders?role=buyer&page=1&pageSize=10" `
  -H "Authorization: Bearer <B 的 token>"
```

```json
{
  "success": true,
  "data": [
    { "id": "2aadbbe9-…", "titleSnapshot": "毕业季护眼台灯", "totalCents": 3500,
      "status": "CANCELLED", "actions": { "canCancel": false, "canComplete": false } },
    { "id": "1bbfb5ec-…", "titleSnapshot": "毕业季二手显示器", "totalCents": 12000,
      "status": "COMPLETED", "actions": { "canCancel": false, "canComplete": false } }
  ],
  "meta": { "pagination": { "page": 1, "pageSize": 10, "total": 2, "totalPages": 1 } }
}
```

`status` 过滤同样支持，如 `?role=buyer&status=COMPLETED` 返回 1 笔。

> 示例中的商品 B 为审查收紧前创建的二手遗留样本，`stock=2` 只用于展示历史样本；
> 当前二手发布/编辑的上限为 1，耗材才允许多库存。

**（2）我发布的商品**（A，含已下架）：

```powershell
curl.exe -s "http://localhost:13080/api/v1/shopping/me/products?page=1&pageSize=10" `
  -H "Authorization: Bearer <A 的 token>"
```

```json
{
  "success": true,
  "data": [
    { "id": "9cb16bf0-…", "title": "毕业季护眼台灯", "priceCents": 3500, "stock": 2,
      "status": "DELISTED", "delistReason": "演示下架，历史订单仍可完成",
      "actions": { "canBuy": false, "canEdit": false, "canDelist": false, "canUploadImages": false } },
    { "id": "e6df485d-…", "title": "毕业季二手显示器", "priceCents": 12000, "stock": 0,
      "status": "ON_SALE",
      "actions": { "canBuy": false, "canEdit": true, "canDelist": true, "canUploadImages": true } }
  ],
  "meta": { "pagination": { "page": 1, "pageSize": 10, "total": 2, "totalPages": 1 } }
}
```

**（3）卖家订单**（A，按状态筛选）：

```powershell
curl.exe -s "http://localhost:13080/api/v1/shopping/orders?role=seller&status=COMPLETED&page=1&pageSize=5" `
  -H "Authorization: Bearer <A 的 token>"
```

```json
{
  "success": true,
  "data": [{
    "id": "1bbfb5ec-…",
    "titleSnapshot": "毕业季二手显示器",
    "buyer": { "displayName": "测试工作人员" },
    "status": "COMPLETED",
    "completedAt": "2026-10-21T08:12:56.693Z",
    "actions": { "canCancel": false, "canComplete": false }
  }],
  "meta": { "pagination": { "page": 1, "pageSize": 5, "total": 1, "totalPages": 1 } }
}
```

### 6.6 商品图上传与公开读取

```powershell
curl.exe -s -X POST "http://localhost:13080/api/v1/shopping/products/e6df485d-d5e0-4a0c-a3bd-ad4a952e326e/images" `
  -H "X-Client-Type: native" -H "Authorization: Bearer <A 的 token>" `
  -F "photos=@sample.png;type=image/png"
```

```json
{
  "success": true,
  "data": [{
    "id": "ca1adf50-8846-4698-b7df-d3cd029a51fb",
    "url": "/api/v1/shopping/product-images/ca1adf50-8846-4698-b7df-d3cd029a51fb/content",
    "sortOrder": 0
  }]
}
```

游客读取内容（无 Cookie/Bearer）：

```text
HTTP/1.1 200 OK
cache-control: public, max-age=86400
content-length: 68
content-type: image/png
x-content-type-options: nosniff
```

服务端先校验全部文件（大小、魔数、声明 `Content-Type`），再落盘到
`UPLOAD_PATH/products/xx/uuid.ext`，最后批量建行；任何一步失败都会删除已写文件。
`UPLOAD_PATH` 不允许等于工作区或位于 `public/` 下。

### 6.7 下架与历史订单

A 下架商品 B（本人可不填原因；管理员下架无论是否本人商品都必须填）：

```json
POST /api/v1/shopping/products/9cb16bf0-ec5c-4578-b20b-f87182722d7e/delist
{ "reason": "演示下架，历史订单仍可完成" }
```

响应 `status=DELISTED`、`delistReason` 为上述文本。游客再读该商品仍返回 200 与
`status: "DELISTED"`；该商品此前的取消订单仍可由买卖双方查看。A 在完成显示器订单后才上传
商品图，订单 `imageSnapshot` 仍为 `null`，可证明快照不随商品后续修改而改写。

## 7. 样本准备与本地运行

```powershell
cd backend
npm run db:generate
npm run db:migrate:dev          # 开发库
npm run accounts:prepare        # 100001/100002/100003 三个课设账号
PORT=13080 npm run dev
```

- 创建商品/下单/取消均通过上面的 HTTP 接口完成，不直接写库；课设样本可用 A 账号发布，
  B 账号下单，A 完成或取消，形成“在售 + 已完成/已取消 + 已下架”三种可演示状态。
- 商品图上传需要真实 JPEG/PNG/WebP；单张默认上限 10 MB，单商品默认 9 张，可用
  `UPLOAD_MAX_BYTES`、`UPLOAD_MAX_FILES_PER_PRODUCT` 调整；存储根目录用 `UPLOAD_PATH`
  （默认 `./storage/uploads`）。
- 测试库：`npm run db:migrate:test`、`npm run test:db -- tests/integration/shopping.test.ts`。
  测试要求 `RUN_DB_TESTS=1` 或通过 `npm run test:db` 触发，库名必须是 `pchospital_exp_*`，
  测试库必须 `_test` 后缀。
- 本地演示数据：商品 A `e6df485d-…`（在售、库存 0）、商品 B `9cb16bf0-…`（已下架、库存 2，
  审查收紧前的二手遗留样本）、订单 `1bbfb5ec-…`（COMPLETED）、`2aadbbe9-…`（CANCELLED），
  均只存在于本机开发库。

## 8. 未覆盖与遗留

- **App 未接入**：选购首页/详情/发布/图片预览/订单三页、HAP 构建、模拟器截图均属下一轮；
  本文只证明后端契约与行为，没有把页面占位当完成。
- 未做线上支付、配送、私信、议价、购物车、多卖家合单；线下付款取货。
- 全量 `npm run test:db` 的 6 个既有环境失败未修（知识索引缺失、测试库账号/成员档案状态、
  测试库非干净）；本轮只对购物链路和受影响权限负责。
- `npm run db:migrate:dev` 在本机应用成功后进程未自行退出，使用 `prisma migrate status`
  复核；共享部署时建议在 Linux 侧按部署文档执行 `db:migrate:deploy`。
- 商品图目前为本地磁盘存储；共享部署需要持久化 `UPLOAD_PATH` 或改对象存储，未在本轮实现。
- 本轮改动全部未提交；无 commit/push/PR。

## 9. 证据索引

原始响应在 `work/agent-tasks/T84-20261021/http/`（UTF-8），关键文件：

| 文件 | 内容 |
| --- | --- |
| `guest-list.json` | 游客分类/关键词列表，`meta.pagination` |
| `guest-detail.json` / `guest-detail-with-image.json` | 公开详情（上传前/后） |
| `product-a.json` / `product-b.json` | A 发布的两件商品 |
| `order1.json` / `order2.json` | B 的两笔下单 |
| `buyer-orders-all.json` / `buyer-orders-before.json` | 我的购物订单 |
| `seller-orders-before.json` / `seller-orders-completed.json` | 卖家订单 |
| `completed.json` / `buyer-order-completed.json` | 完成链路 |
| `cancelled.json` / `buyer-order-cancelled.json` / `product-after-cancel.json` | 取消与库存回补 |
| `image-upload.json` / `image-headers.txt` / `image-content.bin` | 商品图上传与公开读取 |
| `me-products.json` | 我发布的商品（在售 + 已下架） |
| `delisted.json` / `guest-detail-delisted.json` | 下架后游客仍可读 |
| `ids.json` | 四个演示对象 ID |

## 10. App 选购页面（第二轮，2026-10-21 / 22）

### 10.1 页面与路由

App 端在同一个功能分支接入第一轮后端契约，ArkTS / ArkUI 原生页面，未改
`backend/src/**` 与 `backend/prisma/**`。

| 页面 / 组件 | 文件 | 说明 |
| --- | --- | --- |
| 选购首页 | `app/entry/src/main/ets/features/shopping/ShoppingPage.ets` | 真实商品列表、分类筛选、本地搜索（只过滤已加载商品）、新上架 Swiper 横幅、四个入口（二手配件 / 维修耗材 / 我的购物订单 / 发布商品）、上滑分页加载、返回选购页自动刷新、空态与错误态；商品卡显示真实价格、分类、卖家与库存，`stock=0` 显示红色「已售罄」 |
| 商品详情 | `features/shopping/ProductDetailPage.ets` | 公开读取；按服务端 `actions` 显示购买 / 编辑 / 下架；购买底部弹窗（数量 1..min(stock,99)、合计、幂等键）；下架弹窗；游客显示「登录后购买」；售罄与已下架有独立文案 |
| 发布 / 编辑 | `features/shopping/ProductEditPage.ets` | 二手/耗材分类、价格（分转元）、库存、成色、描述、取货备注、0–9 张图片；提交后回详情 |
| 我的购物订单 | `features/shopping/OrdersPage.ets` | 全部 / 待取货 / 已完成 / 已取消筛选、加载更多；订单快照、取消订单二次确认 |
| 卖家订单 | `features/shopping/SellerOrdersPage.ets` | 复用订单列表，按卖家角色取数；确认完成二次确认 |
| 我发布的商品 | `features/shopping/MyProductsPage.ets` | 在售 + 已下架，入口发布新商品 |
| 商品图 | `features/shopping/ShoppingImage.ets` | 以公开接口取字节并解码 `PixelMap`，不把 API 基址/令牌拼进 URL |
| 服务层 | `features/shopping/ShoppingService.ets` / `ShoppingTypes.ets` | 列表/详情/发布/编辑/下架/下单/取消/完成；金额整数分；动作只读服务端 |

路由常量在 `core/ui/Routes.ets:20-24`：
`ROUTE_SHOPPING_GOODS_DETAIL`、`ROUTE_SHOPPING_GOODS_EDIT`、`ROUTE_SHOPPING_ORDERS`、
`ROUTE_SHOPPING_SELLER_ORDERS`、`ROUTE_SHOPPING_MY_PRODUCTS`。`HomePage` 增加对应
`destination` 分支与标题；游客浏览放行仍用字面量 `'shopping-goods-detail'`（避免
`guest-login-app.test.ts` 的 eval 符号表缺少新常量）。「我的」增加我的购物订单 / 我发布的商品 /
卖家订单三个入口。

游客在详情点「登录后购买」→ `HomePage.requestLogin(new LoginIntent())` → 登录成功后弹栈回到
原商品详情并刷新（`onShown` 递增 `shoppingRevision`），底部变为「购买」，可继续打开购买弹窗。

### 10.2 本轮修复（交接文档 §5.3、验收与审查发现）

| 编号 | 问题 | 处理 | 验证 / 证据 |
| --- | --- | --- | --- |
| A | 游客详情页无购买入口，与任务书「游客点购买 → 登录 → 续接」冲突 | 详情底栏在「在售且有库存、未登录」时显示「登录后购买」；`authenticated` 改为 `@Prop` 保持登录后同步 | `guest-buy-login-cta.jpeg` → `guest-buy-login-page.jpeg` → `guest-buy-after-login.jpeg`，登录后自动回原详情且出现「购买」，弹窗可打开 |
| B | 商品卡图片区点击被 `ShoppingImage` 的无条件 `onClick` 吞掉，只能点标题进详情 | 移除外层无条件 `onClick`，仅失败态的重试块注册点击 | 点击商品卡图片区成功进入商品详情（`product-detail.jpeg`，11:09） |
| C | 售罄商品列表仍显示「库存 0」，无售罄标识 | 列表卡显示红色「已售罄」；详情 meta 显示红色「已售罄」chip、底栏显示「该商品已售罄，等待卖家补货」；后端公开列表契约不变（仍返回 `ON_SALE` + `stock=0`） | `shopping-list.jpeg`、`sold-out-detail.jpeg` |
| D | 详情页无任何操作时渲染空白底栏白条 | A/C 补齐游客与售罄文案后所有详情状态都有内容；不再出现空底栏 | 同 A/C 截图 |
| E | `PATCH` 枚举在 API 26 才加入，工程 `compatibleSdkVersion` 为 24，旧系统上直接调用会失败 | ~~`ShoppingService.patch` 在 `http.RequestMethod.PATCH === undefined` 时抛 `CLIENT_UNSUPPORTED`，提示升级系统，不发空请求~~ **已被审查第二轮修复取代**：guard 方案会让 API 24 设备永远无法保存编辑，现改为 `POST` + `X-HTTP-Method-Override: PATCH` 兼容通道并删除 `CLIENT_UNSUPPORTED` guard，见 §10.8 A | 当时：API 26 模拟器编辑保存 `PATCH ... 200`（`edit-product.jpeg` → `edit-saved-detail.jpeg`）；API 24 未实测 |
| F | 逐张上传图片失败后重试会把已成功的图片再传一遍，进度计数恒为 0 | 每成功一张即 `pendingImages = images.slice(i + 1)` 并累计 `uploaded`，重试只处理剩余图片 | 代码修复；模拟器相册为空，未做设备上传复验 |
| G | 切换分类/刷新时若上一轮「加载更多」未结束，`loadingMore` 会保持 true，之后上滑不再加载 | `reload()` 开头重置 `loadingMore = false` | 代码修复；构建与自动化检查通过 |

### 10.3 交接文档 §5.3 三个疑点定性

1. **卡片图片区浅蓝底上的白色商品名文字**：不是布局或占位 bug，文字是测试商品图自身的内容
   （上传的浅蓝底设计图里带标题与规格）。`ShoppingImage` 只渲染解码后的 `PixelMap`，没有在
   图片上叠加文字；同一张图在「我发布的商品」缩略图中显示相同文字。
2. **售罄商品仍出现在「最新上架」**：保留在列表中（公开列表按 `ON_SALE` 返回，含 `stock=0`），
   通过「已售罄」标识而不是隐藏商品来如实表达；如需过滤应由产品决定，本轮未改后端契约。
3. **列表页底部说明文案被底栏遮挡**：非 bug。页面初始视口下文案位于悬浮 TabBar 后方，
   向上滚动后完整可见（`shopping-list-bottom-copy.jpeg`，11:13），底部留白 96 与 note 一致。

### 10.4 设备端到端验证

环境：本机 MySQL 3308 开发库 `pchospital_exp_local`，`PORT=13080` 的 Next.js dev，
模拟器 `T83Nav`（1256×2760），App 连接设置 `http://10.205.195.4:13080`；账号
`100001/customer123`（客户）、`100002/staff123`（工作人员）。

主流程（截图时间为设备时钟，主机时间 Playwright 同日 22:58–23:13）：

1. 客户在「测试打印纸整箱」（卖家测试工作人员，¥25.50，库存 3）购买 2 件，合计 ¥51.00，
   下单单号 `d5e62ba0-de5d-487c-a0ca-4ddadd6747e2`，状态 `PENDING_PICKUP`；列表页可见；
   API 复核库存 3 → 1。
2. 客户在「我的购物订单」取消该单（二次确认「取消后库存会回补」），状态 `CANCELLED`；
   API 复核库存回到 3。
3. 再下 1 件（`88e67162-9483-47d6-a553-95b155bb93f5`，库存 2）；切换工作人员，在「卖家订单」
   点「确认完成」，状态 `COMPLETED`，完成时间 2026-10-21 23:02（UTC 15:02:55.638）；切回客户，
   「我的购物订单」显示「已完成」与完成时间。
4. 游客浏览列表 / 详情正常；游客在详情点「登录后购买」→ 登录页 → 登录后回原详情，
   出现「购买」并可打开购买弹窗。
5. 「我的」三入口（我的购物订单 / 我发布的商品 / 卖家订单）均可达，报修与备案入口未受影响；
   工作人员选购页底栏显示「工作台」，页面与客户一致。
6. 编辑复验（主机 2026-10-22 00:15–00:28，设备重启后时钟 12:27–12:28）：工作人员从
   「我的 → 我发布的商品 → 测试打印纸整箱 → 编辑」进入编辑页（`edit-product.jpeg`），
   未改字段直接保存，后端记录
   `PATCH /api/v1/shopping/products/6015255a-8f49-4dff-bf04-1c93e687b7d9 200 in 149ms`，
   App 返回详情且字段一致（`edit-saved-detail.jpeg`）。该步验证编辑通道与详情回显；
   字段变更持久化由 `shopping.test.ts`「修改与下架」覆盖。

设备链路落库复核（`work/agent-tasks/T84-20261021/http/`）：`app-device-orders.json` 显示
三笔订单（CANCELLED `d5e62ba0…`、COMPLETED `88e67162…`、CANCELLED `dae5dc07…`）及商品
`stock=2`；`app-device-edit.log` 为编辑 PATCH 200 的后端日志。

接口错误/幂等分支（curl，原生 `x-client-type: native` + Bearer）：

- 数量 5 > 库存 2：`OUT_OF_STOCK`「库存不足」。
- 下架商品（`1cbf498a-9bf7-4fa2-b9b3-6989bde68e21`）下单：`PRODUCT_DELISTED`「商品已下架」。
- 同幂等键（`native-order-t84-idem`）重试：返回同一单 `dae5dc07-5588-4fcd-8836-be9745772bc3`，
  库存只扣一次（2 → 1）；同键改数量 2：`IDEMPOTENCY_CONFLICT`；取消后库存回补 2。

### 10.5 构建与自动化检查

- HAP（本机签名）`entry-default-signed.hap`：3,820,403 字节，
  SHA256 `75254a8c3d623a8cf2a1a82f3f76b3ea7100611b70460ff44a3de3cde6d365cd`；
  构建命令：`hvigorw clean assembleHap --mode module -p product=default --no-daemon`
  （`DEVECO_SDK_HOME=E:/DevEco Studio/sdk`），`BUILD SUCCESSFUL in 1 min 25 s 166 ms`
  （日志 `work/agent-tasks/T84-20261021/hap-build-app.log`）。
  签名使用主检出 `app/build-profile.json5` 的本地调试证书，构建后已还原该文件，不进入提交。
- `pnpm lint`：通过（exit 0）。
- `pnpm test:unit`：**578 pass / 0 fail**。
- `pnpm test:db`（全量）：**301 tests / 295 pass / 6 fail**；其中
  `tests/integration/shopping.test.ts` **12/12 通过**。6 个失败均为第一轮已记录的既有环境/测试库
  状态问题，未修改相关代码：
  - `customer-community.test.ts` 2 个：`KNOWLEDGE_INDEX_UNAVAILABLE`，本机缺
    `data/knowledge/index/knowledge-index.json`；
  - `native-activities.test.ts` 3 个：测试库成员档案/账号状态导致 403/404 与期望不符；
  - `personal-profile.test.ts` 1 个：成员目录期望 1 实际 20，测试库非干净库。
- `pnpm build`：通过（exit 0，`✓ Compiled successfully in 14.0s`，Next.js 15.5.25）。
- 备注：以上四项在审查修复（§10.2 E/F/G）落地后按最终代码重跑，日志为
  `work/tmp/lint-final.log`、`unit-final.log`、`test-db-final.log`、`pnpm-build-final.log`；
  构建前已停止本机 dev，未与 `pnpm build` 并行。

### 10.6 未完成 / 风险（如实记录）

- **商品图片上传未在设备验证**：模拟器相册为空、拍照瓦片无响应，发布时只能无图提交；
  图片上传/公开读取已由第一轮 curl 与集成测试覆盖，App 端图片选择与预览仍需实体设备或
  有照片的模拟器复验。§10.2 F 的「失败后只重试剩余图片」因此只有代码审查，没有设备复验。
- **编辑功能与系统版本**（已按审查第二轮修复，见 §10.8 A）：原实现直接使用
  `http.RequestMethod.PATCH`（API 26 新增）并在低版本抛 `CLIENT_UNSUPPORTED`，
  导致 API 24 设备「进得去编辑页但永远保存不了」。现已改为 `POST` +
  `X-HTTP-Method-Override: PATCH` 请求头（POST 枚举与自定义头在所有支持的
  API 版本可用），客户端不再有版本 guard；该通道为代码级兼容修复，
  设备端验证（API 26 模拟器回归 + 后端委托入口联调）由指挥在 §10.8 之后统一补做。
- 共享后端 `native/login` 实测 13.9–21.6 s，超过 App 默认 8 s 超时；设备验收全部走本机 13080。
  dev 模式首次访问新路由需按需编译，发布后首次进详情出现过两次「连接超时」，重试/二次进入即恢复，
  非接口错误。
- 模拟器安全键盘弹出时 `snapshot_display` 全黑，取登录页截图需先收起键盘；不影响功能。
- 未做购物车、议价、私信、线上支付、配送；订单为线下付款取货。
- 截图均为模拟器证据，无实体手机验证。

### 10.7 截图索引

| 文件 | 内容 | 设备时间 |
| --- | --- | --- |
| `shopping-list.jpeg` | 选购列表（游客；含「已售罄」标识） | 11:09 |
| `product-detail.jpeg` | 商品详情（点击图片区进入） | 11:09 |
| `product-publish-form.jpeg` | 发布商品表单 | 11:11 |
| `order-confirm-sheet.jpeg` | 下单确认弹窗（数量 1，合计 ¥25.50） | 11:10 |
| `buyer-orders.jpeg` | 我的购物订单（已完成 + 已取消） | 11:04 |
| `seller-orders-pending.jpeg` | 卖家订单（待取货） | 11:02 |
| `seller-orders-completed.jpeg` | 卖家订单（已完成） | 11:02 |
| `guest-buy-login-cta.jpeg` | 游客详情「登录后购买」 | 11:09 |
| `guest-buy-login-page.jpeg` | 点击后进入登录页 | 11:10 |
| `guest-buy-after-login.jpeg` | 登录后回原详情，出现「购买」 | 11:10 |
| `sold-out-detail.jpeg` | 售罄详情（chip + 底栏文案） | 11:10 |
| `staff-shopping.jpeg` | 工作人员视角选购页（底栏「工作台」） | 11:12 |
| `shopping-list-bottom-copy.jpeg` | 列表滚到底部，说明文案完整可见 | 11:13 |
| `edit-product.jpeg` | 编辑商品页（工作人员，保存前） | 12:27 |
| `edit-saved-detail.jpeg` | 保存后返回商品详情，字段一致 | 12:28 |

前 13 张为设备时钟 11:0x–11:13；模拟器重启后时钟变为 12:27–12:28，用于编辑复验。

### 10.8 审查第二轮修复（PR #90 CHANGES_REQUESTED，2026-10-22）

上游审查对 App 侧提出四项 P2，按下表修复（仅改 `app/entry/src/main/ets/**`；
后端兼容入口由 #89 分支的另一位写手按同一契约同步实现）。

| 编号 | 审查意见 | 处理 | 验证状态 |
| --- | --- | --- | --- |
| A | `ShoppingService.ets:190`：`http.RequestMethod.PATCH` 是 API 26 枚举，工程 `compatibleSdkVersion` 为 24，`CLIENT_UNSUPPORTED` guard 使 API 24 卖家永远保存不了编辑 | `updateProduct` 改走 `ApiClient.postWithHeaders`：`POST /api/v1/shopping/products/{id}` + 请求头 `X-HTTP-Method-Override: PATCH`，由服务端把带该头的 POST 委托给同一更新 handler（鉴权/校验一致）。删除私有 `patch` 方法、PATCH 枚举引用与 `CLIENT_UNSUPPORTED` guard；POST 枚举与自定义请求头在所有支持的 API 版本可用 | 代码级兼容（逐行自查类型与导入）；API 26 模拟器回归与后端委托入口联调由指挥随后统一构建 HAP 后补做 |
| B | 编辑保存无条件覆盖 `stock`，会吞掉编辑期间的下单扣减 | `ShoppingProductPatch` 增加可选 `stockBase`；编辑页加载时记录 `loadedStock`，提交时库存未改则不传 `stock`/`stockBase`，改了则同时传目标值与基线；保存成功后基线推进到当前输入。服务端 409（`STOCK_CONFLICT` / `STOCK_ORDER_LOCKED`）的 message 经现有 `formError` 机制显示在表单 | 代码级；409 冲突链路待后端 #89 入口合并后联调，由指挥设备复验 |
| C | `ProductDetailPage.ets:86`：下单结果未知（超时/网络错误）时关闭弹层再打开会无条件生成新幂等键，可能重复下单 | 新增 `@State pendingIntent: PendingOrderIntent \| null`（key + productId + quantity 快照）。`confirmBuy`：存在匹配本商品的快照则复用原 key 与数量；成功或服务端明确拒绝（业务错误码，如 `OUT_OF_STOCK`）→ 清空快照；`NETWORK_ERROR` / `UNEXPECTED_RESPONSE`（结果未知）→ 写入快照并提示「下单结果未确认，重试将复用同一请求」。弹层重开时若有匹配快照：数量步进器禁用并显示锁定提示，确认按钮文案改「重试同一请求」，另提供「查看我的订单」入口（`ROUTE_SHOPPING_ORDERS`）确认原请求结果；确认前不允许换数量或另起新键 | 代码级；断网/超时场景需设备模拟器复验（指挥随后补） |
| D | `ProductEditPage.ets:495`：新发布成功只设 `savedId`，上传失败后删光待传图片再点按钮会再次 `createProduct`，产生重复商品 | `submit()` 以 `existingId = productId !== '' ? productId : savedId` 区分创建/编辑/上传恢复：`existingId` 非空一律走更新 payload（含 B 的库存规则）+ `uploadPending(existingId)`，仅 `existingId` 为空才 `createProduct`。`savedId` 存在且待传图片为空时按钮文案为「完成并返回」，路径与 `uploadPending` 空列表直接 `onSaved` 一致，不再重复建品 | 代码级；「发布→上传失败→删图→完成」链路待设备复验（模拟器相册为空，图片上传仍未设备闭环，见 §10.6） |
| E | `ProductEditPage.ets:222`：无 `aboutToDisappear` 代次检查，离开页面后迟到的 createProduct/upload 成功回调仍执行 `onSaved`，HomePage 无条件 pop 会弹掉用户新开的页面 | 新增 `private disposed: boolean`，`aboutToDisappear` 置 true；`loadExisting` / `submit` / `uploadPending` / `retryUpload` 中每个 await 之后、以及 `onSaved` / `onSessionExpired` / toast / 上传循环继续前检查 `disposed`，已离开则静默返回（不导航、不失效会话、不再上传），`finally` 中的状态复位同样受保护 | 代码级；「上传中返回再开新页」竞态需设备复验 |

本节修复后的 HAP 构建、模拟器操作证据与后端 `X-HTTP-Method-Override` 入口联调
由指挥统一执行后补充；§10.2 E 行与 §10.6「编辑功能与系统版本」条目已同步修正，
不再描述 `CLIENT_UNSUPPORTED` guard。

### 10.9 审查第三轮修复（PR #90 CHANGES_REQUESTED，2026-10-22）

上游审查对 App 侧再提出两项 P2，按下表修复（仅改 `app/entry/src/main/ets/**`；
本轮按维护者安排不构建 HAP、不做模拟器操作）。

| 编号 | 审查意见 | 处理 | 验证状态 |
| --- | --- | --- | --- |
| A | 未决下单意图只存 `@State`，跨详情实例丢失：订单已落库而响应丢失 → 返回选购（详情出栈销毁）→ 重进同商品重试会生成新幂等键，建出第二笔订单 | 新增 `features/shopping/PendingOrderStore.ets`：与 `ApiConfig` 同一 preferences 私有库（`pc_hospital_app`），值为 JSON 记录数组，每条含 `userId + baseUrl + productId + key + quantity + savedAt`，查找时 **账号 + 服务器 + 商品** 三元组全等才命中（换账号 / 换服务器 / 退出登录的记录自然不可见），读取或解析失败降级为无记录。`ProductDetailPage.confirmBuy` 在**发出 createOrder 之前**写入持久记录（内存 `@State` 快照仍供同实例使用）；只有结果确认（下单成功、服务端明确业务拒绝、会话失效类确定拒绝）才清除，`NETWORK_ERROR` / `UNEXPECTED_RESPONSE` 保留并重写兜底。`aboutToAppear` 与 `refreshVersion` 变化（登录返回 / 订单页返回）时恢复命中记录：复用原 key、锁定原数量，弹层维持「重试同一请求」+「查看我的订单」 | 代码级 + 沙箱回归（见下）；丢响应→返回列表→重进→重试的设备链路**待模拟器复验（本轮按维护者安排未做设备操作）** |
| B | `await createOrder` 后直接调用 `onOpen`：详情无 `aboutToDisappear` / 请求代次 / 会话快照检查，离开页面后迟到的成功回调仍会把当前页导航到订单页，迟到的会话错误仍可能触发 `expireSession` | `ProductDetailPage` 增加 `disposed` 标志 + `aboutToDisappear()`（与 `ProductEditPage` 同款写法）；`confirmBuy` / `reload` / `confirmDelist` 每个 await 之后检查 `disposed`，已销毁则不导航、不 `expireSession`、不 toast、不更新任何 `@State`（持久化意图的写入 / 清除除外——用 `aboutToAppear` 缓存的宿主 Context 执行，独立于 UI 生命周期）。会话绑定：`SessionService` 新增公开 `sessionStamp()`（会话代次 + userId），写请求发出前记录快照，回调时快照不一致（退出 / 换账号 / 重新登录）整份丢弃。请求发出前页面已销毁 / 会话已变时不发请求并回收刚落盘的记录 | 代码级 + 沙箱回归（见下）；延迟下单时返回并打开另一页的设备竞态**待模拟器复验（本轮按维护者安排未做设备操作）** |

沙箱回归：沿用仓库 `*-app.test.ts` 的「真实 `.ets` 源码 → 转译 → 沙箱 eval」做法，
执行 `ProductDetailPage.confirmBuy / restorePendingIntent / openBuy / aboutToDisappear`
与真实 `PendingOrderStore`（preferences 为内存假实现），5 个场景全部通过
（脚本 `work/tmp/pending-order-r3-check.mjs`，不进仓库）：

1. 订单落库但响应丢失 → 详情销毁 → 新实例恢复意图 → 重试复用 `key-1`，服务端仅一笔订单，记录清除；
2. 离开页面后迟到的成功回调不导航，持久记录仍被清除（独立于 UI 生命周期）；
3. 会话更换后迟到的成功回调不导航、迟到的 `AUTH_SESSION_EXPIRED` 不触发 `expireSession`；
4. 服务端明确拒绝（`OUT_OF_STOCK`）清除记录，允许换新键重新下单；
5. 记录按 账号 + 服务器 + 商品 三元组隔离，换任一维度读不到。

自动化检查（backend/，最终代码）：`corepack pnpm lint` 通过（exit 0）；
`corepack pnpm test:unit` **579 pass / 0 fail**（含 eval `SessionService.ets` 全源码的
`native-auth-app.test.ts`，新增 `sessionStamp()` 未破坏既有用例）。
HAP 构建与模拟器复验由指挥统一执行后补充。
