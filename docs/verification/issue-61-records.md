# Issue #61 第三批验证：完整备案与工作摘要

2026-10-13。分支 `feat/issue-61-records-workbench`，基于第二批 `8b02813`（PR #67），第一批 PR #66；本批 [PR #68](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/pull/68)，代码提交 `54c4062`。`origin/main` 包含指定 PR #65 提交 `839c74f`；本批不推 main、不自行合并、不关闭 #61。

## 实际交付与用户确认

独立备案列表/筛选/详情/草稿/编辑/照片/提交、机主字段与电话权限、评论/回复/@成员与原通知、内部已审核备案库，以及工作台真实摘要已接入。保留五栏导航和 #40 原典型案例面板；已审核原始备案与 AI 整理案例分别命名。

维护者已确认：保留课设日期/分类/正文/结果/至少一张照片的提交要求，只同步 Web 机主字段与权限。电话沿用报修 32 字符口径，支持座机/区号；未知姓名不推断成客户昵称。完整契约见 [personal-records-api.md](../../backend/docs/personal-records-api.md)。

## 已执行检查

所有数据库操作仅在本机专用库 `pchospital_exp_issue61_1013` / `_test`（127.0.0.1:3308），无 Docker、生产/共享库操作。新增 nullable 迁移保留第一/二批已有测试资料和订单。本机生产模式后端 13088，模拟器 `http://10.0.2.2:13088`，未修改默认共享地址或部署共享服务。

| 检查 | 实际结果 |
| --- | --- |
| Prisma generate、开发/测试迁移 | 成功，旧记录保留，不回填未知联系信息 |
| `corepack pnpm lint` | exit 0 |
| `corepack pnpm test:unit` | 482/482；新增 4 项真实 ArkTS 状态方法与模拟网络回归 |
| `personal-records.test.ts` | 6/6；真实独立测试库，字段/作者、并发幂等、电话权限、本人分页筛选、提交回放权限、评论/回复/@通知/删除、Web/Native 通道、材料失效与活动联系快照 |
| `staff-repair-records.test.ts` | 8/8；原报修关联建档/并发/取消、版本锁、照片上传读取删除、退回编辑重提通过；增加未知机主姓名与电话快照断言 |
| 后端 `corepack pnpm build` | 生产构建成功 |
| [真实 HTTP 记录](issue-61-records/api-check.json) | 25 项通过；健康、四账号登录、双客户越权、作者/其他成员/审核人员电话范围、本人身份、库筛选、评论/回复实际落库与 @通知、汇总、鉴权照片、独立备案不虚构关联 |
| HAP | 最终 `BUILD SUCCESSFUL`，未签名；4 条既有 PromptAction 警告；SHA256 `71A0113B351C7E4F01438AA6C2A68748E1F8112990FD874A28C87199DDD4ECF0` |
| DevEco 模拟器 | 最终 HAP 安装/启动成功，已实际操作下表页面 |

必要命令（后端 cwd 为 backend；HAP cwd 为 app）：

```powershell
corepack pnpm db:generate
corepack pnpm db:migrate:deploy
corepack pnpm db:migrate:test
corepack pnpm lint
corepack pnpm test:unit
corepack pnpm build
node --env-file=.env -e "process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.RUN_DB_TESTS='1';process.argv=['node','tsx','--test','tests/integration/personal-records.test.ts'];require('tsx/cli')"
node --env-file=.env -e "process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.RUN_DB_TESTS='1';process.argv=['node','tsx','--test','tests/integration/staff-repair-records.test.ts'];require('tsx/cli')"

$env:DEVECO_SDK_HOME='D:/DevEco Studio/sdk'
$env:Path='D:/DevEco Studio/tools/node;'+$env:Path
& 'D:/DevEco Studio/tools/ohpm/bin/ohpm.bat' install
& 'D:/DevEco Studio/tools/hvigor/bin/hvigorw.bat' --mode module -p product=default assembleHap
```

开始时 ArkTS Select 的未显式类型数组导致编译失败，已修复并重建通过。首次新增 DB 用例的清理遗漏评论外键，断言通过但 after hook 失败；已补自身夹具的评论/提及清理，最终 6 项正常退出。上述失败不记为通过。检查没有扩展为全仓审计或全 DB 测试。

## 模拟器操作与证据

DevEco Pura 90，OpenHarmony-6.1.1.125，API24，1320×2856，hdc `127.0.0.1:5555`；CLI `uitest uiInput`/布局转储/screenCap。第一/二批资料、收藏、消息的独立证据见 [第一批](issue-61-profile.md)、[第二批](issue-61-community.md)。

本批使用明确合成的 `SimBook61` / `Owner61` / `Synthetic61` 备案，不是真实维修或生产数据；记录通过真实新建/编辑/提交 API 产生，不直接改表冒充状态。管理员退回、通过通过已有真实审核 API 完成，App 刷新核对；管理员页面不是本批新增功能。界面填写实际姓名与作者分开，备案状态变化不伪造报修订单。

| 操作 | 证据 |
| --- | --- |
| “我的”本人备案/已审核库/我的报名入口 | [工作人员入口](issue-61-records/my-staff-entries.png)；报名明确“等待 #62 接口” |
| 新建独立草稿，编辑并保存机型/机主/座机 | [机主字段](issue-61-records/owner-fields-draft.png)；保存后真实 HTTP 核对字段与固定作者 |
| 无照片禁止提交 | [照片必填提示](issue-61-records/photo-required.png) |
| 打开系统相册，取消返回 | [空相册](issue-61-records/photo-picker-empty.png)；未成功选图上传，详见限制 |
| 真实 API 上传合成 PNG 后 App 鉴权读取/预览 | [照片卡](issue-61-records/api-photo-in-app.png)、[预览](issue-61-records/photo-preview.png)；图片为 320×240 测试渐变，1214 字节 |
| App 提交后待审核只读 | [待审详情](issue-61-records/submitted-readonly.png) |
| 真实管理员退回后 App 显示可编辑，并重新提交 | [退回可编辑](issue-61-records/rejected-editable.png)；退回时编辑保存回归另由真实 DB 用例覆盖 |
| 真实管理员通过后 App 只读，作者/机主与审核时间可见 | [已审核详情](issue-61-records/approved-readonly.png) |
| 原生搜索成员、选择 @、提交评论、回复 | [选择提及](issue-61-records/comment-mention-selection.png)、[评论回复](issue-61-records/comments-reply.png)；实际持久化及收件人由 25 项 HTTP 检查确认 |
| 返回列表读取最新备案；已审核库关键词筛选 | [已审核库筛选](issue-61-records/approved-library-filter.png)，显示原始备案来源 |
| 工作台本人真实汇总/队列/近期备案/消息/收藏入口 | [工作摘要](issue-61-records/workbench-summary.png)；未配置学期显示“待配置”，不显示 0 |

评论时间在最终 HAP 已改用上海时间显示，最终截图复拍；较早的其他截图对应本批功能等价版本。HAP 构建和安装不代表真机通过。

## 未验证范围与剩余工作

- **未真机验证**，没有实体手机。系统相册当前没有图片；`mediatool send /data/local/tmp/issue61-synthetic-photo.png` 失败（create record failed，fileId -13），模拟器未安装相机应用，拍照入口未打开相机。没有完成“从系统相册选择 → App multipart 上传”的设备验证。已验证相册打开/取消、无照片门槛、真实 API 上传/读取/删除（DB 回归）和 App 鉴权预览。
- App 在网络失败/页面销毁/分页重试的状态用例已测；没有声称对所有设备手势或所有异步竞态做全量设备测试。
- 原典型处理/撤回和管理员修改/删除守卫保留，新增材料失效用例通过；本批无收费模型调用，不重复评测自动整理/相似合并/问答全链。
- 活动仅适配机主快照字段；“我的报名”入口等 #62，不实现报名流程。客户原始维修记录入口没有新授权契约，继续标为未接入，不向客户开放内部备案。
- 三批 PR 交技术主线审查；整个 #61 保持开放。共享服务器部署、技术主线验收与选图/真机补证另行安排。
