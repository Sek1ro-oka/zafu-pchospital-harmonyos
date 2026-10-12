# 共享后端部署与游客登录验证（2026-10-12）

## 交付范围

共享实验后端部署到 `8.148.7.53`，公网 API 为 **https://harmony-api.pczafu.cn**。App 内置该默认地址，已有自定义连接地址保留。游客先进入首页，服务介绍与公开指南可浏览；报修、进度、AI 问诊及我的触发登录，并续接原操作。原业务权限保持服务端校验。

本轮新增公开指南目录和真实 Markdown 原文阅读，未实现完整的故障分类知识首页、活动页面或富文本渲染。活动入口仍提示未接入；没有新增购物、社交或案例二次审核。

## 部署证据与资源

- 本机 WSL Ubuntu 使用 Linux Node 24.16.0、pnpm 12.4.1 安装依赖、生成 Prisma client、lint、单测与 Next.js 构建。
- 初次 npm/Prisma 下载遭遇证书错误；依赖改用本机 npm 镜像且保留锁文件完整性校验。Prisma 预编译 Linux 迁移程序经官方 SHA256 校验后使用，未关闭 TLS 校验。该编译好的程序由服务器下载后传回 WSL；不属于服务器源码构建。
- Linux 产物 213,764,292 字节，SHA256 `1ec38a92c841611453ff7f37bbd02b57bf515d448d67d0d37ffe8e0d1a58bd08`；上传后服务器 SHA256 校验通过。
- 服务器安装预编译 MySQL 8.0.46，与 Node runtime；仅解包、应用 **12 个迁移**、seed 和准备三个课设账号。没有服务器 npm/pnpm install、Next build 或 Docker 部署。
- 独立共享库 `pchospital_exp_shared`；预留 `pchospital_exp_shared_test` 是空库，未在服务器执行测试迁移或清库测试。没有导入生产数据、本地维修单据或照片。
- Node 服务 `pchospital-shared`、MySQL 均设置开机启动；后端监听 `127.0.0.1:13080`，MySQL 监听 `127.0.0.1:3306`，App 仅通过 HTTPS API 访问。
- 证书 Let's Encrypt YE2，签发给 `harmony-api.pczafu.cn`，有效期至 **2027-01-10**；Certbot 续期定时器与 Nginx reload hook 已设置。
- Nginx 配置检查通过。首次切换配置期间一次服务器 curl 返回证书校验错误，后续服务器与本机标准 TLS 请求均通过，未以跳过证书校验作为验收。
- API 实测健康检查 HTTP 200，数据库 reachable；既有游戏站点保持 HTTP 200，既有代理入口保持预期 HTTP 401。

服务器总内存约 1.58 GiB，CPU 2 核。实际 API 检查后 cgroup 后端约 **299 MiB**（峰值约 301 MiB）、MySQL 约 **186 MiB**，系统可用约 **485 MiB**；不是只看 free 空闲值。后端上限 384 MiB，MySQL 上限 480 MiB；`NRestarts=0`，后端 memory.events 的 `max/oom/oom_kill=0`，触及过 300 MiB 的软阈值但未触发硬上限。最终 11:45（北京时间）复查可用内存约 **463 MiB**、剩余磁盘约 **25 GiB**，CPU 负载低；完整快照见 [服务器检查](shared-backend-guest-login-20261012/server-check.json)。未使用 swap。配置与维护见 [共享部署说明](../../backend/docs/shared-deployment.md)。

## 本机检查

| 检查 | 实际结果 |
| --- | --- |
| WSL pnpm lint | 通过 |
| WSL pnpm test:unit | 当轮全套 **448/448** 通过 |
| 追加默认地址、恢复断网回归后，针对性检查 | 公开资料 3 项 + 实际 ArkTS 方法 6 项，**9/9** 通过；新增测试文件 lint 通过 |
| WSL pnpm build | Next.js 15.5.25 生产构建 exit 0 |
| HAP assembleHap | BUILD SUCCESSFUL，未签名；最终产物 **1,460,556 字节** |
| 数据库迁移/seed/课设账号 | 真实服务器共享库全部通过，原生三角色登录验证通过 |
| 数据库清理套件 | 未执行；本轮没有修改模型、维修状态或迁移 SQL，不在共享库清库 |

最终 HAP 构建保留 5 处提示调用可能抛异常的编译警告，无错误；签名未配置。HAP SHA256 `54d52c0acfa835ab0abad95c84a39743e5b4b8ab973e2ac888ce887be570fa54`。原 `app/oh-package-lock.json5` 行尾变化保留，未纳入提交。构建中曾因目录错误/一个 ArkTS 对象字段错误失败，修正后以上述最终成功构建为准。

## 公网真实 API

共 **22 次 HTTPS 请求**，结果见 [状态记录](shared-backend-guest-login-20261012/api-check.json)，不记录令牌或 Key：

- health 成功；游客目录返回 **15 份公开指南**，详情读取成功。
- 内部资料 ID、路径猜测均 404；无登录报修列表与 AI 问答均 401。
- 客户 / 工作人员 / 管理员登录，身份与 home 来自服务器；Bearer 查询成功，退出后查询 401。
- 客户本人报修列表可读；工作人员真实模型问题「校园网认证失败怎么办？」得到 `answer`、**3 条引用**、`hybrid` 检索，引用详情可打开。

真实模型成功样本仅证明本次配置与链路可用，不代表覆盖所有问法或案例回流。

## 实际模拟器交互

设备 `127.0.0.1:5555`，OpenHarmony-6.1.1.125，1320×2856。实际安装、启动成功，用 `hdc shell uitest` 操作并转储布局/截图；不是实体手机。

| 场景 | 结果 |
| --- | --- |
| 退出后重启 | 进入游客首页，未强制登录 |
| 游客服务 | 介绍/服务入口可浏览，不加载本人设备数据 |
| 我的触发登录后取消 | 返回原服务页，仍是游客 |
| 游客知识、首页搜索 | 进入共享服务器的公开指南目录，真实详情可读 |
| 指南内 AI 点击与系统返回 | 打开登录，取消后仍保留此前指南详情 |
| 游客首页报修 → 客户登录 | 登录成功直接打开「我的报修」 |
| 有效会话重启 | 通过服务器验证恢复客户身份，不再要求登录 |
| 测试客户会话撤销 → 访问报修 | 打开登录；取消后回游客首页，私人内容清除 |
| 游客报修 → 工作人员登录 | 续接工作人员报修工作台，含待受理 / 我负责范围 |
| 工作人员退出 → 我的 → 客户登录 | 登录成功进入真实客户个人页，未回错首页 |

模拟器原有局域网地址通过连接设置切换为共享域名，可信 HTTPS 连接与登录均实测。新安装默认值和旧地址保留另外通过真实 ApiConfig 方法的模拟存储检查；未清除模拟器应用数据冒充全新安装。

### 截图

- [游客首页](shared-backend-guest-login-20261012/guest-home.png)
- [按需登录](shared-backend-guest-login-20261012/login-on-demand.png)
- [公开指南目录](shared-backend-guest-login-20261012/public-guides.png) · [公开指南详情](shared-backend-guest-login-20261012/public-guide-detail.png)
- [客户报修续接](shared-backend-guest-login-20261012/customer-resumed-repairs.png)
- [工作人员工作台续接](shared-backend-guest-login-20261012/staff-resumed-workbench.png)
- [我的登录续接](shared-backend-guest-login-20261012/my-login-resumed.png)

## 未验证范围

未验证实体手机、完整设备报修/照片/审核/案例回流主链、四人并发压力及长期运行。没有停止共享服务模拟断网；启动网络失败回游客的场景是模拟依赖下执行真实根页面方法验证。MySQL 空库与业务空态如实显示，没有填假维修结果。App UI 与共享后端可用，不等于 Issue #42 全部验收已完成。
