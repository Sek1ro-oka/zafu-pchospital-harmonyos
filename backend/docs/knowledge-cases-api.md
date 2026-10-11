# 典型案例自动整理与知识回流（Issue #40）

已审核通过的维修备案 → 作者/审核人员标记「典型案例」→ DeepSeek 整理 → 自动去重/相似合并
→ 自动发布进检索（STAFF 默认，管理员可改 PUBLIC）→ 换问法命中案例引用并打开来源证据。

本轮**没有**案例二次人工审核、编辑提交或退回队列；原维修备案审核规则不变。
复用既有 `isTypical`、DeepSeek、bge-m3 向量、关键词+向量混合检索与本机 MySQL，
不引入搜索引擎、独立向量库、Redis、任务队列或历史批量导入。

## 1. 数据模型（迁移 `20261011130000_p2_issue40_knowledge_cases`）

| 表 | 说明 |
| --- | --- |
| `knowledge_cases` | 整理后的案例：`structured`（结构化 JSON）、`display_text`（确定性纯文本，检索/展示）、`status`、`visibility`、`content_version`、`embedding`（Float32 LE Bytes + 指纹 + 状态）、`withdrawn_source/at/by`、`failure_code/message` |
| `knowledge_case_sources` | 备案 → 案例的来源贡献：`repair_record_id` 唯一、`case_id` 可空、`status`（PENDING/PROCESSING/PUBLISHED/FAILED/REMOVED）、`content_hash`（材料指纹）、`evidence`（发布时证据快照）、`generation`（租约）、失败信息 |

状态语义：
- 案例：`PUBLISHED`（参与检索）、`REPROCESSING`（来源变化后暂停检索，后台重整）、`FAILED`（可重试）、`WITHDRAWN`（撤下，`withdrawn_source` = `ADMIN` 或 `SOURCES_EXHAUSTED`）；
- 来源：`PENDING → PROCESSING → PUBLISHED`，失败为 `FAILED`（可重试），取消典型/来源删改为 `REMOVED`。

## 2. 权限与通道

| 动作 | 谁 | 权限 | 通道 |
| --- | --- | --- | --- |
| 标记/取消典型、重试、读状态 | 备案作者本人（APPROVED）或审核人员 | `repair:read` + 归属判定 | Cookie+Origin 或 Bearer+`X-Client-Type: native`（写操作都要 `assertWriteAccess`） |
| 案例列表/详情 | 工作人员 | `repair:read` | 同上 |
| 可见范围/撤回/恢复重整/重建向量 | 管理员 | `repair:review` | 写通道 |

作者对备案只有「典型标记」一个动作：标记/取消不会改动备案正文、状态或其他字段。
没有把管理员 `repair:flag` / `repair:review` 赋给普通 MEMBER。

## 3. 接口

信封与鉴权约定同其余原生接口（见 `native-client-api.md`）；`data` 形状见下。

### POST /api/v1/knowledge-cases/records/[id]/typical

标记为典型案例并**同步整理**（可能等待模型约 1 分钟，App 读取超时 90s）。
已在处理中或内容未变时返回现状，不重复调用模型。返回：

```json
{
  "recordId": "…", "isTypical": true,
  "canMark": false, "canUnmark": true, "canRetry": false,
  "status": "PUBLISHED", "caseId": "…", "caseStatus": "PUBLISHED",
  "caseTitle": "…", "caseVisibility": "STAFF",
  "failureCode": null, "failureMessage": null, "updatedAt": "…"
}
```

- `status`：来源贡献视角的 `NONE/PENDING/PROCESSING/PUBLISHED/FAILED`（`REMOVED` 归一为 `NONE`）；
- 能力标记（`canMark/canUnmark/canRetry`）由服务端计算，界面只按它显示按钮。

失败情形：`409 CASE_RECORD_NOT_ELIGIBLE`（非本人/非审核范围或备案未通过）、
模型侧失败如实落到 `status=FAILED` 与 `failureCode`（`MODEL_NOT_CONFIGURED/TIMEOUT/RATE_LIMITED/UNAVAILABLE/OUTPUT_INVALID/BUDGET_EXHAUSTED/…`），不是 HTTP 4xx。

### DELETE /api/v1/knowledge-cases/records/[id]/typical

取消典型：移除来源贡献；案例按剩余来源**自动重整**（后台），没有剩余来源时自动撤下
（`withdrawn_source=SOURCES_EXHAUSTED`，普通重试不能复活）。

### GET /api/v1/knowledge-cases/records/[id]/status

读取备案的真实处理状态与能力标记（同上形状）。历史标记但从未整理（PENDING 超 5s）会在此触发一次后台补处理。

### POST /api/v1/knowledge-cases/records/[id]/retry

失败/中断后重试。来源层失败 → 重跑来源处理；来源已入库而案例 `FAILED` → 重整案例。
返回 `{ "state": {…同上…}, "outcome": { "status": "PUBLISHED|FAILED|…", "failureCode": …, "failureMessage": …, "notes": […] } }`。
仍在处理中/已入库/管理员撤回 → `409 CASE_STATE_CONFLICT`（文案说明真实原因）。

### GET /api/v1/knowledge-cases?status=&visibility=&page=&pageSize=

案例列表（工作人员）。`status ∈ PUBLISHED/REPROCESSING/FAILED/WITHDRAWN`，`visibility ∈ STAFF/PUBLIC`。
条目：`id/title/status/visibility/contentVersion/sourceCount/failureCode/failureMessage/publishedAt/updatedAt`。

### GET /api/v1/knowledge-cases/[id]

案例详情：结构化正文（`content`：title/deviceModel/fault/investigation/cause/resolution/result/category/
differences/unknowns/mergeReason）+ `displayText` + `embedding{status,fingerprint,error}` +
`failure{code,message}` + `withdrawn{source,at}` + `sources[]`（作者、日期、分类、机型、结果、
`quotes[]` 逐项证据、`attachedAt`）+ `actions{canManage,canReprocess,canRestore,canReembed}`。

### POST /api/v1/knowledge-cases/[id]/visibility　（`repair:review`）

`{ "visibility": "STAFF" | "PUBLIC" }`。改为 PUBLIC 后客户可检索并打开；改回 STAFF 立即对客户失效（每次读取按当前状态判定）。
撤回案例不能调整范围（`409 CASE_STATE_CONFLICT`）。

### POST /api/v1/knowledge-cases/[id]/withdraw　（`repair:review`）

管理员撤回：立即停止检索命中与来源读取；**普通重试/重建索引不会自动恢复**。

### POST /api/v1/knowledge-cases/[id]/reprocess　（`repair:review`）

失败重试 / 撤回后的**显式恢复**（撤回案例唯一恢复入口）。无有效来源 → `409 CASE_NO_VALID_SOURCES`。
返回 `{ "case": {…详情…}, "outcome": {…} }`。

### POST /api/v1/knowledge-cases/[id]/embedding　（`repair:review`）

正文未变的已发布案例补/重建向量（不重新整理正文、不重复付费模型）。未配置 `EMBEDDING_API_KEY` → `503 AI_NOT_CONFIGURED`。

## 4. 整理与合并规则（服务端判定，模型只提议）

1. **精确去重**：来源材料指纹（机型/分类/正文/结果/备注/维修日期，忽略空白与版本）相同 → 直接复用已有来源的案例，不再调用模型；重复标记幂等。
2. **候选预筛**：案例池为 `PUBLISHED` 的 STAFF 案例；向量可用时按余弦相似度（阈值 `CASE_SIMILARITY_MIN` 默认 0.5），向量不可用时按「同机型或同分类」预筛，最多 `CASE_MAX_CANDIDATES`（默认 3）个候选。
3. **模型决策**：一次调用同时给出 `action: new|merge` 与结构化正文；`merge` 目标必须在候选白名单内（伪造目标 → 坏响应不落库）。
4. **证据校验**：`evidences` 的 `quote` 必须是该来源材料文本的子串，否则丢弃并记录说明；`fault/investigation/cause/resolution` 非空必须有有效证据，否则清空。证据与字段只按**实际参与本次案例的来源集合**取证：`new` 仅 S1，`merge` 为 S1 + 选中候选的来源；未选中候选的引文、结果与机型/分类一律不参与（单一来源时 `differences` 恒为空），防止候选污染案例事实。
5. **结果与未知**：`result` 由实际来源结果强制推导（全完成/全未完成/混合 `MIXED` 并生成差异说明）；来源未写明的事实保持 `null`，由服务端生成 `unknowns`，不推断。
6. **发布事务**：条件更新校验案例版本 + 当前来源集合 + 可见范围 + 撤回代次 + 备案仍是 APPROVED 且 isTypical、材料指纹未变；任一变化 → 本次结果作废（`CASE_SOURCES_CHANGED`/`CASE_VERSION_CONFLICT`/`CASE_VISIBILITY_CHANGED`），不丢已发布的旧版本。
7. **并发**：来源租约（`CASE_LEASE_MS` 默认 120s）保证同一来源不被重复处理；两条来源并发合并时版本守卫保证不互相覆盖，失败者以可重试的 FAILED 收尾，来源不丢失。
8. **来源上限**：单案例来源上限 8（与模型单次可忠实覆盖的来源数一致）。已达上限后的相似合并与完全重复挂接被**明确拒绝**（`CASE_SOURCE_LIMIT`，可人工整理后重试）；重整遇到超过 8 条的历史数据同样明确失败，不静默只用前 8 条生成缺失来源的正文。

## 5. 失效与撤回

| 事件 | 行为 |
| --- | --- |
| 备案正文/机型被管理员修改 | 来源贡献置 REMOVED，案例按剩余来源后台重整；无剩余来源自动撤下 |
| 备案被软删 | 同上（`invalidateRecordSources`） |
| 取消典型（App/Web flags） | 同上；单来源案例自动撤下 |
| 模型生成期间来源被取消 | 发布事务复检失败 → 旧结果不发布（`STALE_INPUT` 丢弃） |
| 管理员撤回 | 案例 `WITHDRAWN(ADMIN)`；普通重试被拒（`CASE_WITHDRAWN`），仅 `POST reprocess` 可恢复 |
| 重整/显式恢复期间再次撤回 | 每次显式撤回刷新「撤回代次」（`withdrawnAt`）；迟到的重整结果检测到代次不一致 → 不发布（`SKIPPED`），后来的撤回与时间戳完整保留 |
| 完全重复挂接期间目标被改公开 | 挂接事务复核规划时的可见范围 → 拒绝跨范围挂接（`CASE_VISIBILITY_CHANGED`），租约释放可重试 |
| 向量服务故障 | 正文照常发布（关键词先可用），`embedding.status=FAILED` + 错误信息；`POST embedding` 可单条重试 |

## 6. 检索接入

- 查询时把当前数据库中的 `PUBLISHED` 案例（STAFF 全部 + 客户仅 PUBLIC）合并进已加载的文档索引参与 BM25+向量+RRF，**无需重建索引文件**；案例向量仅在指纹与索引一致时使用，否则按关键词降级。
- 案例块 ID：`kcase_<caseId>_v<contentVersion>`；内容版本变化后旧引用打开即 404（提示重新检索）。
- **返回前复核**：搜索与问答在返回前按数据库当前状态重新校验案例候选——已撤回/重整中/失败/改范围/版本变化的案例不带旧摘要返回；问答引用的案例失效时，在预算内用剩余有效证据重新生成一次，做不到就整条降级为 `STALE_EVIDENCE_MESSAGE`（资料已变化，请重新提问），绝不原样返回由失效案例生成的正文。
- 引用详情 `GET /api/v1/knowledge/sources/[id]`：`kind=case` 时返回 `caseDetail`（结构化正文 + 逐条来源证据）；
  客户拿到的来源中 `authorName/repairRecordId` 为 `null`，且每次读取都按数据库当前状态与查看者权限重新判定。

## 7. 配置（backend/.env，均可选）

```text
CASE_PROCESS_BUDGET_MS=60000     # 单次整理总预算；App 读取超时 90s 对应此值
CASE_MAX_OUTPUT_TOKENS=1800
CASE_LEASE_MS=120000             # 来源处理租约（接管阈值）
CASE_SIMILARITY_MIN=0.5          # 相似候选预筛阈值（独立于 #39 检索阈值 0.6）
CASE_MAX_CANDIDATES=3            # 交给模型判断的候选上限
```

模型的 `AI_API_KEY` 与向量的 `EMBEDDING_API_KEY` 复用 #39 配置：不配置模型时标记本身成功、
整理如实失败（`MODEL_NOT_CONFIGURED`）并可重试。

## 8. App 入口（app/entry/src/main/ets/features/knowledge）

- `TypicalCasePanel`：备案详情页（作者，APPROVED）与审核页「已通过」范围（审核人员）里的
  标记/取消/重试面板，状态与按钮全部来自服务端能力标记；
- `CaseLibraryPage` / `CaseDetailPage`：案例库列表、结构化正文 + 多来源证据、管理员
  可见范围/撤回/恢复重整/重建向量（Actions 由 `actions.canXxx` 门控）；
- `CitationDetailPage`：问答引用的案例分支（客户只看到证据引文，看不到作者与备案 ID）。
