CREATE TABLE `notification_events` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`dedup_key` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`route_json` text NOT NULL,
	`delivered_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_events_dedup_uidx` ON `notification_events` (`dedup_key`);--> statement-breakpoint
CREATE INDEX `notification_events_pending_idx` ON `notification_events` (`delivered_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `schedule_triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`logical_trigger_at` integer NOT NULL,
	`requested_at` integer NOT NULL,
	`trigger_source` text NOT NULL,
	`status` text NOT NULL,
	`run_ids_json` text DEFAULT '[]' NOT NULL,
	`safe_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_triggers_schedule_logical_uidx` ON `schedule_triggers` (`schedule_id`,`logical_trigger_at`);--> statement-breakpoint
CREATE INDEX `schedule_triggers_schedule_created_idx` ON `schedule_triggers` (`schedule_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `integrity_checks` ADD `backup_run_id` text REFERENCES backup_runs(id);--> statement-breakpoint
ALTER TABLE `integrity_checks` ADD `job_id` text REFERENCES jobs(id);--> statement-breakpoint
ALTER TABLE `integrity_checks` ADD `verification_strength` text DEFAULT 'LOCAL_SHA256' NOT NULL;--> statement-breakpoint
CREATE INDEX `integrity_checks_run_idx` ON `integrity_checks` (`backup_run_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `schedules` ADD `operation_kind` text DEFAULT 'BACKUP' NOT NULL;--> statement-breakpoint
ALTER TABLE `schedules` ADD `channel_id` text REFERENCES channels(id);--> statement-breakpoint
ALTER TABLE `schedules` ADD `catch_up` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `schedules` ADD `backup_on_startup` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `schedules` ADD `timezone` text DEFAULT 'Etc/UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE `schedules` ADD `task_status` text DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE `schedules` ADD `last_error_safe` text;--> statement-breakpoint
ALTER TABLE `schedules` ADD `last_reconciled_at` integer;
