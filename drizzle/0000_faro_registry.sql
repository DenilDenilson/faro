CREATE TABLE `faro_access_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`blocked_until` integer DEFAULT 0 NOT NULL,
	`window_start` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `faro_history` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`operation` text NOT NULL,
	`before_data` text,
	`after_data` text,
	CONSTRAINT "faro_history_operation_check" CHECK("faro_history"."operation" IN ('create','update','delete'))
);
--> statement-breakpoint
CREATE INDEX `faro_history_record_date_idx` ON `faro_history` (`record_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `faro_history_date_idx` ON `faro_history` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `faro_links` (
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`relation` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `faro_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `faro_records`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `faro_links_unique_idx` ON `faro_links` (`source_id`,`target_id`,`relation`);--> statement-breakpoint
CREATE INDEX `faro_links_target_idx` ON `faro_links` (`target_id`);--> statement-breakpoint
CREATE TABLE `faro_records` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`occurred_at` text,
	`area_id` text,
	`parent_id` text,
	`week_start` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`data` text NOT NULL,
	`idempotency_key` text,
	`dedupe_key` text,
	CONSTRAINT "faro_records_type_check" CHECK("faro_records"."type" IN ('areas','interests','goals','habits','projects','milestones','activities','reviews','seasons','learnings','progress')),
	CONSTRAINT "faro_records_data_check" CHECK(json_valid("faro_records"."data"))
);
--> statement-breakpoint
CREATE INDEX `faro_records_type_date_idx` ON `faro_records` (`type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `faro_records_type_status_idx` ON `faro_records` (`type`,`status`);--> statement-breakpoint
CREATE INDEX `faro_records_created_idx` ON `faro_records` (`created_at`);--> statement-breakpoint
CREATE INDEX `faro_records_area_idx` ON `faro_records` (`area_id`);--> statement-breakpoint
CREATE INDEX `faro_records_parent_idx` ON `faro_records` (`parent_id`);--> statement-breakpoint
CREATE INDEX `faro_records_updated_idx` ON `faro_records` (`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `faro_records_idempotency_idx` ON `faro_records` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `faro_records_dedupe_idx` ON `faro_records` (`dedupe_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `faro_reviews_week_idx` ON `faro_records` (`week_start`) WHERE "faro_records"."type" = 'reviews';--> statement-breakpoint
CREATE TABLE `faro_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT "faro_settings_data_check" CHECK(json_valid("faro_settings"."data"))
);
