ALTER TABLE `repair_activity_attendances`
  ADD COLUMN `cancelled_at` DATETIME(3) NULL,
  ADD COLUMN `business_started_at` DATETIME(3) NULL;
