# Issue #61 第二批验证：收藏与消息

2026-10-13，分支 `feat/issue-61-favorites-messages`，第一批依赖 `0c96b8c`（PR #66）；本批增量可与该提交比较。沿用本批独立开发/测试库 `pchospital_exp_issue61_1013` / `_test`，127.0.0.1:3308；本机生产模式后端 13087，模拟器地址 `http://10.0.2.2:13087`。未部署共享服务、未连接生产库。

## 实际交付

- 客户指南/有效公开 AI 案例收藏、取消/恢复/分页/打开；稳定来源、当前授权复核，不缓存旧正文。
- 客户有效公开案例列表/详情与客户裁剪证据，撤回/转内部/来源失效后不返回旧内容。
- 报修受理/进度/完成/取消的本人站内消息，与状态事件同事务、唯一事件去重；未读、已读、全部已读、删除、详情跳转。
- 成员维修备案收藏与原 Web 通知接入 Native，原收件归属和事件语义保留；五栏只增子路由与原「我的」入口，没重做主页面。

## 已运行检查

| 检查 | 结果 |
| --- | --- |
| 新模型生成、开发/测试迁移 | 均成功；原有开发库资料、订单保留 |
| `pnpm knowledge:index` | 16 篇/135 块真实快照；本机无 embedding Key，仅构建关键词索引，无收费调用，非混合索引验收 |
| `pnpm lint` | exit 0 |
| `pnpm test:unit` | 478/478，通过；本批新增 4 项真实页面状态 + 模拟网络测试 |
| `customer-community.test.ts` | 5/5，真实独立测试库；双客户隔离、指南唯一/恢复、公开案例权限变化与材料失效、分页、事件消息去重、非法状态与事务失败回滚 |
| `pnpm build` | 后端生产构建通过 |
| 真实 HTTP | [26 项通过](issue-61-community/api-check.json)：四角色登录、指南/案例、收藏恢复、越权、真实受理/推进/完成、重复事件、状态 409、消息归属/已读、真实管理接口转内部及客户 404 |
| HAP | 最终 `BUILD SUCCESSFUL`，未签名；4 条既有 PromptAction 警告；SHA256 `5F9017640B1DE33E3BC4AADE0F9BFF805A12B7BBE8C783A189A4E6D61857A444` |

命令：

```powershell
corepack pnpm db:generate
corepack pnpm db:migrate:deploy
corepack pnpm db:migrate:test
corepack pnpm knowledge:index
corepack pnpm lint
corepack pnpm test:unit
corepack pnpm build
node --env-file=.env -e "process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.RUN_DB_TESTS='1';process.argv=['node','tsx','--test','tests/integration/customer-community.test.ts'];require('tsx/cli')"
corepack pnpm exec tsx --test tests/unit/customer-community-app.test.ts
```

DB 回滚用例：真实 MySQL 已写订单状态和事件后，仅在测试进程代理事务内通知 create 抛失败；500 后实际查询订单仍 SUBMITTED、无 ACCEPTED 事件、无消息。未增加应用数据库权限。早期触发器方案受本机 MySQL 权限/协议限制，已移除；不把它记为通过。最小回归只清理自身夹具，既有工作人员测试夹具同步清理其新通知外键，不清共享库。

客户端测试覆盖重复加载/操作、分页失败重试同页、刷新清旧数据、页面销毁后迟到响应、案例读取失败清除旧正文。成员通知标签与原 Web 四种类型一致。

## 模拟器（实装）

DevEco Pura 90，OpenHarmony-6.1.1.125，API24，1320×2856，hdc 127.0.0.1:5555。未签名 HAP 安装/启动成功；本批地址设置为主机 13087。CLI 使用已有 `uitest uiInput`、布局转储与 screenCap 操作/截图。

- [客户收藏](issue-61-community/favorites.png)：指南与案例、打开、取消；从公开案例目录重新收藏恢复。
- [指南收藏](issue-61-community/guide-favorite.png)：真实社团公开文档与收藏按钮。
- [公开案例详情](issue-61-community/public-case.png)：正文及裁剪证据，无作者/原备案/照片入口。
- 通过真实管理员 API 转内部 → 详情刷新 [不可访问](issue-61-community/case-unavailable.png) → 返回收藏自动刷新为 [不可访问项](issue-61-community/favorite-unavailable.png)，旧标题/正文不再显示；之后测试管理员恢复 PUBLIC。
- [客户消息](issue-61-community/messages.png)、[全部已读/删除](issue-61-community/messages-read-deleted.png)：查看详情实际展开对应本人报修，返回刷新；计数随实际服务端结果变化。
- [成员通知](issue-61-community/member-message.png)：合成成员 B 用现有 Web Cookie+合法 Origin 评论 API 实际留言，原通知服务产生作者站内消息；App 读取、已读/删除、跳转备案。
- [成员收藏](issue-61-community/member-favorite.png)、[取消后空态](issue-61-community/member-favorite-empty.png)：在真实备案详情收藏；取消后从详情再收藏，复用原行。消息删完后 [真实空态](issue-61-community/member-messages-empty.png)。

**受控资料说明**：为验证公开案例状态/材料有效性，本机独立库建立明确标名「合成验证案例61（非模型生成）」的受控案例与备案来源，未伪称本批调用模型生成/审核成功。报修消息来自真实 API 状态操作；指南来自真实仓库快照。没有产品代码硬编码业务结果、没有导入生产数据。

## 未验证/剩余

- 未实体手机；分页边界主要由真实 DB 路由与页面状态测试覆盖，模拟器未造满 20 条消息。
- 未调用付费模型或重测 #40 整理链路；保留原守卫，并增加客户端公开读取的材料有效性复核。
- 第三批完整独立备案、照片/评论/@原生交互、已审核备案库和工作摘要尚未交付；#61 不关闭。
- 共享部署交技术主线；App 本机配置不改变仓库共享地址默认值。

契约见 [收藏与消息 API](../../backend/docs/customer-community-api.md)。
