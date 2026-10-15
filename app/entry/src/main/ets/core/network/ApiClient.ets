import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
import { ApiErrorBody, ApiMeta, ApiPage } from './ApiContract';

/**
 * 统一请求错误（ArkTS 只允许抛出 Error 及其子类）。
 * code 一般是后端错误码（AUTH_INVALID_CREDENTIALS 等）；
 * NETWORK_ERROR / UNEXPECTED_RESPONSE / LOCAL_STORAGE_ERROR 是客户端侧错误码，此时 status 为 0 或原始 HTTP 状态。
 */
export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string;
  /**
   * 字段级错误（如报修单提交的 `{ deviceModel: ["请填写设备机型"] }`）。
   * 后端 `VALIDATION_FAILED` 会带上它，界面据此把提示落到对应输入框下方。
   */
  readonly fieldErrors: Record<string, string[]> | undefined;

  constructor(
    code: string,
    message: string,
    status: number,
    requestId: string,
    fieldErrors?: Record<string, string[]>
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.fieldErrors = fieldErrors;
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
    return '无法连接服务器，请检查网络与服务器地址';
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

/** multipart 上传的一个文件分片（Issue #38 照片上传用）。 */
export interface MultipartFilePart {
  /** 表单字段名，如 `photos`。 */
  name: string;
  /** 文件内容类型，如 `image/png`；服务端按真实文件头复核，不一致会被拒。 */
  contentType: string;
  /** 原始文件名（仅展示与排错用）。 */
  fileName: string;
  data: ArrayBuffer;
}

/** 公共 HTTP 客户端：拼接 API 地址、携带原生通道头、拆信封、统一抛 ApiRequestError。 */
export class ApiClient {
  static async getPage<T>(baseUrl: string, path: string, token: string): Promise<ApiPage<T>> {
    return ApiClient.request<ApiPage<T>>(baseUrl, http.RequestMethod.GET, path, '', token, undefined, undefined, true);
  }
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

  /**
   * 删除接口（如删除误传照片），无请求体。
   *
   * 注意：`@ohos.net.http` 的 RequestMethod 枚举**没有 PATCH**，
   * 备案编辑因此走服务端的 POST 编辑别名（见 backend/docs/native-repairs-api.md）。
   */
  static async del<T>(baseUrl: string, path: string, token: string): Promise<T> {
    return ApiClient.request<T>(baseUrl, http.RequestMethod.DELETE, path, '', token);
  }

  /**
   * 携带额外请求头的 POST。
   * 报修单提交用 `Idempotency-Key` 防重复建单：网络抖动重试时服务端据此返回原单。
   */
  static async postWithHeaders<T>(
    baseUrl: string,
    path: string,
    body: string,
    token: string,
    extraHeaders: Record<string, string>
  ): Promise<T> {
    return ApiClient.request<T>(baseUrl, http.RequestMethod.POST, path, body, token, undefined, extraHeaders);
  }

  /**
   * multipart/form-data 上传（Issue #38 维修照片）。
   *
   * 与其余写请求同一原生通道：`X-Client-Type: native` + `Authorization: Bearer`；
   * 服务端会按令牌来源校验（Cookie 走同源、Bearer 要求原生头），这里不伪造 Origin。
   * 大文件放宽超时；成功后仍走统一信封解析。
   */
  static async postMultipart<T>(
    baseUrl: string,
    path: string,
    parts: MultipartFilePart[],
    token: string
  ): Promise<T> {
    const headers: Record<string, string> = {};
    headers['X-Client-Type'] = 'native';
    headers['User-Agent'] = 'PC-Hospital-Harmony/0.1.0';
    headers['Content-Type'] = 'multipart/form-data';
    if (token !== '') {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const formList: Array<http.MultiFormData> = [];
    for (const part of parts) {
      formList.push({
        name: part.name,
        contentType: part.contentType,
        remoteFileName: part.fileName,
        data: part.data
      });
    }
    const requestOptions: http.HttpRequestOptions = {
      method: http.RequestMethod.POST,
      header: headers,
      expectDataType: http.HttpDataType.STRING,
      connectTimeout: 15000,
      readTimeout: 60000,
      multiFormDataList: formList
    };
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

  /**
   * 读取受保护的二进制内容（维修照片）：返回原始字节，不按 JSON 信封解析。
   *
   * 失败时后端仍返回 JSON 信封，这里解码出错误码与文案再抛 `ApiRequestError`，
   * 与普通请求同一错误处理路径。
   */
  static async getBytes(baseUrl: string, path: string, token: string): Promise<ArrayBuffer> {
    const headers: Record<string, string> = {};
    headers['X-Client-Type'] = 'native';
    headers['User-Agent'] = 'PC-Hospital-Harmony/0.1.0';
    if (token !== '') {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const requestOptions: http.HttpRequestOptions = {
      method: http.RequestMethod.GET,
      header: headers,
      expectDataType: http.HttpDataType.ARRAY_BUFFER,
      connectTimeout: 8000,
      readTimeout: 30000
    };
    const httpRequest = http.createHttp();
    let response: http.HttpResponse;
    try {
      response = await httpRequest.request(`${baseUrl}${path}`, requestOptions);
    } catch (error) {
      throw new ApiRequestError('NETWORK_ERROR', describeNetworkError(error as BusinessError), 0, '');
    } finally {
      httpRequest.destroy();
    }
    const status: number = response.responseCode;
    if (status >= 200 && status < 300 && response.result instanceof ArrayBuffer) {
      return response.result;
    }
    throw ApiClient.parseBinaryFailure(status, response.result);
  }

  private static parseBinaryFailure(status: number, raw: Object): ApiRequestError {
    try {
      const text: string = raw instanceof ArrayBuffer
        ? new util.TextDecoder().decodeToString(new Uint8Array(raw))
        : String(raw);
      const envelope = JSON.parse(text) as EnvelopeShape;
      if (envelope.success === false && envelope.error !== undefined) {
        const requestId: string = envelope.meta !== undefined ? envelope.meta.requestId : '';
        return new ApiRequestError(
          envelope.error.code,
          envelope.error.message,
          status,
          requestId,
          envelope.error.fieldErrors
        );
      }
    } catch (error) {
      // 解码失败时退回通用错误，不把原始字节当文本展示。
    }
    return new ApiRequestError('UNEXPECTED_RESPONSE', `图片读取失败（HTTP ${status}）`, status, '');
  }

  private static async request<T>(
    baseUrl: string,
    method: http.RequestMethod,
    path: string,
    body: string,
    token: string,
    options?: ApiRequestOptions,
    extraHeaders?: Record<string, string>,
    paginated: boolean = false
  ): Promise<T> {
    const headers: Record<string, string> = {};
    const baseKeys: string[] = Object.keys(ApiClient.BASE_HEADERS);
    for (const key of baseKeys) {
      headers[key] = ApiClient.BASE_HEADERS[key];
    }
    if (extraHeaders !== undefined) {
      const extraKeys: string[] = Object.keys(extraHeaders);
      for (const key of extraKeys) {
        headers[key] = extraHeaders[key];
      }
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
    if (paginated) {
      const items: Object = ApiClient.parse<Object>(response);
      const envelope = JSON.parse(response.result as string) as EnvelopeShape;
      if (envelope.meta === undefined || envelope.meta.pagination === undefined) {
        throw new ApiRequestError('UNEXPECTED_RESPONSE', '分页信息缺失，请重试', response.responseCode, '');
      }
      const page: ApiPage<Object> = { items: items as Object[], pagination: envelope.meta.pagination };
      return page as T;
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
      // fieldErrors 原样透出：报修单提交这类表单要靠它把提示落到具体输入框。
      throw new ApiRequestError(apiError.code, apiError.message, status, requestId, apiError.fieldErrors);
    }
    throw new ApiRequestError('UNEXPECTED_RESPONSE', `请求失败（HTTP ${status}）`, status, requestId);
  }
}
