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

test("收藏/消息/公开案例列表/详情离开返回：新请求启动，旧响应及 finally 不回写", async () => {
  for (const name of ["FavoritesPage", "MessagesPage", "PublicCasesPage", "PublicCaseDetailPage"]) {
    const old = deferred<unknown>(),
      current = deferred<unknown>();
    let calls = 0;
    const load = () => (++calls === 1 ? old.promise : current.promise);
    const view = page<{
      loading: boolean;
      items: unknown[];
      detail: unknown;
      load(reset: boolean): Promise<void>;
      aboutToDisappear(): void;
    }>(`profile/${name}.ets`, name, {
      favorites: load,
      messages: load,
      cases: load,
      caseDetail: load,
    });
    const first = view.load(true);
    view.aboutToDisappear();
    const second = view.load(true);
    assert.equal(calls, 2, name);
    assert.equal(view.loading, true);
    const data =
      name === "MessagesPage"
        ? { items: [], unreadCount: 0 }
        : name === "PublicCaseDetailPage"
          ? { title: "新内容" }
          : [];
    old.resolve(name === "PublicCaseDetailPage" ? { title: "旧正文" } : data);
    await first;
    assert.equal(view.loading, true, name + "旧 finally 不清新 loading");
    if (name === "PublicCaseDetailPage") assert.equal(view.detail, null);
    current.resolve(data);
    await second;
    assert.equal(view.loading, false, name);
    if (name === "PublicCaseDetailPage")
      assert.equal((view.detail as { title: string }).title, "新内容");
  }
});
test("收藏取消/消息写入离开返回：不锁住 loading，旧操作完成不导航或打断新加载", async () => {
  for (const name of ["FavoritesPage", "MessagesPage"]) {
    const old = deferred<unknown>(),
      current = deferred<unknown>();
    let loads = 0,
      opens = 0;
    const service = {
      removeFavorite: () => old.promise,
      messageAction: () => old.promise,
      favorites: () => {
        loads++;
        return current.promise;
      },
      messages: () => {
        loads++;
        return current.promise;
      },
    };
    const view = page<{
      loading: boolean;
      remove(item: unknown): Promise<void>;
      action(action: string, item: unknown): Promise<void>;
      load(reset: boolean): Promise<void>;
      aboutToDisappear(): void;
      onOpen(): void;
    }>(`profile/${name}.ets`, name, service);
    view.onOpen = () => {
      opens++;
    };
    const first =
      name === "FavoritesPage"
        ? view.remove({ id: "old" })
        : view.action("open", { id: "old", targetId: "record" });
    view.aboutToDisappear();
    const second = view.load(true);
    assert.equal(loads, 1);
    old.resolve({});
    await first;
    assert.equal(view.loading, true);
    assert.equal(opens, 0);
    current.resolve(name === "MessagesPage" ? { items: [], unreadCount: 0 } : []);
    await second;
    assert.equal(view.loading, false);
  }
});
test("案例收藏写入离开返回：释放 busy，旧写响应不提示成功或清新加载状态", async () => {
  const old = deferred<unknown>(),
    current = deferred<unknown>();
  let calls = 0;
  const view = page<{
    busy: boolean;
    loading: boolean;
    detail: unknown;
    notice: string;
    favorite(): Promise<void>;
    load(): Promise<void>;
    aboutToDisappear(): void;
  }>("profile/PublicCaseDetailPage.ets", "PublicCaseDetailPage", {
    favorite: () => old.promise,
    caseDetail: () => {
      calls++;
      return current.promise;
    },
  });
  view.detail = { title: "旧正文" };
  const first = view.favorite();
  view.aboutToDisappear();
  const second = view.load();
  assert.equal(calls, 1);
  assert.equal(view.busy, false);
  old.resolve({});
  await first;
  assert.equal(view.notice, "");
  assert.equal(view.loading, true);
  current.resolve({ title: "刷新正文" });
  await second;
  assert.equal(view.loading, false);
});
