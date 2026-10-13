# Issue #61 第一批验证：个人资料

日期：2026-10-13。起点 `origin/main @ 839c74f8f8cd8391289ab14fb5f1f1728a13a71e`（PR #65 已合入）；分支 `feat/issue-61-personal-profile`，独立 worktree `E:/codes/pchospital-issue61`。Web 固定参照 `e78d057`，复用已存在的成员昵称/技能/内部裁剪规则，本批没有导入 Web 数据，也没有连接生产库。

## 本批完成范围

- 客户独立本人资料：读/保存昵称、电话、默认头像、版本冲突；当前展示名同步，历史联系快照不改写。
- 成员本人昵称与技能原生保存，版本号共享；内部成员目录/搜索/分页及只读资料，管理员受控字段不开放编辑。原 PATCH/PUT、Cookie/Origin 规则保留，POST 别名共享实现。
- 五栏中的「我的 → 个人资料」已接通，默认头像对照参考图②；保存后卡片名称刷新，重启后成员卡片读取真实本人昵称，不改写成员账号受控字段。
- 加载、错误、重试、防重提交、保存失败保留输入、页面离开后丢弃迟到响应。

## 独立数据库

本机 MySQL `127.0.0.1:3308`，只为本批新建 `pchospital_exp_issue61_1013` 与 `pchospital_exp_issue61_1013_test` 及其专用本地账号，凭证只存忽略的 `.env`。不是其他写手的库；不使用 Docker，不在共享库做清库或造数据。

`20261013090000_issue61_customer_profile` 只新增表与外键，未 DROP/重建任何已有表。以下命令实际执行成功：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
corepack pnpm db:migrate:deploy
corepack pnpm db:migrate:test
corepack pnpm db:seed
corepack pnpm db:seed:test
corepack pnpm accounts:prepare
```

开发库真实 HTTP/模拟器使用客户 `100001`、客户 `100061`、工作人员 `100002`；另建合成成员 B 验证内部资料裁剪。数据为本批课设注册、API 操作或明确合成夹具，无生产数据。

## 后端检查

| 检查 | 实际结果 |
| --- | --- |
| `pnpm lint` | 通过；新增测试另运行针对性 eslint，通过 |
| `pnpm test:unit`（既有 CI 门禁） | 最终 474/474 通过，本批新增 5 项：客户入参 2、真实 ArkTS 状态方法 + 模拟网络 3 |
| `personal-profile.test.ts`，只启用独立测试库 | 5/5 通过：双客户本人归属/越权、旧单电话快照、并发首次保存/旧版本回滚、Cookie/Native 分流、成员字段/技能/内部裁剪与 20+1 分页 |
| `pnpm build` | 生产构建通过，最终源码重新构建通过 |
| 本机生产模式 HTTP | 12 项通过，见 [实际结果](issue-61-profile/api-check.json)，客户 A/B 登录、建单、修改资料、旧电话不变、目标 userId 拒绝、他人单据 404、客户成员接口 403、旧版本 409、成员客户资料 403 |

针对性 DB 命令（执行前选择本批 `TEST_DATABASE_URL`，闸门校验）：

```powershell
node --env-file=.env -e "process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.RUN_DB_TESTS='1';process.argv=['node','tsx','--test','tests/integration/personal-profile.test.ts'];require('tsx/cli')"
corepack pnpm exec tsx --test tests/unit/customer-profile.test.ts tests/unit/personal-profile-app.test.ts
```

补充：早期独立运行 `tsc --noEmit` 报告了三个未修改的既有测试文件类型问题（`staff-repair-records.test.ts` 的 BlobPart、`native-auth.test.ts` 的 HeadersInit、`public-guides.test.ts` 的可选 guides），未作为本批通过结果；正常后端生产 build 的类型检查通过。没有为这次功能改动扩展修复无关测试，也没有改 CI。

未重复全套 DB 套件或调用付费模型。本批未修改备案、典型标记、AI 案例与证据失效服务。

## HAP 与模拟器（实际装机）

```powershell
$env:DEVECO_SDK_HOME='D:/DevEco Studio/sdk'
$env:Path='D:/DevEco Studio/tools/node;'+$env:Path
& 'D:/DevEco Studio/tools/ohpm/bin/ohpm.bat' install
& 'D:/DevEco Studio/tools/hvigor/bin/hvigorw.bat' --mode module -p product=default assembleHap
```

最终 `BUILD SUCCESSFUL`，未签名产物 `app/entry/build/default/outputs/default/entry-default-unsigned.hap`，SHA256 `1A83A85E574670CD3E118F519EEF110154FC7F958189B579935A1DDB7C2FAC9D`。4 条既有 PromptAction 异常处理告警，签名按配置跳过。首轮编译发现 ArkTS 静态方法不允许 `this.token()`，已改用类名后重建成功。

本轮启动已安装的 DevEco `Pura 90` 模拟器：`OpenHarmony-6.1.1.125` / API 24，1320×2856，`hdc 127.0.0.1:5555`。安装返回 `install bundle successfully`，启动返回 `start ability successfully`。App 在连接设置中改为 `http://10.0.2.2:13086`（模拟器访问主机），后端实际监听本机 13086；本批业务写入未指向共享服务器。

```powershell
Emulator.exe -start "Pura 90" -bootmode coldboot
hdc install -r <Windows绝对HAP路径>
hdc shell aa start -a EntryAbility -b cn.zafu.pchospital.course -m entry
hdc shell uitest uiInput click <x> <y>
hdc shell uitest uiInput inputText <x> <y> <text>
hdc shell uitest dumpLayout -p /data/local/tmp/issue61-ui.json
hdc shell uitest screenCap -p /data/local/tmp/issue61-ui.png
```

实际操作与最终截图：

- 客户读取、昵称/电话保存、返回「我的」后立即显示新昵称：[资料](issue-61-profile/customer-saved.png)、[我的](issue-61-profile/my-customer.png)。
- 同进程退出客户、登录工作人员；保存昵称后保存 Windows 技能，两次成功且版本衔接；重新安装/停止启动后「我的」仍显示本人资料昵称：[成员资料/技能](issue-61-profile/member-skills.png)、[我的](issue-61-profile/my-member.png)。
- 成员目录打开另一位合成成员 B，私有学号/班级不显示，没有编辑按钮；暂无技能为真实空态：[内部只读资料](issue-61-profile/internal-profile.png)。搜索无匹配：[目录空态](issue-61-profile/directory-empty.png)。20+1 分页在真实 DB 路由回归中验证，模拟器未造满 21 人。
- 临时停止**本批本机**后端，刷新资料出现连接超时及重试按钮；本机后端恢复后点击重试成功：[失败状态](issue-61-profile/network-error.png)。

截图均来自本轮安装的实际 App 与本机课设库，默认头像为仓库 SVG，不把截图裁片当 UI。模拟器证据与实体手机验证分开。

## 未验证与后续批次

- 未用实体手机、其他屏幕/字体缩放；未宣称真实手机完成。
- #62 账号报名关系尚未交付：本批服务没有写入报名表，但未用账号关联的历史报名跑实际 App 闭环。手机号不改变账号身份，不能据此认领旧匿名报名。
- 收藏、公开案例目录、站内消息/通知事件、完整独立备案/照片/评论、已审核备案库、工作摘要属于第二/第三批，本批未实现或测试；不提前关闭 #61。
- 共享部署交技术主线统一安排；本批没有部署服务器。个人页其它未接入入口继续明确标注。

接口与跨模块约定见 [个人资料 API](../../backend/docs/personal-profile-api.md)。
## 2026-10-13 审查修复：返回后加载状态

PR #66 审查指出请求未完成时离开/返回会遗留 loading/saving。资料页离开时使旧代失效并释放 loading/saving/ready，成员目录释放 busy；旧响应和 finally 仍按代次校验，不能回填新页或清新请求的忙状态。成员资料的首段请求结束后也检查代次，避免离开后继续加载技能。

针对实际 ArkTS 方法新增读取、资料/技能写入、目录三项回归：旧请求挂起→离开→新请求启动→旧请求完成→新请求仍为 busy→新请求完成后可继续操作。页面逻辑测试通过，不将其称为模拟器复现。lint、477 项单测及本分支 HAP 构建通过；HAP SHA256 `CA0FC12F839148054798815F5BFE285289D296EA82FC8D0BAEFFE1DF48B19A37`。模拟器返回路径将在叠加修复后的最终 App 上验证，写操作已经送达服务器时不会因离开而撤销，返回须重新读取服务器状态。
