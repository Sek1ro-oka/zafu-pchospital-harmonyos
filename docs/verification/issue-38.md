# Issue #38 验证记录：工作人员处理与维修备案

日期：2026-10-11。分支：`feat/issue-38-staff-repairs`（基点 `e2b79e0`，开工时最新 `origin/main`）。
后端在本机专用 MySQL（`127.0.0.1:3308`，`E:/codes/pchospital-local-mysql`）开发库上验证；
App 在英文路径副本 `E:/codes/pchospital-build/app` 构建未签名 HAP。**无真机/模拟器**。

## 1. 静态检查与测试（backend/）

```powershell
corepack pnpm lint        # 0 errors
corepack pnpm test:unit   # 397 pass / 0 fail（本轮新增：报修工作人员策略 7 项、写通道分流 5 项）
corepack pnpm test:db     # 177 pass / 0 fail（本轮新增集成文件 2 个、17 项；审查修复轮再增 2 项）
corepack pnpm build       # 生产构建通过（exit 0）
```

数据库测试经 `tools/db-task.mjs` 闸门运行，只写入 `_test` 库；本轮用标准脚本
`corepack pnpm db:migrate:test` / `db:migrate:deploy` 把 #37 的报修单迁移补到
本机测试库与开发库（此前两个库都缺该迁移，属环境状态，不是本轮引入）。

### 本轮新增的测试覆盖

- `tests/unit/repair-order-staff-policy.test.ts`：受理/推进/取消/建档的动作矩阵（受理人、其他
  工作人员、管理员、纯 ADMIN 无档案、终态）；状态机与任务书表格逐项一致。
- `tests/unit/request-origin.test.ts` 追加：`assertWriteAccess` 的 Bearer + 原生头放行、
  缺原生头拒绝、Cookie 优先（带原生头也不能跳过同源）、无凭证拒绝。
- `tests/integration/staff-repair-orders.test.ts`（11 项）：客户被拒、待受理/我负责/全部队列、
  重复受理幂等、他人受理 409、**并发抢单仅一人成功且仅一条受理事件**、推进/完成与客户
  时间线一致、非法转换（跳过受理、终态回退、维修中取消）、取消规则（管理员、必填说明、
  幂等）、纯 ADMIN 不能受理但可推进、详情允许动作、双通道来源校验、客户列表不泄漏内部字段。
- `tests/integration/staff-repair-records.test.ts`（6 项）：仅受理人建档、机型预填、结果不预置、
  关联原子完成、重复/换键/并发生成只一份且无孤立记录、编辑规则（版本冲突 409、非本人 403、
  管理员不能改别人草稿、POST 别名同权限）、照片链路（multipart 上传、鉴权读取字节一致、
  匿名 401、删除、无照片不能提交）、审核（普通工作人员 403、退回必填原因、幂等重放、
  退回→修改→重提→通过、通过后不可编辑、重复审核 409）、先完成再补备案、两套状态独立。

## 2. 真实 API 小链路（本机开发库 + `next dev --port 13080`）

一次性脚本串行调用真实 HTTP 接口（脚本未入库；关键步骤见文末 curl），24 项断言全部 PASS：

1. 三方原生登录：客户 100001、工作人员 100002、管理员 100003（**本机开发库新建的联调
   管理员账号**，无成员档案，只用于验证；未改动客户/工作人员账号）。
2. 客户建单 → 201 `SUBMITTED`；工作人员 `scope=unassigned` 队列可见。
3. 受理 → `ACCEPTED`（受理人姓名由服务端计算）→ `REPAIRING` → `COMPLETED`（完成后
   `canCreateRecord=true`，允许先完成再补备案）。
4. 建档（`Idempotency-Key`）→ `DRAFT`、机型预填、`result=null`；重复请求返回同一份。
5. `POST /api/v1/repairs/[id]` 编辑别名保存草稿（version 1→2）——App 因平台网络层
   没有 PATCH 而使用该入口，与 Web 的 PATCH 同一实现。
6. 真实 PNG（1×1，非占位 URL）multipart 上传 → 201；带 Bearer 读取字节一致；
   匿名读取 401。
7. 提交审核 → `PENDING`；管理员待审核列表包含该备案。
8. 管理员退回（带原因）→ `REJECTED`；工作人员修改后重提 → `PENDING`；管理员通过 → `APPROVED`。
9. 一致性：客户刷新看到处理状态 `COMPLETED` 与完整 4 条时间线；工作人员详情显示
   备案 `APPROVED` 而处理状态仍是 `COMPLETED`（两套状态独立）。
10. 权限反例：客户访问工作人员队列 403、普通工作人员审核 403、通过后本人再编辑
    409 `REPAIR_STATE_INVALID`。

复现关键步骤（管理员账号需先在本机 dev 库按 `tools/prepare-test-accounts.ts` 的
方式准备一个 ADMIN 账号）：

```bash
# 登录（示例，实际取 data.token）
curl -s -X POST http://localhost:13080/api/v1/auth/native/login \
  -H 'Content-Type: application/json' -H 'X-Client-Type: native' \
  -d '{"qq":"100001","password":"customer123"}'

# 客户提交报修（Idempotency-Key 防重复）
curl -s -X POST http://localhost:13080/api/v1/repair-orders \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" -H 'X-Client-Type: native' \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" \
  -d '{"deviceModel":"联调用机","faultDescription":"屏幕背光不亮","contactPhone":"13600136000"}'

# 工作人员受理并推进
curl -s -X POST http://localhost:13080/api/v1/staff/repair-orders/$ORDER_ID/accept \
  -H "Authorization: Bearer $STAFF_TOKEN" -H 'X-Client-Type: native' \
  -H 'Content-Type: application/json' -d '{}'
curl -s -X POST http://localhost:13080/api/v1/staff/repair-orders/$ORDER_ID/progress \
  -H "Authorization: Bearer $STAFF_TOKEN" -H 'X-Client-Type: native' \
  -H 'Content-Type: application/json' -d '{"toStatus":"REPAIRING"}'

# 建档与照片（multipart 字段名 photos）
curl -s -X POST http://localhost:13080/api/v1/staff/repair-orders/$ORDER_ID/record \
  -H "Authorization: Bearer $STAFF_TOKEN" -H 'X-Client-Type: native' \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" -d '{}'
curl -s -X POST http://localhost:13080/api/v1/repairs/$RECORD_ID/photos \
  -H "Authorization: Bearer $STAFF_TOKEN" -H 'X-Client-Type: native' \
  -F 'photos=@./sample.png;type=image/png'

# 提交与审核（审核幂等键在请求体）
curl -s -X POST http://localhost:13080/api/v1/repairs/$RECORD_ID/submit \
  -H "Authorization: Bearer $STAFF_TOKEN" -H 'X-Client-Type: native' \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" -d '{"version":2}'
curl -s -X POST http://localhost:13080/api/v1/admin/repairs/$RECORD_ID/reviews \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'X-Client-Type: native' \
  -H 'Content-Type: application/json' \
  -d '{"decision":"REJECTED","note":"补充步骤","idempotencyKey":"'"$(uuidgen)"'"}'
```

## 3. HAP 构建（英文路径副本）

```powershell
# 同步源码到副本后（robocopy /MIR，排除 oh_modules/build/local.properties）：
$env:DEVECO_SDK_HOME = 'D:/DevEco Studio/sdk'
$env:Path = 'D:/DevEco Studio/tools/node;' + $env:Path
& 'D:/DevEco Studio/tools/hvigor/bin/hvigorw.bat' --mode module -p product=default assembleHap
# => BUILD SUCCESSFUL；产物 entry/build/default/outputs/default/entry-default-unsigned.hap
```

编译期修复记录：平台 `@ohos.net.http` 的 `RequestMethod` 不含 PATCH（备案编辑改用
服务端 POST 别名）；`@Prop size` 与内置属性重名（改 `thumbSize`）；Builder 不能链式
调用；对象字面量需要显式声明类型。

## 4. 未验证范围（如实声明）

- **真机/模拟器**：`hdc list targets` 为 `[Empty]`，无设备。App 的登录→工作台→受理→
  备案→照片→审核完整页面链路未装机验证；加载/空态/失败/重试、快速切换详情、键盘遮挡、
  相册选择与 PixelMap 解码、multipart 在设备网络栈上的实际行为均**未验证**。
- 未签名 HAP 构建成功不等于装机成功；接口成功也不等于 App 页面真实可用。
- 照片上传/读取链路在服务端（Node fetch multipart）侧已验证；App 侧同上未验证。
- HTTP 明文在真机上的策略与上一里程碑相同，未复验。
- 客户报修页面（#37）本机行为未回归复测（本轮未改动其代码路径，后端单测/集成覆盖其接口）。

## 5. 环境与数据说明

- 本机 MySQL 专用实例（3308）本轮开始时未运行，用 `node tools/local-mysql.mjs start`
  启动；数据目录与既有配置未改动。
- 开发库新增联调管理员账号（QQ 100003，displayName「联调管理员」，无成员档案；
  口令为本地测试口令）。测试库与开发库均只应用了仓库内已有迁移，无新增迁移。
- 链路产生的测试单据留在本机开发库，不影响其他账号。

## 6. 审查修复轮（同日第二轮）

审查报告 `pchospital-pr50-review-20261011` 提出 7 类问题，逐条修复并补回归。复跑：
lint 0 错误、`test:unit` 397/397、`test:db` 177/177（+2）、后端 build exit 0、
HAP BUILD SUCCESSFUL（同副本、同上命令）。

### 修复内容

| # | 问题 | 修复 |
|---|---|---|
| 1 | 上传/删除照片整表重载覆盖未保存输入 | 照片操作后只做局部刷新（`load(true)`：更新照片/状态/版本，保留编辑缓冲）；保存/提交/上传/删除互斥（`isBusy`） |
| 2 | 审核 A 的迟到响应覆盖已打开的 B | 审核写请求绑定发起时的备案 ID 与详情代次；完成后仅在同一上下文改写 UI，否则只刷新列表 |
| 3 | 审核幂等键跨备案复用导致持续冲突 | 幂等键按备案 ID 隔离（Map）：不确定结果重试复用原键，换备案换新键，成功后作废 |
| 4 | 加载更多在刷新/切范围后永久锁死 | 两处列表 `load()` 新代开始时重置 `loadingMore`；旧代请求不再回写新代状态 |
| 5 | 机型可编辑但保存不发送（假编辑） | 编辑表单机型改为只读展示（取自报修单），去掉编辑缓冲；契约与 Web 原规则一致不含该字段 |
| 6 | 建档复用其他报修的幂等键返回错误备案 | 幂等回放校验「该键对应的备案必须已关联到当前报修单」，否则 409 `IDEMPOTENCY_CONFLICT` |
| 7 | 取消先提交时已取消单仍被新建关联备案 | 建档事务内重读订单状态/归属给出准确错误；关联条件更新限定受理人本人的 ACCEPTED/REPAIRING/COMPLETED，失败回滚不留孤立记录 |

### 修复轮的验证方式

- **后端（问题 6、7）**：`staff-repair-records.test.ts` 新增 2 项真实 MySQL 回归——
  「幂等键跨报修隔离」（复用 A 的键建 B → 409、B 无关联、键仍只对应 A）与
  「取消与建档并发」（独立连接先锁订单行、让建档请求在事务内重读处阻塞，期间把订单
  改为 CANCELLED 并提交 → 建档被 409 拒绝、无关联、无孤立记录）。
  **检测力验证**：把后端修复临时 stashed（旧代码）重跑，2 项均失败（正是审查复现的
  行为）；恢复修复后 8/8 通过。
- **App（问题 1–5）**：适配审查脚本的页面加载技术（vm 模拟平台依赖、执行真实页面方法），
  断言改为「修复后行为」，8 项检查（含写操作互斥加固项）。
  **检测力验证**：把 App 三处修复临时 stashed 重跑，7 项对应问题全部失败；恢复后 8/8 通过。
  这些检查只覆盖页面状态逻辑，**不代表真机 UI**。

### 修复轮后的未验证范围（更新）

- 以上 App 检查均为模拟依赖下的逻辑验证；真机/模拟器仍无设备（`hdc list targets` 空），
  相册选择、PixelMap 渲染、键盘遮挡、设备网络栈上的 multipart 行为与拍照上传后的
  图片展示仍**未装机验证**。
- 机型只读改为编译通过 + 逻辑检查，未做视觉确认。
