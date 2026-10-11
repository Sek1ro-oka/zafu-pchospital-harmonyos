# 原生客户端接口：报修处理与维修备案（Issue #38）

面向 HarmonyOS App 的工作人员处理链路与 App 内备案审核。会话与通道规则见
[原生客户端接口：登录与会话](native-client-api.md)；响应仍使用同一信封：
成功 `{ success, data, meta }`（列表分页在 `meta.pagination`），失败 `{ error: { code, message, fieldErrors? } }`。

本文件只描述 App 实际使用的接口；Web 管理端的其余接口不在本轮契约内。

## 通道与鉴权

| 通道 | 凭证 | 写接口来源校验 |
| --- | --- | --- |
| Web（浏览器） | Cookie `pc_hospital_session` | `assertSameOrigin()`：Origin 必须命中 `APP_BASE_URL` 白名单 |
| 原生（App） | `Authorization: Bearer <token>` | 要求自定义头 `X-Client-Type: native`；**不得伪造 Origin** |

写接口按令牌实际来源分流（`assertWriteAccess`）：Cookie 优先——两个凭证同时存在时按
Cookie 处理，带原生头也**不能**跳过同源校验。读接口只要真实会话。

角色与权限由服务端逐接口判定（`roles` 提交无效）：

- 客户（无 `MEMBER`/`ADMIN` 角色）：不能调用本文件任何接口（403）；
- 工作人员（`MEMBER` + 有效成员档案）：队列 / 详情 / 受理 / 推进 / 本人备案的建档、编辑、提交、照片；
- 管理员（`ADMIN`，标记为 `repair:review` 权限）：上述能力 + 推进/取消任何报修单 + 备案审核；
  没有成员档案的纯管理员**不能受理**（不能凭空成为受理人），也不能代替受理人建档。

## 报修处理（工作人员）

### GET /api/v1/staff/repair-orders

队列。查询参数：`scope=unassigned|mine|all`（默认 `unassigned`，非法 400）、
`status=SUBMITTED|ACCEPTED|REPAIRING|COMPLETED|CANCELLED`（选填，与 scope 取交集）、`page`、`pageSize`。

- `unassigned`：待受理公共池（`SUBMITTED` 且无人受理），先受理成功的人负责后续处理；
- `mine`：我负责（受理人是当前用户的成员档案）；没有成员档案时返回空列表；
- `all`：全部单据（工作人员可查看业务范围内的报修信息，但更新仍限受理人/管理员）。

`data` 为数组，元素是工作人员视图：

```json
{
  "id": "…", "deviceModel": "ThinkPad T14", "deviceSerial": null,
  "faultDescription": "…", "contactPhone": "…", "status": "ACCEPTED",
  "createdAt": "2026-10-11T08:00:00.000Z", "updatedAt": "…", "lastProgressAt": "…",
  "events": [{ "id": "…", "fromStatus": "SUBMITTED", "toStatus": "ACCEPTED", "note": null, "createdAt": "…" }],
  "assignee": { "memberProfileId": "…", "name": "…" },
  "record": { "id": "…", "status": "DRAFT", "result": null, "submittedAt": null, "reviewedAt": null },
  "actions": {
    "canAccept": false, "canStartRepair": true, "canComplete": false,
    "canCancel": false, "canCreateRecord": true
  }
}
```

`actions` 是**服务端计算**的允许动作，客户端只读渲染，不作为授权依据。
客户 DTO 保持不变：不返回受理人、备案关联或其他用户资料。

### GET /api/v1/staff/repair-orders/[id]

工作人员详情（受理信息、时间线、关联备案摘要与 `actions`）。不存在/软删除 404；
无工作人员权限 403。

### POST /api/v1/staff/repair-orders/[id]/accept

受理：`SUBMITTED → ACCEPTED`，受理人 = 当前用户的有效成员档案（服务端确定，不接收客户端自报）。
请求体 `{ "note": "选填说明" }`，可以传 `{}`。

- 并发/重复：本人重复受理返回当前状态（幂等，不重复写事件）；他人已受理返回
  `409 REPAIR_ORDER_STATE_CONFLICT`（刷新后查看）；纯管理员无档案返回 `403 MEMBER_REQUIRED`。

### POST /api/v1/staff/repair-orders/[id]/progress

推进：`ACCEPTED → REPAIRING`、`REPAIRING → COMPLETED`。请求体 `{ "toStatus": "REPAIRING" | "COMPLETED", "note": "选填" }`。

- 受理人本人或管理员；其他人 `403 REPAIR_FORBIDDEN`；
- 当前状态已是目标状态 → 返回当前状态（幂等）；非法转换 `409 REPAIR_ORDER_STATE_INVALID`；
- 条件更新失败（并发变化）`409 REPAIR_ORDER_STATE_CONFLICT`。

### POST /api/v1/staff/repair-orders/[id]/cancel

取消：仅管理员（`repair:review`）。请求体 `{ "note": "取消说明，必填" }`（≤500 字）。
`SUBMITTED` / `ACCEPTED` 可取消；`REPAIRING` / 终态不可取消；重复取消幂等。

### POST /api/v1/staff/repair-orders/[id]/record

从报修单建立关联备案草稿（**仅受理人本人**）。请求头 `Idempotency-Key`（必填，≤128 字）。
请求体可传 `{}`。

- 未受理、已取消或已关联（返回原备案）按幂等/冲突语义处理，不产生多份或孤立记录；
- 机型从报修单预填到 `deviceModel`；维修经过、日期、结果留给备案页人工填写；
- **维修结果不预置成功值**（留空，提交时必填），避免把「处理完成」当成「已修好」；
- 返回 201 + 备案视图（与 `/api/v1/repairs` 的 `data` 同形状）。

## 维修备案（App 复用成员通道）

字段、必填、长度与照片限制与 Web 端完全一致（`repair-validation.ts` / `uploadLimits()`），
不新增收费、根因等字段。

| 接口 | 说明 | 幂等键位置 |
| --- | --- | --- |
| `POST /api/v1/repairs/[id]` | 保存草稿（**App 编辑入口**，见下） | — |
| `POST /api/v1/repairs/[id]/submit` | 提交审核，请求体 `{ "version": n }` | 请求头 `Idempotency-Key` |
| `POST /api/v1/repairs/[id]/photos` | 上传照片（multipart，字段名 `photos`，可多张） | — |
| `DELETE /api/v1/repairs/[id]/photos/[photoId]` | 删除误传照片 | — |
| `GET /api/v1/repairs/[id]` | 详情（含 `canEdit`、`photoLimits`、`reviews`、`timeline`） | — |
| `GET /api/v1/repair-categories` | 启用中的分类字典 | — |
| `GET /api/v1/repair-photos/[photoId]/content` | 照片内容（需要会话鉴权，返回二进制） | — |

**关于 `POST /api/v1/repairs/[id]`（编辑别名）**：`@ohos.net.http` 的 `RequestMethod`
枚举没有 PATCH，App 发不出 PATCH 请求；该 POST 与 Web 的 `PATCH` 共用**同一实现**
（`updateRecord`：同一来源分流、同一服务、同一响应），不是放宽权限。语义仍是部分更新：
请求体 `{ version, repairDate, durationMinutes, categoryId, content, result, remark }`，
`version` 必须与当前版本一致，否则 `409 REPAIR_VERSION_CONFLICT`（客户端刷新重试，
不悄悄覆盖他人结果）。

编辑规则保持原 Web：

- 仅备案本人可编辑 `DRAFT` / `REJECTED`；`PENDING` / `APPROVED` 不可编辑（`409 REPAIR_STATE_INVALID`）；
- 管理员审核权限**不豁免**本人编辑限制（管理员改别人的草稿 `403 REPAIR_FORBIDDEN`）；
- 提交至少需要：有效维修日期（上海日历日，不得晚于今天）、有效分类、非空维修内容、
  维修结果、一张已上传照片（`400 REPAIR_SUBMISSION_INCOMPLETE` 带 `fieldErrors`）；
- 提交后 `DRAFT/REJECTED → PENDING`，退回可修改重提。

照片：真实文件选择后 multipart 上传；服务端按**文件头**复核 MIME（JPEG/PNG/WebP），
默认单张 ≤10 MB、最多 9 张（`UPLOAD_MAX_BYTES` / `UPLOAD_MAX_FILES_PER_REPAIR` 可调），
限制随详情 `photoLimits` 下发；读取必须带会话（401 匿名），令牌不进 URL。

## App 内审核（管理员）

### GET /api/v1/admin/repairs?status=PENDING&page=&pageSize=

待审核分页列表（要求 `repair:review`）。`data` 为数组。

### POST /api/v1/admin/repairs/[id]/reviews

请求体 `{ "decision": "APPROVED" | "REJECTED", "note": "退回必填", "idempotencyKey": "…" }`。
**幂等键在请求体**（与 Web 管理端、批量审核一致），不是请求头。

- 普通工作人员 `403`；退回缺原因 `400 REPAIR_REJECTION_NOTE_REQUIRED`；
- 重复审核或别人先处理 `409 REPAIR_STATE_CONFLICT`；同键同决定重放返回原结果；
- 审核结果不自动改变报修处理状态，也不发布知识库（#40 范围）。

## 两套状态相互独立

- 报修处理状态：`SUBMITTED → ACCEPTED → REPAIRING → COMPLETED`（`SUBMITTED/ACCEPTED → CANCELLED`）。
  允许**先完成报修、后补备案**；完成不要求备案已提交或通过。
- 备案审核状态：`DRAFT → PENDING → APPROVED / REJECTED`（退回可重提）。
- 客户时间线只反映处理状态事件；备案审核不写入客户时间线。

## 错误码补充

| 错误码 | HTTP | 含义 |
| --- | --- | --- |
| `REPAIR_ORDER_STATE_CONFLICT` | 409 | 被他人抢先受理或状态已变化，需刷新后重试 |
| `REPAIR_ORDER_STATE_INVALID` | 409 | 非法状态转换（跳过受理、终态回退等） |
| `REPAIR_ORDER_NOT_FOUND` | 404 | 报修单不存在或不可见 |
| `MEMBER_REQUIRED` | 403 | 账号没有有效成员档案（如纯管理员受理） |
| `REPAIR_FORBIDDEN` | 403 | 非受理人推进 / 非本人编辑备案 / 非受理人建档 |
| `REPAIR_VERSION_CONFLICT` | 409 | 备案版本冲突，刷新后重试 |
| `REPAIR_STATE_CONFLICT` | 409 | 备案状态已变化（重复审核、抢审） |
| `FORBIDDEN` | 403 | 来源校验失败或角色权限不足 |

## 已知限制

- App 编辑依赖上面的 POST 别名，原因与等价性写在对应小节；
- 真机/模拟器上的 multipart 上传、相册选择与照片解码尚未验证（无设备），
  见 [Issue #38 验证记录](../../docs/verification/issue-38.md)；
- 转派、多级审批、维修中取消、重开等不在本轮范围。
