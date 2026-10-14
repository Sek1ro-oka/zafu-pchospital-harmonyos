-- Issue #60 第二批：rememberMe 会话有效期档位（同步 Web：普通 24 小时 / 保持登录 30 天）。
--
-- 为什么必须可空：PR #65 之前创建的存量会话**没有**这一列，它们当年一律按 30 天发放。
-- 一旦给 NOT NULL DEFAULT 0（24 小时），一次迁移就会让所有存量会话变成 24 小时后失效 ——
-- 正在用的人被集体登出。因此这里刻意用 NULL，让「迁移前的旧会话」与「新发放的会话」可分：
--   remember_me = true   → 30 天（保持登录）
--   remember_me = false  → 24 小时（普通）
--   remember_me = NULL   → 迁移前的存量会话，回退到原 30 天行为（见 src/features/auth/session-lifetime.ts）
--
-- 不回填：任何 UPDATE 都会改变既有会话的实际到期时刻（expires_at 已按旧规则落库），
-- 而本列只表达「下次发放/续期时按哪个档位算」。存量会话的 expires_at 保持不变，兼容性由
-- `legacySessionLifetime()` 在读取时实现，不需要也不应该在这里动数据。

ALTER TABLE `auth_sessions`
  ADD COLUMN `remember_me` BOOLEAN NULL;
