# Issue #77：活动详情、报名入口与本人状态还原

2026-10-15。按《Issue-77-活动页面还原-writer开发任务书.md》实施，Refs #77。
功能与本机设备验收已完成，最终视觉效果待维护者审查。没有自行合并 PR、关闭 Issue 或部署共享服务器。

## 基线与范围

开工核实 main 为 `6826bc1f5cd7a13029caaea9898ea5e5d3272a61`，#74/#78/#79 均已 MERGED；原 Issue 中 #74 开放的文字为历史状态。已读最新 AGENTS、README、开发方案、原 Issue、参考图索引、#62 任务/接口/收尾记录及 #75 验证记录，并实际打开两张原图。

开发期间 main 合入 #80，按普通 Merge 同步至 `d53f951973e257e6e5a6a8c93b71f5e5734df6a3`。最终运行时/回归源码为 **`55d831589663092d1c2bcb8b597bd61b1cfb10cc`**，分支 `feat/issue-77-activity-ui`；后续提交仅更新文档、日志和截图，最终 PR HEAD 以交接/PR 为准。Git fetch 连接重置后通过 GitHub API 获取对象，逐对象校验 Git SHA 和完整祖先连接后同步。原工程 main 同样安全快进至 d53f951，用户原有锁文件与预览目录修改保留。

主要修改既有 `ActivityDetailPage` 的详情/signup 两态、`MyRegistrationPage`，以及本人列表辨识多联系快照所需的姓名/掩码电话行。共用状态函数修正未知枚举兜底，视觉组件使用可观察的 primitive props。未新建活动服务或认证链路；HomePage、#75/#76 阅读/搜索、后端业务、Prisma、现场/管理页面与最新 main 无本轮差异。#62 业务交付见 [收尾记录](issue-62-completion.md)；本文件记录 #77 视觉和受影响交互。

## 原图与实际画面

| 实际参考原图 | 最终包页面 | 构图及业务替换 |
| --- | --- | --- |
| [换电池专题](../reference/my-huawei/service-battery-replacement-campaign.jpg) | [游客长标题详情](issue-77/guest-detail.png)、[短标题满额详情](issue-77/full.png)、[活动信息](issue-77/detail-information.png) | 全宽浅蓝主视觉、居中大标题、真实时间/地点、电脑插画；下接白色信息分区与条款，独立底部主要/次要动作 |
| 同上 | [登录续接表单](issue-77/signup-form.png)、[软键盘避让](issue-77/signup-keyboard.png)、[实际条款](issue-77/signup-consent.png)、[报名成功](issue-77/signup-success.png) | 表单沿用同一组件和请求；真实条款 2026-09-27，初始不勾选，机型可空，成功入口传真实 ID |
| [活动打卡详情](../reference/my-huawei/community-event-checkin-detail.jpg) | [REGISTERED](issue-77/registered.png)、[联系卡](issue-77/registration-contact.png)、[CHECKED_IN](issue-77/checked-in.png)、[撤回后](issue-77/withdrawn.png)、[SERVED](issue-77/served.png)、[接待说明](issue-77/served-explanation.png) | 暖色左对齐大标题、白色大圆角状态卡、三段真实节点；联系信息与允许的编辑分区，未发生节点保持中性 |

与原图的差异：保留构图、留白、标题层级和底部动作关系，按电脑医院字段重排；三段状态代替七天签到，未移植购物、收费、积分、订阅、作者、关注或社交计数。蓝色插画由项目已有 `ref_laptop_hero.svg` 调色/调整取景，暖色沿用该资源，均不是现场照片。没有 DTO 的发布者、长介绍、服务范围或结果承诺。系统状态栏与 NavDestination 返回栏继续由现有工程绘制，无重复标题栏。

长活动名完整换行；空地点显示「地点待公布」、机型显示「未填写」。条款最后一条与主动同意选择可滚动阅读，Scroll 与操作栏分配剩余高度；报名模式局部启用 KeyboardAvoidMode.RESIZE，离开恢复原模式。实际键盘截图同时可见姓名和操作栏。

## 最终包与环境

| 项目 | 实际记录 |
| --- | --- |
| 最终运行时源码 | 55d831589663092d1c2bcb8b597bd61b1cfb10cc，含最新 #80 |
| HAP | `app/entry/build/default/outputs/default/entry-default-unsigned.hap`，**3,273,393 字节** |
| SHA-256 | **259D5941EF4502C84DA463E57742FBF21C54014064984A18AC61DB37F052791F** |
| 构建 | Windows / DevEco，工程 target/compatible 6.1.1 API 24；BUILD SUCCESSFUL，最终包 install -r、force-stop/start 实际成功 |
| 模拟器 | Pura 90 Pro 配置，1256 × 2760；设备 model=emulator、API **26**、`OpenHarmony-7.0.0.105`；hdc 127.0.0.1:5555 |
| App 实际 API | **http://127.0.0.1:13082**，[实际连接设置及数据库可达](issue-77/api-settings.png)，使用本机端口转发 |
| 数据库 | 原生 MySQL 9.6，127.0.0.1:3310，独立 `pchospital_exp_issue62`；开发/测试库分离，本轮无重置/迁移 |
| API 构建 | 本机 Next 15.5.25 生产构建；构建时基点 6826bc1，backend/src tree `f1d129d3e5783e1bfe2c724008a82eff80e49ace` 与 d53f951/最终源码完全一致 |
| 可核对清单 | [源码树、包/截图指纹](issue-77/artifact.json)，[HTTP 结果](issue-77/http-check.json) |

本机服务使用已有 #62 迁移和真实接口，不代表共享 https://harmony-api.pczafu.cn 已部署这些功能。测试账号、令牌、数据库密码没有写入新证据文件。截图中的「合成 #77」为明确的本机验收样本，非真实活动公告。

## 最终包实际操作

| 清单 | 操作与结果 |
| --- | --- |
| V01 / V02 | 两张原图逐页对照；长标题、完整实际条款、空地点/机型及键盘避让可读。不同屏幕比例和业务内容有差异，未声明逐像素一致 |
| F01 / F02 | 游客从活动进入报名，取消登录回原详情；再次登录客户 A，续接同一 activityId，实际输入并主动同意后提交成功，从「查看本次报名」打开真实记录 |
| F03 | 服务器 OPEN 可报名；[FULL](issue-77/full.png)、[UPCOMING](issue-77/upcoming.png)、[CLOSED](issue-77/closed.png)、[ENDED](issue-77/ended.png) 主按钮禁用。已有成功 ID 的页在截止后仍可[查看本次报名](issue-77/closed-confirmed-registration.png)；未知枚举禁用由实际页面方法回归验证 |
| F04 | A 最终有 26 条真实账号报名，按 meta 读取第一页 20 条及后续页。[第一页](issue-77/registrations-first-page.png) → [加载更多](issue-77/registrations-load-more.png) → [第二页旧联系快照](issue-77/registrations-second-page.png)。HTTP 另确认一个完整旧活动只在第二页。多联系快照显示真实姓名/掩码电话，不自动取第一个当唯一 |
| F05 | A/B 实际切换，B 的[本人列表为空](issue-77/second-customer-empty.png)，不残留 A 的详情。B 读取 A、错 activityId、缺失报名均真实 404；迟到响应/旧 finally 以方法回归覆盖 |
| F06 | 当前 A 报名由既有工作人员 API 完成签到 → 撤回排队 → 再签到 → 接待；App 每次刷新显示 REGISTERED/CHECKED_IN/SERVED 与真实时间。撤回后签到节点熄灭；接待关联记录实际仍为 DRAFT，客户 DTO 不含内部备案 ID/正文/照片，不表示维修完成或审核通过 |
| F07 / F09 | 服务端允许时实际保存类型；停止仅本任务 13082 API 后保存失败，显示[网络错误 2300056 与重试](issue-77/save-network-error.png)。把当前选择[改成其他故障](issue-77/save-draft-changed.png)，恢复 API 后点「重试保存」，仍保存原 SOFTWARE_SYSTEM 快照，[成功](issue-77/registration-saved.png)并经 HTTP 核实。已签到/接待时不显示保存动作；写成功而刷新失败仅重读由回归覆盖 |
| F08 | 初始同意为 false，无法提交；条款版本来自真实接口。真实 HTTP 拒绝未同意及旧版本；版本变化重读/清同意/保留其他输入，以及防重复提交以实际页面方法回归覆盖 |
| F10 | 最终包[旧匿名查询](issue-77/anonymous-lookup.png)仍独立，不认领账号报名；实际进入[成员现场](issue-77/staff-board.png)与[管理员活动页](issue-77/admin-activities.png)。未处理出勤取消/恢复真实通过，现场处理后 DELETE 409；[取消结果](issue-77/attendance-cancel-check.json)。工作人员出勤与客户节点分开 |
| D01 / D02 | 最后一次运行时修改和 main 同步后构建、装机及上述操作；保留证据均来自该指纹的包，非预览器或静态效果图 |

主样本 activityId：`392985fd-d9ed-42b8-b3be-9d37875e95cc`。最终包报名/状态流 ID：`be6e7eb4-37ef-4360-976c-447c4748e28d`（合成最终验收客户甲）；用于第二页验证的较早同场联系快照：`1160a3a6-f0ae-4d1e-876b-5d42711cd28e`。本账号同场有三条有效联系快照，符合 #62 原规则；报名入口只在本次成功响应确认后指向对应记录，公共详情未查询全部本人结果时只保留「我的报名」，不声称未报名或唯一报名。

现场写入由真实工作人员 API 执行，本轮客户状态页通过实际 App 刷新验收；未将前端对象注入页面。工作人员最终包打开看板可见不可取消理由及真实待填草稿。最终包额外检查管理读取，未为视觉验收重复编辑/删除已有业务。

## 检查与结果

在 `backend/`：

```powershell
node node_modules/eslint/bin/eslint.js .
node --import tsx --test tests/unit/**/*.test.ts
node --import tsx --test tests/unit/native-activities-app.test.ts tests/unit/guest-login-app.test.ts
node node_modules/next/dist/bin/next build
```

- lint **exit 0**；[日志](issue-77/lint.txt)。
- 最终全部单测 **566/566，0 skipped**，含 #80 认证竞争、#75/#76 阅读/搜索及 #77；[日志](issue-77/unit-tests.txt)。
- 相关活动/登录路由方法 **38/38**；[日志](issue-77/related-tests.txt)。执行真实组件状态方法，平台/请求为模拟依赖，不能替代设备。
- API 生产构建 **exit 0**，源码树与最终一致；[日志](issue-77/backend-build.txt)。
- 真实 HTTP **27 项断言通过**，另有未处理出勤取消/恢复检查；未重复运行 #62 全套 DB 并发/迁移回归，本轮未改对应业务/结构。

在 `app/`：

```powershell
$env:DEVECO_SDK_HOME='D:/tool/deveco-studio/Huawei/DevEco Studio/sdk'
$env:Path='D:/tool/deveco-studio/Huawei/DevEco Studio/tools/node;'+$env:Path
& 'D:/tool/deveco-studio/Huawei/DevEco Studio/tools/hvigor/bin/hvigorw.bat' --mode module -p product=default assembleHap
hdc install -r entry/build/default/outputs/default/entry-default-unsigned.hap
hdc shell aa force-stop cn.zafu.pchospital.course
hdc shell aa start -a EntryAbility -b cn.zafu.pchospital.course
```

**BUILD SUCCESSFUL**；[最终日志](issue-77/hap-build.txt)。仍为四处既有 PromptAction 警告和未配置发布签名提示，无新警告。模拟器截屏取自 screenCap，操作使用真实点击/输入/滑动/返回。一次瞬时 pixelMap 截屏失败只重试读取；滚动辅助脚本初次阈值未覆盖列表底部，修正后实际加载后续页。未把辅助脚本时序失败作为业务成功。

## 限制与继续审查

- 单一 Pura 90 Pro 模拟器验收，无实体手机/第二机型或发布签名验证；最终视觉认可由维护者决定。
- 本轮未重新注册账号或执行强制改密设备全链路；沿用 #62 历史设备证据，最新 #80 与登录/注册/改密续接的相关单测通过。条款版本变化及延迟请求以方法回归覆盖，未修改真实服务器条款来制造设备截图。
- 没有部署共享后端、迁移生产数据或执行模型调用；合成样本和实际接待 DRAFT 保留在独立本机库，未宣称维修/审核完成。
- 验证结束保留可见模拟器、13082 API 和独立 MySQL；客户 A 已登录，当前为上述真实已接待报名详情。DevEco 如需继续开发，应打开本功能分支独立检出的 `app/`。原工程用户修改保持原样。

### 2026-10-16 恢复交付

上次推送因自动审批检查额度不足未执行，恢复后功能分支已成功推送。暂停期间本机 API/独立库已停止，现使用原数据目录恢复 MySQL 3310 和隐藏后台 API 13082，health 实际返回 `status=ok,database=reachable`；没有初始化或重置数据。重新安装同一 SHA-256 的最终包并登录客户 A，真实已接待详情可读，[当前审查画面](issue-77/review-handoff-20261016.png)；继续保留模拟器和服务开启。合成活动时间已经自然过去，公开状态现为 ENDED，没有为恢复审查改回 OPEN；10 月 15 日的五态操作证据按当时真实状态保留。此次仅补交接记录/截图，运行时源码和 HAP 指纹未变。
