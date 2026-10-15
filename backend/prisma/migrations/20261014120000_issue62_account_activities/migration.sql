-- Additive migration: historical anonymous registrations remain unowned.
ALTER TABLE `repair_activities` ADD COLUMN `location` VARCHAR(200) NULL;
ALTER TABLE `repair_activity_registrations` ADD COLUMN `user_id` CHAR(36) NULL;
CREATE INDEX `repair_activity_regs_user_deleted_created_idx`
  ON `repair_activity_registrations`(`user_id`, `deleted_at`, `created_at`, `id`);
ALTER TABLE `repair_activity_registrations`
  ADD CONSTRAINT `repair_activity_regs_user_fk` FOREIGN KEY (`user_id`)
  REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
