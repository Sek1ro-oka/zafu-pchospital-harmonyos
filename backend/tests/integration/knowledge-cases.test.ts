import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";

import { PATCH as adminRecordRoute } from "../../src/app/api/v1/admin/repairs/[id]/route";
import { GET as caseDetailRoute } from "../../src/app/api/v1/knowledge-cases/[id]/route";
import { POST as caseEmbeddingRoute } from "../../src/app/api/v1/knowledge-cases/[id]/embedding/route";
import { POST as caseVisibilityRoute } from "../../src/app/api/v1/knowledge-cases/[id]/visibility/route";
import { POST as caseWithdrawRoute } from "../../src/app/api/v1/knowledge-cases/[id]/withdraw/route";
import { GET as caseListRoute } from "../../src/app/api/v1/knowledge-cases/route";
import {
  DELETE as unmarkRoute,
  POST as markRoute,
} from "../../src/app/api/v1/knowledge-cases/records/[id]/typical/route";
import { POST as retryRoute } from "../../src/app/api/v1/knowledge-cases/records/[id]/retry/route";
import { GET as statusRoute } from "../../src/app/api/v1/knowledge-cases/records/[id]/status/route";
import { GET as knowledgeSourceRoute } from "../../src/app/api/v1/knowledge/sources/[id]/route";
import { ChatModelError } from "../../src/features/knowledge/chat-model";
import { knowledgeCaseService } from "../../src/features/knowledge-cases/case-service";
import { caseChunkId } from "../../src/features/knowledge-cases/case-types";
import { awaitBackgroundTasksForTests } from "../../src/lib/api/background";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { getDb, disconnectDb } from "../../src/lib/db/client";
import type { AuthorizedActor } from "../../src/types/contracts";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute } from "./http-harness";
import {
  ADMIN_ID,
  CUSTOMER_ID,
  MP_A_ID,
  MP_B_ID,
  STAFF_A_ID,
  STAFF_B_ID,
  bearerFor,
  cleanupStaffRepairFixtures,
  cookieFor,
  dataOf,
  errorCodeOf,
  prepareStaffRepairFixtures,
} from "./staff-repair-harness";

/**
 * 典型案例自动整理与知识回流的路由/服务级集成测试（真实 MySQL，Issue #40）。
 *
 * 模型与向量用注入的假函数（不发外网、不调用收费服务）；真实模型与真实向量
 * 的小样本验证记录在 docs/verification/issue-40.md。
 */

const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

// 文件级环境：默认关闭模型/向量配置（后台任务不会发外网），需要时按用例打开。
const savedEnv = {
  AI_API_KEY: process.env.AI_API_KEY,
  EMBEDDING_API_KEY: process.env.EMBEDDING_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
  EMBEDDING_BASE_URL: process.env.EMBEDDING_BASE_URL,
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
};

function disableModelEnv(): void {
  process.env.AI_API_KEY = "";
  process.env.EMBEDDING_API_KEY = "";
}

function enableFakeModelEnv(): void {
  process.env.AI_API_KEY = "integration-test-key";
  process.env.EMBEDDING_API_KEY = "integration-test-key";
  process.env.AI_MODEL = "test-case-model";
  process.env.EMBEDDING_BASE_URL = "https://api.siliconflow.cn/v1";
  process.env.EMBEDDING_MODEL = "BAAI/bge-m3";
}

disableModelEnv();
process.env.EMBEDDING_BASE_URL = "https://api.siliconflow.cn/v1";
process.env.EMBEDDING_MODEL = "BAAI/bge-m3";
process.env.AI_MODEL = "test-case-model";

before(async () => {
  if (!enabled) return;
  await cleanupStaffRepairFixtures();
  await prepareStaffRepairFixtures();
});

beforeEach(async () => {
  if (!enabled) return;
  await prepareStaffRepairFixtures();
});

after(async () => {
  if (!enabled) return;
  await cleanupStaffRepairFixtures();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await disconnectDb();
});

// ---------- 夹具 ----------

function actorFor(userId: string, roles: Array<"MEMBER" | "ADMIN">): AuthorizedActor {
  return {
    requestId: `it-case-${randomUUID().slice(0, 8)}`,
    actorType: "USER",
    userId,
    userStatus: "ACTIVE",
    permissions: permissionsForRoles(roles),
  };
}

const memberA = () => actorFor(STAFF_A_ID, ["MEMBER"]);
const memberB = () => actorFor(STAFF_B_ID, ["MEMBER"]);
const admin = () => actorFor(ADMIN_ID, ["ADMIN"]);
const customer = () =>
  actorFor(CUSTOMER_ID, []);

let recordSeq = 0;
async function createApprovedRecord(
  memberProfileId: string,
  fields: { deviceModel: string; content: string; result: string; remark?: string | null },
): Promise<string> {
  const db = getDb();
  const now = new Date();
  const id = randomUUID();
  recordSeq += 1;
  await db.repairRecord.create({
    data: {
      id,
      memberProfileId,
      repairDate: new Date("2026-10-01"),
      deviceModel: fields.deviceModel,
      content: fields.content,
      result: fields.result,
      remark: fields.remark ?? null,
      status: "APPROVED",
      version: 1,
      createRequestKey: `it-case-${recordSeq}-${id.slice(0, 8)}`,
      submittedAt: now,
      reviewedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  return id;
}

/** 假向量：所有文本同向量（相似度 1），保证候选预筛可预期。 */
async function fakeEmbed(_config: unknown, texts: string[]): Promise<number[][]> {
  return texts.map(() => [1, 0, 0]);
}

type FakeModel = {
  fn: (config: unknown, messages: Array<{ role: string; content: string }>) => Promise<string>;
  calls: number;
};

function modelReturning(payload: unknown): FakeModel {
  const state: FakeModel = {
    calls: 0,
    fn: async () => {
      state.calls += 1;
      return JSON.stringify(payload);
    },
  };
  return state;
}

/** 合并到候选 C1 的模型输出；引文取自新来源（S1），保证可定位。 */
function mergePayload(quote: string, resolution: string): Record<string, unknown> {
  return {
    action: "merge",
    target: "C1",
    merge_reason: "同一机型同类故障的后续记录",
    title: "ThinkPad E14 键盘进水处理",
    device_model: "ThinkPad E14",
    fault: "键盘进水后部分按键失灵",
    investigation: null,
    cause: null,
    resolution,
    result: "COMPLETED",
    category: null,
    differences: null,
    evidences: [
      { source: "S1", field: "fault", quote },
      { source: "S1", field: "resolution", quote: resolution },
    ],
  };
}

function newCasePayload(quote: string, resolution: string): Record<string, unknown> {
  return {
    action: "new",
    target: null,
    merge_reason: "知识库中暂无相似案例",
    title: "打印机进纸报错处理",
    device_model: "HP M1136",
    fault: "开机报错 E3",
    investigation: null,
    cause: null,
    resolution,
    result: "COMPLETED",
    category: null,
    differences: null,
    evidences: [{ source: "S1", field: "fault", quote }],
  };
}

async function contributionOf(recordId: string) {
  return getDb().knowledgeCaseSource.findUnique({ where: { repairRecordId: recordId } });
}

async function caseOf(caseId: string) {
  return getDb().knowledgeCase.findUnique({ where: { id: caseId }, include: { sources: true } });
}

async function attachCount(caseId: string): Promise<number> {
  return getDb().knowledgeCaseSource.count({ where: { caseId, status: "PUBLISHED" } });
}

/** 直接插入「已发布来源」行：模拟历史数据/制造满额案例（证据快照为空，仅提供来源数与关联）。 */
async function attachFakeSources(caseId: string, count: number, tag: string): Promise<void> {
  const db = getDb();
  for (let index = 1; index <= count; index += 1) {
    const recordId = await createApprovedRecord(index % 2 === 0 ? MP_A_ID : MP_B_ID, {
      deviceModel: "遗留设备",
      content: `${tag} 第 ${index} 条来源正文，仅用于来源计数。`,
      result: "COMPLETED",
    });
    await db.knowledgeCaseSource.create({
      data: {
        id: randomUUID(),
        repairRecordId: recordId,
        caseId,
        status: "PUBLISHED",
        contentHash: randomUUID().replace(/-/g, "").padEnd(64, "0"),
        generation: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
}

// ---------- 用例 ----------

dbTest("权限矩阵：客户/其他成员不能标记，作者与审核人员可以；标记不改动正文与状态", async () => {
  assert.equal(permissionsForRoles(["MEMBER"]).includes("repair:review"), false);
  assert.equal(permissionsForRoles(["MEMBER"]).includes("repair:flag"), false);
  const recordId = await createApprovedRecord(MP_A_ID, {
    deviceModel: "ThinkPad E14",
    content: "键盘进水后部分按键失灵，拆机清理排线后恢复正常。",
    result: "COMPLETED",
  });
  await assert.rejects(
    () => knowledgeCaseService.markTypical(customer(), recordId),
    (error: unknown) => (error as { code?: string }).code === "FORBIDDEN",
  );
  await assert.rejects(
    () => knowledgeCaseService.markTypical(memberB(), recordId),
    (error: unknown) => (error as { code?: string }).code === "FORBIDDEN",
    "非本人普通成员不能标记他人备案",
  );
  disableModelEnv();
  await knowledgeCaseService.markTypical(memberA(), recordId); // 处理失败但标记成功
  const after = await getDb().repairRecord.findUniqueOrThrow({ where: { id: recordId } });
  assert.equal(after.isTypical, true);
  assert.equal(after.content, "键盘进水后部分按键失灵，拆机清理排线后恢复正常。");
  assert.equal(after.status, "APPROVED");
  assert.equal(after.isDifficult, false);
  const state = await knowledgeCaseService.getRecordCaseStatus(memberA(), recordId);
  assert.equal(state.status, "FAILED");
  assert.equal(state.failureCode, "MODEL_NOT_CONFIGURED");
  assert.equal(state.canRetry, true);
});

dbTest("路由级：真实通道鉴权、缺模型时标记成功且处理如实失败、重试仍失败但状态可读", async () => {
  disableModelEnv();
  const recordId = await createApprovedRecord(MP_A_ID, {
    deviceModel: "ThinkPad E14",
    content: "路由级用例：键盘进水后部分按键失灵。",
    result: "COMPLETED",
  });
  const url = `http://localhost/api/v1/knowledge-cases/records/${recordId}/typical`;
  const noToken = await callRoute(markRoute, url, { method: "POST", headers: { "x-client-type": "native" }, params: { id: recordId } });
  assert.equal(noToken.status, 401);
  const nativeHeaders = await bearerFor(STAFF_A_ID);
  const withoutNativeHeader: Record<string, string> = { ...nativeHeaders };
  delete withoutNativeHeader["x-client-type"];
  const noNativeHeader = await callRoute(markRoute, url, { method: "POST", headers: withoutNativeHeader, params: { id: recordId } });
  assert.equal(noNativeHeader.status, 403, "Bearer 通道必须带 X-Client-Type: native");
  const asCustomer = await callRoute(markRoute, url, { method: "POST", headers: await bearerFor(CUSTOMER_ID), params: { id: recordId } });
  assert.equal(asCustomer.status, 403);
  const marked = await callRoute(markRoute, url, { method: "POST", headers: await bearerFor(STAFF_A_ID), params: { id: recordId } });
  assert.equal(marked.status, 200, JSON.stringify(marked.json));
  assert.equal(dataOf(marked.json).isTypical, true);
  assert.equal(dataOf(marked.json).status, "FAILED");
  assert.equal(dataOf(marked.json).failureCode, "MODEL_NOT_CONFIGURED");
  const status = await callRoute(statusRoute, `http://localhost/api/v1/knowledge-cases/records/${recordId}/status`, {
    headers: await bearerFor(STAFF_B_ID),
    params: { id: recordId },
  });
  assert.equal(status.status, 200, "工作人员可查看任意已审核备案的整理状态");
  const retried = await callRoute(retryRoute, `http://localhost/api/v1/knowledge-cases/records/${recordId}/retry`, {
    method: "POST",
    headers: await bearerFor(STAFF_A_ID),
    params: { id: recordId },
  });
  assert.equal(retried.status, 200);
  assert.equal((dataOf(retried.json).state as { status: string }).status, "FAILED");
});

dbTest("完整流水线：标记→整理→STAFF 发布→工作人员检索/打开案例引用，客户不可见", async () => {
  enableFakeModelEnv();
  const recordId = await createApprovedRecord(MP_A_ID, {
    deviceModel: "ThinkPad E14",
    content: "键盘进水后部分按键失灵，拆机清理排线后恢复正常使用。",
    result: "COMPLETED",
  });
  const model = modelReturning({
    action: "new",
    target: null,
    merge_reason: "暂无相似案例",
    title: "ThinkPad E14 键盘进水清理",
    device_model: "ThinkPad E14",
    fault: "键盘进水后部分按键失灵",
    investigation: null,
    cause: null,
    resolution: "拆机清理排线",
    result: "COMPLETED",
    category: null,
    differences: null,
    evidences: [
      { source: "S1", field: "fault", quote: "键盘进水后部分按键失灵" },
      { source: "S1", field: "resolution", quote: "拆机清理排线" },
    ],
  });
  const state = await knowledgeCaseService.markTypical(memberA(), recordId, {
    callModelFn: model.fn,
    embedFn: fakeEmbed,
  });
  assert.equal(state.status, "PUBLISHED");
  assert.ok(state.caseId, "应生成案例");
  const contribution = await contributionOf(recordId);
  assert.equal(contribution?.status, "PUBLISHED");
  const caseRow = await caseOf(state.caseId!);
  assert.equal(caseRow?.status, "PUBLISHED");
  assert.equal(caseRow?.visibility, "STAFF", "新案例默认内部可见");
  assert.equal(caseRow?.contentVersion, 1);
  assert.equal(caseRow?.embeddingStatus, "READY");
  assert.match(caseRow?.displayText ?? "", /键盘进水后部分按键失灵/);
  assert.match(caseRow?.displayText ?? "", /原文未提供：排查过程、原因/);
  assert.ok(
    ((caseRow?.structured as { unknowns: string[] }).unknowns ?? []).includes("原因"),
    "来源未写原因时必须保持未知",
  );

  // 来源详情：工作人员可打开，客户 404（不泄露内部案例存在性）。
  const chunkId = caseChunkId(caseRow!.id, caseRow!.contentVersion);
  const sourceUrl = `http://localhost/api/v1/knowledge/sources/${chunkId}`;
  const asStaff = await callRoute(knowledgeSourceRoute, sourceUrl, {
    headers: await bearerFor(STAFF_B_ID),
    params: { id: chunkId },
  });
  assert.equal(asStaff.status, 200, JSON.stringify(asStaff.json));
  const detail = dataOf(asStaff.json).caseDetail as Record<string, unknown>;
  assert.equal((detail.content as Record<string, unknown>).title, "ThinkPad E14 键盘进水清理");
  assert.equal((dataOf(asStaff.json).kind as string), "case");
  const sources = detail.sources as Array<Record<string, unknown>>;
  assert.equal(sources.length, 1);
  assert.equal(sources[0].canOpen, true, "工作人员有原备案权限，可打开原始记录");
  assert.equal(sources[0].repairRecordId, recordId);
  const asCustomer = await callRoute(knowledgeSourceRoute, sourceUrl, {
    headers: await bearerFor(CUSTOMER_ID),
    params: { id: chunkId },
  });
  assert.equal(asCustomer.status, 404, "STAFF 案例对客户不可见");
});

dbTest("幂等与完全重复：重复标记不重复建档；同内容来源复用既有案例且不再调用模型", async () => {
  enableFakeModelEnv();
  const first = await createApprovedRecord(MP_A_ID, {
    deviceModel: "ThinkPad E14",
    content: "屏幕闪烁，检查后发现排线松动，更换排线后恢复正常显示。",
    result: "COMPLETED",
  });
  const model = modelReturning({
    action: "new",
    target: null,
    title: "ThinkPad E14 屏幕排线处理",
    device_model: "ThinkPad E14",
    fault: "屏幕闪烁",
    resolution: "更换排线",
    evidences: [
      { source: "S1", field: "fault", quote: "屏幕闪烁" },
      { source: "S1", field: "resolution", quote: "更换排线" },
    ],
  });
  const firstState = await knowledgeCaseService.markTypical(memberA(), first, {
    callModelFn: model.fn,
    embedFn: fakeEmbed,
  });
  assert.equal(firstState.status, "PUBLISHED");
  assert.equal(model.calls, 1);
  const caseId = firstState.caseId!;

  // 重复标记（内容未变）：取回现状，不再调用模型。
  const repeated = await knowledgeCaseService.markTypical(memberA(), first, {
    callModelFn: model.fn,
    embedFn: fakeEmbed,
  });
  assert.equal(repeated.status, "PUBLISHED");
  assert.equal(repeated.caseId, caseId);
  assert.equal(model.calls, 1, "内容未变时不得重复调用模型");

  // 完全重复：另一条实质内容相同的备案 → 复用既有案例，不新建、不调模型。
  const duplicate = await createApprovedRecord(MP_B_ID, {
    deviceModel: "ThinkPad E14",
    content: "屏幕闪烁，检查后发现排线松动，更换排线后恢复正常显示。",
    result: "COMPLETED",
  });
  const dupState = await knowledgeCaseService.markTypical(memberB(), duplicate, {
    callModelFn: model.fn,
    embedFn: fakeEmbed,
  });
  assert.equal(dupState.status, "PUBLISHED");
  assert.equal(dupState.caseId, caseId, "完全重复来源必须复用既有案例");
  assert.equal(model.calls, 1, "完全重复路径不得重复调用模型");
  assert.equal(await attachCount(caseId), 2, "重复来源应增加来源关联");
  const caseRow = await caseOf(caseId);
  assert.equal(caseRow?.contentVersion, 1, "内容未变时版本不递增（复用向量缓存）");
});

dbTest("相似合并：模型判断合并并保留多来源证据；结果相反时 MIXED 且带差异说明", async () => {
  enableFakeModelEnv();
  const db = getDb();
  // 上一条用例留下的案例（A + 完全重复来源）应存在：先取一个 STAFF 案例。
  const target = await db.knowledgeCase.findFirst({
    where: { status: "PUBLISHED", visibility: "STAFF" },
    orderBy: { updatedAt: "desc" },
  });
  assert.ok(target, "前置用例应已产生案例");
  const caseId = target!.id;
  const before = await attachCount(caseId);

  const similar = await createApprovedRecord(MP_B_ID, {
    deviceModel: "ThinkPad E14",
    content: "同型号键盘进水，清理后个别键失灵，更换键盘模块后恢复。",
    result: "NOT_COMPLETED",
  });
  const model = modelReturning(
    mergePayload("同型号键盘进水，清理后个别键失灵", "更换键盘模块后恢复"),
  );
  const state = await knowledgeCaseService.markTypical(memberB(), similar, {
    callModelFn: model.fn,
    embedFn: fakeEmbed,
  });
  assert.equal(state.status, "PUBLISHED");
  assert.equal(state.caseId, caseId, "相似来源应合并到既有案例");
  assert.equal(model.calls, 1);
  assert.equal(await attachCount(caseId), before + 1);

  const caseRow = await caseOf(caseId);
  assert.equal(caseRow?.contentVersion, 2, "合并后内容版本递增");
  const structured = caseRow!.structured as Record<string, unknown>;
  assert.equal(structured.result, "MIXED", "已完成 + 未完成必须保留为 MIXED，不抹平差异");
  assert.match(String(structured.differences ?? ""), /结果不一致/);
  // 新来源贡献保留逐条证据。
  const contribution = await contributionOf(similar);
  const snapshot = contribution?.evidence as { quotes?: Array<{ field: string; quote: string }> } | null;
  assert.ok((snapshot?.quotes?.length ?? 0) >= 1, "来源应保存可定位的引文证据");
});

dbTest("并发合并：两条相似来源同时处理不丢贡献（一条失败可重试后合入同一案例）", async () => {
  enableFakeModelEnv();
  const db = getDb();
  const target = await db.knowledgeCase.findFirst({
    where: { status: "PUBLISHED", visibility: "STAFF" },
    orderBy: { updatedAt: "desc" },
  });
  assert.ok(target);
  const caseId = target!.id;
  const before = await attachCount(caseId);

  const r1 = await createApprovedRecord(MP_A_ID, {
    deviceModel: "ThinkPad E14",
    content: "键盘进水，清理后部分按键失灵，更换键盘排线后恢复。",
    result: "COMPLETED",
  });
  const r2 = await createApprovedRecord(MP_B_ID, {
    deviceModel: "ThinkPad E14",
    content: "键盘进水，清理后部分按键失灵，更换键盘排线后恢复使用。",
    result: "COMPLETED",
  });
  // 闸门：两次模型调用都进入后才放行，保证两条处理都在「读到同一案例版本」之后才发布。
  const payload = mergePayload("键盘进水，清理后部分按键失灵", "更换键盘排线后恢复");
  let modelCalls = 0;
  let releaseGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const gatedModel = async (): Promise<string> => {
    modelCalls += 1;
    if (modelCalls >= 2) releaseGate();
    await gate;
    return JSON.stringify(payload);
  };
  const [s1, s2] = await Promise.all([
    knowledgeCaseService.markTypical(memberA(), r1, { callModelFn: gatedModel, embedFn: fakeEmbed }),
    knowledgeCaseService.markTypical(memberB(), r2, { callModelFn: gatedModel, embedFn: fakeEmbed }),
  ]);
  const published = [s1, s2].filter((state) => state.status === "PUBLISHED");
  const failed = [s1, s2].filter((state) => state.status === "FAILED");
  assert.equal(published.length, 1, `并发合并应仅一条成功，实际：${JSON.stringify([s1.status, s2.status])}`);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].failureCode, "CASE_VERSION_CONFLICT", "失败必须如实标注版本冲突");
  assert.equal(await attachCount(caseId), before + 1, "第一阶段只应合入一条");

  // 失败的一条重试：重新规划（读到最新版本）后合入同一案例，两个来源都保留。
  const failedRecord = s1.status === "FAILED" ? r1 : r2;
  const retried = await knowledgeCaseService.retryProcessing(admin(), failedRecord, {
    callModelFn: async () => JSON.stringify(payload),
    embedFn: fakeEmbed,
  });
  assert.equal(retried.outcome?.status, "PUBLISHED", JSON.stringify(retried.outcome));
  assert.equal(await attachCount(caseId), before + 2, "重试后两条来源都不丢");
  const sources = await db.knowledgeCaseSource.findMany({ where: { caseId, status: "PUBLISHED" } });
  const ids = sources.map((row) => row.repairRecordId);
  assert.ok(ids.includes(r1) && ids.includes(r2));
});

dbTest("机型相近但不同故障不强合；伪造的合并目标被拒绝", async () => {
  enableFakeModelEnv();
  const db = getDb();
  const casesBefore = await db.knowledgeCase.count({ where: { status: "PUBLISHED" } });
  const printer = await createApprovedRecord(MP_A_ID, {
    deviceModel: "HP M1136",
    content: "打印机开机报错 E3，清理进纸传感器后恢复正常。",
    result: "COMPLETED",
  });
  const model = modelReturning(newCasePayload("打印机开机报错 E3", "清理进纸传感器"));
  const state = await knowledgeCaseService.markTypical(memberA(), printer, {
    callModelFn: model.fn,
    embedFn: fakeEmbed,
  });
  assert.equal(state.status, "PUBLISHED");
  assert.equal(await db.knowledgeCase.count({ where: { status: "PUBLISHED" } }), casesBefore + 1, "不同故障应新建独立案例");

  // 伪造目标：模型要求合并到不在白名单里的目标 → 按坏输出失败，不产生任何写入。
  const forged = await createApprovedRecord(MP_A_ID, {
    deviceModel: "ThinkPad E14",
    content: "键盘进水后触摸板失灵，排线重新插拔后恢复。",
    result: "COMPLETED",
  });
  const forgedModel = modelReturning({ action: "merge", target: "C9", title: "伪造目标", evidences: [] });
  const forgedState = await knowledgeCaseService.markTypical(memberA(), forged, {
    callModelFn: forgedModel.fn,
    embedFn: fakeEmbed,
  });
  assert.equal(forgedState.status, "FAILED");
  assert.equal(forgedState.failureCode, "MODEL_OUTPUT_INVALID");
  const contribution = await contributionOf(forged);
  assert.equal(contribution?.status, "FAILED");
  assert.equal(contribution?.caseId, null, "坏输出不得挂接任何案例");
});

dbTest("模型期间来源取消典型：旧结果不能继续发布", async () => {
  enableFakeModelEnv();
  const db = getDb();
  const recordId = await createApprovedRecord(MP_A_ID, {
    deviceModel: "ThinkPad E14",
    content: "整理期间取消典型：键盘进水按键失灵。",
    result: "COMPLETED",
  });
  const raceModel: FakeModel = {
    calls: 0,
    fn: async () => {
      raceModel.calls += 1;
      // 模拟「模型生成期间」作者取消典型。
      await db.repairRecord.update({ where: { id: recordId }, data: { isTypical: false } });
      return JSON.stringify(newCasePayload("键盘进水按键失灵", "清理排线"));
    },
  };
  const before = await db.knowledgeCase.count();
  const state = await knowledgeCaseService.markTypical(memberA(), recordId, {
    callModelFn: raceModel.fn,
    embedFn: fakeEmbed,
  });
  // 视图层把 REMOVED 归一为 NONE（对外语义：当前未参与整理）。
  assert.equal(state.status, "NONE", JSON.stringify(state));
  assert.equal(await db.knowledgeCase.count(), before, "取消典型后旧结果不得发布新案例");
  const contribution = await contributionOf(recordId);
  assert.equal(contribution?.status, "REMOVED");
  assert.equal(contribution?.caseId, null);
});

dbTest("模型失败可重试：先超时失败，重试后成功发布", async () => {
  enableFakeModelEnv();
  const recordId = await createApprovedRecord(MP_A_ID, {
    deviceModel: "Dell 5490",
    content: "电池鼓包，更换电池后恢复正常。",
    result: "COMPLETED",
  });
  let failFirst = true;
  const flaky = async (): Promise<string> => {
    if (failFirst) {
      failFirst = false;
      throw new ChatModelError("timeout", "模拟超时");
    }
    return JSON.stringify({
      action: "new",
      target: null,
      title: "Dell 5490 电池鼓包更换",
      device_model: "Dell 5490",
      fault: "电池鼓包",
      resolution: "更换电池",
      evidences: [
        { source: "S1", field: "fault", quote: "电池鼓包" },
        { source: "S1", field: "resolution", quote: "更换电池" },
      ],
    });
  };
  const first = await knowledgeCaseService.markTypical(memberA(), recordId, {
    callModelFn: flaky,
    embedFn: fakeEmbed,
  });
  assert.equal(first.status, "FAILED");
  assert.equal(first.failureCode, "MODEL_TIMEOUT");
  assert.equal(first.canRetry, true);
  const retried = await knowledgeCaseService.retryProcessing(memberA(), recordId, {
    callModelFn: flaky,
    embedFn: fakeEmbed,
  });
  assert.equal(retried.outcome?.status, "PUBLISHED");
  assert.equal(retried.state.status, "PUBLISHED");
});

dbTest("来源正文修改：案例立即停用，后台重整失败可见，管理员重整后按剩余来源恢复", async () => {
  enableFakeModelEnv();
  const db = getDb();
  // 专用两条来源的案例：内容互不重复，引文好定位。
  const rA = await createApprovedRecord(MP_A_ID, {
    deviceModel: "ViewSonic 显示器",
    content: "显示器无信号，更换 HDMI 线后恢复。",
    result: "COMPLETED",
  });
  const rB = await createApprovedRecord(MP_B_ID, {
    deviceModel: "ViewSonic 显示器",
    content: "显示器无信号，检查后发现线材松动，重新插紧后恢复。",
    result: "COMPLETED",
  });
  const created = await knowledgeCaseService.markTypical(memberA(), rA, {
    callModelFn: async () =>
      JSON.stringify({
        action: "new",
        target: null,
        title: "ViewSonic 显示器无信号处理",
        device_model: "ViewSonic 显示器",
        fault: "显示器无信号",
        resolution: "更换 HDMI 线",
        evidences: [
          { source: "S1", field: "fault", quote: "显示器无信号" },
          { source: "S1", field: "resolution", quote: "更换 HDMI 线" },
        ],
      }),
    embedFn: fakeEmbed,
  });
  assert.equal(created.status, "PUBLISHED");
  const caseId = created.caseId!;
  const merged = await knowledgeCaseService.markTypical(memberB(), rB, {
    callModelFn: async () => JSON.stringify(mergePayload("显示器无信号，检查后发现线材松动", "重新插紧后恢复")),
    embedFn: fakeEmbed,
  });
  assert.equal(merged.status, "PUBLISHED");
  assert.equal(merged.caseId, caseId);
  assert.equal(await attachCount(caseId), 2);
  const versionBeforeEdit = (await caseOf(caseId))!.contentVersion;

  disableModelEnv();
  const editTarget = await db.repairRecord.findUniqueOrThrow({ where: { id: rA } });
  const edited = await callRoute(
    adminRecordRoute,
    `http://localhost/api/v1/admin/repairs/${editTarget.id}`,
    {
      method: "PATCH",
      headers: { cookie: await cookieFor(ADMIN_ID) },
      params: { id: editTarget.id },
      body: {
        version: editTarget.version,
        reason: "Issue40 集成用例：修正正文",
        content: "显示器无信号。", // 实质内容变化
        result: editTarget.result,
        deviceModel: editTarget.deviceModel,
        remark: editTarget.remark,
      },
    },
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  const afterEdit = await caseOf(caseId);
  assert.notEqual(afterEdit?.status, "PUBLISHED", "正文修改后案例必须立即停止检索");
  const detached = await contributionOf(rA);
  assert.equal(detached?.status, "REMOVED", "被修改的来源贡献应被移除");
  assert.equal(detached?.caseId, null);

  // 后台自动重整（本用例关闭模型 → 如实失败并显示，不伪装成功）。
  await awaitBackgroundTasksForTests();
  const failedCase = await caseOf(caseId);
  assert.equal(failedCase?.status, "FAILED");
  assert.equal(failedCase?.failureCode, "MODEL_NOT_CONFIGURED");
  assert.ok((failedCase?.failureMessage ?? "").length > 0, "失败原因对管理员可见");

  // 管理员显式重试（注入假模型）→ 按剩余有效来源重整发布。
  enableFakeModelEnv();
  const reprocessed = await knowledgeCaseService.reprocessCaseByAdmin(admin(), caseId, {
    callModelFn: async (_config, messages) => {
      assert.ok(messages[1].content.includes("重新整理为一张合并后的案例卡"));
      return JSON.stringify({
        action: "new",
        target: null,
        title: "重新整理的显示器案例",
        device_model: "ViewSonic 显示器",
        fault: "显示器无信号",
        resolution: "重新插紧线材后恢复",
        evidences: [
          { source: "S1", field: "fault", quote: "显示器无信号" },
          { source: "S1", field: "resolution", quote: "重新插紧后恢复" },
        ],
      });
    },
    embedFn: fakeEmbed,
  });
  assert.equal(reprocessed.outcome.status, "PUBLISHED", JSON.stringify(reprocessed.outcome));
  const refreshed = await caseOf(caseId);
  assert.equal(refreshed?.status, "PUBLISHED");
  assert.equal(await attachCount(caseId), 1, "重整后只剩未受影响的一条来源");
  assert.ok(refreshed!.contentVersion > versionBeforeEdit);
});

dbTest("管理员撤回：检索与来源立即失效，普通重试不能恢复，显式重整可恢复且范围保持", async () => {
  disableModelEnv();
  const db = getDb();
  const target = await db.knowledgeCase.findFirst({
    where: { status: "PUBLISHED", sources: { some: { status: "PUBLISHED" } } },
    include: { sources: true },
    orderBy: { updatedAt: "desc" },
  });
  assert.ok(target);
  const caseId = target!.id;
  const version = target!.contentVersion;
  const adminHeaders = { cookie: await cookieFor(ADMIN_ID) };

  const withdrawn = await callRoute(caseWithdrawRoute, `http://localhost/api/v1/knowledge-cases/${caseId}/withdraw`, {
    method: "POST",
    headers: adminHeaders,
    params: { id: caseId },
  });
  assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.json));
  assert.equal(dataOf(withdrawn.json).status, "WITHDRAWN");
  assert.equal((dataOf(withdrawn.json).withdrawn as { source: string }).source, "ADMIN");

  // 来源详情（旧版本块 ID）立即 404。
  const chunkId = caseChunkId(caseId, version);
  const asStaff = await callRoute(knowledgeSourceRoute, `http://localhost/api/v1/knowledge/sources/${chunkId}`, {
    headers: await bearerFor(STAFF_A_ID),
    params: { id: chunkId },
  });
  assert.equal(asStaff.status, 404, "撤回后来源读取必须失效");

  // 普通重试不能恢复：来源仍挂在被撤回的案例上，重试返回状态冲突。
  const sourceRecord = await db.knowledgeCaseSource.findFirst({
    where: { caseId, status: "PUBLISHED" },
  });
  assert.ok(sourceRecord);
  await assert.rejects(
    () =>
      knowledgeCaseService.retryProcessing(admin(), sourceRecord!.repairRecordId, {
        callModelFn: async () => "{}",
        embedFn: fakeEmbed,
      }),
    (error: unknown) => (error as { code?: string }).code === "CASE_STATE_CONFLICT",
  );

  // 管理员显式恢复（重新整理发布）。
  enableFakeModelEnv();
  const restored = await knowledgeCaseService.reprocessCaseByAdmin(admin(), caseId, {
    callModelFn: async () =>
      JSON.stringify({
        action: "new",
        target: null,
        title: "恢复后的显示器案例",
        device_model: "ViewSonic 显示器",
        fault: "显示器无信号",
        resolution: "重新插紧后恢复",
        evidences: [
          { source: "S1", field: "fault", quote: "显示器无信号" },
          { source: "S1", field: "resolution", quote: "重新插紧后恢复" },
        ],
      }),
    embedFn: fakeEmbed,
  });
  assert.equal(restored.outcome.status, "PUBLISHED", JSON.stringify(restored.outcome));
  const refreshed = await caseOf(caseId);
  assert.equal(refreshed?.status, "PUBLISHED");
  assert.equal(refreshed?.withdrawnSource, null);
  assert.equal(refreshed?.visibility, "STAFF", "恢复不改变可见范围");
});

dbTest("可见性：管理员改公开后客户可检索与打开；改回内部立即对客户失效", async () => {
  disableModelEnv();
  const db = getDb();
  const target = await db.knowledgeCase.findFirst({
    where: { status: "PUBLISHED" },
    orderBy: { updatedAt: "desc" },
  });
  assert.ok(target);
  const caseId = target!.id;

  const toPublic = await callRoute(caseVisibilityRoute, `http://localhost/api/v1/knowledge-cases/${caseId}/visibility`, {
    method: "POST",
    headers: { cookie: await cookieFor(ADMIN_ID) },
    params: { id: caseId },
    body: { visibility: "PUBLIC" },
  });
  assert.equal(toPublic.status, 200, JSON.stringify(toPublic.json));
  assert.equal(dataOf(toPublic.json).visibility, "PUBLIC");

  const chunkId = caseChunkId(caseId, (dataOf(toPublic.json) as { contentVersion: number }).contentVersion);
  const asCustomer = await callRoute(knowledgeSourceRoute, `http://localhost/api/v1/knowledge/sources/${chunkId}`, {
    headers: await bearerFor(CUSTOMER_ID),
    params: { id: chunkId },
  });
  assert.equal(asCustomer.status, 200, "公开案例客户可打开引用详情");
  const detail = dataOf(asCustomer.json).caseDetail as Record<string, unknown>;
  const sources = detail.sources as Array<Record<string, unknown>>;
  assert.ok(sources.length > 0);
  assert.equal(sources[0].authorName, null, "客户看不到来源作者");
  assert.equal(sources[0].repairRecordId, null, "客户看不到原始备案入口");
  assert.equal(sources[0].canOpen, false);
  assert.ok(Array.isArray(sources[0].quotes), "客户可看到可公开的引文证据");

  const staffChunk = caseChunkId(caseId, (dataOf(toPublic.json) as { contentVersion: number }).contentVersion);
  const staffSource = await callRoute(knowledgeSourceRoute, `http://localhost/api/v1/knowledge/sources/${staffChunk}`, {
    headers: await bearerFor(STAFF_A_ID),
    params: { id: staffChunk },
  });
  assert.equal((dataOf(staffSource.json).caseDetail as { sources: Array<{ canOpen: boolean }> }).sources[0].canOpen, true);

  const backToStaff = await callRoute(caseVisibilityRoute, `http://localhost/api/v1/knowledge-cases/${caseId}/visibility`, {
    method: "POST",
    headers: { cookie: await cookieFor(ADMIN_ID) },
    params: { id: caseId },
    body: { visibility: "STAFF" },
  });
  assert.equal(backToStaff.status, 200);
  const customerAfter = await callRoute(knowledgeSourceRoute, `http://localhost/api/v1/knowledge/sources/${chunkId}`, {
    headers: await bearerFor(CUSTOMER_ID),
    params: { id: chunkId },
  });
  assert.equal(customerAfter.status, 404, "改回内部后客户立即失效（不依赖索引重建）");
});

dbTest("列表与详情：工作人员可读，管理员动作能力正确；客户被拒", async () => {
  disableModelEnv();
  const db = getDb();
  const target = await db.knowledgeCase.findFirst({ where: { status: "PUBLISHED" } });
  assert.ok(target);

  const asCustomer = await callRoute(caseListRoute, "http://localhost/api/v1/knowledge-cases", {
    headers: await bearerFor(CUSTOMER_ID),
  });
  assert.equal(asCustomer.status, 403);

  const asMember = await callRoute(caseListRoute, "http://localhost/api/v1/knowledge-cases?status=PUBLISHED", {
    headers: await bearerFor(STAFF_A_ID),
  });
  assert.equal(asMember.status, 200, JSON.stringify(asMember.json));
  const items = dataOf(asMember.json) as unknown as Array<Record<string, unknown>>;
  assert.ok(items.length >= 1);
  const listed = items.find((item) => item.id === target!.id);
  assert.ok(listed, "列表应包含已发布案例");
  assert.ok((listed!.sourceCount as number) >= 1);

  const detailUrl = `http://localhost/api/v1/knowledge-cases/${target!.id}`;
  const memberDetail = await callRoute(caseDetailRoute, detailUrl, {
    headers: await bearerFor(STAFF_A_ID),
    params: { id: target!.id },
  });
  assert.equal(memberDetail.status, 200);
  const actions = dataOf(memberDetail.json).actions as Record<string, boolean>;
  assert.equal(actions.canManage, false, "普通成员没有管理动作");
  const adminDetail = await callRoute(caseDetailRoute, detailUrl, {
    headers: { cookie: await cookieFor(ADMIN_ID) },
    params: { id: target!.id },
  });
  assert.equal(adminDetail.status, 200);
  assert.equal((dataOf(adminDetail.json).actions as Record<string, boolean>).canManage, true);
  const sourceList = dataOf(adminDetail.json).sources as Array<Record<string, unknown>>;
  assert.ok(sourceList.length >= 1);
  assert.ok(typeof sourceList[0].authorName === "string" && (sourceList[0].authorName as string).length > 0);
});

dbTest("向量失败降级关键词并单条重试：未配置时如实报错，注入向量后 READY", async () => {
  enableFakeModelEnv();
  const recordId = await createApprovedRecord(MP_A_ID, {
    deviceModel: "Acer Swift 3",
    content: "风扇异响，清理风扇加注润滑后恢复安静。",
    result: "COMPLETED",
  });
  const failingEmbed = async (): Promise<number[][]> => {
    throw new Error("模拟向量服务故障");
  };
  const state = await knowledgeCaseService.markTypical(memberA(), recordId, {
    callModelFn: async () =>
      JSON.stringify({
        action: "new",
        target: null,
        title: "Acer Swift 3 风扇异响处理",
        device_model: "Acer Swift 3",
        fault: "风扇异响",
        resolution: "清理风扇加注润滑",
        evidences: [
          { source: "S1", field: "fault", quote: "风扇异响" },
          { source: "S1", field: "resolution", quote: "清理风扇加注润滑" },
        ],
      }),
    embedFn: failingEmbed,
  });
  assert.equal(state.status, "PUBLISHED", "向量失败不应阻塞正文发布（关键词先可用）");
  const caseRow = await caseOf(state.caseId!);
  assert.equal(caseRow?.embeddingStatus, "FAILED");
  assert.ok((caseRow?.embeddingError ?? "").includes("模拟向量服务故障"));

  // 未配置向量服务时，单条重试如实报 AI_NOT_CONFIGURED（503）。
  disableModelEnv();
  const url = `http://localhost/api/v1/knowledge-cases/${state.caseId}/embedding`;
  const notConfigured = await callRoute(caseEmbeddingRoute, url, {
    method: "POST",
    headers: { cookie: await cookieFor(ADMIN_ID) },
    params: { id: state.caseId! },
  });
  assert.equal(notConfigured.status, 503);
  assert.equal(errorCodeOf(notConfigured.json), "AI_NOT_CONFIGURED");

  // 注入假向量后单条重试成功，状态如实变为 READY。
  enableFakeModelEnv();
  const detail = await knowledgeCaseService.reembedCase(admin(), state.caseId!, { embedFn: fakeEmbed });
  assert.equal(detail.embedding.status, "READY");
  const refreshed = await caseOf(state.caseId!);
  assert.equal(refreshed?.embeddingStatus, "READY");
  assert.equal(refreshed?.embeddingFingerprint, "siliconflow:BAAI/bge-m3");
  assert.equal(refreshed?.contentVersion, caseRow?.contentVersion, "单条向量重试不改变内容版本");
});

dbTest("管理员标记（原 Web flags 路径）：isTypical 置 true 驱动后台整理；取消时案例撤下", async () => {
  disableModelEnv();
  const recordId = await createApprovedRecord(MP_A_ID, {
    deviceModel: "Lenovo 小新 Air14",
    content: "屏幕闪烁，更换排线后恢复正常。",
    result: "COMPLETED",
  });
  const flagsRouteUrl = `http://localhost/api/v1/admin/repairs/${recordId}/flags`;
  const { PATCH: flagsRoute } = await import("../../src/app/api/v1/admin/repairs/[id]/flags/route");
  const flagged = await callRoute(flagsRoute, flagsRouteUrl, {
    method: "PATCH",
    headers: { cookie: await cookieFor(ADMIN_ID) },
    params: { id: recordId },
    body: { isDifficult: false, isTypical: true },
  });
  assert.equal(flagged.status, 200, JSON.stringify(flagged.json));
  await awaitBackgroundTasksForTests();
  const contribution = await contributionOf(recordId);
  assert.ok(contribution, "管理端标记后应创建来源贡献并尝试整理");
  assert.equal(contribution!.status, "FAILED", "未配置模型时后台整理如实失败");
  assert.equal(contribution!.failureCode, "MODEL_NOT_CONFIGURED");

  // 取消典型（Web 管理路径）：贡献移除、无案例可撤。
  const unflagged = await callRoute(flagsRoute, flagsRouteUrl, {
    method: "PATCH",
    headers: { cookie: await cookieFor(ADMIN_ID) },
    params: { id: recordId },
    body: { isDifficult: false, isTypical: false },
  });
  assert.equal(unflagged.status, 200);
  const after = await contributionOf(recordId);
  assert.equal(after?.status, "REMOVED");
});

dbTest("取消典型（原生通道）：多来源案例按剩余来源重整（失败可见）；单来源案例自动撤下", async () => {
  enableFakeModelEnv();
  // 专用两条来源案例。
  const rC = await createApprovedRecord(MP_A_ID, {
    deviceModel: "MacBook Air",
    content: "续航明显缩短，检测电池循环次数过高，更换电池后恢复。",
    result: "COMPLETED",
  });
  const rD = await createApprovedRecord(MP_B_ID, {
    deviceModel: "MacBook Air",
    content: "续航缩短，电池健康度低于 80%，更换电池后恢复使用。",
    result: "COMPLETED",
  });
  const created = await knowledgeCaseService.markTypical(memberA(), rC, {
    callModelFn: async () =>
      JSON.stringify({
        action: "new",
        target: null,
        title: "MacBook Air 续航缩短处理",
        device_model: "MacBook Air",
        fault: "续航明显缩短",
        resolution: "更换电池",
        evidences: [
          { source: "S1", field: "fault", quote: "续航明显缩短" },
          { source: "S1", field: "resolution", quote: "更换电池" },
        ],
      }),
    embedFn: fakeEmbed,
  });
  assert.equal(created.status, "PUBLISHED");
  const caseId = created.caseId!;
  const merged = await knowledgeCaseService.markTypical(memberB(), rD, {
    callModelFn: async () => JSON.stringify(mergePayload("续航缩短，电池健康度低于 80%", "更换电池后恢复使用")),
    embedFn: fakeEmbed,
  });
  assert.equal(merged.status, "PUBLISHED");
  assert.equal(merged.caseId, caseId);
  assert.equal(await attachCount(caseId), 2);

  // 作者（rD 属于成员 B）经原生通道取消典型；案例立即停止检索，后台重整失败可见。
  disableModelEnv();
  const removed = await callRoute(
    unmarkRoute,
    `http://localhost/api/v1/knowledge-cases/records/${rD}/typical`,
    { method: "DELETE", headers: await bearerFor(STAFF_B_ID), params: { id: rD } },
  );
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  const afterUnmark = await caseOf(caseId);
  assert.notEqual(afterUnmark?.status, "PUBLISHED", "取消典型后案例必须立即停止检索");
  assert.equal((await contributionOf(rD))?.status, "REMOVED");
  await awaitBackgroundTasksForTests();
  const failedReprocess = await caseOf(caseId);
  assert.equal(failedReprocess?.status, "FAILED", "有剩余来源但重整失败时显示失败，可重试");
  assert.equal(await attachCount(caseId), 1);

  // 单来源案例取消典型 → 无有效来源自动撤下。
  enableFakeModelEnv();
  const rE = await createApprovedRecord(MP_A_ID, {
    deviceModel: "单来源机型",
    content: "扬声器无声，重装声卡驱动后恢复。",
    result: "COMPLETED",
  });
  const single = await knowledgeCaseService.markTypical(memberA(), rE, {
    callModelFn: async () =>
      JSON.stringify({
        action: "new",
        target: null,
        title: "单来源扬声器案例",
        device_model: "单来源机型",
        fault: "扬声器无声",
        resolution: "重装声卡驱动",
        evidences: [
          { source: "S1", field: "fault", quote: "扬声器无声" },
          { source: "S1", field: "resolution", quote: "重装声卡驱动" },
        ],
      }),
    embedFn: fakeEmbed,
  });
  assert.equal(single.status, "PUBLISHED");
  disableModelEnv();
  await knowledgeCaseService.unmarkTypical(memberA(), rE);
  await awaitBackgroundTasksForTests();
  const singleCase = await caseOf(single.caseId!);
  assert.equal(singleCase?.status, "WITHDRAWN", "无有效来源的案例必须自动撤下");
  assert.equal(singleCase?.withdrawnSource, "SOURCES_EXHAUSTED");
  assert.equal(await attachCount(single.caseId!), 0);
});

// ---------- 审查回归（PR #52 第一轮审查的 7 类问题） ----------

dbTest("回归 P1-1：new 不受未选中候选的结果与证据影响（服务端按实际选择收窄来源集合）", async () => {
  enableFakeModelEnv();
  // 候选案例：结果为 NOT_COMPLETED。
  const r1 = await createApprovedRecord(MP_A_ID, {
    deviceModel: "ThinkPad E14",
    content: "键盘进水后部分按键失灵，拆机清理排线后按键仍不可用。",
    result: "NOT_COMPLETED",
  });
  const first = await knowledgeCaseService.markTypical(memberA(), r1, {
    callModelFn: async () =>
      JSON.stringify({
        action: "new",
        target: null,
        title: "ThinkPad E14 键盘进水处理",
        device_model: "ThinkPad E14",
        fault: "键盘进水后部分按键失灵",
        resolution: "拆机清理排线",
        evidences: [
          { source: "S1", field: "fault", quote: "键盘进水后部分按键失灵" },
          { source: "S1", field: "resolution", quote: "拆机清理排线" },
        ],
      }),
    embedFn: fakeEmbed,
  });
  assert.equal(first.status, "PUBLISHED");
  const candidateCaseId = first.caseId!;

  // 新来源（COMPLETED）：模型选择 new，但字段/差异/引文全部引用候选来源（S2）。
  const r2 = await createApprovedRecord(MP_B_ID, {
    deviceModel: "ThinkPad E14",
    content: "键盘进水，个别键失灵感，更换键盘模块后恢复。",
    result: "COMPLETED",
  });
  const second = await knowledgeCaseService.markTypical(memberB(), r2, {
    callModelFn: async () =>
      JSON.stringify({
        action: "new",
        target: null,
        title: "键盘进水处理（新）",
        device_model: "ThinkPad E14",
        fault: "排线失效",
        resolution: "拆机清理排线",
        result: "MIXED",
        differences: "S1 结果为已完成，S2 结果为未完成。",
        evidences: [
          { source: "S2", field: "fault", quote: "拆机清理排线后按键仍不可用" },
          { source: "S2", field: "resolution", quote: "拆机清理排线" },
        ],
      }),
    embedFn: fakeEmbed,
  });
  assert.equal(second.status, "PUBLISHED", JSON.stringify(second));
  assert.notEqual(second.caseId, candidateCaseId, "action=new 必须新建独立案例");
  const created = await caseOf(second.caseId!);
  const structured = created!.structured as Record<string, unknown>;
  assert.equal(structured.result, "COMPLETED", "候选的 NOT_COMPLETED 不得把新案例改成 MIXED");
  assert.equal(structured.differences, null, "单一来源不得携带候选间差异说明");
  assert.equal(structured.resolution, null, "引文只来自未选中候选时字段必须置为未提供");
  assert.equal(await attachCount(second.caseId!), 1);
  assert.equal(await attachCount(candidateCaseId), 1, "候选案例的来源不受影响");
});

dbTest("回归 P1-2：重整/显式恢复期间再次撤回，迟到的模型结果不重新发布", async () => {
  enableFakeModelEnv();
  const db = getDb();
  const recordId = await createApprovedRecord(MP_A_ID, {
    deviceModel: "重回测试机型",
    content: "系统无法关机，长按电源键后恢复。",
    result: "COMPLETED",
  });
  const created = await knowledgeCaseService.markTypical(memberA(), recordId, {
    callModelFn: async () =>
      JSON.stringify({
        action: "new",
        target: null,
        title: "重回测试案例",
        device_model: "重回测试机型",
        fault: "无法关机",
        resolution: "长按电源键",
        evidences: [
          { source: "S1", field: "fault", quote: "无法关机" },
          { source: "S1", field: "resolution", quote: "长按电源键" },
        ],
      }),
    embedFn: fakeEmbed,
  });
  assert.equal(created.status, "PUBLISHED");
  const caseId = created.caseId!;
  const versionBefore = (await caseOf(caseId))!.contentVersion;
  const regeneratePayload = JSON.stringify({
    action: "new",
    target: null,
    title: "重回测试案例（重整）",
    device_model: "重回测试机型",
    fault: "无法关机",
    resolution: "长按电源键",
    evidences: [
      { source: "S1", field: "fault", quote: "无法关机" },
      { source: "S1", field: "resolution", quote: "长按电源键" },
    ],
  });

  // 场景一：普通重整期间管理员撤回 → 迟到的模型结果不得重新发布。
  const reprocessed = await knowledgeCaseService.reprocessCaseByAdmin(admin(), caseId, {
    callModelFn: async () => {
      await knowledgeCaseService.withdrawCase(admin(), caseId);
      return regeneratePayload;
    },
    embedFn: fakeEmbed,
  });
  assert.equal(reprocessed.outcome.status, "SKIPPED", JSON.stringify(reprocessed.outcome));
  assert.equal(reprocessed.outcome.failureCode, "CASE_WITHDRAWN");
  const afterFirst = await caseOf(caseId);
  assert.equal(afterFirst?.status, "WITHDRAWN", "重整期间的撤回必须保持生效");
  assert.equal(afterFirst?.withdrawnSource, "ADMIN");
  assert.equal(afterFirst?.contentVersion, versionBefore, "迟到结果不得递增版本");

  // 场景二：显式恢复（撤回后重新整理）期间再次撤回 → 旧结果不得覆盖第二次撤回。
  let secondWithdrawnAt: Date | null = null;
  const restored = await knowledgeCaseService.reprocessCaseByAdmin(admin(), caseId, {
    callModelFn: async () => {
      await knowledgeCaseService.withdrawCase(admin(), caseId);
      secondWithdrawnAt = (
        await db.knowledgeCase.findUniqueOrThrow({ where: { id: caseId } })
      ).withdrawnAt;
      return regeneratePayload;
    },
    embedFn: fakeEmbed,
  });
  assert.equal(restored.outcome.status, "SKIPPED", JSON.stringify(restored.outcome));
  assert.equal(restored.outcome.failureCode, "CASE_WITHDRAWN");
  const afterSecond = await caseOf(caseId);
  assert.equal(afterSecond?.status, "WITHDRAWN");
  assert.equal(afterSecond?.withdrawnSource, "ADMIN");
  assert.equal(afterSecond?.contentVersion, versionBefore);
  assert.equal(
    afterSecond!.withdrawnAt!.getTime(),
    secondWithdrawnAt!.getTime(),
    "第二次撤回的时间戳必须保留，不被旧恢复结果覆盖",
  );
});

dbTest("回归 P1-4：完全重复在规划与挂接之间被改公开时拒绝挂接（可重试）；正常重复仍复用", async () => {
  enableFakeModelEnv();
  const db = getDb();
  // 候选池需存在带向量的既有案例，确保规划阶段会调用向量接口（本用例的注入点）。
  const fillerRecord = await createApprovedRecord(MP_A_ID, {
    deviceModel: "填充机型",
    content: "电源键无反应，更换电源键后恢复。",
    result: "COMPLETED",
  });
  const filler = await knowledgeCaseService.markTypical(memberA(), fillerRecord, {
    callModelFn: async () =>
      JSON.stringify({
        action: "new",
        target: null,
        title: "填充案例",
        device_model: "填充机型",
        fault: "电源键无反应",
        resolution: "更换电源键",
        evidences: [
          { source: "S1", field: "fault", quote: "电源键无反应" },
          { source: "S1", field: "resolution", quote: "更换电源键" },
        ],
      }),
    embedFn: fakeEmbed,
  });
  assert.equal(filler.status, "PUBLISHED");

  const unique = `完全重复内容 ${randomUUID().slice(0, 8)}：触摸板失灵，重新插拔排线后恢复。`;
  const t1 = await createApprovedRecord(MP_A_ID, {
    deviceModel: "重复机型",
    content: unique,
    result: "COMPLETED",
  });
  const created = await knowledgeCaseService.markTypical(memberA(), t1, {
    callModelFn: async () =>
      JSON.stringify({
        action: "new",
        target: null,
        title: "重复案例",
        device_model: "重复机型",
        fault: "触摸板失灵",
        resolution: "重新插拔排线",
        evidences: [
          { source: "S1", field: "fault", quote: "触摸板失灵" },
          { source: "S1", field: "resolution", quote: "重新插拔排线" },
        ],
      }),
    embedFn: fakeEmbed,
  });
  assert.equal(created.status, "PUBLISHED");
  const caseId = created.caseId!;
  const versionBefore = (await caseOf(caseId))!.contentVersion;

  // 同一实质内容的第二条来源：规划（含向量调用）期间管理员把目标案例改公开。
  let flipHappened = false;
  let modelCalls = 0;
  const t2 = await createApprovedRecord(MP_B_ID, {
    deviceModel: "重复机型",
    content: unique,
    result: "COMPLETED",
  });
  const blocked = await knowledgeCaseService.markTypical(memberB(), t2, {
    callModelFn: async () => {
      modelCalls += 1;
      return "{}";
    },
    embedFn: async (_config: unknown, texts: string[]) => {
      if (!flipHappened) {
        flipHappened = true;
        await db.knowledgeCase.update({ where: { id: caseId }, data: { visibility: "PUBLIC" } });
      }
      return texts.map(() => [1, 0, 0]);
    },
  });
  assert.ok(flipHappened, "用例注入点必须触发（规划阶段确实调用了向量接口）");
  assert.equal(modelCalls, 0, "完全重复路径不应调用模型");
  assert.equal(blocked.status, "FAILED", JSON.stringify(blocked));
  assert.equal(blocked.failureCode, "CASE_VISIBILITY_CHANGED");
  const blockedContribution = await contributionOf(t2);
  assert.equal(blockedContribution?.status, "FAILED");
  assert.equal(blockedContribution?.caseId, null, "跨范围挂接必须被拒绝");
  assert.equal(blockedContribution?.processingStartedAt, null, "失败后必须释放租约（可重试）");
  const stillPublic = await caseOf(caseId);
  assert.equal(stillPublic?.visibility, "PUBLIC");
  assert.equal(stillPublic?.contentVersion, versionBefore, "被拒绝的挂接不得改动目标案例");
  assert.equal(await attachCount(caseId), 1, "被拒绝的来源不得挂入公开案例");

  // 改回内部后：正常完全重复仍复用案例（不调模型、不新增案例）。
  await db.knowledgeCase.update({ where: { id: caseId }, data: { visibility: "STAFF" } });
  const t3 = await createApprovedRecord(MP_A_ID, {
    deviceModel: "重复机型",
    content: unique,
    result: "COMPLETED",
  });
  const reused = await knowledgeCaseService.markTypical(memberA(), t3, {
    callModelFn: async () => {
      modelCalls += 1;
      return "{}";
    },
    embedFn: fakeEmbed,
  });
  assert.equal(reused.status, "PUBLISHED", JSON.stringify(reused));
  assert.equal(reused.caseId, caseId, "内部范围内的完全重复仍复用既有案例");
  assert.equal(modelCalls, 0);
  assert.equal(await attachCount(caseId), 2);
});

dbTest("回归 P2-6：超 8 条来源的重整明确失败不静默丢失；合并到已满案例被拒绝", async () => {
  enableFakeModelEnv();
  // 场景一：历史数据 9 条来源 → 重整必须明确拒绝（不静默只用前 8 条生成缺来源的正文）。
  const record = await createApprovedRecord(MP_A_ID, {
    deviceModel: "上限机型 A",
    content: "键盘灯不亮，更换排线后恢复。",
    result: "COMPLETED",
  });
  const created = await knowledgeCaseService.markTypical(memberA(), record, {
    callModelFn: async () =>
      JSON.stringify({
        action: "new",
        target: null,
        title: "上限案例 A",
        device_model: "上限机型 A",
        fault: "键盘灯不亮",
        resolution: "更换排线",
        evidences: [
          { source: "S1", field: "fault", quote: "键盘灯不亮" },
          { source: "S1", field: "resolution", quote: "更换排线" },
        ],
      }),
    embedFn: fakeEmbed,
  });
  assert.equal(created.status, "PUBLISHED");
  const caseId = created.caseId!;
  const versionBefore = (await caseOf(caseId))!.contentVersion;
  await attachFakeSources(caseId, 8, "P2-6 场景一");
  assert.equal(await attachCount(caseId), 9);

  let reprocessModelCalls = 0;
  const reprocessed = await knowledgeCaseService.reprocessCaseByAdmin(admin(), caseId, {
    callModelFn: async () => {
      reprocessModelCalls += 1;
      return "{}";
    },
    embedFn: fakeEmbed,
  });
  assert.equal(reprocessModelCalls, 0, "超限案例不得调用模型生成缺失来源的正文");
  assert.equal(reprocessed.outcome.status, "FAILED");
  assert.equal(reprocessed.outcome.failureCode, "CASE_SOURCE_LIMIT");
  assert.match(reprocessed.outcome.failureMessage ?? "", /上限/);
  const failedCase = await caseOf(caseId);
  assert.equal(failedCase?.status, "FAILED");
  assert.equal(failedCase?.failureCode, "CASE_SOURCE_LIMIT");
  assert.equal(failedCase?.contentVersion, versionBefore, "失败不得改变内容版本");
  assert.equal(await attachCount(caseId), 9, "全部来源必须保留，不静默丢弃");

  // 场景二：已满 8 条的案例，新相似来源合并被明确拒绝（不静默丢第 9 条事实）。
  const r8 = await createApprovedRecord(MP_A_ID, {
    deviceModel: "上限机型 B",
    content: "风扇异响，清理后恢复正常。",
    result: "COMPLETED",
  });
  const full = await knowledgeCaseService.markTypical(memberA(), r8, {
    callModelFn: async () =>
      JSON.stringify({
        action: "new",
        target: null,
        title: "上限案例 B",
        device_model: "上限机型 B",
        fault: "风扇异响",
        resolution: "清理风扇",
        evidences: [
          { source: "S1", field: "fault", quote: "风扇异响" },
          { source: "S1", field: "resolution", quote: "清理风扇" },
        ],
      }),
    embedFn: fakeEmbed,
  });
  assert.equal(full.status, "PUBLISHED");
  const fullCaseId = full.caseId!;
  await attachFakeSources(fullCaseId, 7, "P2-6 场景二");
  assert.equal(await attachCount(fullCaseId), 8);
  const fullVersion = (await caseOf(fullCaseId))!.contentVersion;

  const mergeAttempt = await createApprovedRecord(MP_B_ID, {
    deviceModel: "上限机型 B",
    content: "同型号风扇异响，清洁扇叶后恢复安静。",
    result: "COMPLETED",
  });
  const merged = await knowledgeCaseService.markTypical(memberB(), mergeAttempt, {
    callModelFn: async () => JSON.stringify(mergePayload("同型号风扇异响，清洁扇叶后恢复安静", "清洁扇叶")),
    embedFn: fakeEmbed,
  });
  assert.equal(merged.status, "FAILED", JSON.stringify(merged));
  assert.equal(merged.failureCode, "CASE_SOURCE_LIMIT");
  assert.equal(await attachCount(fullCaseId), 8, "超限合并必须被拒绝，不得挂入第 9 条");
  const fullAfter = await caseOf(fullCaseId);
  assert.equal(fullAfter?.contentVersion, fullVersion);
  const rejected = await contributionOf(mergeAttempt);
  assert.equal(rejected?.status, "FAILED");
  assert.equal(rejected?.caseId, null);
});
