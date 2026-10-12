# 共享实验后端（不用 Docker）

## 组员使用

App 默认 API 为 **https://harmony-api.pczafu.cn**。App 页面开发不必启动本机后端或 MySQL；新安装直接浏览游客首页，需要报修/进度/AI/我的时登录。旧安装的开发地址会保留，可在登录页「连接设置」改为共享域名。

课设账号：客户 `100001/customer123`、工作人员 `100002/staff123`、管理员 `100003/admin123`。管理员可审核但没有成员档案，不能当工作人员受理报修。联调尽量各用独立账号；同账号操作同一单会互相影响。

修改接口/数据库仍按 [本地开发](local-development.md)验证，合入稳定版本后统一部署。组员不直接连接服务器数据库；不要对共享库执行 reset 或数据库清理测试。

## 当前部署结构

服务器 Ubuntu 24.04，2 核、约 1.58 GiB 内存。Node 24.16.0、Next.js 构建产物、MySQL 8.0.46、systemd 和 Nginx；HTTPS 证书由 Certbot 管理。

```text
App → HTTPS harmony-api.pczafu.cn → Nginx → 127.0.0.1:13080 → MySQL 127.0.0.1:3306
```

课设库 `pchospital_exp_shared`，预留空测试库 `pchospital_exp_shared_test`（服务器不执行测试迁移/清库，测试仍在本机独立库）；初始化只创建字典与课设测试账号，没有导入原生产数据或本地真实维修记录。

```text
/opt/pchospital-shared/
  runtime/       预编译 Node 和 Prisma 迁移程序
  releases/      本机生成的版本产物与解包目录
  current        当前版本目录的符号链接
  shared/
    backend.env           私有配置（数据库、会话、模型 Key）
    knowledge-index.json  本机预生成的知识索引
    uploads/              持久维修照片
```

现有 `/opt/pchospital-exp` 遗留课设文件和其他站点保留。仅新增该课设服务与域名配置，不覆盖既有游戏/代理服务。

## 资源限制

- 后端 `MemoryHigh=300M`、`MemoryMax=384M`、Node 堆上限 256 MiB，CPU 上限 1 核；见 [systemd 配置](../deploy/pchospital-shared.service)。
- MySQL 缓冲池 128 MiB、最大连接 24、关闭 performance schema；见 [配置](../deploy/mysql-low-memory.cnf)。服务额外限制为 `MemoryHigh=360M`、`MemoryMax=480M`、CPU 上限 1 核。
- **服务器禁止依赖安装和项目构建**，也不重跑数据库清理套件；只执行迁移、seed、课设账号初始化及运行。
- 部署前查看 `free -m`、`df -h /`，运行后查看 `systemctl show pchospital-shared mysql -p MemoryCurrent -p MemoryMax`。达到上限或剩余内存不足时先处理课设服务，不重启整个服务器。

## 本机构建与更新

用本机 WSL/Linux 的完整仓库，安装 Linux Node/pnpm，不能把 Windows `node_modules` 直接上传。运行 [构建打包脚本](../tools/build-linux-release.sh)：

```bash
bash backend/tools/build-linux-release.sh /tmp/pchospital-api-linux.tar.gz
```

脚本执行依赖安装、lint、单测、Next 构建，按白名单打包运行及迁移所需文件；不包含 `.env`、照片或 Git 仓库。如下载有证书错误，使用可验证的下载源，不关闭 TLS 校验。首轮本机使用 npm 镜像安装锁定依赖，Prisma 原生迁移程序单独校验官方 SHA256 后使用。

上传后解包到新的 `releases/<版本>/`，保留旧版本，不在服务器 npm/pnpm install。将 `.env` 链接到 `shared/backend.env`，以课设用户运行迁移与 seed（Node runtime 加入 PATH，`PRISMA_SCHEMA_ENGINE_BINARY` 指向 runtime/schema-engine）：

```bash
node tools/db-task.mjs migrate
node tools/db-task.mjs seed
node node_modules/tsx/dist/cli.mjs tools/prepare-test-accounts.ts
```

`accounts:prepare` 会重设三个课设测试账号的密码，只在需要重置演示账号时执行。正常更新应用不必重置账号。

健康检查通过后切换 `current`，重启 **pchospital-shared**；用 [Nginx 配置](../deploy/harmony-api.nginx.conf)代理，`nginx -t` 后 reload。模型 Key 和数据库凭证只配置在服务器私有文件，App 仅内置域名。

## 维护与回退

```bash
systemctl status pchospital-shared mysql --no-pager
journalctl -u pchospital-shared -n 50 --no-pager
curl https://harmony-api.pczafu.cn/api/v1/health
```

更新迁移前用 root 本机 socket 执行 `mysqldump --single-transaction pchospital_exp_shared` 保存私有备份，并保留 `shared/uploads/`；不在共享库运行 migrate reset。应用回退切回旧 release 并重启课设服务；数据库迁移不能靠切换代码自动回退，需要检查兼容性。

Certbot 保留续期定时器；成功续期后 reload Nginx 的 deploy hook 位于 `/etc/letsencrypt/renewal-hooks/deploy/pchospital-shared-nginx.sh`。无需停止既有域名服务。

实际部署与模拟器证据见 [本轮验证](../../docs/verification/shared-backend-guest-login-20261012.md)，部署可用不代表完整业务真机验收已完成。
