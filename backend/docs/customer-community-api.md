# Issue #61 第二批：收藏、公开案例与站内消息

依赖第一批客户资料模型（PR #66）。客户按账号归属，与成员 `RepairFavorite/Notification` 分开；接口统一成功/失败信封，私有列表/正文均 `private, no-store`。本批迁移 `20261013110000_issue61_customer_community` 只新增表/外键，不删除现有课设数据。共享部署交技术主线。

## 客户收藏

| 方法与路径（均 `/api/v1`） | 数据/规则 |
| --- | --- |
| `GET /customer/favorites?page=1&pageSize=20` | `data` 数组，分页在 `meta.pagination`；仅本人未取消的项 |
| `POST /customer/favorites` | `{kind:"GUIDE"或"CASE",sourceId}`；只允许两个字段；当前源必须可访问 |
| `DELETE /customer/favorites/:id` | 本人收藏行 ID；别人或不存在统一 404 |

`CustomerFavorite` 唯一键 `(userId,kind,sourceId)`。指南将当前公开 chunk ID 解析成稳定 `sourcePath` 存储，列表返回当前可打开的 chunk ID；文档更新不因新 chunk ID 重复建收藏。案例保存稳定 case UUID。取消是软删除，恢复复用同一行；无正文、旧标题、作者或照片快照。

可访问项：`{id,kind,sourceId,title,targetId,available:true}`。源撤回/失效/转内部后：`{id,kind,sourceId,title:"内容不可访问",targetId:null,available:false}`，可取消，不提供旧标题/正文/内部证据。指南索引不可用返回明确 503，不能当成「暂无收藏」；恢复时仍复核源。客户端每次进入/返回列表刷新，打开通过正文接口再次判权；分页每页 20，整页时允许继续请求，最后满页可能多读一空页，不把当前一页当总量。

## 客户公开 AI 案例

- `GET /customer/knowledge-cases?page=1&pageSize=20`：本人客户会话，返回当前有效公开案例最小目录 `{caseId,title,contentVersion,updatedAt}`，分页在 meta。
- `GET /customer/knowledge-cases/:id`：复用 #40 的客户引用裁剪和当前状态/内容版本。仅 PUBLISHED + PUBLIC、存在有效来源、来源备案 APPROVED/典型/未删除且材料 hash 未变。无效统一 404 `CASE_NOT_FOUND`，无旧正文。
- 详情含结构化/展示正文与可公开的引用证据；`authorName/repairRecordId` 为 null，`canOpen:false`，没有备案原文入口或照片。本批不把工作人员 `/knowledge-cases/:id` 对客户开放。
- App 新增独立公开案例目录/详情子页，标明「AI 整理案例」；收藏/刷新时内容失效立即清除旧正文。Web 已审核原始备案库在第三批迁移，是不同来源。

## 客户消息

| 方法与路径 | 规则 |
| --- | --- |
| `GET /customer/notifications?page=1&pageSize=20` | `data:{items,unreadCount}`，meta 分页；items 含 `id/title/body/readAt/createdAt/repairOrderId` |
| `POST /customer/notifications/:id/read` | 本人消息；重复已读仍成功；他人 404 |
| `POST /customer/notifications/read-all` | 仅本人未删/未读消息，返回 `updatedCount` |
| `DELETE /customer/notifications/:id` | 仅本人，软删除，未读统计排除 |

`CustomerNotification` 按 `User.id` 收件，关联实际 `RepairOrderEvent`，`eventId` 唯一。受理 ACCEPTED、处理中 REPAIRING、完成 COMPLETED、取消 CANCELLED 在**订单条件更新 + 进度事件的同一事务**生成消息。重复状态请求本来不产生事件，因此不重复发；通知写失败则状态、事件和通知全部回滚，失败状态转换也不发假消息。没有为旧历史事件补发消息。

详情跳转到客户本人报修页并展开对应单据；服务器仍校验单据归属。进入页面/返回刷新，不做系统推送。读取失败时未读数显示不可用，不以 0 冒充成功读取。

## 成员原有能力

成员仍使用 `/member/favorites`（维修备案收藏）和 `/member/notifications`（MENTIONED / REPAIR_COMMENTED / REPAIR_APPROVED / REPAIR_REJECTED）。仅这些负责范围的写路由改用公共 `assertWriteAccess`，原 Web Cookie+Origin 保留，Native Bearer+客户端头独立校验。鉴权、收件人 MemberProfile、取消/恢复和原评论/@通知服务未另建副本。

App 的「我的」接通收藏与消息，备案详情可收藏，成员消息打开原备案。纯管理员无成员档案时沿用 `MEMBER_REQUIRED`，不伪造成员收藏/通知。成员回复/@通知产生路径在第三批原生评论页面迁移，本批通过真实 Web 评论接口生成通知验证读取/已读/删除和跳转。

## 给 #62 / #63 的约定

- 本批拥有 `CustomerFavorite/CustomerNotification`，勿复用成员表或另建同义客户对象。
- 客户消息目前只来自实际报修状态事件；#62 活动消息若扩展，先定义独立事件唯一键，不滥用 repairOrder/event 关系。
- #63 管理操作仍走管理员服务，客户本人接口不能增加任意 userId。案例管理保留 #40 服务及失效处理。

实际验证、受控合成案例说明与模拟器截图见 [第二批验证](../../docs/verification/issue-61-community.md)。
