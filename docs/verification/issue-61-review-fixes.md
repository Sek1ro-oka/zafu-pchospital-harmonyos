# PR #66 → #67 → #68 审查修复

2026-10-13。修复审查报告中的两个 P1 和一个 P2，不改变课设提交规则，不部署服务器、不合并 PR、不关闭 #61。

## 修复与必要回归

| 审查项 | 实现 | 回归 |
| --- | --- | --- |
| 页面请求离开后锁住 loading/busy | #66 资料/成员目录、#67 收藏/消息/公开案例列表及详情、#68 备案列表/摘要/评论离开时失效旧代并释放忙状态；旧响应与 finally 继续检查代次 | 实际 `.ets` 方法配挂起网络：离开→新请求→旧响应→新响应；旧 finally 不解锁新请求，写响应不回填/导航 |
| 同类写入状态 | 资料/技能保存、取消收藏、消息动作、案例收藏、建档、评论搜索/写入、备案编辑/提交/照片/收藏释放旧代状态；备案写动作增加生命周期校验 | 新增回归覆盖保存/搜索/写入返回路径；原有保存、照片、退回重提检查仍通过 |
| 关联机型契约冲突 | 恢复 #38 只读规则；服务器详情提供 canEditDeviceModel，App 只有明确允许才发送机型；关联记录的不同机型写入在本人和管理保存服务均被拒绝 | 关联请求 400、两对象机型保持不变；机主字段仍可改；独立记录可编辑机型；App 构造请求不带关联机型 |
| 独立建档回放串单 | 事务外/内共同验证来源；关联报修、关联报名或 CREATED 非独立来源不能被当作独立创建回放。检测真实关系与创建事件，不根据键前缀推断 | 同作者关联/活动键调用独立创建为 409；活动关联尚未建立也拒绝；真正独立回放、并发仍通过 |

已送达服务器的写请求不会因页面离开撤销；返回重新读取真实状态，旧页面回调不能冒充新页成功。机主字段仍可空，电话权限和 #40 守卫不变，无数据库结构变更。

## 实际检查

- #66：lint、477 项单测、未签名 HAP 构建通过；代码修复 `3afb3c5`。
- #67：同步 #66 后，lint、484 项单测、未签名 HAP 构建通过；代码修复 `8d991b8`。
- #68：同步前两批，lint、**492/492 单测**（本轮增加 10 项分组回归），后端生产 build、最终 HAP 构建通过。
- 仅运行相关真实 DB 文件：`personal-records.test.ts` **8/8**，`staff-repair-records.test.ts` **8/8**；没有扩大到全 DB 审计。
- [9 项真实 HTTP 检查](issue-61-review-fixes/api-check.json)：合成报修→真实受理/建档，canEditDeviceModel=false，改机型 400，跨流程键 409，机主字段保存 200，原机型保持。没有收费模型调用。
- 最终 HAP SHA256 `12864DDA39E833CF0E0C01A0271DCFDF8B029760C07D4CC868B4FB770DDFED32`；安装/启动成功。4 条既有 PromptAction 警告、签名按工程配置跳过。
- Git 增量空白检查、文档链接、HEAD/分支 ref/远端核对；三 PR 等待复审。

恢复环境时发现专用 MySQL 3308 已停止，第一次 DB 回归在 before hook 连接超时，没有跑出业务结果；启动已初始化的 `E:/codes/pchospital-local-mysql`（数据保留）后重跑上述两文件通过。未清空共享/生产库。模拟器也从停止状态启动。

本批后端 cwd backend 的命令：

```powershell
corepack pnpm lint
corepack pnpm test:unit
corepack pnpm build
node --env-file=.env -e "process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.RUN_DB_TESTS='1';process.argv=['node','tsx','--test','tests/integration/personal-records.test.ts'];require('tsx/cli')"
node --env-file=.env -e "process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.RUN_DB_TESTS='1';process.argv=['node','tsx','--test','tests/integration/staff-repair-records.test.ts'];require('tsx/cli')"
```

HAP 构建仍从 app 运行 DevEco `hvigorw --mode module -p product=default assembleHap`；详见 [原第三批命令](issue-61-records.md)。本机需要真实知识索引读取公开案例，另运行 `pnpm knowledge:index`：16 篇/135 块，未配置 embedding Key，只建立关键词索引，不是模型检索复验。

## 实际模拟器：延迟请求与返回

设备仍为 Pura 90，OpenHarmony-6.1.1.125、API24、1320×2856；hdc 127.0.0.1:5555，无实体手机。叠加 HAP 包含三批修复；不把组件方法测试称为设备复现。截图取自此前构建 `84797140`；随后仅补同页刷新时释放备案收藏忙状态的守卫（实际方法回归通过），最终 HAP `12864DDA` 已重新构建、安装和启动，不把该微调声称为另一次完整设备回归。

本机临时代理 13089 转发到真实本批后端 13088，只延迟每个目标路径首次响应 12 秒，其后立即返回；没有替换业务正文、伪造身份或响应状态。[请求/响应记录](issue-61-review-fixes/delay-check.json) 只记录路径、顺序、时间、延迟和状态，不记录令牌/请求体。

五个导航子页在首次读取挂起时返回上级，再进入：第二请求先完成，页面显示真实数据且刷新/操作按钮可用，后续旧响应不会锁住页面：

| 页面 | 读取挂起 | 返回结果 |
| --- | --- | --- |
| 个人资料 | [资料加载中](issue-61-review-fixes/profile-pending.png) | [资料可读/可保存](issue-61-review-fixes/profile-return.png) |
| 收藏 | [收藏加载中](issue-61-review-fixes/favorites-pending.png) | [真实收藏列表](issue-61-review-fixes/favorites-return.png) |
| 消息 | [消息加载中](issue-61-review-fixes/messages-pending.png) | [消息列表/未读数/操作可用](issue-61-review-fixes/messages-return.png) |
| 公开案例详情 | [详情加载中](issue-61-review-fixes/case-pending.png) | [当前公开正文/引用/收藏按钮](issue-61-review-fixes/case-return.png) |
| 本人备案 | [备案加载中](issue-61-review-fixes/records-pending.png) | [备案列表/新建/筛选可用](issue-61-review-fixes/records-return.png) |

**工作摘要是根标签页，切换标签会缓存组件**，与上述导航子页的销毁/重进路径不同。本次切到“我的”再回工作台，仍等待原请求；12 秒延迟触发平台连接超时后显示错误和可用重试，第二请求实际成功：[摘要加载中](issue-61-review-fixes/summary-pending.png) → [超时/重试](issue-61-review-fixes/summary-timeout.png) → [恢复真实摘要](issue-61-review-fixes/summary-return.png)。保留同一实例调用消失/出现生命周期的路径由实际页面方法回归覆盖；没有声称在模拟器复现该实例路径。

另外，[关联备案机型只读](issue-61-review-fixes/linked-model-readonly.png) 显示机型文本、可编辑机主字段，没有机型输入框；API 和 DB 也验证了后台拒绝改写。

设备验证结束后将 App 地址恢复到本机 `http://10.0.2.2:13088`，停止临时延迟代理；工程默认共享地址没有改动。用户演示使用的是合成测试账号/备案，没有接入生产库。

## 仍未验证

实体手机、系统相册选图上传、#62 我的报名、共享部署仍按 [原第三批限制](issue-61-records.md) 保留。未重跑付费模型/全量 DB 审计。三批修复推送后交技术主线复审，不自行标为审查通过或合并。
