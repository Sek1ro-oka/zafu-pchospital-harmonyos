/*
  Warnings:

  - The primary key for the `public_content_settings` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- DropForeignKey
ALTER TABLE `repair_activity_attendances` DROP FOREIGN KEY `repair_activity_attendance_activity_id_fkey`;

-- DropForeignKey
ALTER TABLE `repair_activity_attendances` DROP FOREIGN KEY `repair_activity_attendance_member_fkey`;

-- DropForeignKey
ALTER TABLE `repair_activity_registrations` DROP FOREIGN KEY `repair_activity_regs_activity_id_fkey`;

-- DropForeignKey
ALTER TABLE `repair_activity_registrations` DROP FOREIGN KEY `repair_activity_regs_repair_record_fkey`;

-- DropForeignKey
ALTER TABLE `repair_activity_registrations` DROP FOREIGN KEY `repair_activity_regs_served_by_fkey`;

-- DropForeignKey
ALTER TABLE `repair_timeline_events` DROP FOREIGN KEY `repair_timeline_actor_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `repair_timeline_events` DROP FOREIGN KEY `repair_timeline_repair_record_id_fkey`;

-- AlterTable
ALTER TABLE `public_content_settings` DROP PRIMARY KEY,
    MODIFY `id` VARCHAR(32) NOT NULL,
    ADD PRIMARY KEY (`id`);

-- CreateTable
CREATE TABLE `repair_orders` (
    `id` CHAR(36) NOT NULL,
    `submitted_by_user_id` CHAR(36) NOT NULL,
    `device_model` VARCHAR(60) NOT NULL,
    `device_serial` VARCHAR(120) NULL,
    `fault_description` TEXT NOT NULL,
    `contact_phone` VARCHAR(32) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `last_progress_at` DATETIME(3) NULL,
    `create_request_key` VARCHAR(128) NOT NULL,
    `assignee_member_profile_id` CHAR(36) NULL,
    `repair_record_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `repair_orders_create_request_uq`(`create_request_key`),
    UNIQUE INDEX `repair_orders_record_uq`(`repair_record_id`),
    INDEX `repair_orders_submitter_status_idx`(`submitted_by_user_id`, `status`, `created_at`),
    INDEX `repair_orders_status_progress_idx`(`status`, `last_progress_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `repair_order_events` (
    `id` CHAR(36) NOT NULL,
    `repair_order_id` CHAR(36) NOT NULL,
    `from_status` VARCHAR(32) NULL,
    `to_status` VARCHAR(32) NOT NULL,
    `note` VARCHAR(500) NULL,
    `actor_user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,

    INDEX `repair_order_events_order_time_idx`(`repair_order_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `repair_orders` ADD CONSTRAINT `repair_orders_submitted_by_user_id_fkey` FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_orders` ADD CONSTRAINT `repair_orders_assignee_member_profile_id_fkey` FOREIGN KEY (`assignee_member_profile_id`) REFERENCES `member_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_orders` ADD CONSTRAINT `repair_orders_repair_record_id_fkey` FOREIGN KEY (`repair_record_id`) REFERENCES `repair_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_order_events` ADD CONSTRAINT `repair_order_events_repair_order_id_fkey` FOREIGN KEY (`repair_order_id`) REFERENCES `repair_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_order_events` ADD CONSTRAINT `repair_order_events_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_timeline_events` ADD CONSTRAINT `repair_timeline_events_repair_record_id_fkey` FOREIGN KEY (`repair_record_id`) REFERENCES `repair_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_timeline_events` ADD CONSTRAINT `repair_timeline_events_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_activity_registrations` ADD CONSTRAINT `repair_activity_registrations_activity_id_fkey` FOREIGN KEY (`activity_id`) REFERENCES `repair_activities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_activity_registrations` ADD CONSTRAINT `repair_activity_registrations_served_by_member_profile_id_fkey` FOREIGN KEY (`served_by_member_profile_id`) REFERENCES `member_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_activity_registrations` ADD CONSTRAINT `repair_activity_registrations_repair_record_id_fkey` FOREIGN KEY (`repair_record_id`) REFERENCES `repair_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_activity_attendances` ADD CONSTRAINT `repair_activity_attendances_activity_id_fkey` FOREIGN KEY (`activity_id`) REFERENCES `repair_activities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_activity_attendances` ADD CONSTRAINT `repair_activity_attendances_member_profile_id_fkey` FOREIGN KEY (`member_profile_id`) REFERENCES `member_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
