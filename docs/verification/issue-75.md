# 第 12 模块 / Issue #75：报修与知识阅读页面还原

2026-10-15，基于 `main@28b5308583e59746fc1eac20e11b47cf1a7dfcc1`，分支 `feat/issue75-reading-reference`。
对应 [Issue #75](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/75)（标题编号 12，非历史已取消的 GitHub #12）。本轮为 App 视觉与必要导航调整，未修改后端接口、权限、数据库结构和主页面布局。最终视觉效果待维护者审查。

## 参考与实际页面

| 原图 | 本轮实现 | 实际模拟器截图 |
| --- | --- | --- |
| [权益查询](../reference/my-huawei/service-device-benefits.jpg) | 客户/工作人员报修详情：圆形返回/刷新、设备概要、处理状态、备案、联系信息、进度卡片 | [客户详情](issue-75/customer-order-detail.png)、[工作人员详情](issue-75/staff-order-detail.png)、[操作与进度](issue-75/staff-order-actions.png) |
| [升级尝鲜指南](../reference/my-huawei/harmonyos-upgrade-guide.jpg) | 维修指南：紫色横幅、真实章节快捷入口、正文、末尾行动卡 | [指南详情](issue-75/guide-detail.png)、[章节定位](issue-75/guide-chapter.png)、[底部操作](issue-75/guide-actions.png) |
| [帖子详情](../reference/my-huawei/community-event-post-detail.jpg) | 公开/内部案例：大标题、资料来源、正文与结果、证据、固定底栏；管理员原有操作保留 | [客户详情与收藏反馈](issue-75/public-case-detail.png)、[工作人员详情](issue-75/staff-case-detail.png)、[管理操作](issue-75/admin-case-internal.png) |
| [圈子信息流](../reference/my-huawei/community-circle-detail-feed.jpg) | 案例库：深色主题头图、四块资料说明、圆角浅底、已有状态筛选与内容卡 | [公开案例库](issue-75/public-case-library.png)、[工作人员案例库](issue-75/staff-case-library.png)、[失败范围空态](issue-75/staff-case-empty.png) |

原图中的品牌宣传、保修权益、关注、点赞、加入圈子等不属于电脑医院接口，未照搬。四块资料说明不伪装为已接入的筛选按钮；有数据的筛选仍使用工作人员案例状态。案例接口未提供图片、客户列表摘要/来源数时不补造。装饰使用本地 SVG，非维修现场照片。指南继续展示接口返回原文，Markdown 标记/表格仍为文本，本轮没有新增富文本解析器。

共用组件为 `app/entry/src/main/ets/core/ui/ReadingReference.ets`，`reading_*.svg` 为对应图标/横幅。页头复用 `ReferenceDetail.ets`；导航接线在 `HomePage.ets`。工作人员来源证据新增「查看原始维修备案」，进入已有受保护备案页，客户仍只看公开引文。

## 实际环境

- Windows 本机构建，DevEco SDK 6.1.1（API 24），ArkTS / ArkUI。
- Pura 90 模拟器，1320 × 2856，系统 `emulator 6.1.0.126(SP1DEVC00E120R4P11)`，`hdc` 目标 `127.0.0.1:5555`。
- 已安装本轮 HAP，包名 `cn.zafu.pchospital.course`，入口 `EntryAbility`。
- 验证后端为本机已有 `pchospital-issue61-batch3/backend@ae3906108578b30db5729cdcc291eb069a09513f` 的生产构建，端口 **13088**；App 保存地址 **http://10.0.2.2:13088**。不是本轮最新 main 的后端部署验收；所用报修、指南、案例与收藏接口可正常服务。健康接口实际返回 `200 / database=reachable`。
- MySQL 3308，独立本地课设库 `pchospital_exp_issue61_1013`；使用现有数据，未执行迁移、重置或导入原 Web 数据。
- 设备时间显示约 07:00，主机北京时间约 19:00；截图时间来自模拟器，非业务时间转换证据。

## 实际操作与结果

1. **客户报修**：登录客户 `100001`，从「进度查询」打开已有 `ReviewLink61`，设备/状态/真实进度可见；系统返回先回列表，再返回首页。客户接口没有受理人和备案 ID，页面未增加这些字段。
2. **工作人员报修与建档**：登录 `100002`，查看 `ReviewLink61`，点击「查看 / 继续备案」进入真实草稿。另通过客户 API 创建明确标记的本地合成单 `Issue75 界面验证电脑`（`1002932f-e895-4425-81d9-a904263693a9`），在模拟器依次点击「受理此单 → 开始处理 → 完成维修 → 建立维修备案」，均成功。完成时仍未建档，随后打开实际关联草稿，机型只读。见 [先完成未建档](issue-75/staff-order-complete-before-record.png)、[补建备案](issue-75/staff-order-created-record.png)。本单及草稿保留供维护者检查，没有改动其他报修内容。
3. **指南**：打开真实快照「操作系统与文件系统」，点击「Windows 版本」定位到对应章节，长正文可滚动。打开较短的「介绍」，滚动到末尾收藏，再从「AI 问诊」进入已有对话页（[入口结果](issue-75/guide-ai-navigation.png)）；未发送模型请求。
4. **案例**：客户从「知识 → 浏览有效公开案例」进入列表、详情并收藏，反馈「已收藏；重复收藏不会新增」。工作人员从「我的 → 典型案例库」进入列表、详情、原始备案（[来源页面](issue-75/staff-case-source.png)）；「失败」范围显示真实空态，切回「已发布」可再次打开。
5. **管理员**：`100003` 能看到原有管理操作。对同一本地案例执行「改为内部 → 改为公开」，范围、底栏与按钮即时切换；最终恢复 PUBLIC。点击「撤回案例」出现原有确认框，选择「再想想」，未撤回或重整（[确认框](issue-75/admin-case-withdraw-confirm.png)），未触发模型/向量调用。
6. **收藏结果**：「我的 → 收藏」能看到实际收藏的「介绍」与案例（[截图](issue-75/customer-favorites.png)）。

上述案例是本地已有 **「合成验证案例61（非模型生成）」**，仅用于布局、引用与收藏验收，不代表本轮真实模型生成。旧样本仅有标题及公开正文，缺少部分结构字段；页面仍显示已有正文，缺失结果显示「未写明」，不生成空字段或 `undefined`。未为截图补造案例或审核事实。

### 模拟器发现并修正

- 客户详情初次展开时，传入 `@Builder` 的对象快照未随异步结果更新；改为直接读取页面 `@State`，不改变请求/归属逻辑。
- 工作人员受理成功后，状态卡更新而操作区仍显示旧按钮；操作区改为读取最新 `@State order.actions`。实测开始处理后切换为「完成维修」，完成后仅保留建档入口。管理员面板同样按当前详情刷新可见范围。
- 客户详情与列表共用路由，系统返回需先收起详情并作废在途详情响应；补一项最小回归。
- 旧合成案例缺少结构字段时不展示 `undefined` 空行；补一项最小回归。

## 运行的检查

在 `backend/` 执行：

```powershell
node --import tsx --test tests/unit/repair-orders-app-refresh.test.ts tests/unit/guest-login-app.test.ts tests/unit/customer-community-app.test.ts tests/unit/knowledge-cases-app-flow.test.ts tests/unit/public-guides.test.ts
node node_modules/eslint/bin/eslint.js tests/unit/repair-orders-app-refresh.test.ts tests/unit/knowledge-cases-app-flow.test.ts
```

结果：**39/39 通过**，相关测试文件 ESLint **exit 0**。页面状态测试运行实际状态方法，平台/网络为模拟依赖，不能替代设备与数据库验证。`pnpm exec eslint ...` 首次因本机 pnpm 12 shim 启动失败，随后使用同一已安装 ESLint 的 Node 入口通过；自动产生的包管理锁文件变化未纳入提交。

在 `app/` 执行：

```powershell
$env:DEVECO_SDK_HOME='D:/DevEco Studio/sdk'
$env:Path='D:/DevEco Studio/tools/node;'+$env:Path
& 'D:/DevEco Studio/tools/hvigor/bin/hvigorw.bat' --mode module -p product=default assembleHap
```

结果：**BUILD SUCCESSFUL**。保留原有四处 PromptAction 异常提示警告（CitationDetailPage、KnowledgePage、ServicePage、ProfilePage），未增加警告。产物 `entry-default-unsigned.hap`，3,037,898 字节，SHA-256：`6dd1d926130ae0a7198936612c25c26f1c01d86ba1a4f567c43476cff1cd9cf0`。未配置发布签名，模拟器安装成功，非实体手机安装结果。

```powershell
hdc list targets
hdc install -r <本地 HAP 绝对路径>
hdc shell aa force-stop cn.zafu.pchospital.course
hdc shell aa start -a EntryAbility -b cn.zafu.pchospital.course -m entry
hdc shell uitest dumpLayout -p /data/local/tmp/three-pages-layout.json
hdc shell uitest screenCap -p /data/local/tmp/three-pages.png
```

实际通过 `hdc uitest` 点击、输入、滑动与系统返回，截图取自运行中的 App，非设计稿。

## 未验证范围与审查入口

- 无实体手机验证；相册选图/上传、支付/社交功能不在本轮改动。
- 现有案例只有一条，**未在模拟器制造 20+ 条案例验证真实分页**；保留原分页实现，相关页面迟到响应/刷新回归通过。未专门注入网络故障；失败与失效清正文使用现有模拟依赖回归覆盖。
- 未调用真实模型、重整、生成向量，也未部署共享服务器。内部/撤回内容的后端权限规则未改，本轮未另行执行真实越权/撤回测试。
- 屏幕尺寸不同，品牌和业务内容已按 Issue 映射替换；最终视觉对照由维护者确认，不宣称逐像素差异为零。
- 验证完成保留模拟器、本机后端和 MySQL 运行，客户已登录。客户看「知识」里的指南/公开案例；工作人员账号 `100002 / staff123` 从「工作台」和「我的 → 典型案例库」对照。DevEco 打开本分支目录的 `app/` 可继续运行。
