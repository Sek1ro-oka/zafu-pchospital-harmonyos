# #62 原生活动接口

实现日期：2026-10-14。接口、迁移与 App 已交付本分支；取消成员出勤按用户确认保留缺口。

基点：main `9ac3226db7fea4d670d9ade394d88f591df55361`。Web 参照：`e78d057e5bad64c7a73d89f4bad425473156f625`。本文件随实现与验证更新。

所有路径以 `/api/v1` 开头，沿用 success/data/meta 与 error 信封。鉴权写请求 Web Cookie + 可信 Origin，Native Bearer + X-Client-Type:native，Cookie 优先。公开写按 assertPublicWriteAccess 分流。本人接口要求登录，缺凭证不会降级为匿名。

| 接口                                                                    | 来源          | 请求 / 响应                                                                  | 鉴权与错误                                                               |
| ----------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| GET /repair-activities                                                  | 现有          | 活动数组，五态与真实容量                                                     | 公开                                                                     |
| GET /repair-activities/{id}                                             | 扩展          | 地点（nullable）、consent {version,title,clauses}、五态                      | 公开；不存在 404                                                         |
| POST /repair-activities/{id}/registrations                              | 保留          | name/phone/issueType/deviceModel?/consentAccepted/consentVersion? → 掩码报名 | 公开写；旧 Web 不传版本仍记录当前版本，传版本必核对                      |
| POST /repair-activities/{id}/registrations/lookup                       | 保留          | phone → 报名及 editToken                                                     | 公开写、频率限制、活动结束拒绝                                           |
| PATCH/POST /repair-activities/{id}/registrations/{regId}                | POST 别名新增 | phone/editToken/issueType → 报名                                             | 公开写、凭据与状态检查                                                   |
| POST /customer/repair-activities/{id}/registrations                     | 新增          | 同报名字段，consentVersion 必填                                              | 已登录账号（含成员）；服务器绑定 actor.userId                            |
| GET /customer/activity-registrations                                    | 新增          | page/pageSize → 本人报名数组，meta.pagination                                | 逐请求核对归属；不含内部备案 ID/正文                                     |
| GET/POST /customer/activity-registrations/{regId}?activityId={id}       | 新增          | 详情；POST {activityId,issueType}                                            | 归属、活动 ID、软删除、状态逐次检查，越权统一 404                        |
| GET /member/repair-activities                                           | 现有          | 成员活动与 attended                                                          | activity:staff + 有效成员                                                |
| POST /member/repair-activities/{id}/attendance                          | 适配          | 标记本场出勤                                                                 | 同上，报名截止后开放；取消暂不实现（用户确认保留缺口）                   |
| GET /member/repair-activities/{id}/board                                | 扩展          | eligible/queue/served/pendingServeDraft                                      | 同上，不以出勤限制读取                                                   |
| POST /member/repair-activities/{id}/check-in                            | 扩展          | registrationIds，issueTypeUpdates? [{registrationId,issueType}]              | 同上 + 本场出勤、报名截止后；事务内全有或全无                            |
| POST /member/repair-activities/{id}/withdraw                            | 适配          | registrationId → 报名                                                        | 同上 + 出勤；只撤 CHECKED_IN                                             |
| POST /member/repair-activities/{id}/serve                               | 改为草稿      | registrationId → registration,repairRecordId                                 | 同上 + 出勤、报名截止后；真实 DRAFT，同成员跨活动草稿拦截                |
| GET /member/repair-activities/{id}/registrations/{registrationId}/phone | Web 同步      | {phone}                                                                      | activity:staff + 有效成员 + 有效报名，无出勤前提；审计、private,no-store |
| GET/POST /admin/repair-activities                                       | 适配          | 列表/创建，含 location?                                                      | activity:admin                                                           |
| PATCH/POST/DELETE /admin/repair-activities/{id}                         | POST 别名新增 | 编辑/软删除                                                                  | activity:admin；保持时间容量校验                                         |
| GET /admin/repair-activities/{id}/registrations                         | 现有          | 本活动报名（默认掩码电话）                                                   | activity:admin                                                           |
| PATCH/POST/DELETE /admin/repair-activities/{id}/registrations/{regId}   | POST 别名新增 | name?/phone?/issueType? / 软删除                                             | activity:admin；活动未结束才编辑、手机号查重、审计                       |

## 所有权、快照和状态

报名 userId 可空，不按手机号回填。姓名、电话、机型是报名快照。匿名查询/修改只匹配 userId 为 null 的行，账号报名不能经手机号公开通道绕过所有权检查。允许任一已登录账号为本人联系快照报名，不增加同账号同场唯一约束；原同场有效手机号唯一与容量锁不变。客户端身份字段不参与归属。

| 动作              | 条件与变化                                                                             |
| ----------------- | -------------------------------------------------------------------------------------- |
| 新报名            | OPEN；同意当前条款；保留 IP/手机号限流与容量事务                                       |
| 本人/匿名修改类型 | REGISTERED 且活动未 ENDED；报名截止后仍可在活动开始前改                                |
| 客户签到          | REGISTERED → CHECKED_IN；允许同时调整类型；重试不改已入队类型                          |
| 撤回排队          | CHECKED_IN → REGISTERED，清签到时间；不释放容量                                        |
| 接待              | CHECKED_IN → SERVED，同事务关联 DRAFT；不代表维修完成                                  |
| 已接待撤回        | 409，拒绝                                                                              |
| 成员取消出勤      | 已盘点课设及固定 Web，未发现接口；用户于本次开发确认先保留此缺口，不自行添加无约束删除 |

公开 ENDED 保留课设 `now >= activityAt` 边界；现场开放另按固定 Web `now >= signupClosesAt`，不以 ENDED 禁止现场接待。未提交接待草稿仅指本成员有效 DRAFT + 活动关联；普通草稿、PENDING、REJECTED 不阻止下一位。机型遵循 #61 的关联来源守卫，客户不能读取内部备案。接待仅创建草稿，正文、结果、耗时、备注留空，提交仍需课设有效日期、启用分类、实际结果、正文及至少一张照片，沿用 #40 证据规则。

## 错误码

原活动/验证/鉴权/限流码保持。新增 ACTIVITY_CONSENT_VERSION_CHANGED (409，重新读条款) 与 ACTIVITY_SERVE_DRAFT_PENDING (409，继续填写已有草稿)。本人不存在/跨账号/活动 ID 不符统一 ACTIVITY_REGISTRATION_NOT_FOUND (404)。未出勤 403 ACTIVITY_ATTENDANCE_REQUIRED；纯管理员无成员档案 403 MEMBER_REQUIRED。电话不进入默认列表或日志，按需读取审计不写完整电话。

## DTO 与客户端路由

- 活动详情：公开列表原字段完全保留；详情另含 `location:string|null` 和 `consent:{version,title,clauses[]}`。已结束活动可只读详情，报名/匿名查询与编辑仍由各自状态守卫拒绝。
- 本人报名：`id,activityId,name,phoneMasked,issueType,deviceModel,status,createdAt,checkedInAt,servedAt,canEditIssueType,activity:{id,title,location,activityAt,signupClosesAt}`。不含 `repairRecordId`、备案正文/照片/评论；状态与允许修改字段均来自服务器。
- 分页：`page>=1`，`1<=pageSize<=100`，默认 20；信封 `meta.pagination={page,pageSize,total,totalPages}`。App 新增 `ApiClient.getPage` 取真实元数据，旧 `get/post` 拆包行为保持。
- 看板：`activity.canOperateStaff` 是服务器现场开放判断；`served[]` 附 `recordStatus` 与 `canOpenRecord`，按作者/审核权限/已审核可读规则决定链接。全局 `pendingServeDraft` 含本人草稿 ID、机主和活动标题，仅供授权成员继续填写。
- 管理报名默认只返回 `phoneMasked`。替换手机号可显式提交 `phone`，留空省略字段保持原号；纯管理员不能通过成员电话接口读取原完整电话。
- 签到和接待保留现有成功 HTTP 201；其他读取/编辑/撤回通常 200。重复接待返回 409，不重复建档；同成员跨场接待先锁成员行，再锁活动行并检查未提交草稿。

| App 路由                              | 参数                                            | 准入 / 用途                        |
| ------------------------------------- | ----------------------------------------------- | ---------------------------------- |
| `activity-detail`                     | `ActivityParam {activityId}`                    | 游客详情                           |
| `activity-signup`                     | 同上                                            | 登录 / 注册 / 必要改密后原目标续接 |
| `activity-lookup`                     | 同上                                            | 独立旧匿名查询                     |
| `my-activity-registrations`           | null                                            | 本人分页                           |
| `my-activity-registration`            | `RegistrationParam {activityId,registrationId}` | 本人详情 / 改类型                  |
| `staff-activities` / `activity-board` | null / ActivityParam                            | 成员出勤与现场                     |
| `management` / `activity-admin`       | null                                            | #63 可复用管理入口                 |
| `activity-edit`                       | ActivityParam，创建时 activityId 为空串         | 创建 / 编辑活动                    |
| `activity-registration-admin`         | ActivityParam                                   | 报名管理                           |

#63 从现有 `management` 子页扩展管理导航，直接复用这些路由和 `ActivityService`；不在顶层五栏增加管理 tab。

## 验证与交付限制

见 [实际验证记录](../../docs/verification/issue-62-activities.md)。取消成员出勤按用户确认保留缺口；不新增无条件 DELETE。未部署共享后端，不代表共享地址已具备这些接口。默认 App 地址仍是共享地址，开发验收使用显式配置的独立本机地址。
