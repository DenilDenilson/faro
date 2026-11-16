CREATE TABLE `faro_strategy` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`indicator_id` text,
	`occurred_at` text,
	`data` text NOT NULL,
	CONSTRAINT "faro_strategy_kind_check" CHECK("faro_strategy"."kind" IN ('vision','key','indicator','measurement','review')),
	CONSTRAINT "faro_strategy_data_check" CHECK(json_valid("faro_strategy"."data"))
);
--> statement-breakpoint
CREATE INDEX `faro_strategy_kind_status_idx` ON `faro_strategy` (`kind`,`status`);--> statement-breakpoint
CREATE INDEX `faro_strategy_indicator_date_idx` ON `faro_strategy` (`indicator_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `faro_strategy_history` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `faro_strategy_history_item_date_idx` ON `faro_strategy_history` (`item_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `faro_strategy_links` (
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`relation` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `faro_strategy`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `faro_strategy`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `faro_strategy_links_unique_idx` ON `faro_strategy_links` (`source_id`,`target_id`,`relation`);--> statement-breakpoint
CREATE INDEX `faro_strategy_links_target_idx` ON `faro_strategy_links` (`target_id`);--> statement-breakpoint
CREATE TABLE `faro_strategy_record_links` (
	`record_id` text NOT NULL,
	`strategy_id` text NOT NULL,
	`relation` text NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `faro_records`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`strategy_id`) REFERENCES `faro_strategy`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `faro_strategy_record_links_unique_idx` ON `faro_strategy_record_links` (`record_id`,`strategy_id`,`relation`);--> statement-breakpoint
CREATE INDEX `faro_strategy_record_links_target_idx` ON `faro_strategy_record_links` (`strategy_id`);