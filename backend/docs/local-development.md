# 本地开发

仅开发 App 时默认使用 [共享后端](shared-deployment.md)，无需本地安装数据库。本地修改后端时从 [README 快速开始](../README.md)执行 `install → setup:local → dev`。开发方案见[同仓文档](../../docs/development-plan.md)。初始化不安装 MySQL，也不会重设已有管理员密码。

## 初始化与日常命令

`corepack pnpm setup:local`：无 `.env` 时交互连接本机已运行 MySQL，默认 `127.0.0.1:3306`。管理员需要查看账号及建库/建账号权限；密码不回显、不保存。默认库为 `pchospital_exp_local`、`pchospital_exp_local_test`；课设库标识可改为自己的标识。建立新账号和随机应用密钥后，写入被忽略的 `.env`，自动迁移、seed、数据库健康检查。

已有 `.env` 时原文件、数据库账号及凭证保持不变，仅部署已有迁移并 upsert 基础字典 seed。首次路径检测到同名数据库或账号会停止，绝不自动复用或重置。创建途中因权限/连接错误中断可能留下部分新对象，解决错误后可更换库标识重试；脚本不会清空旧库。

```powershell
corepack pnpm db:migrate:deploy
corepack pnpm db:seed
corepack pnpm db:migrate:test
corepack pnpm db:seed:test
corepack pnpm db:health
corepack pnpm test:db
```

以上命令由 setup 自动执行前五项。新增模型使用 `db:migrate:dev`，按 Prisma 要求配置自己的本机 shadow 库权限。`db:reset:test` 是可选的清空测试库操作，不是首次建库必需步骤。

## 当前电脑的专用实例

当前专用原生 MySQL 9.6.0 使用 `127.0.0.1:3308`，持久数据目录 `E:/codes/pchospital-local-mysql`，禁用 mysqlx，未注册 Windows 服务。原 MySQL 服务未更改。

| 配置          | 当前值                                                       |
| ------------- | ------------------------------------------------------------ |
| 开发库 / 用户 | `pchospital_exp_local` / `pchospital_local`                  |
| 测试库 / 用户 | `pchospital_exp_local_test` / `pchospital_local_test`        |
| 应用          | `http://localhost:13080`                                     |
| 日常配置      | `backend/.env`                                               |
| 实例管理配置  | `backend/.env.local-admin`（新实例随机 root 凭证、数据目录） |

复制到新 `backend/` 的本机配置会继续使用3308；不要替换为示例占位值。电脑重启后，可在该目录执行：

```powershell
node tools/local-mysql.mjs start
corepack pnpm db:health
corepack pnpm dev --port 13080
```

停止 App 使用 Ctrl+C；`node tools/local-mysql.mjs stop` 停止该专用数据库并保留数据。该管理脚本需要自己的 `.env.local-admin`，普通组员使用自己已经运行的本机 MySQL 即可，不必复制当前电脑的实例管理配置。

Next 自动读取 `.env`；数据库 wrapper、Prisma config、健康工具也自动读取。测试选择 `TEST_DATABASE_URL`；Windows 数据库任务通过 Node 直接调用已安装 CLI，不依赖 `pnpm.cmd` 子进程。

## 已验证的功能边界

`RepairRecord.repairDate` 是上海日历日 `DATE`，数据库查询转换为日历边界；API 保留 UTC 时间元数据。seed 仅建立角色、维修分类和技能字典，尚无持久测试账号；原生登录、客户报修/预约、AI 后续开发。

2026-09-30 本地数据库迁移/seed、双向跨库拒绝、MySQL停止/重启均通过；单测318/318、集成137/137、lint及串行build通过；健康接口HTTP200。旧云端实验应用/数据库和专用代理已停用，保留数据卷。未做鸿蒙真机联调。

初始化专项验证：临时干净 clone 在没有 `.env` 时 `install --frozen-lockfile` 及 Prisma postinstall 通过；使用独立 `setupcheck_0930` 双库实测首次建库、两个库的迁移/seed/health 通过，重复 setup 的 `.env` 文件哈希不变，同名对象和非本机连接均被拒绝。Windows 交互终端使用假密码验证不回显，连接失败仅显示错误码。验证借用现有专用 MySQL3308，仅写入新验证库，没有修改原开发/测试库；默认3306和其他 MySQL 版本未验证。
