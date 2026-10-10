import { ApiClient, ApiRequestError } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { SessionStore } from '../../core/auth/SessionStore';
import {
  RepairOrderView,
  RepairOrderSubmitRequest,
} from './RepairOrderContract';

const LIST_PATH: string = '/api/v1/repair-orders';
const DETAIL_PATH_PREFIX: string = '/api/v1/repair-orders/';

/**
 * 客户报修单服务（Issue #37）。
 *
 * 与 SessionService 同一套路：地址取自 ApiConfig，令牌取自 SessionStore，
 * 身份一律由服务端认定，客户端不缓存、不改写归属。
 *
 * 每次调用现读令牌而非注入，是为了让「退出后再次登录」不需要重建服务实例。
 */
export class RepairOrderService {
  /** 读当前令牌；空串表示未登录，调用方应回登录页。 */
  private static async token(): Promise<string> {
    return await SessionStore.readToken();
  }

  private static baseUrl(): string {
    return ApiConfig.getBaseUrl();
  }

  private static ensureReady(): void {
    if (RepairOrderService.baseUrl() === '') {
      throw new ApiRequestError('NETWORK_ERROR', '服务器地址未配置，请回到登录页填写', 0, '');
    }
  }

  /**
   * 提交报修。
   *
   * 带 `Idempotency-Key`：网络抖动导致的重复提交由服务端去重并返回原单，
   * 用户不会看到「提交失败」后被引导重试又建出第二张单。
   *
   * **键由调用方（表单）生成并传入**，而非此方法内部新建 ——
   * 这样同一张表单的多次重试复用同一个键，只有确认成功或开始新一张单才换键。
   */
  static async submit(request: RepairOrderSubmitRequest, idempotencyKey: string): Promise<RepairOrderView> {
    RepairOrderService.ensureReady();
    const token = await RepairOrderService.token();
    if (token === '') {
      throw new ApiRequestError('UNAUTHENTICATED', '登录状态已失效，请重新登录', 0, '');
    }
    const headers: Record<string, string> = {};
    headers['Idempotency-Key'] = idempotencyKey;
    return await ApiClient.postWithHeaders<RepairOrderView>(
      RepairOrderService.baseUrl(),
      LIST_PATH,
      JSON.stringify(request),
      token,
      headers
    );
  }

  /**
   * 本人报修列表。
   *
   * 后端 `GET /api/v1/repair-orders` 把分页放在 **信封 meta** 里，
   * 而 ApiClient 只拆 `data`，所以这里只取走 `items`。
   * 支持 `page` 参数翻页，UI 据此实现"加载更多"。
   */
  static async listMine(status: string = '', page: number = 1): Promise<RepairOrderView[]> {
    RepairOrderService.ensureReady();
    const token = await RepairOrderService.token();
    if (token === '') {
      throw new ApiRequestError('UNAUTHENTICATED', '登录状态已失效，请重新登录', 0, '');
    }
    let path: string = LIST_PATH;
    const params: string[] = [];
    if (status !== '') {
      params.push(`status=${status}`);
    }
    if (page > 1) {
      params.push(`page=${page}`);
    }
    if (params.length > 0) {
      path = `${LIST_PATH}?${params.join('&')}`;
    }
    const items = await ApiClient.get<RepairOrderView[]>(RepairOrderService.baseUrl(), path, token);
    // 服务端历史数据若把 items 返回成 null，界面按空列表处理而不是崩溃。
    return items === undefined || items === null ? [] : items;
  }

  /** 报修单详情（含进度事件）。非本人的单后端返回 404，此处原样抛出。 */
  static async detail(id: string): Promise<RepairOrderView> {
    RepairOrderService.ensureReady();
    const token = await RepairOrderService.token();
    if (token === '') {
      throw new ApiRequestError('UNAUTHENTICATED', '登录状态已失效，请重新登录', 0, '');
    }
    return await ApiClient.get<RepairOrderView>(
      RepairOrderService.baseUrl(),
      `${DETAIL_PATH_PREFIX}${id}`,
      token
    );
  }
}
