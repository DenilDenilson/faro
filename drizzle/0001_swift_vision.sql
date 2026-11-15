CREATE TABLE `faro_planning` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`week_start` text,
	`source_key` text,
	`data` text NOT NULL,
	CONSTRAINT "faro_planning_kind_check" CHECK("faro_planning"."kind" IN ('plan','template')),
	CONSTRAINT "faro_planning_data_check" CHECK(json_valid("faro_planning"."data"))
);
--> statement-breakpoint
CREATE INDEX `faro_planning_week_idx` ON `faro_planning` (`week_start`);--> statement-breakpoint
CREATE UNIQUE INDEX `faro_planning_source_idx` ON `faro_planning` (`source_key`);--> statement-breakpoint
CREATE TABLE `faro_planning_history` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `faro_planning_history_item_idx` ON `faro_planning_history` (`item_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `faro_planning_links` (
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`relation` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `faro_planning`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `faro_records`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `faro_planning_links_unique_idx` ON `faro_planning_links` (`source_id`,`target_id`,`relation`);--> statement-breakpoint
CREATE INDEX `faro_planning_links_target_idx` ON `faro_planning_links` (`target_id`);