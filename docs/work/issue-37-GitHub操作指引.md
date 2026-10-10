# Issue #37 认领与 PR 操作指引

> ⚠️ **本机无 GitHub 写凭据**（已实测：`gh` 未安装、无 Token、
> Windows 凭据助手 `manager` 在非交互环境下挂起不回）。
> **读操作正常**（`git ls-remote origin` 可通），所以**只有"写"的三步需要你操作**：
> ① 留认领评论 ② 推送分支 ③ 开 PR。
>
> 代码已全部写完并按 LF 规范提交在本地分支上，**工作区干净**，随时可推。

---

## 当前本地状态（已验证，2026-10-10）

| 项 | 值 |
| --- | --- |
| 本地分支 | `feat/issue-37-customer-repair-orders` |
| 提交 | `def53b9` feat(repair-orders): 客户报修提交、本人列表与进度查询 (#37) |
| 工作区 | 干净（无未提交改动） |
| 推送目标 | `origin` = `Sek1ro-oka/zafu-pchospital-harmonyos` |
| PR 目标 | `Xiaoyuan-114/zafu-pchospital-harmonyos` : `main` |

---

## 第一步：在 Issue #37 下留认领评论

打开 https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/37

复制以下内容贴到评论区：

```markdown
**认领 Issue #37（02 客户报修与进度查询）**

- 认领人：@Sek1ro-oka
- 开始时间：2026-10-10
- 分支：`feat/issue-37-customer-repair-orders`（个人 fork 提 PR）

**本次范围**：客户报修单的提交、本人列表、详情与进度查询。
新建 `RepairOrder` / `RepairOrderEvent` 模型，**不复用** `RepairRecord`
（备案是工作人员对象，与客户报修是两个东西）。#38 的工作人员侧留作后续。

**不包含**：照片上传、客户取消、工作人员受理 —— 分别留给 #38 或单开。

**当前状态**：后端 + App 已实现，单测 342/342、集成 8/8、真实 HTTP 链路 11 项全通过，
HAP 构建成功。PR 即将提交。

**请其他协作者注意**：本 Issue 已认领，如你也计划做客户报修请在此评论，
避免重复开发。
```

> 若仓库支持，建议同时把自己设为 **Assignee**（页面右侧 Assignees → 选自己）。

---

## 第二步：推送分支

代码已提交在本地，只差推送。**三种方式任选其一**：

### 方式 1（推荐）：你本机开个终端跑一条命令

在 `E:\zafu_ph` 目录下执行：

```bash
git push -u origin feat/issue-37-customer-repair-orders
```

会弹出 GitHub 登录窗口（或让你输入用户名 + Personal Access Token），
登录/粘贴后即完成推送。**这一步我这边做不了，因为凭据窗口需要真人交互。**

### 方式 2：给我一个 Token，我替你推

在 https://github.com/settings/tokens 生成 **classic token**，勾选：
- `public_repo`（若仓库是私有，改用 `repo`）

把 Token 贴给我，我用它**一次性**完成推送。凭据**只用于本次操作，不写入任何文件**，
用完你可以在 GitHub 上一键 Revoke。

### 方式 3：先把提交导出成补丁，你在别处应用

如果上面都走不通，我可以导出 `.patch`，你在有凭据的机器上 `git am` 后推送。

---

## 第三步：开 PR

推送成功后，GitHub 会在仓库页顶部显示 **"Compare & pull request"** 提示条，点它即可。
或直接打开：

```
https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/compare/main...Sek1ro-oka:zafu-pchospital-harmonyos:feat/issue-37-customer-repair-orders?expand=1
```

**PR 标题**：

```
feat(repair-orders): 客户报修提交、本人列表与进度查询 (#37)
```

**PR 描述**（直接复制）：

```markdown
Closes #37

## 做了什么

**后端** —— 新增客户报修单 `RepairOrder` 与进度事件 `RepairOrderEvent`，
与工作人员的维修备案 `RepairRecord` 完全分离（两者是不同业务对象）。

- schema 新增两模型 + 反向关系；迁移 `20261010061804_p2_issue37_repair_orders`
- `RepairOrderStatus` 独立枚举，不复用 `RepairStatus`
- `permissionsForRoles([])` 走 `customerPermissions`（无角色即客户，方案 B），
  **保持 #36 已验收的「客户 `100001` 的 `roles` 返回 `[]`」契约不变**
- 错误码 `REPAIR_ORDER_NOT_FOUND`(404) / `REPAIR_ORDER_STATE_INVALID`(409)
- `features/repair-orders/` 六个文件：validation / policy / repository / view / http / service
- 新增路由 `POST|GET /api/v1/repair-orders`、`GET /api/v1/repair-orders/[id]`

**App** —— `features/repair/` 新增契约 / 服务 / 表单 / 列表页四个文件，
新增 `ROUTE_REPAIR_ORDERS`，与工作人员 `ROUTE_REPAIR` 彻底分离。

- `ApiClient` 支持自定义请求头（`Idempotency-Key`）并透出服务端 `fieldErrors`
- 列表页含**加载中 / 空数据 / 失败可重试 / 有数据**四态
- 会话失效自动回登录页

## 顺带修掉的两个真实缺陷

1. **写接口的 CSRF 防线只认 Cookie 通道，把 App 原生请求全拒了**（实测 403
   `请求来源无效`）。鸿蒙 App 走 `Authorization: Bearer` 原生通道、**不发 `Origin`**，
   原有的 `assertSameOrigin` 必然失败。改为**按令牌来源分流**：
   Cookie 通道照旧 `assertSameOrigin`，Bearer 通道改用 `assertNativeClient`。
   判据是令牌来源而非有无 `Origin`（该头由请求方控制，不能当准入条件）。
2. `createWithEvent` 从**交互式回调事务**改为**数组式事务 + 事务外回读**，
   缩短连接占用、收窄失败面。

## 没做什么（留后续）

- 照片上传、客户取消、工作人员受理 → #38

## 验证证据

| 验证 | 方式 | 结果 |
| --- | --- | --- |
| 单测（全量） | `npx tsx --test "tests/unit/*.test.ts"` | **342/342 通过** |
| 单测（新增） | `repair-order-*` 两个文件 | 15/15 通过 |
| 集成测试 | `RUN_DB_TESTS=1 npx tsx --test tests/integration/repair-orders.test.ts` | **8/8 通过**（真实 MySQL） |
| HTTP 真实链路 | `curl --noproxy '*'` 走完整登录→提交→查询 | **11 项断言全通过** |
| Lint | `npx eslint <新代码>` | **0 错误 0 警告** |
| 类型检查 | `npx tsc --noEmit` | 仅剩上游既有 1 处（`native-auth.test.ts`） |
| HAP 构建 | `hvigorw assembleHap` | **BUILD SUCCESSFUL** |

HTTP 链路覆盖：登录拿 token ✓ / `roles` 仍为 `[]` ✓ /
`permissions` 含 `repair.order:create`+`read` ✓ / 提交 201 并写首条进度事件 ✓ /
列表 200 含该单 ✓ / 详情 200 ✓ / 无效输入 400 `VALIDATION_FAILED` 带 `fieldErrors` ✓ /
越权与不存在 404 `REPAIR_ORDER_NOT_FOUND` ✓ / 匿名 401 ✓ /
同 `Idempotency-Key` 幂等返回同一单 ✓ / 数据库行数逐行核对 ✓

## 待人工执行

- [ ] Previewer 目视走查提交与列表/详情（本机无鸿蒙设备，按既定决定不碰真机）
```

---

## 备选：如果你愿意提供 Token

在 https://github.com/settings/tokens 生成 **classic token**，勾 `public_repo`
（私有库用 `repo`；fine-grained 需勾 `Contents: Read and write` +
`Pull requests: Read and write`），贴给我，我就能代你完成**推送**，
并给出 PR 链接。凭据**只用于本次操作，不写入任何文件**，用完可一键 Revoke。
