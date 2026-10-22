import { util } from '@kit.ArkTS';
import { ApiClient, ApiRequestError, MultipartFilePart } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { ApiPage } from '../../core/network/ApiContract';
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
 * 编辑商品在语义上是 `PATCH /products/{id}`，但 `http.RequestMethod.PATCH`
 * 枚举在 API 26 才加入、工程 `compatibleSdkVersion` 为 24，因此改发
 * `POST` 并携带 `X-HTTP-Method-Override: PATCH` 请求头，由服务端把带该头的
 * POST 委托给同一更新 handler（鉴权与校验一致）。POST 枚举与自定义请求头
 * 在所有支持的 API 版本可用，与备案编辑的 POST 别名做法一致。
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
    const headers: Record<string, string> = {};
    headers['X-HTTP-Method-Override'] = 'PATCH';
    return ApiClient.postWithHeaders<ShoppingProductView>(
      ApiConfig.getBaseUrl(),
      `${PRODUCTS_PATH}/${encodeId(id)}`,
      JSON.stringify(patch),
      await requireToken(),
      headers
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

  /** 幂等键：一次购买意图内复用（结果未知时重试沿用同一把），结果确认后换新；格式与后端 80 字符上限兼容。 */
  static newOrderKey(): string {
    return `native-order-${util.generateRandomUUID(true)}`;
  }
}
