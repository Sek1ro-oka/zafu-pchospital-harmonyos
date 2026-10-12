import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

class RequestError extends Error { constructor(public code: string, message = code) { super(message); } }
function load<T>(file: string, name: string, deps: Record<string, unknown>, page = false): T {
  let source = readFileSync('../app/entry/src/main/ets/' + file, 'utf8');
  if (page) source = source.slice(0, source.indexOf('  @Builder')) + '\n}';
  source = source.replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g, '')
    .replace(/@(Component|State|Prop)\s*/g, '').replace('export struct', 'class').replace(/export /g, '');
  const code = ts.transpileModule(source + '\n' + (page ? 'new ' + name + '();' : name + ';'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  return runInNewContext(code, { ApiRequestError: RequestError, HOME_STAFF: 'STAFF', NavPathStack: class {},
    isSessionExpiredCode: (code: string) => code === 'UNAUTHENTICATED', isNetworkErrorCode: () => false, ...deps });
}
interface Service { stats(): Promise<{total: number; pending: number; completed: number}>; identity(): Promise<unknown>; }
interface Page { loadStats(): Promise<void>; showIdentity(): Promise<void>; aboutToDisappear(): void;
  statsState: number; totalCount: number; identityBusy: boolean; onSessionExpired(): void; }
function deferred<T>() { let resolve!: (value:T) => void; const promise = new Promise<T>(done => { resolve = done; }); return {promise,resolve}; }

test('统计采用分页 total，超过20条、取消状态与空列表均不按当前页计算', async () => {
  const calls: string[] = [];
  const service = load<Service>('features/profile/ProfileService.ets', 'ProfileService', {
    ApiConfig: {getBaseUrl: () => 'https://api.example'}, SessionStore: {readToken: async () => 'token'},
    ApiClient: {getWithMeta: async (_url: string, path: string, token: string) => {
      assert.equal(token, 'token'); calls.push(path); const status = new URL('https://api.example' + path).searchParams.get('status') || '';
      const totals: Record<string,number> = {'': 39, SUBMITTED: 11, ACCEPTED: 4, REPAIRING: 3, COMPLETED: 20};
      return {data: [], meta: {pagination: {total: totals[status]}}};
    }}
  });
  const result = await service.stats(); assert.equal(result.total, 39); assert.equal(result.pending, 18); assert.equal(result.completed, 20);
  assert.equal(calls.length, 5); assert.ok(calls.every(path => path.includes('pageSize=1') && !path.includes('userId')));
});

test('统计元数据缺失报错，未登录不发业务请求', async () => {
  let token = 'token'; let calls = 0;
  const service = load<Service>('features/profile/ProfileService.ets', 'ProfileService', {
    ApiConfig: {getBaseUrl: () => 'https://api.example'}, SessionStore: {readToken: async () => token},
    ApiClient: {getWithMeta: async () => {calls++; return {data: [], meta: {}};}}
  });
  await assert.rejects(service.stats(), (e: RequestError) => e.code === 'UNEXPECTED_RESPONSE');
  token = ''; calls = 0; await assert.rejects(service.stats(), (e: RequestError) => e.code === 'UNAUTHENTICATED'); assert.equal(calls, 0);
});

test('页面统计防重入，销毁后旧结果不更新，重新进入可请求', async () => {
  const pending = deferred<{total:number;pending:number;completed:number}>(); let calls = 0;
  const page = load<Page>('features/profile/ProfilePage.ets', 'ProfilePage', {
    ProfileService: {stats: () => {calls++; return pending.promise;}}
  }, true);
  const first = page.loadStats(); await page.loadStats(); assert.equal(calls, 1);
  page.aboutToDisappear(); pending.resolve({total:39,pending:18,completed:20}); await first; assert.equal(page.totalCount, 0);
  await page.loadStats(); assert.equal(page.totalCount, 39);
});

test('资料查看防连点、迟到响应不展示；会话过期通知根页面', async () => {
  const pending = deferred<unknown>(); let calls = 0; let dialogs = 0; let expired = 0;
  const page = load<Page & {getUIContext():unknown}>('features/profile/ProfilePage.ets', 'ProfilePage', {
    ProfileService: {identity: () => {calls++; return pending.promise;}}
  }, true);
  page.getUIContext = () => ({showAlertDialog: () => dialogs++});
  const first = page.showIdentity(); await page.showIdentity(); assert.equal(calls, 1);
  page.aboutToDisappear(); pending.resolve({displayName:'客户',roles:['CUSTOMER']}); await first; assert.equal(dialogs, 0); assert.equal(page.identityBusy,false);
  const invalid = load<Page>('features/profile/ProfilePage.ets', 'ProfilePage', {
    ProfileService: {identity: async () => {throw new RequestError('UNAUTHENTICATED');}}
  }, true);
  invalid.onSessionExpired = () => expired++; await invalid.showIdentity(); assert.equal(expired, 1);
});

interface Client {get<T>(url:string,path:string,token:string):Promise<T>;getWithMeta<T>(url:string,path:string,token:string):Promise<{data:T;meta:{pagination:{total:number}}}>;}
test('公共客户端保留分页但不改变既有 get 返回，原生请求与错误信封一致', async () => {
  let response = {responseCode:200,result:JSON.stringify({success:true,data:[],meta:{requestId:'request',pagination:{total:39}}})};
  let destroyed = 0;
  const client = load<Client>('core/network/ApiClient.ets', 'ApiClient', {
    http: {RequestMethod:{GET:'GET'},HttpDataType:{STRING:'STRING'},createHttp: () => ({
      request: async (_url:string, options:{header:Record<string,string>}) => {
        assert.equal(options.header.Authorization,'Bearer token'); assert.equal(options.header['X-Client-Type'],'native');return response;
      },destroy: () => destroyed++
    })}
  });
  assert.equal((await client.get<unknown[]>('https://api.example','/list','token')).length,0);
  assert.equal((await client.getWithMeta<unknown[]>('https://api.example','/list','token')).meta.pagination.total,39);
  response = {responseCode:401,result:JSON.stringify({success:false,error:{code:'UNAUTHENTICATED',message:'请登录'},meta:{requestId:'expired'}})};
  await assert.rejects(client.getWithMeta('https://api.example','/list','token'),(e:RequestError & {requestId:string}) => e.code === 'UNAUTHENTICATED' && e.requestId === 'expired');
  assert.equal(destroyed,3);
});
