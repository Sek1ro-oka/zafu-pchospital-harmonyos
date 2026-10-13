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
  version: number;
  selected: string[];
  errorText: string;
  onSaved(name: string): void;
  saveNickname(): Promise<void>;
  saveSkills(): Promise<void>;
  load(): Promise<void>;
  aboutToDisappear(): void;
}
function page(service: Record<string, unknown>): ProfilePage {
  const source = readFileSync(
    "../app/entry/src/main/ets/features/profile/PersonalProfilePage.ets",
    "utf8",
  );
  const state = source
    .slice(0, source.indexOf("  @Builder"))
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g, "")
    .replace(/@(Component|State|Prop)\s*/g, "")
    .replace("export struct PersonalProfilePage", "class PersonalProfilePage");
  const code = ts.transpileModule(state + "\n}\nnew PersonalProfilePage();", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(code, {
    HOME_STAFF: "STAFF",
    PersonalProfileService: service,
    ApiRequestError: Error,
    isSessionExpiredCode: () => false,
  }) as ProfilePage;
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
