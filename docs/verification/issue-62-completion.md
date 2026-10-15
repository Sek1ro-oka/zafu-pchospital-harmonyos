# Issue #62 收尾验收（2026-10-15）

按本轮《Issue-62-全部完成-writer收尾开发文档》继续 PR #74，取代首轮“取消出勤保留缺口”的安排。取消出勤、历史处理兼容、现场事务互斥、管理员精确重试，以及最终包系统选图上传已补齐。功能与本模块必要验收已可供技术主线审查；未合并、未关闭 Issue、未部署共享后端。

首轮记录见 [历史验证](issue-62-activities.md)，本轮 API/状态/权限及 #63 路由见 [活动契约](../../backend/docs/native-activities-api.md)。本页所有 `same-package-*` 截图来自下述同一最终源码安装包，未将首轮截图当作本轮最终包证据。

## 源码、包与环境

- 接续 PR #74 HEAD `abf405ebb244a92025093c90325848cdbf16412a`；开工核实最新 main `8129961a4d91e4b6fa3ca39621a9a89600deaeba`，普通 Merge 保留 #71/#73。常规 Git HTTPS 连接重置，改用已认证 Git 数据 API 获取缺失对象，逐个校验 SHA 和完整祖先。
- 最终功能源码冻结于 `6e28dc015b2fed732aa51ea031f8487fa68b62b1`。后续仅补测试可信 Origin 配置可移植性（`57a442e`）及契约/记录/证据，不改变验收运行代码；App、后端源码、Prisma 和测试树 SHA 见 [产物记录](issue-62-completion/artifact.json)，用于核对交付与验收代码相同。没有强推、直推 main 或改写已合并历史。
- 最终未签名 HAP：`app/entry/build/default/outputs/default/entry-default-unsigned.hap`，2,897,550 字节；SHA256 `47F26DF19A67DC6B095AACEF071232B0096CCDD1AF6B9825971F0D6566F413F9`。已构建、安装、运行；临时选图诊断已移除，最终同包链路重新跑通。
- 用户已安装的 Pura 90 Pro 模拟器配置，HDC `127.0.0.1:5555`，API 26、x86_64、1256×2760，系统 `7.0.0.107`；DevEco SDK 默认环境。无实体手机或发布签名验收。
- 本机 Node 25.6.0、锁定 pnpm 12.4.1、原生 MySQL 9.6；独立实例 `127.0.0.1:3310`，开发库 `pchospital_exp_issue62` 与 `_test` 分离。真实 API `http://127.0.0.1:13082`，HDC 反向端口供 App 使用；源码共享默认地址保持。
- 活动、账号、报名、维修材料、截图均为合成验收样本。没有调用收费模型、迁移原 Web 数据、修改共享账号密码或对共享库运行清理测试。凭证、令牌不纳入证据。

## 实现与必要修复

出勤行增加 nullable `cancelledAt/businessStartedAt`，取消保留历史和唯一关系，重新出勤恢复同一行。只定位当前有效成员本人；本人成功签到/类型调整、撤回或接待后永久禁止取消，不因报名回到 REGISTERED、软删除或备案提交而解除。看板、电话读取不计业务处理。

旧行没有业务标记时，按本人、本场的 SUCCESS USER 审计及接待来源判定，包含软删除报名。当前现场成功事务首次记录业务时间；失败事务回滚。取消、签到、撤回、接待共用活动锁，事务内检查有效出勤；接待保留成员→活动锁序。App/Web 共用 DELETE 服务、确认与状态反馈，重复取消无重复状态变更审计。

管理员重试保存失败的 load/save/delete、活动与报名目标、提交快照及会话身份；删除 B 失败后只重试 B，不保存 A。写成功后刷新失败只重读。列表渲染按字段变化更新，软删除不会继续显示可操作旧行；切账号即使读取失败，也清除旧列表/编辑内容，迟到回调不回写。

## 命令与实际结果

命令在 `backend/` 执行；本机直接使用已核对完整性的 pnpm 12.4.1 可执行文件，版本与 packageManager 一致。Prisma 使用核对过官方校验和的本机 schema-engine。

| 检查           | 实际命令/操作                                                                                                                                                                                                                                                 | 结果                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma 生成    | `pnpm db:generate`                                                                                                                                                                                                                                            | exit 0                                                                                                                                                                     |
| 追加迁移       | `pnpm db:migrate:deploy`、`pnpm db:migrate:test`                                                                                                                                                                                                              | 两库均 18 条迁移；追加 `20261015133000_issue62_attendance_cancellation`，未 reset/改写旧 #74 迁移                                                                          |
| 升级只读核验   | 本机独立库查询字段和迁移前出勤                                                                                                                                                                                                                                | 两新列 nullable；旧出勤时间仍在、两字段仍 null；历史取消实际 409；[结构/旧行](issue-62-completion/migration-check.json)、[HTTP](issue-62-completion/final-http-check.json) |
| lint           | `pnpm lint`                                                                                                                                                                                                                                                   | exit 0；[日志](issue-62-completion/lint.txt)                                                                                                                               |
| 单测           | `pnpm test:unit`                                                                                                                                                                                                                                              | **529/529，0 skipped**；[日志](issue-62-completion/unit-tests.txt)                                                                                                         |
| 相关数据库回归 | `pnpm test:db tests/integration/native-activities.test.ts tests/integration/repair-activity-consent.test.ts tests/integration/repair-activity-device-model.test.ts tests/integration/personal-records.test.ts tests/integration/staff-repair-records.test.ts` | **54/54，0 skipped**；[日志](issue-62-completion/database-tests.txt)，含原 #74 的 44 项；未运行无关全量 DB 套件                                                            |
| 后端生产构建   | `NEXT_TELEMETRY_DISABLED=1 pnpm build`                                                                                                                                                                                                                        | exit 0；[日志](issue-62-completion/backend-build.txt)                                                                                                                      |
| ArkTS/HAP      | DevEco `hvigorw.bat --mode module -p product=default assembleHap`                                                                                                                                                                                             | BUILD SUCCESSFUL，实际安装运行；[日志](issue-62-completion/hap-build.txt)                                                                                                  |
| 最终真实 HTTP  | 四角色登录/逐次鉴权，临时会话最后吊销                                                                                                                                                                                                                         | **27 项断言通过**；[结果](issue-62-completion/final-http-check.json)                                                                                                       |
| 精确重试持久化 | 最终 App 删除失败/重试后，API 读取 A/B                                                                                                                                                                                                                        | **2 项断言通过**，A 原姓名未提交、仅 B 软删除；[结果](issue-62-completion/final-retry-http-check.json)                                                                     |

首次新增 DB 用例因夹具使用大写 Authorization 属性报错，修正为 harness 的小写键后完整重跑 54/54；只读迁移核验脚本初次 CJS 顶层 await 不支持，改为 async 入口后通过。输入法/滚动导致早于实际结果的截图和中间诊断已移除；仅在实际 UI 或服务器确认后记录成功。首轮额外 tsc 的 45 个基线测试类型错误保留在历史记录，本轮未扩大修复，标准生产构建通过。

## 收尾任务 C / R / E 对照

| 项目    | 本轮证据与结论                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01/C02 | DB 首次/重复取消、重复标记、恢复同一行及审计数量通过；最终包实际标记→确认取消→恢复，取消不改客户报名/队列/名额                                                                  |
| C03/C04 | DB 签到后、签到再撤回、仅撤回他人签到、接待及提交后均 409；最终包签到/接待后显示不可取消，HTTP 提交后 DELETE 仍冲突                                                             |
| C05     | DB 其它成员本场、本人其它场、读取电话均不误判；取消后仍可授权读电话，但现场写入拒绝                                                                                             |
| C06     | DB 批量签到后条失败回滚，前条状态/标记/审计均不残留，仍可取消                                                                                                                   |
| C07     | DB 取消分别与签到/接待/撤回竞争，每种重复 3 轮并交换发起顺序，只允许合法一方成功，无孤立备案                                                                                    |
| C08     | DB 模拟旧空标记签到→撤回、报名软删除，仍按历史证据拒绝；真实开发库迁移前出勤的新字段保持 null，实际 HTTP 取消仍 409                                                             |
| C09/C10 | DB 缺凭证、客户、纯管理员、缺 native、恶意 Origin 与可信 Cookie 通道、伪造目标覆盖；目标始终本人，未影响另一成员；最终包纯管理员现场拒绝                                        |
| R01     | 最终包编辑 A 未保存→停止本任务 API→确认删除 B 失败→恢复 API→重试并再次确认，只删除 B。API 在显式保存 A 前确认 A 仍为原名；修复后列表立即显示 B 已删除                           |
| R02     | 页面方法回归保存原目标/快照、改选 B 后重试不偷换内容；读失败重试读取、输入保留。最终包随后明确保存 A 当前修改，API 和 UI 均确认                                                 |
| R03     | 页面方法回归 save/delete 各验证写成功而刷新失败，仅重读，写调用次数保持 1                                                                                                       |
| R04     | 页面方法回归离开、切账号、迟到结果、旧 finally；追加跨账号刷新失败清理，避免旧列表/编辑残留                                                                                     |
| E01     | 同一最终包客户真实报名/本人列表，成员出勤取消/恢复/禁止取消及接待提交，纯管理员拒绝、活动创建/编辑/删除、报名修改/精确删除重试均实际操作                                        |
| E02     | 通过正常系统截屏将合成活动画面放入相册，PhotoViewPicker 实选 1/9→App multipart 上传→实际缩略图→App 点击提交→PENDING；最终 HTTP 确认 1 张照片。**本轮未用直接 API 上传照片代替** |

媒体工具正常导入测试素材曾返回权限错误，未修改系统安全设置或媒体库数据库。改用系统截屏功能准备素材，无须额外媒体权限。中间仅记录类型/字节数的诊断确认 JPEG 完整读取，随后移除诊断，正式包再次完成整段上传与提交。系统选择器隐私界面未暴露在底层 ArkUI 布局树，选择数量以实际截图确认。

## 原 #62 全清单回归

| 原范围                            | 本轮结论                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 真实活动详情/条款/地点/五态/容量  | 最终包游客详情与真实 API；原窗口/条款/查重/最后名额竞争回归全部通过                                                                    |
| 登录/注册/强制改密续接            | 最终包登录续接同一活动并真实报名；路由单测包含取消/参数保留，注册与强改沿用首轮实际装机及本轮现有认证/路由回归；本轮没有另建或强改账号 |
| 账号关系、本人列表/详情/修改/分页 | 双账号真实 HTTP、最终包本人列表与 B 空列表；54 项回归含伪造身份、跨账号 404、真实分页、状态编辑；页面异步回归保留                      |
| 旧匿名查询/凭据修改               | DB 和真实 HTTP 成功；账号行不泄漏到匿名入口，同手机号不认领。最终包另从独立匿名入口查询合成旧行                                        |
| 出勤/取消/签到调整/队列/撤回/电话 | 新 C01–C10、原回归与设备操作通过；电话缓存/权限仍验证，默认掩码                                                                        |
| 接待真实草稿、全局拦截、备案提交  | 并发/来源/分类留空、课设正文结果照片门槛回归通过；最终包实际草稿填写、系统选图上传与提交，提交后无待填写拦截                           |
| 活动与报名管理、管理入口          | 最终包原生日期/时间创建、保存地点/容量、软删除活动、报名保存/精确删除重试，API 持久化确认；#63 复用管理/活动路由，无新顶栏             |
| 双写通道、身份与安全边界          | 原 Cookie/Origin 与 Bearer/native 回归及新 DELETE 覆盖；纯管理员不替代成员；本人 DTO 无内部备案 ID，匿名归属不变                       |
| 升级保留、文档与交接              | 18 条迁移只追加结构；旧行兼容；契约、任务清单、README、开发方案及 PR 正文同步本轮结果                                                  |

上述是按功能及受影响路径的回归结论，未宣称每一种失败状态均重新拍过设备截图。Web 同步了取消入口/反馈并通过生产构建与服务层回归，本轮未用浏览器逐页操作；实体手机、共享部署及 #40 完整 AI 回流不在本次必要设备验收范围。

## 最终包截图

- 客户：[游客详情](issue-62-completion/same-package-guest.png)、[服务器确认报名](issue-62-completion/same-package-signup.png)、[本人列表](issue-62-completion/same-package-my-registrations.png)、[第二客户为空](issue-62-completion/same-package-second-customer-empty.png)、[独立匿名查询](issue-62-completion/same-package-anonymous-lookup.png)。
- 现场：[取消后未出勤](issue-62-completion/same-package-cancelled.png)、[处理后不可取消](issue-62-completion/same-package-cancel-blocked.png)、[真实草稿](issue-62-completion/same-package-draft.png)、[系统已选 1 张](issue-62-completion/same-package-photo-selected.png)、[App 上传展示](issue-62-completion/same-package-photo-uploaded.png)、[真实待审核](issue-62-completion/same-package-record-pending.png)、[提交后看板](issue-62-completion/same-package-board-submitted.png)。
- 管理：[纯管理员现场拒绝](issue-62-completion/same-package-admin-denied.png)、[A 未保存编辑](issue-62-completion/same-package-admin-unsaved-a.png)、[B 删除失败](issue-62-completion/same-package-delete-b-failed.png)、[重试再次确认](issue-62-completion/same-package-delete-retry-confirm.png)、[只删除 B](issue-62-completion/same-package-delete-retry-result.png)、[明确保存 A](issue-62-completion/same-package-admin-saved.png)、[保存地点/容量](issue-62-completion/same-package-admin-activity-saved.png)。
- 创建：[原生日期](issue-62-completion/same-package-date-picker.png)、[原生时间](issue-62-completion/same-package-time-picker.png)、[真实创建保存](issue-62-completion/same-package-activity-created.png)、[软删除后空态](issue-62-completion/same-package-activity-deleted.png)。
