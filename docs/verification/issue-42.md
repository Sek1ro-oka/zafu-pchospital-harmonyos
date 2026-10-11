# Issue #42 验证记录：完整联调与课程演示

日期：2026-10-11。分支：`feat/issue-42-demo-integration`（基点 `upstream/main` @ `2c60449`，
即 #40 经 PR #52 合入后的 main）。环境：本机专用 MySQL `127.0.0.1:3308`（开发库
`pchospital_exp_local`）；**本轮未启动后端、未构建 App、未连接设备**。

本轮交付为演示与验证文档：[Issue #42 演示指引](../demo/issue-42-demo-guide.md)（新建）与本文件。
未修改 `backend/`、`app/`、根 `README.md`、`docs/development-plan.md` 或其他写手的文件。

## 1. 范围与依据

- 范围：Issue #42「07 完整联调与课程演示」的演示顺序、材料清单与验证记录；
  只记录本轮**实际执行**的检查，功能链路的实测结果一律待阶段2回填。
- 验收依据：Issue #42 验收步骤（原文见演示指引开头）、[开发方案](../development-plan.md)、
  [AGENTS.md](../../AGENTS.md)。
- 接口与环境依据：[backend/docs/local-development.md](../../backend/docs/local-development.md)、
  [native-client-api.md](../../backend/docs/native-client-api.md)、
  [native-repairs-api.md](../../backend/docs/native-repairs-api.md)、
  [knowledge-cases-api.md](../../backend/docs/knowledge-cases-api.md)、
  [knowledge-ai.md](../../backend/docs/knowledge-ai.md)。
- 既有记录：[issue-38.md](issue-38.md)、[issue-40.md](issue-40.md)（其数字属各自里程碑的实测，
  本轮**不复用、不转述为 #42 的通过项**）。
- 本轮未执行 lint、单测、集成测试、后端构建、HAP 构建与任何数据库命令
  （另一名写手正在使用 `backend/` 与数据库，避免抢占）；也未做装机验证。

## 2. 本轮实际执行的检查与结果

下表全部为本轮实际运行并观察到的结果；未在表中的项目即未验证。

| 检查 | 命令 / 方式 | 结果 |
| --- | --- | --- |
| 当前分支 | `git branch --show-current` | `feat/issue-42-demo-integration` |
| 基点与最近提交 | `git log --oneline -3` / `git log -1 --format=%P` | `2c60449 Merge pull request #52 from Xiaoyuan-114/feat/issue-40-typical-cases`（两父提交 `6c8fbcb`、`1ad82b8`）、`1ad82b8`、`db1b243`（后两笔均为 #40 审查修复提交） |
| HEAD 与 upstream 关系 | `git rev-parse upstream/main` / `git merge-base HEAD upstream/main` | `upstream/main` = `2c604498ba2da028a12deee50715d809e4e97a4c` = HEAD 的 merge-base（分支正好基于该提交，无额外合并） |
| HEAD | `git log -1 --format=%H %ad` | `2c604498ba2da028a12deee50715d809e4e97a4c`（2026-10-11 20:22 +0800） |
| 工作区 | `git status --short` | 写本记录开始时无输出（干净）；记录结束时出现并行写手在 `backend/` 的 2 个改动（见下方备注） |
| 设备 | `hdc list targets`（`E:\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe`） | `[Empty]`（无设备） |
| DevEco 位置 | `Test-Path 'D:\DevEco Studio'` / 列目录 | `D:\DevEco Studio` 不存在；实际在 `E:\DevEco Studio`（含 `bin/jbr/lib/modules/plugins/sdk/tools` 等） |
| SDK | 列目录 | `E:\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe` 存在 |
| 模拟器机型 | 列 `%LOCALAPPDATA%\Huawei\Emulator\deployed` | 4 个机型配置：Mate X7、MateBook Pro、MatePad Pro 13、Pura 90 Pro；每个只有 `config.ini`（前两者外另有 `Camera.properties`） |
| 模拟器系统镜像 | 读 `.emu_config` 的 `imagePath` 并检查 | `C:\Users\MR\AppData\Local\Huawei\Sdk` **不存在** → 无系统镜像；`.emu_config` 中 `HarmonyOS_Software_Service_Agreement`、`HarmonyOS_SDK_Agreement` 均为 `disagree` |
| 签名材料 | `Test-Path "$env:USERPROFILE\.ohos"` | `False`（无签名配置，无法装机） |
| 模型/向量 Key | 读 `backend/.env` 的键名 | 仅 `EXPERIMENT_DEV_DB/TEST_DB`、`DATABASE_URL`、`TEST_DATABASE_URL`、`AUTH_SECRET`、`INVITE_CODE_PEPPER`、`PII_AUDIT_PEPPER`、`APP_BASE_URL`、`RECRUITMENT_CYCLE`、`ACADEMIC_TERM_START/END`；**无任何 `AI_*`、`EMBEDDING_*` 键** |
| 数据库目标 | 解析 `DATABASE_URL` / `TEST_DATABASE_URL`（不打印凭证） | `127.0.0.1:3308/pchospital_exp_local`（用户 `pch_local`）、`127.0.0.1:3308/pchospital_exp_local_test`（用户 `pch_local_test`） |
| 专用实例端口 | `Test-NetConnection 127.0.0.1 -Port 3308` | `True`（实例在监听；本轮未执行任何数据库命令） |
| 后端端口 | `Test-NetConnection 127.0.0.1 -Port 13080` | `False`（后端未启动，属本轮预期状态） |
| 实例管理配置 | `Test-Path backend/.env.local-admin` | `False` → `tools/local-mysql.mjs` 不可用（暂无影响，实例已在运行） |
| 知识索引 | `Test-Path backend/data/knowledge/index/knowledge-index.json` | `False`（`data/knowledge/` 下只有 `snapshot/`、`internal-test/`、`knowledge.sources.json`、`README.md`） |
| 测试账号工具 | 读 `backend/tools/prepare-test-accounts.ts` | 基点 `2c60449` 上只有 `100001`（客户）、`100002`（工作人员）两个账号；写本记录时并行的写手已在**工作区**把管理员 `100003`（`ADMIN`、无成员档案）加入该工具（未提交），并同步进 `backend/docs/native-client-api.md` |
| 文档目录 | 列 `docs/` | 无 `docs/demo/`，本轮新建 |

备注（本轮发现的文档与实机差异，不改文件）：`backend/.env` 的库用户是 `pch_local` /
`pch_local_test`，而 `local-development.md` 的实例表中开发库用户写作 `pchospital_local`
（测试库一致）。不影响连接，已另行报告。
另有并行写手的 2 个未提交改动在 `backend/`（`docs/native-client-api.md`、
`tools/prepare-test-accounts.ts`），属其任务范围；本轮未修改、未纳入本记录的结果项。

## 3. 真实通过项（本轮可确证的事实）

1. **分支与基点正确**：`feat/issue-42-demo-integration` 的 HEAD 是 `2c60449`，
   即 #40 功能经 PR #52 以普通 Merge 合入 `upstream/main` 的合并提交（两父提交
   `6c8fbcb`、`1ad82b8`），且 `upstream/main` 正指向该提交、HEAD 的 merge-base 也是它；
   其前两笔 `db1b243`、`1ad82b8` 是 #40 两轮审查修复提交 —— 即 **#40 已合入 main，
   合入前含两笔审查修复**。
2. **工作区状态已核对**：写本记录开始时 `git status --short` 无输出（干净）；记录结束时工作区只有
   本轮新增的 `docs/demo/`、`docs/verification/issue-42.md`，以及并行写手在 `backend/` 的
   2 个未提交改动（见 §2 备注）。本轮未改动 `backend/`、`app/`、根 `README.md`、
   `docs/development-plan.md` 或其他写手的文件。
3. **本机环境事实核对完成**：无设备（`[Empty]`）、模拟器只有机型配置且无系统镜像、
   无签名材料（`~/.ohos` 不存在）、`backend/.env` 无模型/向量 Key、专用 MySQL 3308 正在监听、
   缺 `backend/.env.local-admin`、知识索引未构建。以上均与 Issue #42 任务书列出的本机事实一致。
4. **交付文档就位**：演示指引覆盖角色与账号、环境启动口径、15 步分角色演示顺序
   （含失败场景）、已知缺口与验收边界、材料清单；本记录如实区分「已核对事实」与「待补实测」。

## 4. 失败项

本轮未执行功能、构建或测试，**没有可记录的失败项**。
`127.0.0.1:13080` 未监听是「后端本轮未启动」的预期状态，不是失败。
演示脚本中的失败场景（无依据问答 / 越权访问 / 纯管理员受理被拒，指引步骤 13）是**演示内容**，
其实际表现属阶段2实测项，不能计入本轮结果。

## 5. 未验证项（如实声明）

- **真机 / 模拟器**：全部未验证。无设备（`hdc list targets` 为 `[Empty]`）、模拟器无系统镜像、
  无签名材料 → 完整业务链「客户咨询与引用 → 确认报修 → 受理推进 → 客户查看变化 →
  建档与照片 → 提交审核 → 审核通过 → 标记典型 → 自动整理/去重合并 →
  换问法检索命中并打开多来源证据 → 客户权限边界 → 失败场景」**未在设备上跑通**。
- **构建**：后端 `build` 与 App `assembleHap` 本轮未执行。
- **lint / 单测 / 集成测试**：本轮未执行，无可引用数字。
- **真实模型与向量能力**：本机未配置 Key，DeepSeek 整理、bge-m3 向量、相似合并与带引用问答
  **无法在本机复现**；标记典型在本机预期以 `MODEL_NOT_CONFIGURED` 失败，问答预期
  `503 AI_NOT_CONFIGURED`，向量不可用时检索降级为关键词。
- **知识索引**：未构建（`knowledge:index` 未执行）；未构建前问答/搜索预期
  `503 KNOWLEDGE_INDEX_UNAVAILABLE`。
- **后端健康检查**：未请求 `http://localhost:13080/api/v1/health`。
- **管理员账号**：管理员 `100003`（`ADMIN`、无成员档案、口令 `admin123`）已在并行写手的工作区改动里
  加入 `accounts:prepare`，但**尚未提交、本轮未执行** → `100003` 能否按预期登录、
  `accounts:prepare` 输出是否为三个账号，待确认。
- **未签名 HAP 与装机**：构建成功不等于装机运行正确；即使构建通过，本机无签名材料也无法安装。

## 6. 待补项（由指挥在阶段2填入实测结果）

| 待补项 | 落点 |
| --- | --- |
| 指引 §3 步骤 1–15 的「阶段2实测」 | `docs/demo/issue-42-demo-guide.md` |
| 数据库启停、迁移/seed/`db:health`/`accounts:prepare` 的实际输出 | 本文件 §2 与指引 §2 |
| `knowledge:index` 的索引版本与检索模式（`hybrid` / `keyword-only`） | 指引 §2.3 |
| `/api/v1/health` 的实际返回 | 指引 §2.4、本文件 §5 |
| 后端 `lint` / `test:unit` / `test:db` / `build` 的实际数字与输出末尾 | 本文件 §3、§5 |
| App `assembleHap` 输出、产物路径与签名状态 | 本文件 §3、§5；指引 §5 |
| 设备型号/系统/`hdc list targets` 输出 | 指引 §5 |
| 逐步截图或录像（文件名与步骤号对应） | 指引 §5 |
| 各步权限边界与失败场景的实际表现（含 HTTP 状态与错误码） | 指引 §3 步骤 12、13 |
| 四人实际贡献说明（与提交、Issue 记录核对） | 指引 §5 |
| `accounts:prepare` 实际输出（是否三个账号）与 `100003/admin123` 登录结果 | 指引 §1、§2.2；本文件 §5 |

**未实测的数字、通过项与截图一律留空并标注「待补」，不得预填。**
