# Issue #37 认领与 PR 操作指引

> **第二步（推送分支）已完成** ✅ —— 远端 `Sek1ro-oka/zafu-pchospital-harmonyos` 上
> `feat/issue-37-customer-repair-orders` = `1ba250d`，本地远端一致，工作区干净。
>
> **剩下 2 步需要你跑一条命令**（`gh` 已装好，但未登录；本机确实无存量凭据）：
> ① 在 Issue #37 留认领评论 ② 开 PR。
> 两步已合并进 `issue37-finish.sh`，跑它就行 —— `gh` 会自己弹浏览器让你登录，
> 之后评论与 PR 全自动完成。**或者**按下面两步手动做。

---

## 当前状态（2026-10-10 核对）

| 项 | 值 |
| --- | --- |
| 本地分支 | `feat/issue-37-customer-repair-orders` |
| 提交 | `def53b9` 实现 + `1ba250d` 文档 |
| 工作区 | 干净（无未提交改动） |
| 推送状态 | ✅ **已推送**，远端 = `1ba250d`，与本地一致 |
| 推送目标 | `origin` = `Sek1ro-oka/zafu-pchospital-harmonyos` |
| PR base | **上游 `main`**（`Xiaoyuan-114/zafu-pchospital-harmonyos`），已验证是本分支祖先 |
| 剩余待办 | ① 认领评论 ② 开 PR |

---

## 一键完成（推荐）

打开 Git Bash，执行：

```bash
bash /e/zafu_ph_tmp/issue37-finish.sh
```

脚本会：① 检测 `gh` 登录（未登录则弹浏览器，你粘贴一次性验证码即可）
→ ② 在 Issue #37 下发出认领评论 → ③ 用 `base=上游main` 开 PR 并打印链接。

> 脚本与正文材料同时备份在 `E:\zafu_ph_tmp\` 下，被清掉可重新生成。

---

## 手动方式（若不想用脚本）

### 第一步：在 Issue #37 下留认领评论

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

## 第二步：推送分支 ✅ 已完成

已于 2026-10-10 完成。远端核对：

```
$ git ls-remote origin refs/heads/feat/issue-37-customer-repair-orders
1ba250df5fc63595d3122b4e51fdc213572b9dec    refs/heads/feat/issue-37-customer-repair-orders
```

本地 `HEAD` 同为 `1ba250d`，**本地与远端一致**。

> 保留原说明备查：本机凭据助手 `manager` 在非交互环境会挂起，
> 所以推送必须由你在本机终端执行（`git push -u origin <branch>`），
> 凭据窗口需要真人交互。既然已成功，后续分支沿用同样方式即可。

---

## 第三步：开 PR

⚠️ **base 必须选上游 `main`**，不要选个人 fork 的 `main`。
个人 fork 的 `main` 停在 `c5b332b`，**落后上游 12 个提交**；
若拿它当 base，会误把上游已合入的 12 个提交也算进本 PR 的 diff。

已验证：**上游 `main`（`6f83dea`）是本分支的祖先**，
所以对上游开 PR 时 diff 恰好只有这 2 个提交：

```
1ba250d docs(issue-37): 记录提交就绪状态与推送/PR 操作指引
def53b9 feat(repair-orders): 客户报修提交、本人列表与进度查询 (#37)
```

推送成功后，GitHub 会在仓库页顶部显示 **"Compare & pull request"** 提示条，点它即可。
或直接打开（`base` 已指向上游）：

```
https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/compare/main...Sek1ro-oka:zafu-pchospital-harmonyos:feat/issue-37-customer-repair-orders?expand=1
```

> 用 `gh` 一条命令等价写法（会自动指定 `--head Sek1ro-oka:feat/...`）：
> ```bash
> gh pr create --repo Xiaoyuan-114/zafu-pchospital-harmonyos \
>   --base main --head Sek1ro-oka:feat/issue-37-customer-repair-orders \
>   --title "feat(repair-orders): 客户报修提交、本人列表与进度查询 (#37)" \
>   --body-file /e/zafu_ph_tmp/issue37-pr-body.md
> ```

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
