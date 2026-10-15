# 原生客户端接口：登录、注册、改密与会话

面向 HarmonyOS 原生 App 的最小会话通道（2026-10-09 第一里程碑：登录、会话、角色入口；
2026-10-12 增补 Issue #60 第 2–4 项：公开写通道、客户自助注册、邀请码注册工作人员；
2026-10-13 第二批：原生改密、rememberMe 会话档位；
2026-10-14 复审修复：会话改为**固定到期**、移除滑动续期，App 注册/改密页面交付）。所有响应沿用既有信封：
成功 `{ success, data, meta }`，失败 `{ success, error:{ code, message }, meta }`。

## 通道与鉴权方式

| 通道 | 凭证 | 写接口来源校验 |
| --- | --- | --- |
| Web（浏览器） | Cookie `pc_hospital_session`（HttpOnly，SameSite=Lax） | `assertSameOrigin()`：Origin 必须命中 `APP_BASE_URL` 白名单 |
| 原生（App） | 登录/注册在响应体返回令牌，后续请求 `Authorization: Bearer <token>` | 要求自定义头 `X-Client-Type: native`；**不得伪造 Origin** |

已登录写接口按**令牌实际来源**分流（`assertWriteAccess()`）：Cookie → 同源校验，Bearer → 原生头。
**公开写接口**（注册，此时还没有令牌）按请求实际携带的来源分流（`assertPublicWriteAccess()`）：
带 `Origin` 就按 Web 严格校验、不带 `Origin` 才按原生校验，详见下方「注册」一节。

原生通道为什么不需要 Origin 校验：它不使用 Cookie 凭证，CSRF（浏览器自动携带 Cookie）不成立；
而跨站脚本无法设置自定义头（非简单头触发预检，本站不返回 CORS 头）。两条通道各自独立校验，互不替代。

令牌即服务端会话（`auth_sessions` 表，HMAC-SHA256 摘要存储，可从 Web/原生任一端吊销）：
有效期见下方「rememberMe 与会话有效期」；身份、角色与入口（`home`）一律由服务端计算，
请求中的角色字段被忽略。

## 接口

### POST /api/v1/auth/native/login

请求头：`Content-Type: application/json`、`X-Client-Type: native`
请求体：`{ "qq": "100001", "password": "customer123", "rememberMe": false }`

`rememberMe` 选填，缺省 `false`：`true` = 保持登录（会话 30 天），`false` / 缺省 = 普通档位
（会话 24 小时）。只认布尔值，字符串 `"true"` 与数字 `1` 一律按缺省处理（不猜客户端意图）。

成功 200 `data`（不下发 Cookie）：

```json
{
  "token": "lERkwunEdMXWAVyP-Q7Ivrj803FRJsVaiCXFPZqffbA",
  "expiresAt": "2026-11-08T08:19:18.964Z",
  "userId": "30000000-0000-4000-8000-000000000001",
  "displayName": "测试客户",
  "roles": [],
  "permissions": ["repair.order:create", "repair.order:read"],
  "memberProfileId": null,
  "memberStatus": null,
  "mustChangePassword": false,
  "home": "CUSTOMER"
}
```

失败：`401 AUTH_INVALID_CREDENTIALS`（QQ 号或密码错误）、`429 AUTH_RATE_LIMITED`（同一 QQ+IP 15 分钟失败 5 次）、
`403 FORBIDDEN`（缺少 `X-Client-Type`）、`400 VALIDATION_FAILED`（QQ 格式）。

### GET /api/v1/auth/native/session

请求头：`X-Client-Type: native`、`Authorization: Bearer <token>`

成功 200 `data`：与登录相同，但**不含 `token` / `expiresAt`**。用于 App 重启后向服务器验证身份。
初始密码未改的账号也可通过（`allowForcedPasswordChange = true`，见下方「强制改密账号的接口边界」）。

失败：`401 UNAUTHENTICATED`（未携带令牌）、`401 AUTH_SESSION_INVALID`（无效/已吊销）、
`401 AUTH_SESSION_EXPIRED`（过期，服务端同时吊销该会话）。

### POST /api/v1/auth/native/logout

请求头：`X-Client-Type: native`、`Authorization: Bearer <token>`

成功 200 `data`：`{ "loggedOut": true }`。令牌已失效时同样返回成功（幂等），App 只需清掉本地会话。
初始密码未改的账号同样可以退出。
失败：`401 UNAUTHENTICATED`（未携带令牌）、`403 FORBIDDEN`（缺少 `X-Client-Type`）。

### POST /api/v1/auth/native/password/change

原生修改密码（普通改密与首次/强制改密共用这一个入口）。请求头
`Content-Type: application/json`、`X-Client-Type: native`、`Authorization: Bearer <token>`。

请求体：

```json
{
  "currentPassword": "customer123",
  "newPassword": "customer-456",
  "newPasswordConfirmation": "customer-456",
  "rememberMe": false
}
```

`rememberMe` 选填，语义与登录一致：`true` = 保持登录（新会话 30 天），`false` / 缺省 =
普通档位（新会话 24 小时）。**省略时沿用当前会话的档位**，不会把 24 小时账号偷偷续成 30 天，
也不会把 30 天账号缩短成 24 小时。

与 Web 端 `POST /api/v1/auth/password/change` **共用同一个 `AuthService.changePassword`**：
口令校验、哈希、会话轮换与旧会话吊销完全同一套逻辑，错误码也一致，原生入口不自己加规则。
两条通道只差凭证与令牌的回传方式：

| | Web `/api/v1/auth/password/change` | 原生 `/api/v1/auth/native/password/change` |
| --- | --- | --- |
| 来源校验 | `assertSameOrigin()`（Cookie 通道的 CSRF 防线） | `assertWriteAccess()`：Bearer 通道要求 `X-Client-Type: native` |
| 令牌 | Cookie | `Authorization: Bearer` |
| 新令牌 | `Set-Cookie`（HttpOnly） | **响应体 `data.token`**，不下发 Cookie |
| 强制改密账号 | 可访问 | 可访问 |

成功 200 `data`：

```json
{
  "changed": true,
  "mustChangePassword": false,
  "token": "lERkwunEdMXWAVyP-Q7Ivrj803FRJsVaiCXFPZqffbA",
  "expiresAt": "2026-11-07T08:19:18.964Z"
}
```

客户端必须把 `token` 保存到本地并替换旧令牌；旧令牌已失效，继续用会得到
`401 AUTH_SESSION_INVALID`。若本地保存失败，按登录接口同样的处理：不得展示「已登录成功」，
并调用 `POST /api/v1/auth/native/logout` 清理服务端会话。

**旧会话失效策略（与 Web 逐字一致）**：成功即吊销该账号**所有**未吊销会话（`revoked_at = now`），
再发放新会话。也就是改密会把它在别的设备上的登录一并踢掉，这是既有策略，本入口不放宽也不收紧。

失败（错误码与 Web 改密完全一致，不新增）：

| 状态 | 错误码 | 触发条件 |
| --- | --- | --- |
| 400 | `PASSWORD_CURRENT_INVALID` | 当前密码错误 |
| 400 | `PASSWORD_CONFIRMATION_MISMATCH` | 两次输入的新密码不一致 |
| 400 | `VALIDATION_FAILED` | 新密码长度不在 6–128 |
| 401 | `UNAUTHENTICATED` | 未携带令牌 |
| 401 | `AUTH_SESSION_INVALID` | 会话无效或已吊销 |
| 401 | `AUTH_SESSION_EXPIRED` | 会话已过期（服务端同时吊销该会话） |
| 403 | `FORBIDDEN` | 缺少 `X-Client-Type: native` |
| 500 | `INTERNAL_ERROR` | 口令或会话写库失败。整体回滚，**口令未被改写**，可原样重试 |

失败响应不含 `data`、不含令牌、不产生新会话，也不会改动当前口令。

**「新密码不得与当前密码相同」不存在**：这是既有 Web 行为（两次确认一致、长度合规、
当前口令正确即成功），原生入口不比 Web 更严，也不为此发明错误码。

## 注册（Issue #60，Web 与原生共用）

两个**公开**注册入口，语义严格分开，客户端不要混用：

| 入口 | 语义 | 是否消耗邀请码 |
| --- | --- | --- |
| `POST /api/v1/auth/register/customer` | 客户自助注册（QQ + 自设密码），只产生客户身份 | 否（完全不读邀请码） |
| `POST /api/v1/auth/register/staff` | 邀请码注册**工作人员**（产生 `MEMBER` 角色 + 成员档案） | 是 |

请求头：`Content-Type: application/json`，外加通道标识之一：

| 请求特征 | 通道 | 校验 |
| --- | --- | --- |
| 带 `Origin` | Web | 必须命中 `APP_BASE_URL` 白名单 |
| 不带 `Origin` | 原生 | 必须带 `X-Client-Type: native` |

原生客户端**不要伪造 `Origin`**：一旦带了 `Origin`，就按更严的 Web 白名单校验，伪造值只会被拒。
客户端标识只用于选择校验方式，不是身份凭证：请求体里的 `roles` / `permissions` / `home` /
`memberProfileId` 等字段一律被忽略（自动化测试覆盖），身份、角色与入口都由服务端读库决定。

**会话行为是确定的：注册成功即返回会话**（注册即登录），不存在「账号已建但未登录」的中间态；
- Web：响应 `data` 与 `POST /api/v1/auth/login` 同形（`{ userId, displayName, roles, permissions, mustChangePassword, expiresAt }`）并下发 `Set-Cookie`；
- 原生：响应 `data` 与 `POST /api/v1/auth/native/login` 同形（多出 `token` / `expiresAt` / `home`）且**不下发 Cookie**。

两个注册入口都接收选填 `rememberMe`（布尔，缺省 `false`），语义与登录一致：
`true` = 保持登录（会话 30 天），`false` / 缺省 = 普通档位（会话 24 小时）。
注册的档位选择与登录同一条规则落库（`auth_sessions.remember_me`）。

成功状态码 `201`；失败响应不含 `data`、不含 Cookie、不产生会话。

**注册是原子的：「建账号 + 发会话」在同一个数据库事务里完成。** 注册失败（含发会话失败）会整体回滚，
不会留下「注册失败但账号已存在」的状态 —— 因此失败后用同一个 QQ 重试是安全的，会正常成功，
不会拿到 `409 ACCOUNT_IDENTITY_TAKEN`；邀请码名额也不会因为失败的请求被扣掉。

### POST /api/v1/auth/register/customer

请求体：`{ "qq": "100004", "password": "customer-123", "passwordConfirmation": "customer-123", "rememberMe": false }`
（昵称与联系电话由个人资料模块补充，本入口不接收；`displayName` 由服务端生成，形如 `客户<QQ>`；
`rememberMe` 选填，见上）

成功 201 `data`（原生）：`userId`、`displayName`、`roles: []`、客户基础 `permissions`、
`memberProfileId: null`、`memberStatus: null`、`mustChangePassword: false`、`home: "CUSTOMER"`、`token`、`expiresAt`。

失败：

| 状态 | 错误码 | 触发条件 |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | QQ 不是 5–11 位数字，或密码长度不在 6–128 |
| 400 | `PASSWORD_CONFIRMATION_MISMATCH` | 两次密码不一致 |
| 409 | `ACCOUNT_IDENTITY_TAKEN` | QQ 已被**任何**账号占用（含软删除身份）：不认领、不合并、不改写既有账号与口令 |
| 403 | `FORBIDDEN` | 来源校验不通过（无 `Origin` 且无 `X-Client-Type: native`，或 `Origin` 不在白名单） |
| 429 | `RATE_LIMITED` | 同一 IP 15 分钟超过 10 次 |
| 500 | `INTERNAL_ERROR` | 账号或会话写库失败。整体回滚，**不会留下账号**，可原样重试（重试会成功而不是 409） |

### POST /api/v1/auth/register/staff

请求体：

```json
{
  "code": "<邀请码明文>",
  "idempotencyKey": "<客户端生成的 UUID>",
  "realName": "张三",
  "qq": "100005",
  "phone": "13800000000",
  "studentId": "可选",
  "className": "可选",
  "password": "staff-123",
  "passwordConfirmation": "staff-123",
  "rememberMe": false
}
```

成功 201 `data`（原生）：与 `/api/v1/auth/native/login` 同形，`roles: ["MEMBER"]`、
`home: "STAFF"`、`memberProfileId` / `memberStatus` 为新建档案；Web 与 `/api/v1/auth/login` 同形 + Cookie。

规则沿用 `InviteCodeService.redeem`：使用次数、生效/失效时间、QQ/手机绑定、并发与幂等都在同一个
串行化事务内判定与扣减，不会超卖，失败不扣名额。**命中既有账号身份**（例如该 QQ 已有客户账号）时
整体回滚并返回 `409 ACCOUNT_IDENTITY_CONFLICT`：不覆盖既有账号、不发会话、不扣名额。
建账号与发会话在同一个事务里完成，注册失败（含发会话失败）整体回滚，不会留下账号，可安全重试。

**幂等重放会校验密码。** 用同一个 `idempotencyKey` 重放时，除了原来的邀请码 / QQ / 手机号必须
完全一致，本次请求的 `password` 还必须与账号**当前**口令一致；不一致按认证失败处理
（`401 AUTH_INVALID_CREDENTIALS`），不发放任何会话。也就是说：重放不是免密凭证，
账号改密之后旧请求的重放同样会被拒。口令正确时重放仍然成功（幂等行为不回退），
但不会重复扣名额。

失败：`400 INVITE_CODE_INVALID`、`409 INVITE_CODE_NOT_ACTIVE`、`409 INVITE_CODE_EXPIRED`、
`409 INVITE_CODE_REVOKED`、`409 INVITE_CODE_EXHAUSTED`、`409 INVITE_CODE_BINDING_MISMATCH`、
`400 VALIDATION_FAILED`（姓名 2–64、QQ、手机号、密码长度）、`400 PASSWORD_CONFIRMATION_MISMATCH`、
`409 IDEMPOTENCY_CONFLICT`（幂等键已用于另一项注册请求）、
`401 AUTH_INVALID_CREDENTIALS`（幂等重放时密码与账号当前口令不一致）、
`500 INTERNAL_ERROR`（账号或会话写库失败，整体回滚、可安全重试）、
`403 FORBIDDEN`、`429 RATE_LIMITED`。

> Web 现有注册页（`/login?mode=register`）仍调用旧入口 `POST /api/v1/member-registrations/invite`
> （等价实现，仅 Web/Cookie，无需改动）；原生客户端用上表的 `/api/v1/auth/register/staff`。

### GET /api/v1/health（连通性检测，无需鉴权）

成功 200 `data`：`{ "status": "ok", "database": "reachable" }`。

## 角色与入口（home）映射

| 服务端角色 | 模型中的含义 | `home` | App 入口 |
| --- | --- | --- | --- |
| 无 `MEMBER` / `ADMIN` | 普通账号 = 客户（无成员档案） | `CUSTOMER` | 客户服务入口 |
| `MEMBER` | 维修队成员 = 工作人员（需有效成员档案） | `STAFF` | 工作人员入口 |
| `ADMIN` | 超级管理员（管理后台权限是另一套） | `STAFF` | 工作人员入口 |

说明：工作人员**不等于**超级管理员 —— `MEMBER` 没有管理权限，`ADMIN` 进入工作人员入口也不改变其权限集合；
业务权限始终由服务端逐接口 `requirePermission(actor, ...)` 判定。客户端提交 `roles` 等字段不会生效；
客户令牌访问工作人员接口、工作人员令牌访问管理员接口均返回 `403 FORBIDDEN`（自动化测试覆盖）。

## 本地测试账号（只操作课设库）

```powershell
cd backend
corepack pnpm accounts:prepare
```

| 账号 | QQ | 密码 | 说明 |
| --- | --- | --- | --- |
| 客户 | `100001` | `customer123` | 无角色、无成员档案 → 客户入口 |
| 工作人员 | `100002` | `staff123` | `MEMBER` + 有效成员档案 → 工作人员入口 |
| 管理员 | `100003` | `admin123` | `ADMIN`、**无成员档案** → 管理后台权限；不能受理报修单 |

账号说明（三个号都进「本地测试账号」，与 `tools/prepare-test-accounts.ts` 中的固定 UUID 一一对应）：

- **管理员**（`100003`）：`ADMIN` 角色，带 `repair:review` / `repair:flag`，可审核维修备案、标记典型案例、
  切换内部/公开与撤回案例（管理端接口）。它是**纯管理员**（没有成员档案），
  所以**能审核 / 标记，但不能受理报修单** —— 受理要求有效成员档案，它会得到
  `403 MEMBER_REQUIRED`。这正好用来演示「权限失败 / 身份不足」场景。
- 管理员角色**不下放**给工作人员：`100002`（`MEMBER`）调管理端接口应得到 `403 FORBIDDEN`。
- 不要为了「让管理员也能受理」给它加成员档案：那会变成「管理员 + 维修队成员」，
  演示不出上面的权限失败场景；也不要给 `MEMBER` 授予 `repair:review` / `repair:flag`。

可重复执行：口令每次重置为已知值，角色集合与成员档案收敛到目标值（无档案账号发现残留档案即停止并提示）；
只动这三个固定账号，QQ 被其他账号占用时会停止并提示。
与 seed 使用同一道数据库闸门（`assertExperimentDatabase`），拒绝任何非 `pchospital_exp_*` 课设库。

## 手机联调（App 侧）

- 登录页可配置服务器地址，填 `http://<电脑局域网IP>:13080`（如 `http://192.168.1.20:13080`），保存后重启保留；
  电脑防火墙需放行该端口。
- 已声明 `ohos.permission.INTERNET`。Stage 模型默认允许明文 HTTP；若设备/企业策略返回 `2300997 Cleartext traffic not permitted`，
  本课设没有真机复现该场景（无设备），遇到时按设备策略处理。
- Web 写入接口仍要求同源 Origin；原生写入接口按 `Authorization: Bearer` + `X-Client-Type: native`
  独立校验（已登录写接口见 `assertWriteAccess()`，注册等公开写接口见 `assertPublicWriteAccess()`），
  不通过伪造 Origin 绕过。

## rememberMe 与会话有效期

会话有效期与 Web 的 rememberMe 完全同步，两个档位：

| 档位 | 有效期 | 请求字段 |
| --- | --- | --- |
| 普通（缺省） | **24 小时** | `rememberMe: false` 或缺省 |
| 保持登录 | **30 天** | `rememberMe: true` |

- 字段名统一为 `rememberMe`，只认布尔值；字符串 `"true"`、数字 `1` 一律按缺省（24 小时）处理。
- **四个入口**都接收该字段，逐条列清：

| 入口 | 字段解析位置 | `true` | `false` / 缺省 |
| --- | --- | --- | --- |
| `POST /api/v1/auth/native/login` | 路由 `body.rememberMe === true` | 30 天 | 24 小时 |
| `POST /api/v1/auth/register/customer` | `parseCustomerRegistrationInput`（只认布尔值） | 30 天 | 24 小时 |
| `POST /api/v1/auth/register/staff` | 路由 `typeof body.rememberMe === "boolean" ? … : undefined` | 30 天 | 24 小时 |
| `POST /api/v1/auth/native/password/change` | 路由 `typeof body.rememberMe === "boolean" ? … : undefined` | 30 天 | 24 小时 |

  归一化规则只有一份：客户注册路由把整个请求体交给 `parseCustomerRegistrationInput`
  （该函数的注释即规则说明），其余三个入口在路由层显式取布尔值。四处**效果一致** ——
  非布尔值一律按缺省（24 小时）处理，绝不猜客户端意图。

  > Web 端 `POST /api/v1/auth/login` 与 `POST /api/v1/auth/password/change` 同样接收
  > `rememberMe`（同一套档位规则）；Web 注册页仍走旧的
  > `POST /api/v1/member-registrations/invite`，该入口不接收本字段，按普通档位（24 小时）发放。

- 档位落在 `auth_sessions.remember_me`（新增可空布尔列），**新会话一律显式写 `true` / `false`**；
  `NULL` 只表示迁移前的存量会话。
- **改密轮换保留原选择**：改密请求省略 `rememberMe` 时，新会话沿用当前会话的档位
  （不升档也不降档）；显式传值则按本次选择轮换。
- **会话固定到期，不做滑动续期**（对齐 Web 参照实现）：到期时间在发放时按档位一次算定
  （普通 24 小时 / 保持登录 30 天），`authenticate` 只按触达间隔记录活跃（`lastSeenAt`），
  **绝不延长 `expiresAt`**。持续访问不会让原生 Bearer 会话被无限续期而永不过期。
- **App 侧默认勾选保持登录**（清单第 7 项「App 默认保持登录并允许用户关闭」）：登录 / 客户注册 /
  工作人员注册三页的开关初始为勾选，实际提交的通常是 `rememberMe: true`，用户可关闭降为普通档位；
  改密页是「沿用 / 普通 / 保持登录」三态单选，默认「沿用当前会话档位」（对应省略 `rememberMe`）。
  上表「缺省 `false`」只描述**字段被省略时**的服务端行为，不代表 App 的初始勾选状态。

### 存量会话兼容（重要）

`remember_me` 为 `NULL` 的会话是迁移前（PR #65 之前）创建的，它们当年一律按 30 天发放，
`expires_at` 也是按 30 天写入的。迁移本身**不回填、不改写**任何既有 `expires_at`，
因此这些会话仍按各自原本的到期时刻**固定失效**，不会因为本次迁移提前变成 24 小时。
读取档位时（例如改密轮换要沿用原档位）**NULL 回退到 30 天**：`legacySessionLifetime(null)` = 保持登录档位，
所以存量会话改密且省略 `rememberMe` 时，轮换出的新会话仍是 30 天，不会被降成 24 小时。

### 到期后的行为

会话到期时 `authenticate` 拒绝并返回 `401 AUTH_SESSION_EXPIRED`，同时服务端吊销该会话
（旧令牌此后按 `AUTH_SESSION_INVALID` 处理）。两个档位的到期都走同一条路径，只是时刻不同。

## 强制改密账号的接口边界

`password_credentials.must_change_password = true`（管理员重置密码后的账号、报名面试通过后发放的
初始密码账号）在 `authenticateRequest()` 默认档位下**一律** `403 PASSWORD_CHANGE_REQUIRED`，
拿不到任何业务身份。可用于兜底的只有下面三个入口：

| 入口 | 说明 |
| --- | --- |
| `GET /api/v1/auth/native/session` | 以 `allowForcedPasswordChange = true` 读取身份与 `mustChangePassword`，供 App 重启后校验并提示去改密 |
| `POST /api/v1/auth/native/logout` | 退出不受影响，可以主动清掉会话 |
| `POST /api/v1/auth/native/password/change` | 原生改密入口。**不走 `authenticateRequest` 的默认档位**（直接读 Bearer + `authService.changePassword`），否则强制改密账号永远无法自救。成功后 `mustChangePassword` 置 `false` 并轮换会话 |
| `POST /api/v1/auth/password/change` | Web 端改密入口，同样对强制改密账号放行（`PASSWORD_CURRENT_INVALID` / `PASSWORD_CONFIRMATION_MISMATCH` / `VALIDATION_FAILED`；成功后轮换会话并吊销旧令牌） |

也就是说：**改密入口本身必须对强制改密账号可用**，受限制的是其他业务接口。
自助注册（`/auth/register/customer` 与 `/auth/register/staff`）产生的账号
`mustChangePassword` 恒为 `false`，不落在这条限制里。

## 本轮未覆盖

2026-10-13：Issue #61 第一批接通客户本人资料与成员昵称/技能原生写入、内部资料只读；详见 [个人资料契约](personal-profile-api.md)。
身份仍来自本文件定义的会话，不开放客户访问成员档案。

**后端侧已完成**：原生改密入口、rememberMe 两档有效期、改密轮换保留档位、存量会话兼容、
会话固定到期（移除滑动续期，对齐 Web）。
**App 侧已完成**（PR #69，2026-10-14 合入 main）：客户自助注册页、邀请码注册工作人员页、
原生改密页（含 rememberMe 档位单选与强制改密账号自救），改密不再需要引导到 Web 端。
找回密码、第三方登录仍留给后续 PR。

业务接口已分文档接入：客户报修（#37，`/api/v1/repair-orders`）、
工作人员处理与维修备案（#38，[说明](native-repairs-api.md)）、知识问答（#39，[说明](knowledge-ai.md)）；
各页面在收到会话失效错误码时回调统一登出、回到登录页。真机与模拟器上的整体链路仍未验证（无设备）。

## Issue #61 个人中心扩展

- [个人资料](personal-profile-api.md)：独立客户档案、成员昵称/技能、授权成员目录。
- [收藏与消息](customer-community-api.md)：客户公开内容收藏/报修通知、原成员备案收藏与通知。
- [独立备案与工作摘要](personal-records-api.md)：机主字段/电话权限、本人列表、评论/回复/@成员、内部已审核备案库；保留既有课设提交条件和 Web/Native 通道。

以上为功能分支交付，共享部署由技术主线安排；具体模拟器/真机限制见各批验收记录。
