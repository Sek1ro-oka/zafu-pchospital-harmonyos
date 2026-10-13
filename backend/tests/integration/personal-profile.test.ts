import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import {
  GET as customerGet,
  POST as customerPost,
} from "../../src/app/api/v1/customer/profile/route";
import { GET as memberGet, POST as memberPost } from "../../src/app/api/v1/member/profile/route";
import { POST as skillsPost } from "../../src/app/api/v1/member/profile/skills/route";
import { GET as internalGet } from "../../src/app/api/v1/members/[memberProfileId]/profile/route";
import { GET as directoryGet } from "../../src/app/api/v1/member/directory/route";
import { GET as orderGet } from "../../src/app/api/v1/repair-orders/[id]/route";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import { integrationTestsEnabled } from "./db-guard";
import { bearerFor } from "./staff-repair-harness";

const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;
const users = Array.from({ length: 23 }, () => randomUUID());
const profiles = Array.from({ length: 21 }, () => randomUUID());
const orderId = randomUUID();
let a: Record<string, string>, b: Record<string, string>, staff: Record<string, string>;
async function call(
  handler: (request: Request) => Promise<Response>,
  headers: Record<string, string>,
  body?: unknown,
  query = "",
) {
  const response = await handler(
    new Request(`http://localhost/api/v1/customer/profile${query}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const json = await response.json();
  return { status: response.status, ...json };
}
before(async () => {
  if (!enabled) return;
  const db = getDb(),
    now = new Date();
  const role = await db.role.findUniqueOrThrow({ where: { code: "MEMBER" } });
  for (let i = 0; i < users.length; i++) {
    await db.user.create({
      data: {
        id: users[i],
        status: "ACTIVE",
        displayName: `资料测试${i}`,
        createdAt: now,
        updatedAt: now,
      },
    });
    if (i >= 2) {
      await db.memberProfile.create({
        data: {
          id: profiles[i - 2],
          userId: users[i],
          realName: `资料成员${i}`,
          studentId: "PRIVATE-STUDENT",
          className: "PRIVATE-CLASS",
          status: "ACTIVE",
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      });
      await db.userRole.create({
        data: {
          id: randomUUID(),
          userId: users[i],
          roleId: role.id,
          sourceType: "ADMIN_CREATED",
          sourceId: users[i],
          grantedAt: now,
          activeKey: `${users[i]}:${role.id}`,
        },
      });
    }
  }
  a = await bearerFor(users[0]);
  b = await bearerFor(users[1]);
  staff = await bearerFor(users[2]);
  await db.repairOrder.create({
    data: {
      id: orderId,
      submittedByUserId: users[0],
      deviceModel: "快照测试电脑",
      faultDescription: "快照测试故障",
      contactPhone: "13900000000",
      status: "SUBMITTED",
      createRequestKey: randomUUID(),
      createdAt: now,
      updatedAt: now,
    },
  });
});
after(async () => {
  if (!enabled) return;
  const db = getDb();
  await db.repairOrder.deleteMany({ where: { id: orderId } });
  await db.customerProfile.deleteMany({ where: { userId: { in: users } } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: users } } });
  await db.userSkill.deleteMany({ where: { memberProfileId: { in: profiles } } });
  await db.memberProfile.deleteMany({ where: { id: { in: profiles } } });
  await db.userRole.deleteMany({ where: { userId: { in: users } } });
  await db.authSession.deleteMany({ where: { userId: { in: users } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await disconnectDb();
});

dbTest("两个客户只操作本人资料；未知身份字段拒绝，旧报修电话不改写", async () => {
  assert.equal((await call(customerGet, a)).data.version, 0);
  const saved = await call(customerPost, a, {
    nickname: "客户A昵称",
    phone: "13800000000",
    version: 0,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.version, 1);
  assert.equal((await call(customerGet, b, undefined, `?userId=${users[0]}`)).data.phone, null);
  assert.equal(
    (await call(customerPost, b, { userId: users[0], nickname: "冒充", phone: null, version: 0 }))
      .status,
    400,
  );
  assert.equal((await call(customerGet, a)).data.nickname, "客户A昵称");
  assert.equal(
    (await getDb().repairOrder.findUniqueOrThrow({ where: { id: orderId } })).contactPhone,
    "13900000000",
  );
  const foreign = await orderGet(
    new Request(`http://localhost/api/v1/repair-orders/${orderId}`, { headers: b }),
    { params: Promise.resolve({ id: orderId }) },
  );
  assert.equal(foreign.status, 404);
  assert.equal((await call(memberGet, a)).status, 403);
  assert.equal((await call(directoryGet, a)).status, 403);
});
dbTest("并发首次保存仅一方成功，旧版本回滚账号名称，清空使用默认昵称", async () => {
  const responses = await Promise.all(
    ["昵称一", "昵称二"].map((nickname) =>
      call(customerPost, b, { nickname, phone: null, version: 0 }),
    ),
  );
  assert.deepEqual(responses.map((item) => item.status).sort(), [200, 409]);
  const current = (await call(customerGet, b)).data;
  assert.equal(
    (await call(customerPost, b, { nickname: "旧版本", phone: null, version: 0 })).status,
    409,
  );
  assert.equal((await call(customerGet, b)).data.displayName, current.displayName);
  assert.equal(
    (await call(customerPost, b, { nickname: null, phone: null, version: 1 })).data.displayName,
    "客户",
  );
});
dbTest(
  "客户写通道保留 Cookie+Origin，Bearer 缺 native 头拒绝；工作人员不能写客户档案",
  async () => {
    assert.equal(
      (
        await call(
          customerPost,
          { authorization: a.authorization },
          { nickname: null, phone: null, version: 1 },
        )
      ).status,
      403,
    );
    const cookie = { cookie: `pc_hospital_session=${a.authorization.slice(7)}` };
    assert.equal(
      (await call(customerPost, cookie, { nickname: "Cookie", phone: null, version: 1 })).status,
      403,
    );
    assert.equal(
      (
        await call(
          customerPost,
          { ...cookie, origin: process.env.APP_BASE_URL! },
          { nickname: "Cookie", phone: null, version: 1 },
        )
      ).status,
      200,
    );
    assert.equal((await call(customerGet, staff)).status, 403);
  },
);
dbTest("成员原生昵称与技能保存复用版本规则，拒绝管理员字段与客户调用", async () => {
  const own = await call(memberGet, staff);
  assert.equal(own.status, 200);
  assert.equal((await call(memberPost, staff, { nickname: "成员新昵称", version: 1 })).status, 200);
  assert.equal(
    (await call(memberPost, staff, { nickname: "越权", realName: "改实名", version: 2 })).status,
    400,
  );
  assert.equal((await call(memberPost, staff, { nickname: "旧版", version: 1 })).status, 409);
  const skill = await getDb().skill.findFirstOrThrow({
    where: { isActive: true, deletedAt: null },
  });
  assert.equal(
    (await call(skillsPost, staff, { skillIds: [skill.id], profileVersion: 2 })).status,
    200,
  );
  assert.equal(
    (await call(skillsPost, a, { skillIds: [skill.id], profileVersion: 1 })).status,
    403,
  );
});
dbTest("成员目录分页和内部资料裁剪；客户不得读取成员详情", async () => {
  const first = await call(directoryGet, staff, undefined, "?page=1");
  const second = await call(directoryGet, staff, undefined, "?page=2");
  assert.equal(first.data.items.length, 20);
  assert.equal(first.data.hasMore, true);
  assert.equal(second.data.items.length, 1);
  assert.equal(second.data.hasMore, false);
  assert.equal(
    first.data.items.some(
      (item: { memberProfileId: string }) =>
        item.memberProfileId === second.data.items[0].memberProfileId,
    ),
    false,
  );
  const context = { params: Promise.resolve({ memberProfileId: profiles[1] }) };
  const response = await internalGet(
    new Request("http://localhost/profile", { headers: staff }),
    context,
  );
  const json = await response.json();
  assert.equal(response.status, 200);
  assert.equal("studentId" in json.data.profile, false);
  assert.equal("className" in json.data.profile, false);
  assert.equal("userId" in json.data.profile, false);
  assert.equal(
    (await internalGet(new Request("http://localhost/profile", { headers: a }), context)).status,
    403,
  );
});
