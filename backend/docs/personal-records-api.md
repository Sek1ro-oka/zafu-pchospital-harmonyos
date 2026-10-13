# Issue #61 第三批：独立备案与工作摘要

2026-10-13。依赖第一批个人资料、第二批收藏/消息；App 使用五栏导航内的子页。与 [原生鉴权](native-client-api.md)、[报修与关联备案](native-repairs-api.md)、[收藏/消息](customer-community-api.md) 一起使用。

## 已确认的口径

参照 Web 固定提交 `e78d057e5bad64c7a73d89f4bad425473156f625`，选择性同步机主字段和权限。**维护者明确确认保留课设提交规则**：有效日期、启用分类、非空维修正文、实际维修结果、至少一张照片。不会改成 Web 当前的“姓名/11 位手机必填，正文/照片可空”。

| 对象/字段 | 本批规则 |
| --- | --- |
| `RepairRecord.memberProfileId` | 备案作者；服务器按有效成员档案定位，不接受请求改写 |
| `ownerName` | 可空、去首尾空格、最多 40 字；未知不根据昵称推断 |
| `ownerPhone` | 可空、最多 32 字符；至少 7 位数字，只允许数字、`+`、`-`、空格、括号，与报修电话校验相同 |
| `deviceModel` | 可空、最多 60 字；独立备案可编辑，修改关联备案不回写原报修单 |
| 独立草稿结果 | 默认为 `null`；工作人员真实选择后保存，不预置“已完成” |

迁移 `20261013130000_issue61_repair_owner` 只新增两列 nullable 字段，保留已有课设数据。历史值维持空值；不导入 Web 数据。

### 来源和权限

- 独立备案：由工作人员填写机主字段；不猜测客户归属，不因此绑定客户账号。
- 报修建档：复制 `RepairOrder.contactPhone` 和机型，姓名无明确来源则空。后续编辑备案联系字段不改原报修联系快照；既有单据和备案状态独立。
- 活动接待：既有 `createSubmittedForActivity` 新增可选 `ownerName/ownerPhone`，接待服务从报名 `name/phone` 快照传入。**本批不改变既有活动接待状态、照片例外、结果和审计流程**；#62 后续改变接待建档流程时须自行对齐，不因本批字段适配宣称活动闭环完成。
- 电话仅备案作者本人或有 `repair:review` 的人员获得；其他有权阅读备案的内部成员收到 `ownerPhone:null`。详情、列表、写入及幂等回放均经过服务器验证；默认视图不返回电话。
- 其他成员只可读 `APPROVED` 备案；作者可读本人记录，审核人员沿用原管理权限。客户不能读取原始 `RepairRecord`、照片、评论、成员摘要。
- 机主姓名不是备案作者，不改变 `memberProfileId`，不用于把客户报修、备案、报名合并为一个对象。

## 列表与建档

| 接口 | 返回/规则 |
| --- | --- |
| `GET /api/v1/member/repairs` | 新增本人列表；服务器强制当前有效成员 ID，忽略客户端 `memberId`；纯管理员无成员档案时 `MEMBER_REQUIRED` |
| `GET /api/v1/repairs?status=APPROVED` | 复用内部已审核备案库；列表每条保留原始备案来源，与 AI `KnowledgeCase` 分开 |
| `POST /api/v1/repairs` | 创建独立 `DRAFT`，`Idempotency-Key` 必填；并发/重试复用原备案，不重复写 CREATED；其他作者复用键为 409 |
| `GET /api/v1/repairs/{id}` | 原详情，增加机主字段；含服务器 `canEdit/canReview`、照片、审核和时间线 |
| `POST /api/v1/repairs/{id}` | 原 PATCH 的原生别名；要求 version，只允许本人 DRAFT/REJECTED；新增 deviceModel/ownerName/ownerPhone 可空字段 |
| `/repairs/{id}/photos`、`/submit` | 复用已有照片/提交服务；版本冲突、照片必填、幂等、退回重提规则不变 |

两种列表都支持原 `page/pageSize`、`categoryId`、`query`（正文/备注/作者）、`result`、`repairDateFrom/To`、`isTypical/isDifficult`；本人列表额外支持状态。响应为原信封 `data:RepairView[]`、`meta.pagination`。App 每页 20，整页时允许继续请求，末尾无结果显示已到末尾；下一页失败不推进页码，不把尚未应用的输入混进旧分页。

保存示例：

```json
{
  "version": 2,
  "deviceModel": "实验机型",
  "ownerName": "合成机主",
  "ownerPhone": "0571-12345678",
  "repairDate": "2026-10-13",
  "categoryId": "有效分类ID",
  "content": "实际检查与维修过程",
  "result": "COMPLETED",
  "durationMinutes": 30,
  "remark": null
}
```

写入仍使用公共 `assertWriteAccess`，Native Bearer + `X-Client-Type:native`，Web Cookie + 可信 Origin；App 不伪造 Origin。权限不以隐藏按钮代替。

## 备案评论

- `GET /repairs/{id}/comments?page=1&pageSize=20`：分页根评论，附本页回复；只返回当前可读记录的评论。
- `POST /repairs/{id}/comments`：`{body,parentCommentId?,mentionedMemberProfileIds?}`，最多 2000 字、最多 @10 人；回复的回复归同一根评论。显式成员 ID 与原文本提及解析沿用现有服务。
- `DELETE /repairs/{id}/comments/{commentId}`：本人可删除，有治理权限的人按原规则删除；服务器返回 `canDelete` 只用于界面提示。
- 本批只将上述写路由接入公共 Web/Native 校验，没有替换原通知事务或收件人规则。提及备案作者时一条评论只生成一次通知，失败评论不会发送通知。
- App 用 `/member/directory` 搜索、分页选择要提及的成员；请求发送期间禁用输入/提交，失败保留正文和回复目标。

## 工作摘要

复用 `GET /api/v1/member/dashboard`，按服务端身份聚合：正式已审核维修数量/分钟、本月/学期、草稿/待审/退回队列、近期本人备案、消息未读数、收藏数量及跳转。

`MetricValue.UNCONFIGURED/value:null` 显示“待配置”；`degraded` 中的队列/近期区块显示不可用，不能展示回退结构内的假 0；消息/收藏 `available:false` 显示摘要不可用。整页失败提供刷新重试，重新加载清除旧摘要。课程环境尚未配置学期时不伪造学期统计。

## #40 与跨模块边界

- 本人草稿/退回编辑使用公共 `repairService`，实质材料哈希变化后使旧来源失效；管理员编辑/删除、典型标记继续原 #40 失效/重整服务。
- 机主字段不进入 `materialOf` 或 AI 引文材料，不能通过新增字段绕过证据失效校验。
- 自动整理、合并、发布、撤回、证据失效保持现状；本批没有调用收费模型，不宣称重新验收 AI 全链。
- #62 使用报名快照传机主信息；“我的报名”已预留并标明等待接口，App 活动报名本批未实现。
- #63 复用共同 Schema、保存/审核服务和权限视图；不整文件覆盖导航/Schema，不绕过公共服务直接写表。
- 客户的原始“维修记录”入口继续如实标为未接入，不能把内部备案库开放给客户。

实际命令、模拟器证据与未验证范围见 [第三批验收记录](../../docs/verification/issue-61-records.md)。共享部署由技术主线另行安排。
