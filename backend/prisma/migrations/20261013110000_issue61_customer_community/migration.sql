-- CreateTable
CREATE TABLE `customer_favorites` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `source_id` VARCHAR(512) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `customer_favorites_user_idx`(`user_id`, `deleted_at`, `created_at`),
    UNIQUE INDEX `customer_favorites_source_uq`(`user_id`, `kind`, `source_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_notifications` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `repair_order_id` CHAR(36) NOT NULL,
    `event_id` CHAR(36) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `body` VARCHAR(600) NOT NULL,
    `read_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `customer_notifications_event_uq`(`event_id`),
    INDEX `customer_notifications_user_idx`(`user_id`, `deleted_at`, `read_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `customer_favorites` ADD CONSTRAINT `customer_favorites_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_notifications` ADD CONSTRAINT `customer_notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_notifications` ADD CONSTRAINT `customer_notifications_repair_order_id_fkey` FOREIGN KEY (`repair_order_id`) REFERENCES `repair_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_notifications` ADD CONSTRAINT `customer_notifications_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `repair_order_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
