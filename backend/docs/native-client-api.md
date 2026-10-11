# 原生客户端接口：登录与会话

面向 HarmonyOS 原生 App 的最小会话通道（2026-10-09 第一里程碑：登录、会话、角色入口）。
所有响应沿用既有信封：成功 `{ success, data, meta }`，失败 `{ success, error:{ code, message }, meta }`。

## 通道与鉴权方式

| 通道 | 凭证 | 写接口来源校验 |
| --- | --- | --- |
| Web（浏览器） | Cookie `pc_hospital_session`（HttpOnly，SameSite=Lax） | `assertSameOrigin()`：Origin 必须命中 `APP_BASE_URL` 白名单 |
| 原生（App） | 登录走 `/api/v1/auth/native/*`，令牌在响应体返回，后续请求 `Authorization: Bearer <token>` | 要求自定义头 `X-Client-Type: native`；**不得伪造 Origin** |

原生通道为什么不需要 Origin 校验：它不使用 Cookie 凭证，CSRF（浏览器自动携带 Cookie）不成立；
而跨站脚本无法设置自定义头（非简单头触发预检，本站不返回 CORS 头）。两条通道各自独立校验，互不替代。

令牌即服务端会话（`auth_sessions` 表，HMAC-SHA256 摘要存储，可从 Web/原生任一端吊销）：
有效期 30 天，临近到期自动续期；身份、角色与入口（`home`）一律由服务端计算，请求中的角色字段被忽略。

## 接口

### POST /api/v1/auth/native/login

请求头：`Content-Type: application/json`、`X-Client-Type: native`
请求体：`{ "qq": "100001", "password": "customer123" }`

成功 200 `data`（不下发 Cookie）：

```json
{
  "token": "lERkwunEdMXWAVyP-Q7Ivrj803FRJsVaiCXFPZqffbA",
  "expiresAt": "2026-11-08T08:19:18.964Z",
  "userId": "30000000-0000-4000-8000-000000000001",
  "displayName": "测试客户",
  "roles": [],
  "permissions": [],
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
初始密码未改的账号也可通过（App 本轮不提供改密页，界面按 `mustChangePassword` 提示去 Web 端改密）。

失败：`401 UNAUTHENTICATED`（未携带令牌）、`401 AUTH_SESSION_INVALID`（无效/已吊销）、
`401 AUTH_SESSION_EXPIRED`（过期，服务端同时吊销该会话）。

### POST /api/v1/auth/native/logout

请求头：`X-Client-Type: native`、`Authorization: Bearer <token>`

成功 200 `data`：`{ "loggedOut": true }`。令牌已失效时同样返回成功（幂等），App 只需清掉本地会话。
失败：`401 UNAUTHENTICATED`（未携带令牌）、`403 FORBIDDEN`（缺少 `X-Client-Type`）。

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
- Web 写入接口仍要求同源 Origin；原生写入接口在后续里程碑按同一模式提供，不通过伪造 Origin 绕过。

## 本轮未覆盖

注册、找回密码、第三方登录、改密页。业务接口已分文档接入：客户报修（#37，`/api/v1/repair-orders`）、
工作人员处理与维修备案（#38，[说明](native-repairs-api.md)）、知识问答（#39，[说明](knowledge-ai.md)）；
各页面在收到会话失效错误码时回调统一登出、回到登录页。真机与模拟器上的整体链路仍未验证（无设备）。
