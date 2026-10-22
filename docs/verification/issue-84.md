# Issue #84：选购平台后端（验证记录）

2026-10-21。按 T84 任务书在任务工作树
`E:\zafu_ph\.worktrees\issue84-shopping-20261021`（分支 `feat/issue-84-shopping-20261021`，
基线 `main 2870955`）实施，Refs #84。**本轮只交付后端 P1+P2**：数据模型与迁移、游客可读的商品
浏览、商品发布/编辑/下架、商品图上传与公开读取、下单/订单列表/取消/完成、服务端权限与动作计算，
以及单测、数据库集成测试和真实 HTTP 演示。App 选购页面、HAP 构建与模拟器截图不在本轮范围，
留待下一轮接入本契约。第三轮（PR #89 审查修复）：编辑接口的库存与旧快照防护（`stock` 可选 +
`stockBase` 基线、二手订单锁定）、事务内幂等命中分支统一走 `replayOrder` 校验、新增
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
