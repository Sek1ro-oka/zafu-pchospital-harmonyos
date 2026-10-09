// 后端 API 信封（已核实的 `success` / `data` 或 `error` / `meta` 结构）。
export interface ApiMeta {
  requestId: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
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
