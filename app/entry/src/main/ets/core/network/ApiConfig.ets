import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';

const STORE_NAME: string = 'pc_hospital_app';
const KEY_BASE_URL: string = 'api_base_url';
export const DEFAULT_API_BASE_URL: string = 'https://harmony-api.pczafu.cn';

/**
 * API 地址规范化：去空白、缺协议补 `http://`、去尾部斜杠。
 * 非法（含空格或没有主机名）返回空串，由调用方提示重新填写。
 */
export function normalizeBaseUrl(raw: string): string {
  let value: string = raw.trim();
  if (value === '' || value.includes(' ')) {
    return '';
  }
  if (!value.startsWith('http://') && !value.startsWith('https://')) {
    value = `http://${value}`;
  }
  while (value.endsWith('/')) {
    value = value.substring(0, value.length - 1);
  }
  const prefixLength: number = value.startsWith('https://') ? 8 : 7;
  if (value.length <= prefixLength) {
    return '';
  }
  return value;
}

/** API 地址是可配置项（手机联调填电脑局域网 IP:端口），保存在应用私有 preferences。 */
export class ApiConfig {
  private static baseUrl: string = DEFAULT_API_BASE_URL;

  static getBaseUrl(): string {
    return ApiConfig.baseUrl;
  }

  /** 新安装默认共享实验后端；已有开发地址保留，仍可在连接设置切换。 */
  static async loadSaved(context: common.Context): Promise<string> {
    try {
      const store = await preferences.getPreferences(context, { name: STORE_NAME });
      const saved = await store.get(KEY_BASE_URL, '') as string;
      const url = normalizeBaseUrl(saved);
      if (url !== '') {
        ApiConfig.baseUrl = url;
      }
    } catch (error) {
      // 读取失败不阻塞启动：内存值仍可为空，登录页会提示填写。
    }
    return ApiConfig.baseUrl;
  }

  /** 保存并立即生效；规范化失败返回空串（调用方提示）。 */
  static async save(context: common.Context, raw: string): Promise<string> {
    const url = normalizeBaseUrl(raw);
    if (url === '') {
      return '';
    }
    ApiConfig.baseUrl = url;
    try {
      const store = await preferences.getPreferences(context, { name: STORE_NAME });
      await store.put(KEY_BASE_URL, url);
      await store.flush();
    } catch (error) {
      // 持久化失败只影响下次启动的记忆，不阻塞本次会话。
    }
    return url;
  }
}
