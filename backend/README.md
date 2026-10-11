# 本地实验后端

同仓库的 `backend/` 提供 Next.js API 与 Prisma/MySQL 数据层。组员先启动本机 MySQL，再运行初始化命令即可开发。

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

- 接口：`src/app/api/v1/`；业务：`src/features/`；模型与迁移：`prisma/`；测试：`tests/`。
- 原生 Bearer 登录/会话已实现（`/api/v1/auth/native/*`，见 [接口说明](docs/native-client-api.md)）；
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

源码来自 `ZAFU-PCHospital/zafu-pchospital-web`，提取基点 `64eb141ec21468c46f001dbe7cdab1183e4cb23c`，用于课程实验；原项目许可证由维护者决定。
