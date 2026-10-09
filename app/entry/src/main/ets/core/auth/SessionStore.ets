import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';

const TOKEN_ALIAS: string = 'pc_hospital_app_session_token';

function toBytes(value: string): Uint8Array {
  return new util.TextEncoder().encodeInto(value);
}

function fromBytes(bytes: Uint8Array): string {
  return new util.TextDecoder().decodeToString(bytes);
}

/**
 * 会话令牌本地保存：令牌是凭证，放系统 Asset Store（密钥/口令存储），不写普通 preferences。
 * 首次解锁后可读（DEVICE_FIRST_UNLOCKED），重启恢复会话时无需解锁屏幕。
 */
export class SessionStore {
  /** 读取令牌；未保存或存储不可用时返回空串（当作未登录处理）。 */
  static async readToken(): Promise<string> {
    const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, toBytes(TOKEN_ALIAS));
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    let rows: Array<asset.AssetMap>;
    try {
      rows = await asset.query(query);
    } catch (error) {
      return '';
    }
    if (rows.length === 0) {
      return '';
    }
    const secret = rows[0].get(asset.Tag.SECRET);
    if (secret instanceof Uint8Array) {
      return fromBytes(secret);
    }
    return '';
  }

  /** 保存令牌（同别名覆盖旧值）；返回 false 时由会话服务撤销新令牌并报告登录失败。 */
  static async writeToken(token: string): Promise<boolean> {
    const attributes: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    attributes.set(asset.Tag.SECRET, toBytes(token));
    attributes.set(asset.Tag.ALIAS, toBytes(TOKEN_ALIAS));
    attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
    attributes.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE);
    try {
      await asset.add(attributes);
      return true;
    } catch (error) {
      return false;
    }
  }

  /** 清除令牌；从未保存过等情形不视为失败。 */
  static async clearToken(): Promise<void> {
    const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, toBytes(TOKEN_ALIAS));
    try {
      await asset.remove(query);
    } catch (error) {
      return;
    }
  }
}
