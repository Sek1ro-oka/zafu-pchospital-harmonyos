import { http } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { util } from '@kit.ArkTS';
import { ApiClient, ApiRequestError, MultipartFilePart } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { ApiErrorBody, ApiMeta, ApiPage } from '../../core/network/ApiContract';
import { SessionStore } from '../../core/auth/SessionStore';
import { PickedImage } from '../repair/PhotoPicker';
import {
  ShoppingOrderDraft,
  ShoppingOrderView,
  ShoppingProductDraft,
  ShoppingProductPatch,
  ShoppingProductView,
} from './ShoppingTypes';

const PRODUCTS_PATH: string = '/api/v1/shopping/products';
const MY_PRODUCTS_PATH: string = '/api/v1/shopping/me/products';
const ORDERS_PATH: string = '/api/v1/shopping/orders';

interface ShoppingEnvelope {
  success: boolean;
  data?: Object;
  error?: ApiErrorBody;
  meta?: ApiMeta;
}

async function optionalToken(): Promise<string> {
  return SessionStore.readToken();
}

async function requireToken(): Promise<string> {
  if (ApiConfig.getBaseUrl() === '') {
    throw new ApiRequestError('NETWORK_ERROR', '服务器地址未配置，请回到登录页填写', 0, '');
  }
  const token: string = await SessionStore.readToken();
  if (token === '') {
    throw new ApiRequestError('UNAUTHENTICATED', '请先登录', 0, '');
  }
  return token;
}

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

/**
 * 选购交易服务（#84）。
 *
 * 列表接口的 `data` 是数组、分页在 `meta.pagination`，故列表统一走
 * `ApiClient.getPage`；写接口走服务端既有信封。
 *
 * `PATCH /products/{id}` 是购物编辑唯一的服务端入口，但共享 `ApiClient`
 * 没有 PATCH 方法（且本轮不允许改 `core/`），因此在本文件内用
 * `@ohos.net.http` 发 PATCH 并复用同一套信封 / 错误码解析。
 */
export class ShoppingService {
  static async listProducts(category: string, page: number, pageSize: number): Promise<ApiPage<ShoppingProductView>> {
    const token: string = await optionalToken();
    const categoryQuery: string = category === '' ? '' : `&category=${encodeURIComponent(category)}`;
    return ApiClient.getPage<ShoppingProductView>(
      ApiConfig.getBaseUrl(),
      `${PRODUCTS_PATH}?page=${page}&pageSize=${pageSize}${categoryQuery}`,
      token
    );
  }

  static async productDetail(id: string): Promise<ShoppingProductView> {
    return ApiClient.get<ShoppingProductView>(
      ApiConfig.getBaseUrl(),
      `${PRODUCTS_PATH}/${encodeId(id)}`,
      await optionalToken()
    );
  }

  static async createProduct(draft: ShoppingProductDraft): Promise<ShoppingProductView> {
    return ApiClient.post<ShoppingProductView>(
      ApiConfig.getBaseUrl(),
      PRODUCTS_PATH,
      JSON.stringify(draft),
      await requireToken()
    );
  }

  static async updateProduct(id: string, patch: ShoppingProductPatch): Promise<ShoppingProductView> {
    const token: string = await requireToken();
    return ShoppingService.patch<ShoppingProductView>(
      `${PRODUCTS_PATH}/${encodeId(id)}`,
      JSON.stringify(patch),
      token
    );
  }

  static async delistProduct(id: string, reason: string): Promise<ShoppingProductView> {
    const body: Record<string, string> = {};
    if (reason !== '') body.reason = reason;
    return ApiClient.post<ShoppingProductView>(
      ApiConfig.getBaseUrl(),
      `${PRODUCTS_PATH}/${encodeId(id)}/delist`,
      JSON.stringify(body),
      await requireToken()
    );
  }

  static async uploadImages(id: string, images: PickedImage[]): Promise<Object> {
    const parts: MultipartFilePart[] = [];
    for (const image of images) {
      parts.push({
        name: 'photos',
        contentType: image.mimeType,
        fileName: image.fileName,
        data: image.data
      });
    }
    return ApiClient.postMultipart<Object>(
      ApiConfig.getBaseUrl(),
      `${PRODUCTS_PATH}/${encodeId(id)}/images`,
      parts,
      await requireToken()
    );
  }

  static async listMine(page: number, pageSize: number): Promise<ApiPage<ShoppingProductView>> {
    return ApiClient.getPage<ShoppingProductView>(
      ApiConfig.getBaseUrl(),
      `${MY_PRODUCTS_PATH}?page=${page}&pageSize=${pageSize}`,
      await requireToken()
    );
  }

  static async listOrders(role: string, status: string, page: number, pageSize: number): Promise<ApiPage<ShoppingOrderView>> {
    const statusQuery: string = status === '' ? '' : `&status=${encodeURIComponent(status)}`;
    return ApiClient.getPage<ShoppingOrderView>(
      ApiConfig.getBaseUrl(),
      `${ORDERS_PATH}?role=${role}&page=${page}&pageSize=${pageSize}${statusQuery}`,
      await requireToken()
    );
  }

  static async orderDetail(id: string): Promise<ShoppingOrderView> {
    return ApiClient.get<ShoppingOrderView>(
      ApiConfig.getBaseUrl(),
      `${ORDERS_PATH}/${encodeId(id)}`,
      await requireToken()
    );
  }

  static async createOrder(draft: ShoppingOrderDraft): Promise<ShoppingOrderView> {
    return ApiClient.post<ShoppingOrderView>(
      ApiConfig.getBaseUrl(),
      ORDERS_PATH,
      JSON.stringify(draft),
      await requireToken()
    );
  }

  static async cancelOrder(id: string, reason: string): Promise<ShoppingOrderView> {
    const body: Record<string, string> = {};
    if (reason !== '') body.reason = reason;
    return ApiClient.post<ShoppingOrderView>(
      ApiConfig.getBaseUrl(),
      `${ORDERS_PATH}/${encodeId(id)}/cancel`,
      JSON.stringify(body),
      await requireToken()
    );
  }

  static async completeOrder(id: string): Promise<ShoppingOrderView> {
    return ApiClient.post<ShoppingOrderView>(
      ApiConfig.getBaseUrl(),
      `${ORDERS_PATH}/${encodeId(id)}/complete`,
      '{}',
      await requireToken()
    );
  }

  /** 公开商品图：不携带令牌，服务端路由本身对游客开放。 */
  static async imageBytes(path: string): Promise<ArrayBuffer> {
    if (path === '') {
      throw new ApiRequestError('UNEXPECTED_RESPONSE', '图片地址为空', 0, '');
    }
    return ApiClient.getBytes(ApiConfig.getBaseUrl(), path, '');
  }

  /** 与服务端同语义的 PATCH：路径是已编码的相对路径，body 是 JSON 字符串。 */
  private static async patch<T>(path: string, body: string, token: string): Promise<T> {
    // PATCH 枚举在 API 26 才加入；compatibleSdkVersion 为 24，旧系统给出明确提示而不是发空请求。
    if (http.RequestMethod.PATCH === undefined) {
      throw new ApiRequestError('CLIENT_UNSUPPORTED', '当前系统版本不支持编辑商品，请升级系统后重试', 0, '');
    }
    const headers: Record<string, string> = {};
    headers['Content-Type'] = 'application/json';
    headers['X-Client-Type'] = 'native';
    headers['User-Agent'] = 'PC-Hospital-Harmony/0.1.0';
    headers['Authorization'] = `Bearer ${token}`;
    const options: http.HttpRequestOptions = {
      method: http.RequestMethod.PATCH,
      header: headers,
      expectDataType: http.HttpDataType.STRING,
      connectTimeout: 8000,
      readTimeout: 8000,
      extraData: body
    };
    const request = http.createHttp();
    let response: http.HttpResponse;
    try {
      response = await request.request(`${ApiConfig.getBaseUrl()}${path}`, options);
    } catch (error) {
      throw new ApiRequestError(
        'NETWORK_ERROR',
        `网络请求失败（错误码 ${(error as BusinessError).code}）`,
        0,
        ''
      );
    } finally {
      request.destroy();
    }
    const status: number = response.responseCode;
    const text: string = response.result as string;
    if (text === undefined || text === '') {
      throw new ApiRequestError('UNEXPECTED_RESPONSE', `服务器无响应内容（HTTP ${status}）`, status, '');
    }
    let envelope: ShoppingEnvelope;
    try {
      envelope = JSON.parse(text) as ShoppingEnvelope;
    } catch (decodeError) {
      throw new ApiRequestError('UNEXPECTED_RESPONSE', `服务器返回无法识别的数据（HTTP ${status}）`, status, '');
    }
    if (envelope.success === true) {
      return envelope.data as T;
    }
    const requestId: string = envelope.meta !== undefined ? envelope.meta.requestId : '';
    if (envelope.error !== undefined) {
      throw new ApiRequestError(
        envelope.error.code,
        envelope.error.message,
        status,
        requestId,
        envelope.error.fieldErrors
      );
    }
    throw new ApiRequestError('UNEXPECTED_RESPONSE', `请求失败（HTTP ${status}）`, status, requestId);
  }

  /** 幂等键：一次下单尝试内复用，成功后换新；格式与后端 80 字符上限兼容。 */
  static newOrderKey(): string {
    return `native-order-${util.generateRandomUUID(true)}`;
  }
}
