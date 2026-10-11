import { fileIo } from '@kit.CoreFileKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';

/** 从相册选中的一张图片：原始字节 + 推断的内容类型 + 文件名。 */
export interface PickedImage {
  fileName: string;
  mimeType: string;
  data: ArrayBuffer;
}

/** 服务端只接受真实 JPEG / PNG / WebP（按文件头复核），客户端按扩展名先筛一道。 */
const JPEG_EXTENSIONS: string[] = ['.jpg', '.jpeg'];
const PNG_EXTENSIONS: string[] = ['.png'];
const WEBP_EXTENSIONS: string[] = ['.webp'];

/**
 * 本机相册选图（Issue #38）。
 *
 * 走系统 PhotoViewPicker：无需申请媒体库权限；返回的 URI 可直接用 fileIo 读取。
 * 不做拍照、排序等超出本轮范围的能力。
 */
export class PhotoPicker {
  /** 打开系统相册选图；用户取消返回空数组。 */
  static async pick(maxCount: number): Promise<PickedImage[]> {
    const picker = new photoAccessHelper.PhotoViewPicker();
    const options = new photoAccessHelper.PhotoSelectOptions();
    options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
    options.maxSelectNumber = maxCount;
    let uris: string[] = [];
    try {
      const result = await picker.select(options);
      uris = result.photoUris;
    } catch (error) {
      // 用户取消不算错误：返回空数组，由界面保持原状。
      return [];
    }
    const picked: PickedImage[] = [];
    for (const uri of uris) {
      const image = PhotoPicker.readImage(uri);
      if (image !== null) {
        picked.push(image);
      }
    }
    return picked;
  }

  private static readImage(uri: string): PickedImage | null {
    const mimeType = PhotoPicker.mimeForUri(uri);
    if (mimeType === '') {
      return null;
    }
    const fileName = PhotoPicker.fileNameForUri(uri);
    let file: fileIo.File | null = null;
    try {
      file = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
      const stat = fileIo.statSync(file.fd);
      if (stat.size <= 0) {
        return null;
      }
      const buffer = new ArrayBuffer(stat.size);
      const readBytes = fileIo.readSync(file.fd, buffer);
      if (readBytes !== stat.size) {
        return null;
      }
      return { fileName: fileName, mimeType: mimeType, data: buffer };
    } catch (error) {
      // 单个文件读取失败（权限、损坏等）不拖垮整次选择：跳过它，其余照常返回。
      return null;
    } finally {
      if (file !== null) {
        try {
          fileIo.closeSync(file);
        } catch (closeError) {
          // 关闭失败已无法补救，忽略。
        }
      }
    }
  }

  /** 扩展名 → 内容类型；不支持的类型返回空串（调用方过滤并提示）。 */
  static mimeForUri(uri: string): string {
    const name = PhotoPicker.fileNameForUri(uri).toLowerCase();
    for (const extension of JPEG_EXTENSIONS) {
      if (name.endsWith(extension)) {
        return 'image/jpeg';
      }
    }
    for (const extension of PNG_EXTENSIONS) {
      if (name.endsWith(extension)) {
        return 'image/png';
      }
    }
    for (const extension of WEBP_EXTENSIONS) {
      if (name.endsWith(extension)) {
        return 'image/webp';
      }
    }
    return '';
  }

  /** 取 URI 最后一段作为文件名（去掉查询串）。 */
  static fileNameForUri(uri: string): string {
    let path = uri;
    const queryIndex = path.indexOf('?');
    if (queryIndex >= 0) {
      path = path.substring(0, queryIndex);
    }
    const slashIndex = path.lastIndexOf('/');
    const name = slashIndex >= 0 ? path.substring(slashIndex + 1) : path;
    return name === '' ? 'photo' : name;
  }
}
