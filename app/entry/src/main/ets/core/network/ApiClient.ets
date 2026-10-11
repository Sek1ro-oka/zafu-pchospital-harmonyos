import { http } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { ApiErrorBody, ApiMeta } from './ApiContract';

/**
 * 统一请求错误（ArkTS 只允许抛出 Error 及其子类）。
 * code 一般是后端错误码（AUTH_INVALID_CREDENTIALS 等）；
 * NETWORK_ERROR / UNEXPECTED_RESPONSE / LOCAL_STORAGE_ERROR 是客户端侧错误码，此时 status 为 0 或原始 HTTP 状态。
 */
export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string;

  constructor(code: string, message: string, status: number, requestId: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

/** 会话已失效的错误码：收到后应清除本地令牌并回到登录页。 */
export function isSessionExpiredCode(code: string): boolean {
  return code === 'UNAUTHENTICATED' ||
    code === 'AUTH_SESSION_INVALID' ||
    code === 'AUTH_SESSION_EXPIRED' ||
    code === 'ACCOUNT_DISABLED' ||
    code === 'MEMBER_PROFILE_INACTIVE';
}

interface EnvelopeShape {
  success: boolean;
  data?: Object;
  error?: ApiErrorBody;
  meta?: ApiMeta;
}

function describeNetworkError(error: BusinessError): string {
  if (error.code === 2300006) {
    return '无法解析服务器地址，请检查 API 地址';
  }
  if (error.code === 2300007) {
    return '无法连接服务器，请确认后端已启动、手机与电脑在同一局域网';
  }
  if (error.code === 2300028) {
    return '连接超时，请检查网络与服务器地址';
  }
  if (error.code === 2300997) {
    return '系统禁止明文 HTTP 请求（2300997），请检查设备网络策略';
  }
  if (error.code === 2300998) {
    return '该地址被设备网络策略禁止访问（2300998）';
  }
  return `网络请求失败（错误码 ${error.code}）`;
}

/** 可选请求参数：知识问答等慢接口可以放宽读取超时；不传保持原有 8 秒行为。 */
export interface ApiRequestOptions {
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
}

/** 公共 HTTP 客户端：拼接 API 地址、携带原生通道头、拆信封、统一抛 ApiRequestError。 */
export class ApiClient {
  private static readonly BASE_HEADERS: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-Type': 'native',
    'User-Agent': 'PC-Hospital-Harmony/0.1.0',
  };

  static async get<T>(baseUrl: string, path: string, token: string, options?: ApiRequestOptions): Promise<T> {
    return ApiClient.request<T>(baseUrl, http.RequestMethod.GET, path, '', token, options);
  }

  static async post<T>(baseUrl: string, path: string, body: string, token: string, options?: ApiRequestOptions): Promise<T> {
    return ApiClient.request<T>(baseUrl, http.RequestMethod.POST, path, body, token, options);
  }

  private static async request<T>(
    baseUrl: string,
    method: http.RequestMethod,
    path: string,
    body: string,
    token: string,
    options?: ApiRequestOptions
  ): Promise<T> {
    const headers: Record<string, string> = {};
    const baseKeys: string[] = Object.keys(ApiClient.BASE_HEADERS);
    for (const key of baseKeys) {
      headers[key] = ApiClient.BASE_HEADERS[key];
    }
    if (token !== '') {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const requestOptions: http.HttpRequestOptions = {
      method: method,
      header: headers,
      expectDataType: http.HttpDataType.STRING,
      connectTimeout: options !== undefined && options.connectTimeoutMs !== undefined ? options.connectTimeoutMs : 8000,
      readTimeout: options !== undefined && options.readTimeoutMs !== undefined ? options.readTimeoutMs : 8000,
    };
    if (body !== '') {
      requestOptions.extraData = body;
    }
    const httpRequest = http.createHttp();
    let response: http.HttpResponse;
    try {
      response = await httpRequest.request(`${baseUrl}${path}`, requestOptions);
    } catch (error) {
      throw new ApiRequestError('NETWORK_ERROR', describeNetworkError(error as BusinessError), 0, '');
    } finally {
      httpRequest.destroy();
    }
    return ApiClient.parse<T>(response);
  }

  private static parse<T>(response: http.HttpResponse): T {
    const status: number = response.responseCode;
    const text: string = response.result as string;
    if (text === undefined || text === '') {
      throw new ApiRequestError('UNEXPECTED_RESPONSE', `服务器无响应内容（HTTP ${status}）`, status, '');
    }
    let envelope: EnvelopeShape;
    try {
      envelope = JSON.parse(text) as EnvelopeShape;
    } catch (error) {
      throw new ApiRequestError('UNEXPECTED_RESPONSE', `服务器返回无法识别的数据（HTTP ${status}）`, status, '');
    }
    if (envelope.success === true) {
      return envelope.data as T;
    }
    const requestId: string = envelope.meta !== undefined ? envelope.meta.requestId : '';
    const apiError: ApiErrorBody | undefined = envelope.error;
    if (apiError !== undefined) {
      throw new ApiRequestError(apiError.code, apiError.message, status, requestId);
    }
    throw new ApiRequestError('UNEXPECTED_RESPONSE', `请求失败（HTTP ${status}）`, status, requestId);
  }
}
