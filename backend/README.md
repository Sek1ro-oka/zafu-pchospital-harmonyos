# 课设实验后端

同仓库的 `backend/` 提供 Next.js API 与 Prisma/MySQL 数据层。App 开发默认使用共享后端 **https://harmony-api.pczafu.cn**，无需本机启动服务或连接数据库；下方本地步骤用于修改接口/数据库结构。

服务器采用 Node + MySQL + systemd + Nginx HTTPS，不使用 Docker；仅接收本机 WSL/Linux 构建产物，不在服务器 install/build。见 [共享部署与维护](docs/shared-deployment.md)和 [游客访问契约](docs/guest-access.md)。

## 新人快速开始

要求：Node.js 24、Corepack、已安装且运行的本机 MySQL，以及本机 MySQL 可建库/建账号的管理员账号。已实测 Node 24.16.0、pnpm 12.4.1、MySQL 9.6.0；其他 MySQL 版本需实际验证。Corepack 不存在时先运行 `npm install --global corepack`；命令使用 `corepack pnpm`，无须单独安装 pnpm。

```powershell
git clone https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos.git
cd zafu-pchospital-harmonyos/backend
corepack pnpm install --frozen-lockfile
corepack pnpm setup:local
corepack pnpm accounts:prepare
corepack pnpm dev --port 13080
```

`accounts:prepare` 准备 App 登录用的本地测试账号（客户 `100001/customer123`、工作人员 `100002/staff123`），
可重复执行、只操作课设库；接口与角色说明见 [原生客户端接口](docs/native-client-api.md)。

`setup:local` 首次交互询问本机 MySQL 地址/端口（默认 `127.0.0.1:3306`）、管理员账号和不回显的密码，建立独立开发库/测试库及各自账号，并生成本机 `.env`。管理员密码不会保存。同名库或账号已存在时直接停止，换一个库标识或提供原 `.env`；已有 `.env` 时保留连接与密钥，应用迁移、基础字典 seed 并检查数据库健康。

浏览器访问 `http://localhost:13080/api/v1/health`：应返回 `success: true` 和 `database: reachable`。手机与电脑处于同一局域网时，将 App API 地址设为电脑实际局域网 IP（如 `http://192.168.1.20:13080`），允许本机防火墙的应用端口；数据库只由后端访问。HTTP 真机配置仍需按实际 SDK 验证，当前未完成真机联调。

## 开发范围与检查

2026-10-15 #76 新增鉴权只读案例搜索，支持标题/正文匹配、有效性过滤后分页与旧结果目标确认，复用原公开案例来源校验；未更改 AI 检索，未新增迁移。见 [目录与搜索契约](docs/knowledge-browse-api.md) 和 [本机验证](../docs/verification/issue-76.md)。本批后端尚未部署共享服务器。

2026-10-15 收尾新增 `DELETE /member/repair-activities/{id}/attendance`：历史保留、处理证据兼容和现场写事务互斥；见 [契约](docs/native-activities-api.md) 和 [收尾验证](../docs/verification/issue-62-completion.md)。529 项单测、54 项相关 DB 回归和 lint/生产构建通过，前轮取消缺口已按新任务补齐。

首轮历史（2026-10-15）：#62 功能分支新增账号报名归属/本人分页与最小结构迁移、真实地点/条款，适配活动双写通道、现场签到/电话/接待草稿及管理接口；[活动契约](docs/native-activities-api.md) 包含权限、状态及 #63 路由交接。独立库 44 项相关回归、521 项单测、lint 和生产构建通过，见 [验证记录](../docs/verification/issue-62-activities.md)。取消成员出勤按用户确认保留缺口，未部署共享服务。

- 接口：`src/app/api/v1/`；业务：`src/features/`；模型与迁移：`prisma/`；测试：`tests/`。
- 原生 Bearer 登录/会话与公开注册（客户自助注册、邀请码注册工作人员）已实现
  （`/api/v1/auth/native/*`、`/api/v1/auth/register/*`，见 [接口说明](docs/native-client-api.md)）；
  客户报修（#37）、工作人员处理与维修备案（#38，见 [说明](docs/native-repairs-api.md)）、
  知识检索与 AI 问答（`/api/v1/knowledge/*`，配置、命令与验证记录见
  [知识问答说明](docs/knowledge-ai.md)）均已实现。`RepairRecord` 是工作人员维修备案。
- 直接运行本机 Node/MySQL；团队按[开发方案](../docs/development-plan.md)自行安排进度。

```powershell
corepack pnpm lint
corepack pnpm test:unit
corepack pnpm build
corepack pnpm test:db
```

`test:db` 自动选择 `.env` 中的 `TEST_DATABASE_URL`，会修改/清理测试数据，只允许指定的 `_test` 库。更多配置、当前电脑 MySQL 启停和验证范围见[本地开发说明](docs/local-development.md)。

可向 `test:db` 传入现有的 `tests/integration/*.test.ts` 文件以运行受影响回归，例如 `corepack pnpm test:db tests/integration/native-activities.test.ts`；不传参数仍运行全部集成测试，库名保护保持。

源码来自 `ZAFU-PCHospital/zafu-pchospital-web`，提取基点 `64eb141ec21468c46f001dbe7cdab1183e4cb23c`，用于课程实验；原项目许可证由维护者决定。
