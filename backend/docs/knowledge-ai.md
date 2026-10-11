# 知识检索与 AI 问答（Issue #39）

日期：2026-10-11。本文件是知识问答功能的配置、命令、接口、更新方式、失败行为与本轮验证记录。
范围与验收口径见 [Issue #39 任务书](../../docs/tasks/issue-39-knowledge-ai.md)。

本轮已交付：真实文档快照与来源清单、按标题/段落分段、中文关键词（BM25）＋向量（bge-m3）混合检索
（RRF 融合）、DeepSeek 多轮问答（带可核验引用与三种状态）、原生问答页与引用详情、本次会话内存对话。
本轮未交付（按任务书）：可编辑报修草稿（待 #37）、本人报修状态工具、案例审核回流（#40）、
联网搜索、流式输出、聊天历史持久化、重排模型、独立向量数据库。

## 1. 首次启动（组员：获取快照 → 配置模型 → 建索引 → 启动）

```powershell
cd backend
corepack pnpm install --frozen-lockfile
# 1) 文档快照已随仓库提交（data/knowledge/snapshot）；更新快照时才需要联网：
#    corepack pnpm knowledge:sync -- --revision <上游 40 位 sha>
# 2) 在 backend/.env 配置回答模型与 embedding（见下表；Key 只放本机，不进仓库）
# 3) 构建索引（需要能访问 embedding 服务；首次构建会调用约 135 次文本向量，之后缓存命中不重复调用）
corepack pnpm knowledge:index
# 4) 启动（与现有开发流程一致）
corepack pnpm dev --port 13080
```

`knowledge:index` 的输出包含实际索引版本（如 `k1.48f43637.3575fd64`）、检索模式
（`hybrid` 或 `keyword-only`）与向量统计，复制到验收记录里即可核对本次运行的索引是否一致。

## 2. 配置键（backend/.env，示例见 .env.example）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `AI_BASE_URL` | `https://api.deepseek.com` | 回答模型（OpenAI 兼容） |
| `AI_MODEL` | `deepseek-flash` | 本轮回答模型 |
| `AI_API_KEY` | 空 | 未配置时问答接口返回 `AI_NOT_CONFIGURED`（503），检索不受影响 |
| `AI_TIMEOUT_MS` | `45000` | 回答模型单次请求超时；客户端读取超时 60s 留出余量 |
| `AI_MAX_OUTPUT_TOKENS` | `1000` | 回答输出上限 |
| `EMBEDDING_BASE_URL` | `https://api.siliconflow.cn/v1` | 向量服务（OpenAI 兼容 `/embeddings`） |
| `EMBEDDING_MODEL` | `BAAI/bge-m3` | 1024 维 |
| `EMBEDDING_API_KEY` | 空 | 未配置时检索**自动降级为关键词**并在响应中如实标注 |
| `EMBEDDING_TIMEOUT_MS` | `30000` | 向量请求超时 |
| `KNOWLEDGE_INDEX_PATH` | `data/knowledge/index/knowledge-index.json` | 生成索引路径（gitignore） |

回答模型调用固定使用 `temperature 0.2`、`response_format: json_object`、`thinking: {type:"disabled"}`
（实测 deepseek-flash 支持；关闭思考以避免首轮长时间等待）。

## 3. 数据与命令

```text
data/knowledge/knowledge.sources.json   来源清单：上游仓库/提交、每篇正文 sha256、内部测试资料
data/knowledge/snapshot/docs/**         上游 Markdown 快照（提交进仓库；路径与上游 src/ 一致）
data/knowledge/internal-test/**         明确标记的内部（STAFF）合成测试资料，仅用于可见性验收
data/knowledge/index/                   生成索引 + embedding 缓存（gitignore，机器相关）
```

- `corepack pnpm knowledge:sync -- --revision <sha>`：从上游 ZAFU-PCHospital-Doc 拉取固定提交，
  按 SUMMARY.md 收录「实际存在且有正文」的 Markdown（空链接、纯目录、占位内容跳过并记录原因），
  不复制 `.git`；`internal` 段不清除。变更上游提交时必须显式传入新 sha（40 位）。
- `corepack pnpm knowledge:index`：校验快照 sha256 → 分段 → 生成/复用向量 → 原子替换索引。
  失败（网络、坏响应、维度不一致）不会覆盖上一份完整索引；embedding 缓存以
  `provider + model + 分段规则版本 + 内容哈希` 为键，未变化的块不重复调用；
  provider/model 或缓存维度变化时整体重建，不混用新旧向量；删除的正文不会残留在新索引中。

## 4. 接口契约（原生 Bearer + `X-Client-Type: native`；沿用 `{success,data|error,meta}` 信封）

### POST /api/v1/knowledge/chat

请求：`{ question: string(1–1000 字), history: [{role: "user"|"assistant", content: ≤2000 字}] }`
（history ≤ 8 条、总长 ≤ 8000 字、请求体 ≤ 32KB；只接受 user/assistant，system 注入直接校验失败）。

响应 `data`：

```ts
{
  status: "answer" | "clarify" | "insufficient_evidence",
  answer: string | null,               // answer / insufficient_evidence 的正文
  clarifyingQuestion: string | null,   // clarify 的追问
  citations: Citation[],               // 仅 answer；澄清可以没有引用
  retrievalMode: "hybrid" | "keyword", // 实际使用的检索模式
  degradation: { reason, message } | null, // 降级说明（见 §6）
  indexVersion: string,
  evidenceCount: number,               // 送入模型的授权候选数
  notes: string[]                      // 校验说明（如下调的无效引用编号）
}
// Citation: { sourceId, title, docTitle, headingPath[], snippet, originalUrl, revision, visibility, indexVersion }
```

### POST /api/v1/knowledge/search

请求：`{ query: string(1–500 字), topK?: 1–10, retrieval?: "auto" | "keyword" }`
（`retrieval: "keyword"` 用于验收对比关键词与混合检索，此时不报降级）。

响应 `data`：`{ query, retrievalMode, degradation, indexVersion, results: [...Citation & {score, ranks:{keyword,vector}}] }`。

### GET /api/v1/knowledge/sources/[id]

响应 `data`：引用正文、`headingPath`、`startLine/endLine`、`partIndex/partTotal`（超长块拆分段）、
`sourcePath`、`visibility`、`revision`、`indexVersion`、`originalUrl`（快照块按固定提交生成并编码；
内部资料为 null）。不存在、已过期（内容更新导致块 ID 失效）或越权不可见统一
`404 KNOWLEDGE_SOURCE_NOT_FOUND`，不泄露内部资料存在性。

错误码（已并入统一定义）：`KNOWLEDGE_INDEX_UNAVAILABLE`(503)、`KNOWLEDGE_SOURCE_NOT_FOUND`(404)、
`AI_NOT_CONFIGURED`(503)、`AI_PROVIDER_TIMEOUT`(504)、`AI_PROVIDER_ERROR`(502)、
输入问题为 `VALIDATION_FAILED`(400)。

## 5. 检索与回答行为

- 分词：ASCII 整体保留（`KZ-900`、`0x0000007b`、`OMEN 17` 不被拆碎），CJK 取二元组；全角归一。
- 关键词：BM25（k1=1.2, b=0.75），标题路径以 2 倍词频加权。
- 向量：bge-m3 余弦相似度，**低于 0.6 不参与融合**（阈值按实测校准：域内问题最高 0.81，
  域外问题最高 0.50–0.55；换模型需重新校准）。
- 融合：RRF（k=20）合并两个排名，不直接相加原始分数。
- 可见性：排名前过滤——客户请求的语料中根本不含 STAFF 块；来源详情同样按服务端角色检查。
- 多轮：追问/指代（如「这个怎么检查」）与上一条用户消息拼接后再检索；历史仅作为对话上下文传给模型，
  并明确告知历史中的编号与结论不是证据；引用编号 S1…Sn 由后端按本次授权候选生成，
  返回前逐个校验（非法编号丢弃并在 `notes` 说明），URL 一律由后端生成。
- 状态：`answer` 必须带有效引用；`clarify` 允许无引用；无候选证据时不调用模型直接返回
  `insufficient_evidence`。模型给出 answer 但无有效引用时：纠正重试一次，仍无则按证据不足处理。
- 失败：provider 超时/限流/坏响应分别返回 5xx 失败（`AI_PROVIDER_TIMEOUT` / `AI_PROVIDER_ERROR`），
  **不伪装成「资料不足」**；不自动重试（仅上述纠正场景重试一次）。
- 会话与历史只在本轮请求内处理，服务端不持久化聊天；App 侧消息只存内存，离开问答、清空或退出登录即清除。

## 6. 降级语义（degradation.reason）

| reason | 触发 | 行为 |
| --- | --- | --- |
| `EMBEDDING_NOT_CONFIGURED` | 未配置 key | 关键词检索 |
| `INDEX_WITHOUT_EMBEDDING` | 索引构建时无向量 | 关键词检索，提示重建 |
| `INDEX_EMBEDDING_MISMATCH` | 索引指纹/维度与当前配置不一致 | 关键词检索，**不混用新旧向量**，提示重建 |
| `EMBEDDING_REQUEST_FAILED` | 查询向量请求失败 | 关键词检索，结果可能不完整 |

降级时响应中的 `retrievalMode` 一定是 `keyword`，不会宣称做过向量检索。

## 7. 常见失败与排查

- `KNOWLEDGE_INDEX_UNAVAILABLE`：未建索引或索引损坏/维度不一致 → 重跑 `corepack pnpm knowledge:index`；
  维度不一致说明 embedding 配置变过，需要重建（禁止手工拼接新旧向量）。
- `AI_NOT_CONFIGURED`：后端 `.env` 缺 `AI_API_KEY`。
- `AI_PROVIDER_TIMEOUT`：模型 45s 未返回；客户端 60s 读取超时，页面可重试。连续失败先看 provider 状态。
- `knowledge:index` 中途失败：旧索引保留；embedding 缓存按批写入，重跑续用已成功的块。
- `knowledge:sync` 失败：旧快照保留（先写 staging 后原子替换），检查网络与提交号。

## 8. 本轮验证记录（2026-10-11）

命令与结果（在本机、开发库 127.0.0.1:3308 / API 13080 实测）：

- `corepack pnpm lint` 通过（0 error）；`corepack pnpm test:unit` 355 项全部通过
  （较 main 的 327 项新增 28 项知识用例：分段与行定位、精确词/融合/维度不匹配/越权过滤、
  坏引用与模型失败映射、历史边界、索引装配与过期清理）；`corepack pnpm build` 通过。
- 真实 E2E（生产模式后端 + 真实 DeepSeek `deepseek-flash` + 真实 SiliconFlow `BAAI/bge-m3`）：
  客户 `100001`、工作人员 `100002` 原生登录；11 条问答样本 + 2 组检索对比 + 引用详情/越权/会话失效；
  全部请求实际请求向量服务，`retrievalMode` 均为 `hybrid`，无降级。
- 代表性通过项：
  - 「校园网认证失败应该怎么处理？」→ answer，4 条引用全部来自《认证相关》，正文含 S1–S4 标注，与文档逐条对应。
  - 「CrystalDiskInfo 怎么看硬盘健康状态？」→ answer，5 条引用，步骤与图吧工具箱说明保留原文条件。
  - 「暗影精灵 17-ck2000 开机风扇不转怎么办？」→ answer，正确识别 17-ck2xxx，保留 EC Reset 顺序与
    「不要跳过 EC Reset 直接刷 BIOS」条件，未与其他机型混淆。
  - 「帮我把打印机墨盒换成彩色的」「TWN-01 是什么」→ insufficient_evidence，未编造答案。
  - 客户问内部资料 → 无据；工作人员检索同一关键词 → 命中 STAFF 块（搜索 keyword=1）。
  - 客户访问 STAFF 块详情 → 404（与不存在 ID 同码）；工作人员 → 200。
  - 缺 `X-Client-Type` → 403；缺令牌 → 401；退出后令牌 → 401（客户端按会话失效回登录页）。
  - 引用详情返回正文、行号（如 Login.md 第 21 行）、版本与固定提交原文链接。
  - 关键词 vs 混合：如「屏幕不亮是不是显示器问题」，关键词 top1 为《外接显示器判断》，
    混合 top1 为《先观察机器是什么反应》（向量 rank 1）——融合改变了排序，差异真实存在。
- 真实失败/偏差例（如实记录）：
  - 「连不上学校 Wi-Fi，认证页面一直登录失败」命中《认证相关》证据，但模型选择 clarify 追问场景细节
    （校内/校外、报错原文）。该行为在契约内但不够理想，已加入提示词规则要求「资料覆盖时直接回答」，
    调整后复测模型仍选择追问——作为已知的模型行为偏差记录，不硬编码干预。
  - 「这个怎么检查？」（多轮）检索上下文正确（命中开机黑屏章节），模型按文档「先观察机器反应」
    的流程追问指示灯/风扇状态——视为贴合文档的澄清行为。
  - 工作人员对内部测试资料提问时，模型读到「合成的测试资料/非真实案例」标注后拒绝给出流程
    （而非照抄虚构内容）——对合成测试语料是合理反应；可见性验收以检索与详情两处证据为准。
- 模型超时/失败路径：以单测注入假 provider 验证错误码映射（超时→504、坏响应→502）；
  未制造真实限流。
- 未做真机验证：`hdc list targets` 为 `[Empty]`（无设备），App 交互（输入/滚动/引用返回/清空/退出）
  **未真机验证**；HAP 已构建：英文路径副本
  `E:/codes/pchospital-build/app` 未签名构建成功（entry-default-unsigned.hap）。
  构建成功不等于装机成功。

## 9. 已知限制与后续依赖

- Embedding 阈值 0.6 基于 bge-m3 与当前语料实测校准；更换模型或大幅扩充语料后需重新校准并重跑混合对比。
- 会话级检索意图使用启发式拼接（短问句/指代），未引入查询改写模型。
- 本次对话只存页面内存；引用详情返回保留对话；退出登录/离开问答即清除。
- 报修草稿提交、本人报修状态查询等待 #37 契约稳定后对接（本轮检索/问答/引用均不产生报修单）；
  案例提取与审核回流属于 #40，本轮保留来源与可见性结构。
- 索引为本地文件（`KNOWLEDGE_INDEX_PATH`），单进程加载；不引入独立向量数据库与后台同步服务。
