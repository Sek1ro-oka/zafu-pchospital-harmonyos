-- Issue #84 选购交易：新增商品、商品图片、订单三张表。
-- 本迁移只建新表与新索引，不修改既有表和数据（可安全应用到已有开发库）。

-- CreateTable
CREATE TABLE `products` (
    `id` CHAR(36) NOT NULL,
    `seller_id` CHAR(36) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `description` TEXT NOT NULL,
    `price_cents` INT NOT NULL,
    `category` VARCHAR(32) NOT NULL,
    `condition` VARCHAR(32) NOT NULL,
    `stock` INT NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `pickup_note` VARCHAR(255) NULL,
    `delist_reason` VARCHAR(255) NULL,
    `delisted_by` CHAR(36) NULL,
    `delisted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `products_status_category_created_idx`(`status`, `category`, `created_at`),
    INDEX `products_seller_created_idx`(`seller_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_images` (
    `id` CHAR(36) NOT NULL,
    `product_id` CHAR(36) NOT NULL,
    `url` VARCHAR(512) NOT NULL,
    `storage_key` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(64) NOT NULL,
    `size_bytes` INT NOT NULL,
    `sort_order` INT NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `product_images_storage_key_uq`(`storage_key`),
    INDEX `product_images_product_sort_idx`(`product_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shopping_orders` (
    `id` CHAR(36) NOT NULL,
    `product_id` CHAR(36) NOT NULL,
    `buyer_id` CHAR(36) NOT NULL,
    `seller_id` CHAR(36) NOT NULL,
    `quantity` INT NOT NULL,
    `unit_price_cents` INT NOT NULL,
    `total_cents` INT NOT NULL,
    `title_snapshot` VARCHAR(120) NOT NULL,
    `image_snapshot` VARCHAR(512) NULL,
    `status` VARCHAR(32) NOT NULL,
    `cancel_reason` VARCHAR(255) NULL,
    `cancelled_by` CHAR(36) NULL,
    `idempotency_key` VARCHAR(80) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `shopping_orders_buyer_idem_uq`(`buyer_id`, `idempotency_key`),
    INDEX `shopping_orders_buyer_created_idx`(`buyer_id`, `created_at`),
    INDEX `shopping_orders_seller_created_idx`(`seller_id`, `created_at`),
    INDEX `shopping_orders_product_created_idx`(`product_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_seller_id_fkey` FOREIGN KEY (`seller_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shopping_orders` ADD CONSTRAINT `shopping_orders_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shopping_orders` ADD CONSTRAINT `shopping_orders_buyer_id_fkey` FOREIGN KEY (`buyer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shopping_orders` ADD CONSTRAINT `shopping_orders_seller_id_fkey` FOREIGN KEY (`seller_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
