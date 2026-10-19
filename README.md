# 鸿蒙电脑医院

四人 HarmonyOS 原生课程项目，以“我的华为”为参考，围绕校园电脑服务建设 **服务、选购、活动与论坛** 的小型平台。前后端同仓：ArkTS / ArkUI App，Next.js API，独立课设 MySQL；不使用 Docker。

## 当前目标与工作状态

**2026-10-19 已确认：后续重点是参考 App 的功能与视觉还原、操作完成度和业务复杂度，暂停全面移植 Web 功能及继续扩展 AI/Agent。** 保留已完成的维修、知识、账号与活动能力；新增小型选购交易和论坛，统一打磨用户能连续操作的流程。

**本轮只更新目标、文档与模块 Issues，尚未开始本轮业务开发。组员收到维护者开工通知后再认领。** 任务文档中的规划默认值与现有接口事实分开记录；完整范围、需求分析和验收见 [当前目标](docs/current-goals.md)。旧开发方案、旧“选购→知识”映射及旧 Web 迁移任务书的冲突部分以当前目标为准。

### 页面映射与参考图

客户：**首页｜活动｜服务｜选购｜我的**。工作人员：**首页｜活动｜工作台｜选购｜我的**。

| 页面 | 参考图片 | 当前目标 |
| --- | --- | --- |
| **首页** | [首页](docs/reference/my-huawei/home-navigation.jpg) | 大标题、搜索、主视觉、快捷服务与液态玻璃底栏，聚合真实服务/活动/选购入口 |
| **活动** | [花粉](docs/reference/my-huawei/community-huafen-feed.jpg)、[信息流](docs/reference/my-huawei/community-circle-detail-feed.jpg)、[帖子详情](docs/reference/my-huawei/community-event-post-detail.jpg) | 同一 Tab 内组织 **活动＋论坛**；保留社团活动/报名，新增登录用户发帖与评论 |
| **服务／工作台** | [服务](docs/reference/my-huawei/service-my-products-repair-entry.jpg)、[检测与帮助](docs/reference/my-huawei/service-diagnostics-help.jpg) | **知识库迁入服务**，保留 AI 问诊、指南/案例/搜索、报修与进度；工作人员保留处理、备案、审核与现场能力 |
| **选购** | [选购](docs/reference/my-huawei/shopping-category-navigation.jpg)、[订单筛选与空态](docs/reference/my-huawei/shopping-orders-empty-state.jpg) | **恢复选购语义**，提供二手商品、硅脂等维修耗材、真实下单和买卖双方订单管理 |
| **我的** | [我的](docs/reference/my-huawei/my-account-service-record-entry.jpg)、[账号资料](docs/reference/my-huawei/account-profile-sheet.jpg) | 原资料/报修/报名/收藏/消息，加购物订单、本人商品、卖家订单和我的帖子入口 |

以上是目标导航，当前代码尚未完成本轮迁移；不能只改标签或做占位页宣称完成。全部 16 张参考图见 [图片索引](docs/reference/my-huawei/README.md)。商品详情/下单等缺失参考图需补齐或记录设计依据，不宣称已有完整参考流程。

### 已确认规则

- **交易**：线下付款取货，App 内完成商品、下单、库存、取消、交付完成与订单查询，不接线上支付和配送，不伪造支付成功。
- **二手发布**：登录用户可发布；卖家编辑/下架本人商品、处理本人订单；管理员可下架商品。游客可浏览，写操作及本人记录按需登录。
- **活动＋论坛**：社团发布活动；登录用户可发帖/评论，作者可删除本人内容，管理员可管理。首版不做私信、关注、积分和推荐算法。
- **服务与权限**：知识迁入服务但不删除已有指南、搜索、引用和问答；公开/内部知识及成员/管理员边界保持。购物订单、客户报修单和工作人员维修备案分别建模。
- **规划默认值**：首版单商品直接下单；二手库存1、耗材支持数量并由授权工作人员维护；待取货→完成/取消。具体角色表、取消/库存规则和可调整项见 [当前目标](docs/current-goals.md#选购二手商品与维修耗材)，开工在 Issue 记录，不额外加审批流程。

## 当前模块任务

只保留以下 **4 个当前模块任务**，不预分配负责人、不设固定排期。一个模块可分几个 PR 交付，状态在同一 Issue 内更新；各模块同时负责其真实功能与参考样式。

| 顺序 | Issue | 任务书与依赖 |
| --- | --- | --- |
| 当前01 | [#83 五栏导航调整与知识迁入服务](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/83) | [任务书](docs/tasks/current-goals/01-navigation-service.md)；优先约定路由、服务知识入口及首页/我的接线 |
| 当前02 | [#84 选购平台：二手、耗材与交易闭环](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/84) | [任务书](docs/tasks/current-goals/02-shopping.md)；与 #83 约定入口后可独立推进 |
| 当前03 | [#85 活动＋论坛：报名整合与发帖评论](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/85) | [任务书](docs/tasks/current-goals/03-activities-forum.md)；复用已有活动，与 #84 可并行 |
| 当前04 | [#42 统一还原打磨、联调与课程演示](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/42) | [任务书](docs/tasks/current-goals/04-polish-demo.md)；提前整理差距，完整联调依赖前三项 |

先确认 #83 的入口与公共边界，#84/#85 分别交付真实闭环，再由 #42 收齐跨模块一致性与演示。旧 #36–#41、#60–#63、#75–#77 属于历史任务；保留已有交付与问题记录，未做的无关 Web 管理/统计/导出扩展不继续追着移植。

## 当前实际进度

2026-10-19 只读盘点起点为 `main 774145d`。此处描述源码与历史证据，不代表共享服务器已部署同版本。

| 范围 | 当前情况 |
| --- | --- |
| 原生底座与账号 | 已有游客先浏览、按需登录/注册、会话与双角色入口，保留现有改密/权限规则 |
| 维修服务与知识 | 已有报修、进度、工作人员处理、备案审核、指南/案例阅读与搜索、AI 问答/知识回流；知识当前仍为顶层 Tab，迁移待 #83 |
| 个人功能 | 已有资料、收藏、消息及相关成员功能；购物/卖家订单/本人商品/帖子入口待新模块 |
| 活动 | #62/#77 对应改动已合入，已有活动报名、本人状态、现场与管理；论坛尚未实现 |
| 选购交易与论坛 | 本轮待开发，当前商品/购物订单/论坛模型与页面尚未实现 |
| 视觉与设备 | 多轮 HAP 构建和模拟器证据已归档；新目标的还原与完整演示仍待完成，真机结果以实际记录为准 |

已有证据：[三个页面还原](docs/verification/three-reference-pages-20261014.md)、[阅读详情 #75](docs/verification/issue-75.md)、[知识目录/搜索 #76](docs/verification/issue-76.md)、[活动详情/本人状态 #77](docs/verification/issue-77.md)、[活动闭环收尾](docs/verification/issue-62-completion.md)、[个人资料/备案修复](docs/verification/issue-61-review-fixes.md)。无需因方向调整重跑这些模块的全部旧测试。

## 克隆与目录

```powershell
git clone https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos.git E:/codes/pchospital-harmonyos
cd E:/codes/pchospital-harmonyos
```

使用英文路径，避免 Hvigor 的中文父目录限制。DevEco 打开 `app/`，后端命令在 `backend/` 执行。

```text
app/                         HarmonyOS 原生工程：core 公共层、features 业务
backend/                     Next.js API、Prisma/MySQL、迁移及必要测试
docs/current-goals.md         当前需求分析、页面映射、范围及验收
docs/tasks/current-goals/     当前四个模块任务书
docs/reference/my-huawei/     16 张参考截图与索引
docs/verification/            实际验证与截图，按当次版本/设备阅读
AGENTS.md                    编码与协作规则
```

## 运行与开发

### 仅开发 App

DevEco Studio 打开 `app/`，安装工程所需 SDK/依赖，选择模拟器或连接设备后运行 `entry`。当前工程使用 **HarmonyOS 6.1.1 / API 24**；实体设备需配置本机签名。

App 默认 API：**https://harmony-api.pczafu.cn**。组员通常无需启动数据库；新增功能必须部署相应后端后共享环境才可用。地址内置不代表服务器已经包含最新功能，版本缺失时用独立本地后端联调。

原测试账号：客户 `100001/customer123`、工作人员 `100002/staff123`、管理员 `100003/admin123`；各环境需实际准备账号。交易/论坛开发尽量使用独立课设账号，避免多人操作同一笔数据。

```powershell
cd app
$env:DEVECO_SDK_HOME = 'D:/DevEco Studio/sdk'
$env:Path = 'D:/DevEco Studio/tools/node;' + $env:Path
& 'D:/DevEco Studio/tools/ohpm/bin/ohpm.bat' install
& 'D:/DevEco Studio/tools/hvigor/bin/hvigorw.bat' --mode module -p product=default assembleHap
```

本机 DevEco 路径仅为示例，按成员安装位置调整。模拟器可用 `hdc list targets` 检查连接；安装和真实操作结果与单纯构建通过分开记录。

### 修改后端时

要求 Node.js 24、Corepack、本机 MySQL。先按 [后端 README](backend/README.md) 和 [本地开发](backend/docs/local-development.md)配置独立开发/测试库，保留已有 `.env` 与课设数据。

```powershell
cd backend
corepack pnpm install --frozen-lockfile
corepack pnpm setup:local
corepack pnpm accounts:prepare
corepack pnpm dev --port 13080
```

健康接口 `http://localhost:13080/api/v1/health`；App 登录页“连接设置”可切换 API。模拟器访问本机通常使用 `http://10.0.2.2:13080`，手机使用电脑局域网 IP；设备上的 localhost 指向设备自身。

App 只访问 API，原生通道使用 `X-Client-Type: native` 和 Bearer，会话/权限由服务端认定。数据库密码和模型 Key 只放后端；不接原 Web 生产库、不迁移其数据。

### 必要检查与提交

只检查本次改动及受影响链路：文档检查链接/范围；ArkTS 构建 HAP并实际模拟器操作；新增交易/论坛接口检查真实返回、相关权限与必要状态/库存回归。无关全仓审计、全库测试和收费模型评测不作为常规步骤。

功能分支与 PR 提交，普通 Merge；不直接推 main、不强推、不要求另一位成员批准。CI `backend-check` 仍按仓库规则执行。组员交付提供页面对照、实际截图、检查结果及未验证项，不能以假数据或占位页面宣称完成。

共享服务只接收本机 WSL/Linux 构建产物，不在服务器 install/build 或清库测试。部署需按 [共享后端说明](backend/docs/shared-deployment.md)记录代码/迁移版本，避免打满服务器资源。

## 文档索引

- [当前目标与需求分析](docs/current-goals.md)、[当前四个模块任务](#当前模块任务)
- [开发方案与历史基线](docs/development-plan.md)、[旧 Web 迁移任务](docs/tasks/web-migration/README.md)（保留历史，冲突处以当前目标为准）
- [参考图索引](docs/reference/my-huawei/README.md)、[项目规则](AGENTS.md)
- [后端快速开始](backend/README.md)、[本地配置](backend/docs/local-development.md)、[共享部署](backend/docs/shared-deployment.md)
- [原生鉴权](backend/docs/native-client-api.md)、[维修接口](backend/docs/native-repairs-api.md)、[活动接口](backend/docs/native-activities-api.md)、[知识浏览接口](backend/docs/knowledge-browse-api.md)
