-- CreateTable
CREATE TABLE `knowledge_cases` (
    `id` CHAR(36) NOT NULL,
    `display_text` TEXT NOT NULL,
    `structured` JSON NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `visibility` VARCHAR(16) NOT NULL,
    `content_version` INTEGER NOT NULL DEFAULT 1,
    `content_hash` VARCHAR(64) NOT NULL,
    `model` VARCHAR(64) NULL,
    `prompt_version` VARCHAR(32) NULL,
    `embedding` BLOB NULL,
    `embedding_fingerprint` VARCHAR(128) NULL,
    `embedding_status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `embedding_error` VARCHAR(500) NULL,
    `withdrawn_source` VARCHAR(32) NULL,
    `withdrawn_at` DATETIME(3) NULL,
    `withdrawn_by_user_id` CHAR(36) NULL,
    `failure_code` VARCHAR(64) NULL,
    `failure_message` VARCHAR(500) NULL,
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `knowledge_cases_status_visibility_idx`(`status`, `visibility`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_case_sources` (
    `id` CHAR(36) NOT NULL,
    `repair_record_id` CHAR(36) NOT NULL,
    `case_id` CHAR(36) NULL,
    `status` VARCHAR(32) NOT NULL,
    `content_hash` VARCHAR(64) NOT NULL,
    `evidence` JSON NULL,
    `generation` INTEGER NOT NULL DEFAULT 0,
    `processing_started_at` DATETIME(3) NULL,
    `failure_code` VARCHAR(64) NULL,
    `failure_message` VARCHAR(500) NULL,
    `processed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `knowledge_case_sources_record_uq`(`repair_record_id`),
    INDEX `knowledge_case_sources_case_status_idx`(`case_id`, `status`),
    INDEX `knowledge_case_sources_status_updated_idx`(`status`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `knowledge_cases` ADD CONSTRAINT `knowledge_cases_withdrawn_by_user_id_fkey` FOREIGN KEY (`withdrawn_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_case_sources` ADD CONSTRAINT `knowledge_case_sources_repair_record_id_fkey` FOREIGN KEY (`repair_record_id`) REFERENCES `repair_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_case_sources` ADD CONSTRAINT `knowledge_case_sources_case_id_fkey` FOREIGN KEY (`case_id`) REFERENCES `knowledge_cases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
