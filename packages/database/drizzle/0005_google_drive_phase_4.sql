CREATE TABLE `drive_upload_sessions` (
	`job_id` text PRIMARY KEY NOT NULL,
	`destination_id` text NOT NULL,
	`media_copy_id` text NOT NULL,
	`parent_provider_object_id` text NOT NULL,
	`session_uri` text NOT NULL,
	`provider_file_id` text,
	`bytes_acknowledged` integer DEFAULT 0 NOT NULL,
	`expected_bytes` integer NOT NULL,
	`expected_sha256` text NOT NULL,
	`source_reference_json` text NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_copy_id`) REFERENCES `media_copies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `drive_upload_sessions_destination_idx` ON `drive_upload_sessions` (`destination_id`);--> statement-breakpoint
CREATE INDEX `drive_upload_sessions_copy_idx` ON `drive_upload_sessions` (`media_copy_id`);--> statement-breakpoint
CREATE TABLE `provider_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`destination_id` text NOT NULL,
	`logical_key` text NOT NULL,
	`object_type` text NOT NULL,
	`provider_object_id` text NOT NULL,
	`parent_provider_object_id` text,
	`current_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_objects_destination_key_uidx` ON `provider_objects` (`destination_id`,`logical_key`);--> statement-breakpoint
CREATE INDEX `provider_objects_provider_id_idx` ON `provider_objects` (`provider_object_id`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `drive_credential_ref` text;--> statement-breakpoint
ALTER TABLE `media_copies` ADD `verification_strength` text;--> statement-breakpoint
ALTER TABLE `media_copies` ADD `provider_metadata_json` text;