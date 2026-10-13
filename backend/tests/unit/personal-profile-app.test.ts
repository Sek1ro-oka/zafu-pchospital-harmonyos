import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

interface ProfilePage {
  home: string;
  permissions: string[];
  ready: boolean;
  nickname: string;
  phone: string;
  saving: boolean;
  loading: boolean;
  version: number;
  selected: string[];
  errorText: string;
  onSaved(name: string): void;
  saveNickname(): Promise<void>;
  saveSkills(): Promise<void>;
  load(): Promise<void>;
  aboutToDisappear(): void;
}
function page<T = ProfilePage>(service: Record<string, unknown>, name = "PersonalProfilePage"): T {
  const source = readFileSync(`../app/entry/src/main/ets/features/profile/${name}.ets`, "utf8");
  const state = source
    .slice(
      0,
      source.indexOf("  @Builder") > 0 ? source.indexOf("  @Builder") : source.indexOf("  build()"),
    )
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g, "")
    .replace(/@(Component|State|Prop)\s*/g, "")
    .replace(`export struct ${name}`, `class ${name}`);
  const code = ts.transpileModule(state + `\n}\nnew ${name}();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(code, {
    HOME_STAFF: "STAFF",
    PersonalProfileService: service,
    ApiRequestError: Error,
    isSessionExpiredCode: () => false,
  }) as T;
}
test("资料请求防重复提交，服务端版本/昵称即时回传；离开后不更新新页面", async () => {
  let resolve!: (value: unknown) => void,
    calls = 0,
    saved = "";
  const pending = new Promise((done) => {
    resolve = done;
  });
  const profile = page({
    saveCustomer: () => {
      calls++;
      return pending;
    },
  });
  profile.ready = true;
  profile.nickname = "编辑";
  profile.onSaved = (name) => {
    saved = name;
  };
  const first = profile.saveNickname();
  await profile.saveNickname();
  assert.equal(calls, 1);
  assert.equal(profile.saving, true);
  profile.aboutToDisappear();
  resolve({ displayName: "编辑", nickname: "编辑", phone: null, version: 1 });
  await first;
  assert.equal(saved, "");
});
test("保存成功使用实际响应；失败保留输入与版本可重试", async () => {
  let calls = 0,
    saved = "";
  const profile = page({
    saveCustomer: async () => {
      if (++calls === 1) throw new Error("断网");
      return { displayName: "规范昵称", nickname: "规范昵称", phone: null, version: 2 };
    },
  });
  profile.ready = true;
  profile.version = 1;
  profile.nickname = " 我的输入 ";
  profile.onSaved = (name) => {
    saved = name;
  };
  await profile.saveNickname();
  assert.equal(profile.nickname, " 我的输入 ");
  assert.equal(profile.version, 1);
  assert.equal(profile.saving, false);
  await profile.saveNickname();
  assert.equal(saved, "规范昵称");
  assert.equal(profile.version, 2);
  assert.equal(profile.errorText, "");
});
test("成员昵称与技能写入共享服务端版本，避免后一次使用保存前版本", async () => {
  let skillVersion = 0;
  const profile = page({
    saveMember: async () => ({ profile: { displayName: "成员", nickname: "成员", version: 2 } }),
    saveSkills: async (input: { profileVersion: number }) => {
      skillVersion = input.profileVersion;
      return { skills: [], version: 3 };
    },
  });
  profile.home = "STAFF";
  profile.permissions = ["member.profile.update_self", "member.skill.assign_self"];
  profile.ready = true;
  profile.version = 1;
  await profile.saveNickname();
  await profile.saveSkills();
  assert.equal(skillVersion, 2);
  assert.equal(profile.version, 3);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const result = (nickname: string, version: number) => ({
  displayName: nickname,
  nickname,
  phone: null,
  version,
});
test("资料读取离开/返回：新请求可以启动，旧 finally 不清新请求的 loading", async () => {
  const old = deferred<unknown>(),
    current = deferred<unknown>();
  let calls = 0;
  const profile = page({ customer: () => (++calls === 1 ? old.promise : current.promise) });
  const first = profile.load();
  profile.aboutToDisappear();
  assert.equal(profile.loading, false);
  const second = profile.load();
  assert.equal(calls, 2);
  old.resolve(result("旧资料", 1));
  await first;
  assert.equal(profile.loading, true);
  assert.equal(profile.ready, false);
  current.resolve(result("最新资料", 2));
  await second;
  assert.equal(profile.loading, false);
  assert.equal(profile.nickname, "最新资料");
});
test("资料和技能写入离开/返回：解除 saving，旧写响应不覆盖新资料或清新写状态", async () => {
  for (const skills of [false, true]) {
    const old = deferred<unknown>(),
      current = deferred<unknown>();
    let writes = 0,
      saved = 0;
    const service = {
      customer: async () => result("重新加载", 2),
      member: async () => ({ profile: { ...result("重新加载", 2), skills: [] } }),
      skills: async () => [],
      saveCustomer: () => (++writes === 1 ? old.promise : current.promise),
      saveSkills: () => (++writes === 1 ? old.promise : current.promise),
    };
    const profile = page(service);
    profile.ready = true;
    profile.onSaved = () => {
      saved++;
    };
    if (skills) {
      profile.home = "STAFF";
      profile.permissions = ["member.skill.assign_self"];
    }
    const write = () => (skills ? profile.saveSkills() : profile.saveNickname());
    const first = write();
    profile.aboutToDisappear();
    assert.equal(profile.saving, false);
    await profile.load();
    const second = write();
    old.resolve(skills ? { skills: [], version: 99 } : result("迟到写入", 99));
    await first;
    assert.equal(profile.saving, true);
    assert.equal(profile.version, 2);
    assert.equal(saved, 0);
    current.resolve(skills ? { skills: [], version: 3 } : result("本代保存", 3));
    await second;
    assert.equal(profile.saving, false);
    assert.equal(profile.version, 3);
  }
});
test("成员目录离开/返回：旧响应不能清新请求 busy 或回填旧目录", async () => {
  const old = deferred<unknown>(),
    current = deferred<unknown>();
  let calls = 0;
  const directory = page<{
    busy: boolean;
    items: unknown[];
    load(reset: boolean): Promise<void>;
    aboutToDisappear(): void;
  }>({ directory: () => (++calls === 1 ? old.promise : current.promise) }, "MemberDirectoryPage");
  const first = directory.load(true);
  directory.aboutToDisappear();
  const second = directory.load(true);
  assert.equal(calls, 2);
  old.resolve({ items: [{ memberProfileId: "old" }], page: 1, hasMore: false });
  await first;
  assert.equal(directory.busy, true);
  assert.equal(directory.items.length, 0);
  current.resolve({ items: [], page: 1, hasMore: false });
  await second;
  assert.equal(directory.busy, false);
});
