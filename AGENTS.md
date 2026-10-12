# AGENTS.md

先读 README 和 `docs/development-plan.md`，按用户当前指定的功能开发。使用 README 中的 7 个模块 Issue 记录目标与进度，团队自行认领和安排；不要求细粒度拆分、指定 reviewer 或固定排期。修改通过功能分支和 PR 合入 `main`，不要求另一位成员批准。

- 前后端同仓：DevEco 打开 `app/`，Node 命令在 `backend/` 执行。使用 ArkTS / ArkUI 原生页面；`app/entry/src/main/ets/core/` 放公共会话、网络和 UI，`features/` 放业务。
- 界面参考 `docs/reference/my-huawei/` 的五张图片。
- App 默认连接共享实验后端；修改后端时可在本机连接独立 MySQL，不使用 Docker。先读 `backend/README.md` 和 `backend/docs/local-development.md`，真实连接配置放 `backend/.env`，本 App 只访问 API。
- 后端接口位于 `backend/src/app/api/v1/`，业务位于 `backend/src/features/`，共享能力位于 `backend/src/lib/`。接口变更同步客户端契约；开发库与测试库分离。
- 客户报修单和维修备案 `RepairRecord` 是不同对象；实现前检查实际接口、字段和状态。权限由服务端检查。
- 保留双角色业务、带来源问答、人工确认报修草稿和典型案例自动整理合并与知识回流主线；#40 按当前任务书实施，已审核备案标记典型后自动发布，不新增案例二次审核。其他功能按团队时间安排。
- 不硬编码业务结果、AI 回答或用户身份。骨架、模拟数据和未接入状态如实标明。
- 修改后运行与变更相关的检查；ArkTS 变更构建 HAP，接口变更检查真实返回。没有设备时明确记录未做真机验证。
- 不直接推送 `main`：在功能分支提交和推送，通过 PR 使用普通 Merge（Create a merge commit）合入，不使用 Squash 或 Rebase。合入前解决审查讨论并通过 `backend-check`（后端 lint 和单测）；不要求额外审批。CI 不替代按改动需要执行的构建、数据库测试或真机验证。`main` 禁止强推和删除，ruleset 无绕过名单，不修改规则来绕过限制。操作前后检查工作区、HEAD、分支与远端；不覆盖他人改动，Git 异常先保存文件和提交对象。
- 本课设使用独立共享实验库或本地开发/测试库；不修改原生产项目或生产数据库。
- 共享服务器资源有限：依赖安装和项目构建必须在本机 WSL/Linux 完成，上传 Linux 产物；服务器只运行服务、迁移和课设账号初始化，不在服务器执行 install/build 或清库测试。部署说明见 backend/docs/shared-deployment.md。
