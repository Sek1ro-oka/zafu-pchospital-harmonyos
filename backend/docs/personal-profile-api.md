# Issue #61 第一批：个人资料契约

基于课设 `839c74f` 与 Web 固定参照 `e78d057e5bad64c7a73d89f4bad425473156f625`。本批已实现个人资料；收藏、消息、完整独立备案尚未交付。所有响应沿用 API 信封，资料响应 `Cache-Control: private, no-store`。

## 客户本人资料

`GET /api/v1/customer/profile`：必须登录且是无有效 MEMBER/ADMIN 角色、无成员档案的客户。身份取会话，不接受目标账号。返回 `data`：

```json
{ "displayName": "客户100001", "nickname": null, "phone": null, "version": 0, "avatarUrl": null }
```

`CustomerProfile` 独立于 `MemberProfile`，主键/外键为 `userId`，数据库表 `customer_profiles`。新注册或既有客户尚未编辑时不自动写库，返回 `version: 0`；首次成功保存创建资料，版本为 1。头像使用 App 默认资源，不提供上传。

`PATCH /api/v1/customer/profile`，或原生 `POST` 同路径别名，共用同一处理函数：

```json
{ "nickname": "昵称", "phone": "13800000000", "version": 0 }
```

- 完整提交三个字段。昵称去首尾空白，最多 64 个 Unicode 码点，拒绝控制/不可见字符；`null`/空字符串清空。联系电话为 11 位大陆手机号，`null`/空字符串清空。当前课程资料电话规则与报名流程的手机号口径一致。
- 只允许 `nickname/phone/version`，传入 `userId/role/realName` 等额外字段返回 400 `VALIDATION_FAILED`。GET 即使附加他人 `userId` 查询参数仍只返回会话本人。
- 版本不匹配返回 409 `CUSTOMER_PROFILE_VERSION_CONFLICT`；刷新后检查资料再保存。并发首次保存只有一方成功；冲突事务不会改写账号展示名。
- 昵称同步当前 `User.displayName`；清空回退为 `客户<QQ>`（无 QQ 时为「客户」）。电话只存此资料表，**不更新 UserIdentity、不更新已提交 RepairOrder 或报名联系快照**。
- 客户不能调用成员资料/目录/技能写入，成员或管理员不能借此接口成为客户档案。客户没有按其他账号 ID 读写资料的接口。
- Cookie 写入仍需受信任 Origin；Bearer 写入需 `X-Client-Type: native`，使用 #60 的 `assertWriteAccess`，不伪造 Origin。

校验失败为 400（昵称复用 `MEMBER_PROFILE_INVALID_NICKNAME`；其余 `VALIDATION_FAILED`）；未登录/会话失效为 401；非客户为 403 `FORBIDDEN`；强制改密账号仍被既有鉴权挡在业务接口外。

## 成员资料（复用 Web）

| 接口 | 规则 |
| --- | --- |
| `GET /member/profile` | `member.profile.read_self` + 有效本人 MemberProfile；返回 `{ profile, repairSummary, recentRepairs }` |
| `PATCH/POST /member/profile` | 仅 `nickname/version`；`member.profile.update_self`；本人版本冲突 409；实名/学号/班级/角色保持管理边界 |
| `PUT/POST /member/profile/skills` | `{ skillIds, profileVersion }`；`member.skill.assign_self`；最多 12 项，复用已有启用/停用、取消/恢复规则与版本、审计事务 |
| `GET /skills` | 沿用现有登录只读技能字典，App 用于选择；本批没有新增技能创建或管理功能 |
| `GET /members/:memberProfileId/profile` | `member.profile.read_internal`；内部裁剪视图，含 QQ，不含学号/班级/userId；App 只读 |
| `GET /member/directory?query=&page=1` | 新增资料选择器；同内部读取权限，仅有效成员与有效未删除账号；姓名/昵称搜索，page 1–10000、query 最多 64 字；每页 20 项，稳定 ID 排序，返回 `{items:[{memberProfileId,displayName}],page,hasMore}`，不返回联系方式 |

上述路径均加 `/api/v1`。原生 POST 别名仅为 ArkTS 无 PATCH 枚举适配，不复制业务逻辑；Web 原 PATCH/PUT 保留，Cookie 仍校验 Origin。

成员昵称仍存 `MemberProfile.nickname`，不改写账号受控字段。App 的「我的」卡片读取本人资料的 displayName，因此重启后仍能看到真实昵称；资料保存结果同步当前页面展示。纯管理员没有成员档案时显示服务端 `MEMBER_REQUIRED`，不伪造成员资料。

## 给 #62 / #63 的边界

- #62 新报名绑定当前账号，由报名接口读取 `userId` 并另存提交时联系快照。可在客户明确同意后用本接口电话作为表单初值，**不能按电话自动认领旧匿名报名**，也不能让资料更新批量改历史报名。
- #63 客户管理复用本表与字段含义，自行使用管理员权限入口；不得把本人接口增加目标 userId，也不另建同义客户表。
- 「我的报名」当前仍为未接入入口，等待 #62 契约；五栏顺序没有改变。
- 下一批的客户收藏、报修消息 DTO 尚未定稿；不使用 MemberProfile/Favorite/Notification 偷换客户归属。本批没有修改 #40 备案、典型标记或证据失效链路。

## 本机运行与迁移

按本机环境应用 `20261013090000_issue61_customer_profile`，仅新增客户资料表与外键，不删除或重建已有业务表。先迁移、再生成 Prisma client；App 连接本机地址后测试，部署交技术主线。本批独立开发/测试库为 `pchospital_exp_issue61_1013` / `pchospital_exp_issue61_1013_test`（127.0.0.1:3308），未在共享库或生产库运行写入/测试。

实际检查与模拟器证据见 [第一批验证](../../docs/verification/issue-61-profile.md)。
