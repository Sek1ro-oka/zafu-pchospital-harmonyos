import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { GET } from "../../src/app/api/v1/knowledge/cases/search/route";
import { GET as publicDetail } from "../../src/app/api/v1/customer/knowledge-cases/[id]/route";
import { materialHashOf, materialOf } from "../../src/features/knowledge-cases/case-material";
import { getDb, disconnectDb } from "../../src/lib/db/client";
import { callRoute } from "./http-harness";
import { integrationTestsEnabled } from "./db-guard";
import { CUSTOMER_ID, STAFF_A_ID, MP_A_ID, bearerFor, prepareStaffRepairFixtures, cleanupStaffRepairFixtures } from "./staff-repair-harness";

const enabled = integrationTestsEnabled(), dbTest = enabled ? test : test.skip;
const ids: string[] = [], records: string[] = [];
let customer: Record<string, string>, staff: Record<string, string>;
before(async () => {
  if (!enabled) return;
  await cleanupStaffRepairFixtures(); await prepareStaffRepairFixtures();
  customer = await bearerFor(CUSTOMER_ID); staff = await bearerFor(STAFF_A_ID);
  const db = getDb();
  for (let i = 0; i < 24; i++) {
    const id = randomUUID(), recordId = randomUUID(), now = new Date(Date.UTC(2026, 0, 1, 0, 0, i));
    ids.push(id); records.push(recordId);
    const record = await db.repairRecord.create({ data: { id: recordId, memberProfileId: MP_A_ID,
      status: "APPROVED", createRequestKey: randomUUID(), isTypical: true, deviceModel: "合成样本",
      content: "重新连接线缆恢复显示", result: "COMPLETED", createdAt: now }, include: { category: true } });
    await db.knowledgeCase.create({ data: { id, status: i === 23 ? "WITHDRAWN" : "PUBLISHED",
      visibility: i === 22 ? "STAFF" : "PUBLIC", structured: { title: `Browse76 合成案例 ${i}`, unknowns: [] },
      displayText: "本地测试：重新连接线缆恢复显示，不代表真实模型生成。", contentHash: "test-only", createdAt: now, updatedAt: now, publishedAt: now } });
    await db.knowledgeCaseSource.create({ data: { id: randomUUID(), caseId: id, repairRecordId: recordId,
      status: "PUBLISHED", contentHash: materialHashOf(materialOf(record)),
      evidence: { quotes: [{ field: "resolution", quote: "重新连接线缆恢复显示" }] }, createdAt: now } });
  }
});
after(async () => { if (enabled) { await cleanupStaffRepairFixtures(); await disconnectDb(); } });
function search(headers: Record<string, string>, suffix = "") {
  return callRoute(GET, "http://localhost/api/v1/knowledge/cases/search?q=Browse76" + suffix, { headers });
}
interface SearchData { items: { caseId: string; title: string; excerpt: string; visibility: string }[]; total: number; page: number; hasMore: boolean; }
function data(result: { json: Record<string, unknown> }): SearchData { return result.json.data as SearchData; }

dbTest("搜索要求登录，客户只得有效公开案例，工作人员可查内部案例", async () => {
  assert.equal((await search({})).status, 401);
  const c = await search(customer), s = await search(staff);
  assert.equal(c.status, 200); assert.equal(data(c).total, 22); assert.equal(data(s).total, 23);
  assert.ok(data(c).items.every((item) => item.visibility === "PUBLIC"));
  assert.ok(data(s).items.some((item) => item.caseId === ids[22]));
  assert.equal(c.headers.get("cache-control"), "private, no-store");
  const raw = JSON.stringify(c.json); assert.equal(raw.includes(records[0]), false); assert.equal(raw.includes("memberProfileId"), false);
});
dbTest("完整集合匹配后分页：第二页可达，切换 pageSize 无重复和跳页", async () => {
  const first = data(await search(customer)), second = data(await search(customer, "&page=2"));
  assert.equal(first.items.length, 20); assert.equal(first.hasMore, true); assert.equal(second.items.length, 2); assert.equal(second.hasMore, false);
  assert.equal(new Set(first.items.concat(second.items).map((v) => v.caseId)).size, 22);
  assert.equal(data(await search(customer, "&pageSize=1&page=22")).items[0].caseId, ids[0]);
});
dbTest("标题大小写、正文词语和无命中均按实际内容匹配", async () => {
  const title = await callRoute(GET, "http://localhost/api/v1/knowledge/cases/search?q=browse76", { headers: customer });
  const text = await callRoute(GET, "http://localhost/api/v1/knowledge/cases/search?q=" + encodeURIComponent("线缆"), { headers: customer });
  assert.equal(data(title).total, 22); assert.equal(data(text).total, 22); assert.ok(data(text).items[0].excerpt.includes("线缆"));
  assert.equal(data(await search(customer, "-不存在")).total, 0);
});
dbTest("空词、过长词及分页参数错误返回校验失败", async () => {
  for (const query of ["q=", "q=" + "a".repeat(101), "q=Browse76&page=0", "q=Browse76&pageSize=101", "q=Browse76&caseId="]) {
    const result = await callRoute(GET, "http://localhost/api/v1/knowledge/cases/search?" + query, { headers: customer });
    assert.equal(result.status, 400);
  }
});
dbTest("旧结果点击复核：转内部后客户不可访问，工作人员仍可访问", async () => {
  const db = getDb();
  await db.knowledgeCase.update({ where: { id: ids[0] }, data: { visibility: "STAFF" } });
  assert.equal(data(await search(customer, "&caseId=" + ids[0])).items.length, 0);
  assert.equal(data(await search(staff, "&caseId=" + ids[0])).items.length, 1);
  const old = await callRoute(publicDetail, "http://localhost/api/v1/customer/knowledge-cases/" + ids[0], { headers: customer, params: { id: ids[0] } });
  assert.equal(old.status, 404);
  await db.knowledgeCase.update({ where: { id: ids[0] }, data: { visibility: "PUBLIC" } });
});
dbTest("撤回和来源失效后，搜索与旧结果确认都不再返回内容", async () => {
  const db = getDb();
  await db.knowledgeCase.update({ where: { id: ids[0] }, data: { status: "WITHDRAWN" } });
  await db.repairRecord.update({ where: { id: records[1] }, data: { content: "已变化，不匹配旧证据哈希" } });
  for (const headers of [customer, staff]) {
    assert.equal(data(await search(headers, "&caseId=" + ids[0])).items.length, 0);
    assert.equal(data(await search(headers, "&caseId=" + ids[1])).items.length, 0);
    const result = data(await search(headers));
    assert.ok(result.items.every((item) => item.caseId !== ids[0] && item.caseId !== ids[1]));
  }
  const old = await callRoute(publicDetail, "http://localhost/api/v1/customer/knowledge-cases/" + ids[1], { headers: customer, params: { id: ids[1] } });
  assert.equal(old.status, 404);
});
