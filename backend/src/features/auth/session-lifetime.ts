/**
 * 会话有效期档位（Issue #60 rememberMe 同步 Web 行为）。
 *
 * 为什么单独一个文件：这条规则同时被 `AuthService`（登录 / 注册 / 改密轮换）
 * 与测试夹具读取，分头写常量的下场是「文档说 24 小时、代码里某条路径还是 30 天」。
 * 这里只有一个 `sessionLifetimeFor`，所有路径都走它。
 *
 * 会话到期时间在发放时一次算定（固定档位），authenticate 只记录活跃、**不做滑动续期**
 * —— 对齐 Web 参照实现，因此这里不再保留任何续期窗口常量。
 */

/** 普通档位：24 小时。Web rememberMe 未勾选时的会话有效期。 */
export const SESSION_LIFETIME_SHORT_MS = 24 * 60 * 60 * 1_000;
/** 保持登录档位：30 天。Web 勾选 rememberMe 时的会话有效期。 */
export const SESSION_LIFETIME_KEEP_MS = 30 * 24 * 60 * 60 * 1_000;

/**
 * 存量会话的兼容档位。
 *
 * **PR #65 之前创建的所有会话 `remember_me` 都是 NULL**（那一列还不存在），
 * 它们当年一律按 30 天发放。若把 NULL 当成「普通档位」，一次迁移就会让所有存量会话
 * 变成 24 小时后失效 —— 正在用的人被集体登出，这是不可接受的破坏性变更。
 * 因此 NULL 明确回退到 `SESSION_LIFETIME_KEEP_MS`。
 */
export const SESSION_LIFETIME_LEGACY_MS = SESSION_LIFETIME_KEEP_MS;

/** 触达写入间隔：5 分钟内只更新一次 `lastSeenAt`，避免每次请求都写库。 */
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1_000;

/**
 * 按 rememberMe 选择算出生效时长。
 *
 * 三态而不是两态：`true` → 30 天，`false` → 24 小时，`null`（存量会话）→ 30 天。
 * `undefined` 与 `false` 同义 —— 调用方「没提交这个字段」就是普通档位。
 */
export function sessionLifetimeFor(rememberMe: boolean | null | undefined): number {
  return rememberMe === true ? SESSION_LIFETIME_KEEP_MS : SESSION_LIFETIME_SHORT_MS;
}

/**
 * 改密轮换时要保留的原档位：**只认库里的值**。
 *
 * 返回 `null` 表示「原会话是存量会话（`remember_me` 为 NULL）」，此时新会话必须
 * 继续回退到 30 天，不能因为字段缺失就降级成 24 小时。
 */
export function legacySessionLifetime(rememberMe: boolean | null): number {
  return rememberMe === null ? SESSION_LIFETIME_LEGACY_MS : sessionLifetimeFor(rememberMe);
}
