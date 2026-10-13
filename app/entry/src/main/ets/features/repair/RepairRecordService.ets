import { util } from '@kit.ArkTS';
import { ApiClient, ApiRequestError, MultipartFilePart } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { SessionStore } from '../../core/auth/SessionStore';
import { PickedImage } from './PhotoPicker';
import {
  RepairCategoryView,
  RepairPhotoView,
  RepairRecordDetailView,
  RepairRecordView,
  RepairRecordFields,
  RepairRecordSaveRequest,
} from './StaffRepairContract';

const REPAIRS_PATH: string = '/api/v1/repairs';
const CATEGORIES_PATH: string = '/api/v1/repair-categories';

async function ready(): Promise<string> {
  if (ApiConfig.getBaseUrl() === '') {
    throw new ApiRequestError('NETWORK_ERROR', '服务器地址未配置，请回到登录页填写', 0, '');
  }
  const token = await SessionStore.readToken();
  if (token === '') {
    throw new ApiRequestError('UNAUTHENTICATED', '登录状态已失效，请重新登录', 0, '');
  }
  return token;
}

/**
 * 维修备案服务（工作人员本人视角，Issue #38）。
 *
 * 复用 #1 起的备案链路：详情 / 保存草稿 / 提交 / 照片上传与删除 / 分类字典。
 * 编辑权限、字段校验、版本冲突、提交必填与照片规则都在服务端，
 * 客户端只做乐观提示与错误映射。
 */
export class RepairRecordService {
  static async list(mine: boolean, page: number, filter: string): Promise<RepairRecordView[]> {
    return ApiClient.get<RepairRecordView[]>(ApiConfig.getBaseUrl(), `${mine ? '/api/v1/member/repairs' : REPAIRS_PATH}?page=${page}&pageSize=20${mine ? '' : '&status=APPROVED'}${filter}`, await ready());
  }
  static async create(key: string): Promise<RecordCreateView> {
    const headers: Record<string, string> = { 'Idempotency-Key': key };
    return ApiClient.postWithHeaders<RecordCreateView>(ApiConfig.getBaseUrl(), REPAIRS_PATH, '{}', await ready(), headers);
  }
  static createKey(): string { return `native-record-${util.generateRandomUUID(true)}`; }

  static async detail(id: string): Promise<RepairRecordDetailView> {
    const token = await ready();
    return await ApiClient.get<RepairRecordDetailView>(
      ApiConfig.getBaseUrl(),
      `${REPAIRS_PATH}/${id}`,
      token
    );
  }

  /** 保存草稿（走 POST 编辑别名：平台 http 枚举没有 PATCH，服务端与 PATCH 同语义）。 */
  static async save(
    id: string,
    version: number,
    fields: RepairRecordFields
  ): Promise<RepairRecordDetailView> {
    const token = await ready();
    const body: RepairRecordSaveRequest = {
      version: version,
      deviceModel: fields.deviceModel,
      ownerName: fields.ownerName,
      ownerPhone: fields.ownerPhone,
      repairDate: fields.repairDate,
      durationMinutes: fields.durationMinutes,
      categoryId: fields.categoryId,
      content: fields.content,
      result: fields.result,
      remark: fields.remark,
    };
    return await ApiClient.post<RepairRecordDetailView>(
      ApiConfig.getBaseUrl(),
      `${REPAIRS_PATH}/${id}`,
      JSON.stringify(body),
      token
    );
  }

  /** 提交审核：幂等键走请求头，重试复用同一个键。 */
  static async submit(id: string, version: number, idempotencyKey: string): Promise<RepairRecordDetailView> {
    const token = await ready();
    const headers: Record<string, string> = {};
    headers['Idempotency-Key'] = idempotencyKey;
    return await ApiClient.postWithHeaders<RepairRecordDetailView>(
      ApiConfig.getBaseUrl(),
      `${REPAIRS_PATH}/${id}/submit`,
      JSON.stringify({ version: version }),
      token,
      headers
    );
  }

  /** 上传照片（multipart，字段名与 Web 端一致：photos）。 */
  static async uploadPhotos(id: string, images: PickedImage[]): Promise<RepairPhotoView[]> {
    const token = await ready();
    const parts: MultipartFilePart[] = [];
    for (const image of images) {
      parts.push({
        name: 'photos',
        contentType: image.mimeType,
        fileName: image.fileName,
        data: image.data
      });
    }
    return await ApiClient.postMultipart<RepairPhotoView[]>(
      ApiConfig.getBaseUrl(),
      `${REPAIRS_PATH}/${id}/photos`,
      parts,
      token
    );
  }

  /** 删除误传照片。 */
  static async removePhoto(recordId: string, photoId: string): Promise<void> {
    const token = await ready();
    await ApiClient.del<Record<string, boolean>>(
      ApiConfig.getBaseUrl(),
      `${REPAIRS_PATH}/${recordId}/photos/${photoId}`,
      token
    );
  }

  /** 启用中的分类字典（提交审核必填分类）。 */
  static async categories(): Promise<RepairCategoryView[]> {
    const token = await ready();
    const items = await ApiClient.get<RepairCategoryView[]>(
      ApiConfig.getBaseUrl(),
      CATEGORIES_PATH,
      token
    );
    return items === undefined || items === null ? [] : items;
  }

  /** 受保护照片内容（带会话鉴权，不把令牌放进 URL）。 */
  static async photoBytes(photoId: string): Promise<ArrayBuffer> {
    const token = await ready();
    return await ApiClient.getBytes(
      ApiConfig.getBaseUrl(),
      `/api/v1/repair-photos/${photoId}/content`,
      token
    );
  }
}

export interface RecordCreateView { id: string; version: number; }
