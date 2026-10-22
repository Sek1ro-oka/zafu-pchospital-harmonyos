import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';

const STORE_NAME: string = 'pc_hospital_app';
const KEY_PENDING_ORDERS: string = 'shopping_pending_orders';
/** 记录条数上限：正常只有一两条在途未决，超限淘汰最旧，防止异常场景无限增长。 */
const MAX_RECORDS: number = 16;

/**
 * 结果未知的下单请求快照（持久化版，#84 审查第三轮）。
 *
 * 幂等键必须跨详情页实例存活：下单已落库而响应丢失 → 用户返回列表
 * （详情出栈销毁）→ 重进同一商品重试，新实例必须复用原 key，服务端按
 * `(buyerId, idempotencyKey)` 去重返回原单；换了新 key 就会建出第二笔订单。
 *
 * 记录按 **账号 + 服务器 + 商品** 三元组隔离：查找时三项全部相等才算命中，
 * 退出登录 / 换账号 / 换服务器留下的记录对当前会话自然不可见（不读取、不复用）。
 * 存 preferences 与 `ApiConfig` 同一私有库（`pc_hospital_app`），值是 JSON 数组；
 * 读取或解析失败一律降级为「无记录」，绝不因本地存储故障阻塞下单。
 */
export interface PendingOrderRecord {
  /** 发起下单的账号（`SessionService.current().userId`）。 */
  userId: string;
  /** 发起下单时的服务器地址（`ApiConfig.getBaseUrl()`）。 */
  baseUrl: string;
  productId: string;
  /** 幂等键：重试必须原样复用。 */
  key: string;
  quantity: number;
  /** 写入时间戳（毫秒）；仅用于超限淘汰与排查，不参与业务判断。 */
  savedAt: number;
}

function sameScope(a: PendingOrderRecord, userId: string, baseUrl: string, productId: string): boolean {
  return a.userId === userId && a.baseUrl === baseUrl && a.productId === productId;
}

export class PendingOrderStore {
  /**
   * 读取当前 账号 + 服务器 + 商品 的未决下单意图。
   * 无记录、三元组不匹配、读取或解析失败都返回 null（降级为无记录）。
   */
  static async read(context: common.Context, userId: string, baseUrl: string,
    productId: string): Promise<PendingOrderRecord | null> {
    const records: PendingOrderRecord[] = await PendingOrderStore.loadAll(context);
    for (const record of records) {
      if (sameScope(record, userId, baseUrl, productId)) {
        return record;
      }
    }
    return null;
  }

  /**
   * 写入（同三元组覆盖）未决下单意图；调用方必须在**发出下单请求之前**落盘。
   * 写入失败静默降级：同实例仍有内存快照，跨实例恢复退化为「无记录」。
   */
  static async write(context: common.Context, record: PendingOrderRecord): Promise<void> {
    const records: PendingOrderRecord[] = await PendingOrderStore.loadAll(context);
    const next: PendingOrderRecord[] = [];
    for (const existing of records) {
      if (!sameScope(existing, record.userId, record.baseUrl, record.productId)) {
        next.push(existing);
      }
    }
    next.push(record);
    while (next.length > MAX_RECORDS) {
      let oldest: number = 0;
      for (let i = 1; i < next.length; i += 1) {
        if (next[i].savedAt < next[oldest].savedAt) oldest = i;
      }
      next.splice(oldest, 1);
    }
    await PendingOrderStore.saveAll(context, next);
  }

  /**
   * 结果确认（下单成功 / 服务端明确拒绝）后清除；只删三元组完全匹配的那条，
   * 其他账号 / 服务器 / 商品的记录不动。清除失败静默：残留记录最坏情况是
   * 多提示一次「重试同一请求」，重试走幂等键不会重复建单。
   */
  static async clear(context: common.Context, userId: string, baseUrl: string, productId: string): Promise<void> {
    const records: PendingOrderRecord[] = await PendingOrderStore.loadAll(context);
    const next: PendingOrderRecord[] = [];
    for (const existing of records) {
      if (!sameScope(existing, userId, baseUrl, productId)) {
        next.push(existing);
      }
    }
    if (next.length !== records.length) {
      await PendingOrderStore.saveAll(context, next);
    }
  }

  private static async loadAll(context: common.Context): Promise<PendingOrderRecord[]> {
    try {
      const store = await preferences.getPreferences(context, { name: STORE_NAME });
      const raw = await store.get(KEY_PENDING_ORDERS, '') as string;
      if (raw === '') {
        return [];
      }
      const parsed = JSON.parse(raw) as PendingOrderRecord[];
      if (!Array.isArray(parsed)) {
        return [];
      }
      const records: PendingOrderRecord[] = [];
      for (const item of parsed) {
        if (PendingOrderStore.isValid(item)) {
          records.push(item);
        }
      }
      return records;
    } catch (error) {
      // 文件损坏 / 存储不可用：按「无记录」处理，不抛出。
      return [];
    }
  }

  private static async saveAll(context: common.Context, records: PendingOrderRecord[]): Promise<void> {
    try {
      const store = await preferences.getPreferences(context, { name: STORE_NAME });
      await store.put(KEY_PENDING_ORDERS, JSON.stringify(records));
      await store.flush();
    } catch (error) {
      // 持久化失败只影响跨实例恢复，不阻塞本次下单流程。
    }
  }

  /** 结构校验：字段缺失或类型不对的记录（旧版本 / 损坏数据）直接丢弃。 */
  private static isValid(item: PendingOrderRecord): boolean {
    return typeof item.userId === 'string' && item.userId !== ''
      && typeof item.baseUrl === 'string' && item.baseUrl !== ''
      && typeof item.productId === 'string' && item.productId !== ''
      && typeof item.key === 'string' && item.key !== ''
      && typeof item.quantity === 'number' && item.quantity >= 1
      && typeof item.savedAt === 'number';
  }
}
