import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function page<T>(file: string, name: string, service: Record<string, unknown>): T {
  const source = readFileSync(`../app/entry/src/main/ets/features/${file}`, "utf8");
  const state = source
    .slice(0, source.indexOf("  build()"))
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g, "")
    .replace(/@Watch\('[^']+'\)\s*/g, "")
    .replace(/@(Component|State|Prop)\s*/g, "")
    .replace(`export struct ${name}`, `class ${name}`);
  const code = ts.transpileModule(state + `\n}\nnew ${name}();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(code, {
    HOME_STAFF: "STAFF",
    CommunityService: service,
    ApiRequestError: Error,
    isSessionExpiredCode: () => false,
  }) as T;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
interface Favorites {
  items: { id: string }[];
  loading: boolean;
  hasMore: boolean;
  load(reset: boolean): Promise<void>;
  aboutToDisappear(): void;
}
test("收藏防重复/分页追加，刷新丢弃旧目录；销毁后迟到响应不回写", async () => {
  let calls = 0;
  const pending = deferred<{ id: string }[]>();
  const favorites = page<Favorites>("profile/FavoritesPage.ets", "FavoritesPage", {
    favorites: async () => {
      calls++;
      return pending.promise;
    },
  });
  favorites.items = [{ id: "old" }];
  const loading = favorites.load(true);
  await favorites.load(false);
  assert.equal(calls, 1);
  assert.equal(favorites.items.length, 0);
  favorites.aboutToDisappear();
  pending.resolve([{ id: "private-old" }]);
  await loading;
  assert.equal(favorites.items.length, 0);
});
test("收藏分页失败可重试同一页，成功后才推进页码", async () => {
  const requested: number[] = [];
  let fail = true;
  const favorites = page<Favorites>("profile/FavoritesPage.ets", "FavoritesPage", {
    favorites: async (_staff: boolean, page: number) => {
      requested.push(page);
      if (page === 2 && fail) {
        fail = false;
        throw new Error("network");
      }
      return page === 1
        ? Array.from({ length: 20 }, (_, index) => ({ id: `${index}` }))
        : [{ id: "next" }];
    },
  });
  await favorites.load(true);
  await favorites.load(false);
  assert.equal(favorites.loading, false);
  await favorites.load(false);
  assert.equal(requested.join(","), "1,2,2");
  assert.equal(favorites.items.length, 21);
  assert.equal(favorites.hasMore, false);
});
interface CasePage {
  param: { caseId: string };
  detail: { title: string } | null;
  load(): Promise<void>;
  errorText: string;
}
test("公开案例重读失败清除旧正文，不在已失效内容上保留缓存", async () => {
  const detail = page<CasePage>("profile/PublicCaseDetailPage.ets", "PublicCaseDetailPage", {
    caseDetail: async () => {
      throw new Error("内容不可访问");
    },
  });
  detail.param = { caseId: "case61" };
  detail.detail = { title: "撤回前旧正文" };
  await detail.load();
  assert.equal(detail.detail, null);
  assert.equal(detail.errorText, "内容不可访问");
});
test("消息已读/删除操作防重；旧页面操作完成后不导航到新会话", async () => {
  let calls = 0,
    opens = 0;
  const pending = deferred<void>();
  const messages = page<{
    action(action: string, item: unknown): Promise<void>;
    aboutToDisappear(): void;
    onOpen(): void;
  }>("profile/MessagesPage.ets", "MessagesPage", {
    messageAction: () => {
      calls++;
      return pending.promise;
    },
  });
  messages.onOpen = () => {
    opens++;
  };
  const first = messages.action("open", { id: "msg", targetId: "order" });
  await messages.action("open", { id: "msg", targetId: "order" });
  assert.equal(calls, 1);
  messages.aboutToDisappear();
  pending.resolve();
  await first;
  assert.equal(opens, 0);
});
