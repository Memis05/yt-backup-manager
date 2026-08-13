CREATE TABLE `recovery_drive_root_selections` (
	`session_id` text NOT NULL,
	`source_id` text NOT NULL,
	`provider_root_id` text NOT NULL,
	`selected` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `source_id`, `provider_root_id`),
	FOREIGN KEY (`session_id`) REFERENCES `recovery_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `recovery_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recovery_drive_root_selections_source_idx` ON `recovery_drive_root_selections` (`session_id`,`source_id`);