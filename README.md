# 鸿蒙电脑医院

四人课程项目，前后端放在同一公开仓库。ArkTS / ArkUI 原生 App 的界面参考“我的华为”，Next.js 后端连接本机 MySQL，不使用 Docker。功能范围见 [开发方案](docs/development-plan.md)，使用模块 Issue 记录目标与进度，由团队认领和安排，不设固定周计划或成员审批。

## 模块任务

- [01 基础联通与登录验收 #36](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/36)：代码已完成，设备验证待补。
- [02 客户报修与进度查询 #37](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/37)
- [03 工作人员处理与维修备案 #38](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/38)
- [04 知识检索与 AI 问答 #39](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/39)
- [05 案例审核与知识回流 #40](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/40)
- [06 界面与交互完善 #41](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/41)
- [07 完整联调与课程演示 #42](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/42)

依赖和必要验收写在各模块内。接口就绪后可以并行推进，不必等前一个 Issue 全部关闭。测试与审查只覆盖本次改动及受影响链路。

## 克隆与目录

```powershell
git clone https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos.git E:/codes/pchospital-harmonyos
cd E:/codes/pchospital-harmonyos
```

请使用英文路径，中文父目录会触发 Hvigor `Invalid project path`。

```text
app/                     HarmonyOS 原生工程，DevEco 打开此目录
  entry/src/main/ets/    core 会话/网络/导航/主题，features 业务模块
backend/                 Next.js API、Prisma 模型/迁移/seed 和测试
docs/development-plan.md 功能范围与已核实业务基础
docs/reference/my-huawei/ 五张参考截图
AGENTS.md                项目开发规则
```

## 启动后端

安装 Node.js 24、Corepack 和本机 MySQL。进入 `backend/`，按 [后端快速开始](backend/README.md)完成首次配置、迁移和 seed 后启动。完整配置见 [本地开发说明](backend/docs/local-development.md)。数据库账号各自在电脑上配置，组员无需访问旧服务器或原维护者的数据库。

```powershell
cd backend
corepack pnpm accounts:prepare   # 准备 App 登录测试账号（只操作课设库，可重复执行）
corepack pnpm dev --port 13080
```

健康接口为 `http://localhost:13080/api/v1/health`。手机联调时使用电脑局域网 IP 和端口，同一网络内访问 API；手机的 `localhost` 指向手机自身。原生登录接口与角色说明见 [原生客户端接口](backend/docs/native-client-api.md)。

## 手机连接步骤（App ↔ 本机后端）

1. 电脑启动后端（上节），确认 `http://localhost:13080/api/v1/health` 返回 `success: true`；手机与电脑连同一 Wi-Fi。
2. 查电脑局域网 IPv4（`ipconfig`，如 `192.168.1.20`），放行防火墙 13080 端口。
3. 手机安装 App（DevEco 运行；注意工程路径需为英文，中文父目录会触发 Hvigor `Invalid project path`）。
4. 打开 App 登录页：填服务器地址 `http://192.168.1.20:13080`（点“保存地址并检测”，状态显示“后端可达”），
   用测试账号登录：客户 `100001 / customer123`，工作人员 `100002 / staff123`。
5. 启动时 App 会先向服务器验证本机会话：有效进入对应入口，失效回登录页；退出后令牌在服务端吊销。

客户端不伪造 Origin，走独立的 `X-Client-Type: native` 通道；HTTP 明文访问在真机上的具体策略尚未验证（无设备），详见接口说明。

## 构建 App

工程使用 HarmonyOS 6.1.1 / API 24，用 DevEco Studio 打开 `app/`，安装依赖，构建 `entry`。连接设备并配置本机签名后运行。当前电脑的 DevEco Studio 位于 `D:/DevEco Studio`，命令行示例：

```powershell
cd app
$env:DEVECO_SDK_HOME = 'D:/DevEco Studio/sdk'
$env:Path = 'D:/DevEco Studio/tools/node;' + $env:Path
& 'D:/DevEco Studio/tools/ohpm/bin/ohpm.bat' install
& 'D:/DevEco Studio/tools/hvigor/bin/hvigorw.bat' --mode module -p product=default assembleHap
```

## 当前实际进度

App 已接入真实登录与会话：登录页、启动恢复会话、退出、按服务端返回的角色进入客户服务/工作人员入口；业务入口（报修、备案、问答）仍为骨架页并标注“未接入”。后端已提供原生 Bearer 会话通道（`/api/v1/auth/native/*`，[接口说明](backend/docs/native-client-api.md)），Web Cookie 登录行为保持原样；通用客户报修与 AI 问答尚未实现。`RepairRecord` 是工作人员维修备案，不等于客户报修单。

2026-10-09（登录里程碑）：在英文路径副本重新构建未签名 HAP 成功；后端 lint、生产构建通过，327 项单测、150 项数据库集成测试全部通过（含新增 22 项鉴权用例）；在 13080 端口以真实开发库验证 health → 客户/工作人员原生登录 → 会话查询 → 退出后令牌失效，以及错误密码、缺失令牌、缺失客户端标识、伪造角色无效、客户/工作人员越权访问均被拒。`hdc list targets` 仍为 `[Empty]`：App 的 health → 登录 → 重启恢复 → 退出链路**未真机验证**（构建成功不等于装机成功）。

2026-10-09 主线修正：启动恢复成功时返回服务器身份；本地令牌保存失败则尽力撤销新令牌并报 `LOCAL_STORAGE_ERROR`，不进入主页。临时 TypeScript 转译配合平台/网络模拟依赖的 5 项行为检查通过（有效恢复、失效清理、断网保留、保存失败、撤销失败），修改后的工程在 `E:/codes/pchospital-native-auth-check-20261009/app` 构建未签名 HAP 成功。模拟依赖检查不等于系统 Asset Store 或真机验证，设备会话链路仍待验证。

2026-09-30 合仓后已在英文路径从新克隆的 `app/` 构建未签名 HAP；新 `backend/` 安装依赖、生产构建通过，并临时在 13081 端口启动验证健康接口 HTTP 200、数据库可达。迁移前后端的 318 项单测与 137 项数据库测试已通过；初始化命令另做首次配置与重复运行验证。旧云端实验服务已停用，数据卷保留。

## 协作与来源

前后端接口变更可在同一提交中完成。提交前运行相关检查，分别记录构建、接口和真机结果。克隆公开仓库不需要邀请；向本仓库推送功能分支需要写入权限，由维护者添加 Collaborator，也可从个人 fork 提交 PR。

`main` 已启用 [main-protection](https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/rules/24866387)：必须通过 PR，且仅使用普通 Merge（Create a merge commit）；禁止直接推送、强推和删除主分支，无绕过名单。合入前解决审查讨论，不要求另一位成员批准，不强制 CI；不使用 Squash 或 Rebase，未启用与普通 Merge 冲突的线性历史要求。

- [开发方案](docs/development-plan.md)
- [五张参考截图](docs/reference/my-huawei/README.md)
- [Agent 开发规则](AGENTS.md)

业务基础由原维护者授权复用 [电脑医院 Web 项目](https://github.com/ZAFU-PCHospital/zafu-pchospital-web)。后端导入基点为 `6f2ec0c188e8afbe60401b16f7c3634286f14749`，App 原提交历史保留；迁移前两仓库另有本机 Git bundle 备份。原项目许可证由维护者决定，未添加扩大授权范围的许可证。
