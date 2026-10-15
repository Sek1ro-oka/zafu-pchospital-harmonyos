# Issue #62 活动闭环验证记录

本页为首轮历史记录。2026-10-15 新任务已取代取消出勤保留安排，系统选图与最终包新增证据见 [收尾验证](issue-62-completion.md)；下方限制描述仅代表当轮结果。

验证于 2026-10-14 至 2026-10-15，范围为客户账号报名、成员现场接待及管理员活动管理。本分支保留取消成员出勤的契约缺口，不建议关闭整个 #62。接口和 #63 路由交接见 [原生活动契约](../../backend/docs/native-activities-api.md)。

发布前再次同步 main `2e2b14becb0a09d8ce6d7a1fac5637a7db3b3b6e`（#71/#72），使用普通 Merge 保留历史；解决 FormControls 与路由测试重叠，保留最新默认保持登录、改密强制标记复位及活动参数测试。常规 Git HTTPS 连接重置，改用 GitHub Git 数据 API 获取对象，逐个核对 SHA 并通过祖先完整性校验。合并后单测 521/521；其余最终检查与产物见下表。

## 基点与隔离环境

- 开工 fetch 后将原工程 main 快进到 `9ac3226db7fea4d670d9ade394d88f591df55361`；保留原工程的 `app/oh-package-lock.json5` 改动及 `.preview/`。在独立英文路径检出建立 `feat/issue-62-activities`，没有覆盖用户工程。发布前又将原工程 main 快进至 `2e2b14b`，上述两处用户文件状态仍保留。
- 固定 Web 参照 `e78d057e5bad64c7a73d89f4bad425473156f625`，选择性同步签到调整、电话授权及接待草稿，未导入原 Web 数据。
- 本机 Node 25.6.0、仓库锁定的 pnpm 12.4.1、原生 MySQL 9.6；独立实例 `127.0.0.1:3310`，开发库 `pchospital_exp_issue62` 与测试库 `pchospital_exp_issue62_test`，不同数据库账号。无 Docker、共享库清理或共享部署。
- 本机生产模式 API `http://127.0.0.1:13082`，HDC 反向端口供模拟器访问；App 设置中显式保存此地址，源码默认共享地址保持。
- 两个合成客户、有效成员、无成员档案的纯管理员；姓名、电话、机型、活动和照片均为合成验收材料，令牌与数据库凭证未纳入证据。

## 命令与结果

下列命令在 `backend/` 执行；本机缺 Corepack，实际调用经完整性核对的 pnpm 12.4.1 原生可执行文件，与仓库 packageManager 版本一致。Prisma 使用已核对官方 SHA256 的本机 schema-engine。

| 检查           | 命令 / 操作                                                                                                                                                                                                                                                   | 实际结果与证据                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma         | `pnpm db:generate`、`pnpm db:migrate:deploy`、`pnpm db:migrate:test`                                                                                                                                                                                          | 生成成功；开发/测试库均应用 17 条迁移                                                                                                                                                                                                                           |
| 历史升级       | 先应用 main 的 16 条迁移，插入匿名合成行，再应用本次迁移                                                                                                                                                                                                      | 旧列逐项相同；userId、旧条款时间/版本及地点保持 null；[结果](issue-62-activities/migration-check.json)                                                                                                                                                          |
| lint           | `pnpm lint`                                                                                                                                                                                                                                                   | exit 0；[日志](issue-62-activities/lint.txt)                                                                                                                                                                                                                    |
| 单测           | `pnpm test:unit`                                                                                                                                                                                                                                              | 521/521，0 skipped；[日志](issue-62-activities/unit-tests.txt)                                                                                                                                                                                                  |
| 相关数据库回归 | `pnpm test:db tests/integration/native-activities.test.ts tests/integration/repair-activity-consent.test.ts tests/integration/repair-activity-device-model.test.ts tests/integration/personal-records.test.ts tests/integration/staff-repair-records.test.ts` | 44/44，0 skipped；[日志](issue-62-activities/database-tests.txt)；未运行全量 DB 测试                                                                                                                                                                            |
| 后端生产构建   | `NEXT_TELEMETRY_DISABLED=1 pnpm build`                                                                                                                                                                                                                        | exit 0，含生产编译、类型检查和路由生成；[日志](issue-62-activities/backend-build.txt)                                                                                                                                                                           |
| 额外 tsc       | `pnpm exec tsc --noEmit`                                                                                                                                                                                                                                      | 开工基点/合并 main 前功能分支各 45 个既有测试类型错误，按文件和错误码统计一致，无新增源码错误；[对比](issue-62-activities/tsc-comparison.json)、[基点](issue-62-activities/baseline-tsc.txt)、[功能分支](issue-62-activities/feature-tsc.txt)。此额外检查未通过，未扩大修复范围 |
| HAP            | DevEco `hvigorw.bat --mode module -p product=default assembleHap`                                                                                                                                                                                             | BUILD SUCCESSFUL；[日志](issue-62-activities/hap-build.txt)                                                                                                                                                                                                     |
| 真实 HTTP      | 本机生产模式 API，四种身份逐次登录/退出                                                                                                                                                                                                                       | 12 项断言通过，含 A/B 隔离、直接越权、纯管理员拒绝、电话权限/缓存；[结果](issue-62-activities/api-check.json)                                                                                                                                                   |

`db-task.mjs` 仅为 test 子命令增加现有 integration 文件白名单参数，保留 `_test` 库保护；迁移/重置参数未放宽。构建明确 tracing root，避免本机父目录 package-lock 导致整用户目录追踪；Windows 本机遥测 EXDEV 通过关闭遥测排除，无共享部署产物。

## 模拟器与产物

续做时本机 API / 独立数据库进程已停止，首次核验连接失败；恢复原实例与已构建 API 后，额外 8 项只读 HTTP 核验通过，确认地点/容量、软删除计数、本人 SERVED、关联 PENDING 及无待提交草稿均持久化，见 [最终状态](issue-62-activities/final-state-check.json)。

设备 `127.0.0.1:5555`，型号 emulator，API 26，x86_64，系统 `emulator 7.0.0.107(SP8DEVC00E999R4P11)`，1256×2760。使用 DevEco Studio 默认 SDK，实际安装并运行本次未签名 HAP，未以预览器模拟存储代替登录验收。

产物：`app/entry/build/default/outputs/default/entry-default-unsigned.hap`，2,813,264 字节，SHA256 `8361502DF715F855CA0152B03E562D3E2344D6A0054C6711DE50DD52C8CE2410`。构建产物未提交到 Git；无实体手机、发布签名或共享部署。上述截图/装机操作来自合并最新 main 前的 HAP（SHA256 `4E9B35A3288DCEB72285A768FDD1D3E9AFAB17667FFAB273EAC4C94795BCBF35`）；合并后最终 HAP 已重新构建，当前 `hdc list targets` 为 `[Empty]`，未对最终包重复装机，不将此前截图标作最终包截图。

## 任务书场景核对

| 场景           | 实际验证及边界                                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T01 登录续接   | 模拟器游客详情→登录→原活动报名；注册新客户及强制改密后均回原活动。登录路由取消行为由已有及新增路由单测覆盖，未单独截图取消                                                                                                     |
| T02 本人持久化 | 客户 A 报名、修改类型、强制停止 App 再打开，本人列表仍有 1 条；HTTP 登录后的本人归属相同                                                                                                                                       |
| T03 越权/伪造  | DB 回归及真实 HTTP：B 读/改 A 均 404；伪造活动 ID/归属不能修改所有权；本人 DTO 不含内部备案 ID/正文                                                                                                                            |
| T04 匿名兼容   | 迁移前匿名行保留；同手机号账号不认领由 DB 回归覆盖；模拟器独立匿名入口查询历史行，B 本人列表为空                                                                                                                               |
| T05 窗口/查重  | DB 回归覆盖五态、开始边界、手机号重复；模拟器未同意提交明确失败，不显示成功                                                                                                                                                    |
| T06 并发报名   | DB 实际竞争最后名额和重复手机号，容量不超额；App 双击提交防重由异步单测覆盖                                                                                                                                                    |
| T07 条款/限流  | API 返回实际条款；DB 覆盖缺同意、旧版本 409、字段错误/限流，旧 Web 省略版本兼容；App 条款及失败输入保留已验证                                                                                                                  |
| T08 修改/撤回  | 本人 REGISTERED 修改；已签到/已接待拒绝由 DB 回归覆盖；模拟器队列撤回后回待签到，再次签到成功；不释放容量                                                                                                                      |
| T09 出勤/签到  | DB 覆盖截止闸门、未出勤拒绝、签到类型调整/审计及顺序；模拟器标记出勤，按姓名过滤，将类型改为 CLEAN_ONLY 后入队                                                                                                                 |
| T10 竞争接待   | DB 两成员并发同一报名，只关联一个草稿；重复接待不建第二份；模拟器接待跳真实 DRAFT 编辑页                                                                                                                                       |
| T11 全局草稿   | DB 同成员跨活动竞争最多一个未提交接待草稿；模拟器看板显示继续填写入口和已接待草稿；提交后解除拦截                                                                                                                              |
| T12 填写/提交  | 模拟器人工填写正文、显式选择 COMPLETED、耗时 25 分钟并保存；系统相册为空，照片通过真实本机 API multipart 上传 PNG；App 刷新出现缩略图并实际点击提交，返回 PENDING。DB 回归另覆盖缺材料拒绝及真实照片提交。系统选图上传仍未验证 |
| T13 角色隔离   | 纯管理员在模拟器现场入口被拒绝，管理功能可用；DB/HTTP 客户电话和内部访问拒绝；管理员无法替代有效成员                                                                                                                           |
| T14 电话       | 模拟器默认掩码→按需查看→隐藏；HTTP 成员未出勤也可读，客户拒绝；private,no-store，审计不写完整号码由 DB 回归覆盖                                                                                                                |
| T15 管理       | 模拟器创建活动（原生日期/时间选择）、编辑地点/容量、改报名姓名、软删报名/新建活动；本机接口确认地点与容量保存；DB 覆盖授权、时间/容量与软删除计数                                                                              |
| T16 写通道     | DB Cookie+Origin / Bearer+native、缺凭证/标识、Cookie 优先等回归通过；Web 匿名服务与 POST 别名兼容。未用浏览器逐页验收 Web UI                                                                                                  |
| T17 时序/失败  | 异步单测覆盖离开重进旧 finally、切账号迟到结果、分页失败原页重试；模拟器切 B 后为空，停止本机 API 后刷新失败，再启动服务点击重试恢复。未在设备人为注入延迟网络或构造多页本人数据                                               |
| T18 升级保留   | 实际 16→17 迁移并比较旧行，不自动绑定账号，不回填历史条款；[升级证据](issue-62-activities/migration-check.json)                                                                                                                |

## 截图索引

- 游客与报名：[列表](issue-62-activities/guest-activity-list.png)、[详情](issue-62-activities/guest-activity-detail.png)、[实际条款](issue-62-activities/guest-activity-consent.png)、[登录目标](issue-62-activities/signup-login-intent.png)、[续接](issue-62-activities/signup-resumed.png)、[未同意拒绝](issue-62-activities/signup-consent-required.png)、[报名成功](issue-62-activities/signup-success.png)。
- 本人与身份：[本人详情](issue-62-activities/my-registration-detail.png)、[修改后](issue-62-activities/my-registration-updated.png)、[重启恢复](issue-62-activities/my-registrations-after-restart.png)、[注册续接](issue-62-activities/registration-resumed-signup.png)、[B 空列表](issue-62-activities/second-customer-empty.png)、[强制改密](issue-62-activities/forced-password-page.png)、[改密续接](issue-62-activities/password-resumed-signup.png)、[旧匿名查询](issue-62-activities/anonymous-lookup.png)。
- 现场：[未出勤看板](issue-62-activities/staff-board-before-attendance.png)、[授权电话](issue-62-activities/staff-authorized-phone.png)、[签到队列](issue-62-activities/staff-queue.png)、[撤回](issue-62-activities/staff-withdrawn.png)、[接待草稿](issue-62-activities/served-draft-editor.png)、[继续草稿](issue-62-activities/staff-pending-draft.png)、[已接待](issue-62-activities/staff-served-list.png)、[API 照片展示](issue-62-activities/draft-with-api-photo.png)、[提交待审核](issue-62-activities/served-record-submitted.png)、[提交后看板](issue-62-activities/staff-submitted-board.png)。
- 管理与失败：[纯管理员现场拒绝](issue-62-activities/pure-admin-staff-denied.png)、[管理列表](issue-62-activities/admin-activity-list.png)、[编辑保存](issue-62-activities/admin-activity-saved.png)、[报名修改](issue-62-activities/admin-registration-updated.png)、[报名软删](issue-62-activities/admin-registration-deleted.png)、[日期选择](issue-62-activities/admin-date-picker.png)、[创建结果](issue-62-activities/admin-created-activity.png)、[活动删除](issue-62-activities/admin-activity-deleted.png)、[网络失败](issue-62-activities/network-failure-retry.png)、[重试恢复](issue-62-activities/network-retry-restored.png)。

## 发现的问题和限制

实际注册页面复现开工基点的 `$$this is not defined` 崩溃，见 [原始故障片段](issue-62-activities/registration-crash-before-fix.txt)。自定义 LabeledInput 改为显式单向属性及回调更新，注册/改密各调用一致；重新构建安装后实际注册与强制改密续接通过，原生 TextInput 的双向绑定保持。发布前 main #71 同步修复了相同崩溃，合并时保留该修复，并将 text 标为 @Prop 以接收父组件状态更新。

初次运行缺 Prisma 生成客户端/文档 manifest，先完成生成；集成断言按接口实际 200/201 和 `REPAIR_SUBMISSION_INCOMPLETE` 字段错误修正后重跑为 44/44。额外 tsc 的 45 个基线测试错误如上保留记录。

用户确认“先保留缺口，完成其余链路”：课设及固定 Web 均只有标记成员出勤，取消条件未定义，未增加无条件取消接口，也未将其勾选完成。系统照片选择器可打开但相册无图片，[观察记录](issue-62-activities/photo-picker-observation.json) 明确系统选图上传未通过；API 上传、App 展示和 App 提交已验证。实体手机、共享后端部署、付费模型与 #40 完整 AI 回流本轮未验证。当前交付用于审查，不合并、不关闭 Issue。
