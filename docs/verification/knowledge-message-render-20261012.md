# 知识问答加载气泡不更新修复

2026-10-12，分支 `fix/knowledge-message-render-20261012`，基点 `origin/main bab74e6`。

## 现象与定位

提问「CrystalDiskInfo 怎么看硬盘健康状态？」后，页面长期显示「正在检索资料并生成回答」。现场 UITest 显示发送按钮已恢复为「发送」，待处理气泡却仍在；服务器 Nginx 已记录问答 HTTP 200。同题使用独立测试会话请求实际 API，HTTP 200、约 1.72 秒返回。

实验后端 health 本机 HTTP 200（约 6ms），内存回收 pressure avg10=0，无 OOM、服务无重启。此次不是上一轮内存软限额问题。

原因：消息使用不可变对象替换，但 ForEach 的渲染键只含 id。pending→done/failed 的新对象仍使用同一键，ArkUI 复用旧气泡的构建结果，逻辑状态和设备显示不一致。

## 最小修复

`KnowledgePage.ets` 消息键改为 `id + ':' + status`，状态变化时重建对应气泡。没有修改请求超时、模型、后端、鉴权或数据。

## 实际验证

- 本机 `hvigorw --mode module -p product=default assembleHap`：BUILD SUCCESSFUL（未签名；保留既有 4 条告警）。
- `hdc install -r` 和 `aa start` 成功，模拟器 OpenHarmony-6.1.1.125 / API24。
- 用原生页面示例问题重放同题：等待约 2 秒后实际 dumpLayout 已包含完整回答与 S1/S2/S3 三条引用，发送按钮恢复，没有加载气泡。[实际截图](knowledge-message-render-20261012/answer.png)。
- 本机 WSL 运行 `pnpm exec tsx --test tests/unit/knowledge-app-flow.test.ts`，**3/3** 通过（失败问题重试顺序、再次失败可重试、非法重试拒绝）。
- 未改数据库/接口，未重跑 DB 套件；失败序列由既有纯状态回归检查，未做设备断网注入。没有实体手机验证。

此前纯函数检查无法检测 ArkUI ForEach 缓存；本轮以实际模拟器渲染作为该问题的关键验收证据。
