// 后端 API 信封（已核实的 `success` / `data` 或 `error` / `meta` 结构）。
export interface ApiMeta {
  requestId: string;
  pagination?: ApiPagination;
}

export interface ApiPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  /** 字段级错误：键为字段名，值为该字段的错误文案列表（后端 VALIDATION_FAILED 返回）。 */
  fieldErrors?: Record<string, string[]>;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
  meta: ApiMeta;
}

/** GET /api/v1/health 的 data。 */
export interface HealthData {
  status: string;
  database: string;
}
