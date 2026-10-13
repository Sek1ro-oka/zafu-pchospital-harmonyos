-- 新列为空，保留所有既有课设数据；不根据电话或昵称推断旧机主。
ALTER TABLE `repair_records`
  ADD COLUMN `owner_name` VARCHAR(40) NULL,
  ADD COLUMN `owner_phone` VARCHAR(32) NULL;
