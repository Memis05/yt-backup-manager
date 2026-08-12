CREATE TABLE `account_channels` (
	`account_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`relationship_metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `channel_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text,
	`email` text,
	`display_name` text,
	`avatar_url` text,
	`credential_ref` text NOT NULL,
	`capabilities_json` text DEFAULT '{}' NOT NULL,
	`connected_at` integer NOT NULL,
	`last_auth_at` integer,
	`last_error_code` text,
	`last_error_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_provider_account_uidx` ON `accounts` (`provider`,`provider_account_id`) WHERE "accounts"."provider_account_id" is not null;--> statement-breakpoint
CREATE INDEX `accounts_email_idx` ON `accounts` (`email`);--> statement-breakpoint
CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`severity` text DEFAULT 'INFO' NOT NULL,
	`account_id` text,
	`channel_id` text,
	`media_item_id` text,
	`playlist_id` text,
	`destination_id` text,
	`backup_run_id` text,
	`job_id` text,
	`summary` text NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`backup_run_id`) REFERENCES `backup_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_log_created_idx` ON `activity_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `activity_log_channel_created_idx` ON `activity_log` (`channel_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_log_media_created_idx` ON `activity_log` (`media_item_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_log_severity_created_idx` ON `activity_log` (`severity`,`created_at`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `backup_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text,
	`trigger_type` text NOT NULL,
	`status` text NOT NULL,
	`effective_config_json` text NOT NULL,
	`discovered_count` integer DEFAULT 0 NOT NULL,
	`downloaded_count` integer DEFAULT 0 NOT NULL,
	`local_copy_count` integer DEFAULT 0 NOT NULL,
	`drive_upload_count` integer DEFAULT 0 NOT NULL,
	`metadata_update_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`bytes_downloaded` integer DEFAULT 0 NOT NULL,
	`bytes_transferred` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `backup_runs_channel_created_idx` ON `backup_runs` (`channel_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `backup_runs_status_idx` ON `backup_runs` (`status`);--> statement-breakpoint
CREATE TABLE `channel_destinations` (
	`channel_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`channel_id`, `destination_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `channel_settings` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`quality_profile_override` text,
	`schedule_id_override` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`schedule_id_override`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`source_provider` text NOT NULL,
	`provider_channel_id` text NOT NULL,
	`title` text NOT NULL,
	`handle` text,
	`thumbnail_url` text,
	`backup_enabled` integer DEFAULT false NOT NULL,
	`source_status` text DEFAULT 'AVAILABLE' NOT NULL,
	`published_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer,
	`last_sync_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channels_provider_channel_uidx` ON `channels` (`source_provider`,`provider_channel_id`);--> statement-breakpoint
CREATE TABLE `default_destinations` (
	`destination_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `destinations` (
	`id` text PRIMARY KEY NOT NULL,
	`destination_type` text NOT NULL,
	`account_id` text,
	`root_path` text,
	`provider_root_id` text,
	`volume_guid` text,
	`volume_serial` text,
	`filesystem_type` text,
	`last_known_mount_path` text,
	`credential_ref` text,
	`enabled` integer DEFAULT true NOT NULL,
	`availability_status` text DEFAULT 'UNKNOWN' NOT NULL,
	`last_probe_at` integer,
	`last_error_code` text,
	`last_error_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `destinations_type_idx` ON `destinations` (`destination_type`);--> statement-breakpoint
CREATE INDEX `destinations_account_idx` ON `destinations` (`account_id`);--> statement-breakpoint
CREATE INDEX `destinations_volume_guid_idx` ON `destinations` (`volume_guid`);--> statement-breakpoint
CREATE INDEX `destinations_volume_serial_idx` ON `destinations` (`volume_serial`);--> statement-breakpoint
CREATE TABLE `global_backup_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`default_quality_profile` text NOT NULL,
	`default_schedule_id` text,
	`default_concurrent_downloads` integer NOT NULL,
	`default_concurrent_local_copies` integer NOT NULL,
	`default_concurrent_drive_uploads` integer NOT NULL,
	`download_bandwidth_limit` integer,
	`upload_bandwidth_limit` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`default_schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "global_backup_settings_singleton_check" CHECK("global_backup_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `integrity_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`media_copy_id` text,
	`media_artifact_id` text,
	`destination_id` text NOT NULL,
	`expected_sha256` text,
	`actual_sha256` text,
	`expected_bytes` integer,
	`actual_bytes` integer,
	`result` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`error_code` text,
	`error_message_safe` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`media_copy_id`) REFERENCES `media_copies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_artifact_id`) REFERENCES `media_artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "integrity_checks_one_target_check" CHECK(("integrity_checks"."media_copy_id" is not null) <> ("integrity_checks"."media_artifact_id" is not null))
);
--> statement-breakpoint
CREATE INDEX `integrity_checks_destination_created_idx` ON `integrity_checks` (`destination_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `integrity_checks_copy_created_idx` ON `integrity_checks` (`media_copy_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `job_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`worker_instance_id` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`result_status` text,
	`error_code` text,
	`error_message_safe` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `job_dependencies` (
	`job_id` text NOT NULL,
	`depends_on_job_id` text NOT NULL,
	PRIMARY KEY(`job_id`, `depends_on_job_id`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "job_dependencies_not_self_check" CHECK("job_dependencies"."job_id" <> "job_dependencies"."depends_on_job_id")
);
--> statement-breakpoint
CREATE INDEX `job_dependencies_depends_on_idx` ON `job_dependencies` (`depends_on_job_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`backup_run_id` text,
	`channel_id` text,
	`media_item_id` text,
	`destination_id` text,
	`job_type` text NOT NULL,
	`status` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`next_retry_at` integer,
	`progress_ratio` real,
	`bytes_processed` integer DEFAULT 0 NOT NULL,
	`bytes_total` integer,
	`speed_bytes_per_sec` integer,
	`eta_seconds` integer,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`result_json` text,
	`idempotency_key` text NOT NULL,
	`lock_owner` text,
	`lease_until` integer,
	`last_heartbeat_at` integer,
	`error_code` text,
	`error_message_safe` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`backup_run_id`) REFERENCES `backup_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_idempotency_uidx` ON `jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `jobs_queue_idx` ON `jobs` (`status`,`next_retry_at`,`priority`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_run_status_idx` ON `jobs` (`backup_run_id`,`status`);--> statement-breakpoint
CREATE INDEX `jobs_media_status_idx` ON `jobs` (`media_item_id`,`status`);--> statement-breakpoint
CREATE INDEX `jobs_destination_status_idx` ON `jobs` (`destination_id`,`status`);--> statement-breakpoint
CREATE INDEX `jobs_lease_idx` ON `jobs` (`lease_until`);--> statement-breakpoint
CREATE TABLE `media_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`media_item_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`artifact_type` text NOT NULL,
	`relative_path` text,
	`provider_file_id` text,
	`bytes` integer,
	`sha256` text,
	`status` text NOT NULL,
	`verified_at` integer,
	`last_checked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_artifacts_item_destination_type_uidx` ON `media_artifacts` (`media_item_id`,`destination_id`,`artifact_type`);--> statement-breakpoint
CREATE TABLE `media_copies` (
	`id` text PRIMARY KEY NOT NULL,
	`media_item_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`relative_path` text,
	`provider_file_id` text,
	`container` text,
	`video_codec` text,
	`audio_codec` text,
	`width` integer,
	`height` integer,
	`fps` real,
	`bytes` integer,
	`sha256` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`verified_at` integer,
	`last_checked_at` integer,
	`missing_since` integer,
	`corrupt_since` integer,
	`last_error_code` text,
	`last_error_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_copies_media_destination_uidx` ON `media_copies` (`media_item_id`,`destination_id`);--> statement-breakpoint
CREATE INDEX `media_copies_destination_status_idx` ON `media_copies` (`destination_id`,`status`);--> statement-breakpoint
CREATE INDEX `media_copies_media_status_idx` ON `media_copies` (`media_item_id`,`status`);--> statement-breakpoint
CREATE INDEX `media_copies_status_idx` ON `media_copies` (`status`);--> statement-breakpoint
CREATE INDEX `media_copies_provider_file_idx` ON `media_copies` (`provider_file_id`);--> statement-breakpoint
CREATE TABLE `media_items` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`source_provider` text NOT NULL,
	`provider_media_id` text NOT NULL,
	`media_type` text NOT NULL,
	`title` text NOT NULL,
	`original_title` text NOT NULL,
	`source_url` text NOT NULL,
	`visibility` text,
	`source_status` text DEFAULT 'AVAILABLE' NOT NULL,
	`published_at` integer,
	`duration_seconds` integer,
	`thumbnail_url` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer,
	`removed_at` integer,
	`metadata_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_items_provider_media_uidx` ON `media_items` (`source_provider`,`provider_media_id`);--> statement-breakpoint
CREATE INDEX `media_items_channel_published_idx` ON `media_items` (`channel_id`,`published_at`);--> statement-breakpoint
CREATE INDEX `media_items_channel_type_idx` ON `media_items` (`channel_id`,`media_type`);--> statement-breakpoint
CREATE INDEX `media_items_source_status_idx` ON `media_items` (`source_status`);--> statement-breakpoint
CREATE INDEX `media_items_last_seen_idx` ON `media_items` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE `media_metadata_history` (
	`id` text PRIMARY KEY NOT NULL,
	`media_item_id` text NOT NULL,
	`change_type` text NOT NULL,
	`old_value_json` text,
	`new_value_json` text NOT NULL,
	`captured_at` integer NOT NULL,
	`backup_run_id` text,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`backup_run_id`) REFERENCES `backup_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `media_metadata_history_item_captured_idx` ON `media_metadata_history` (`media_item_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `playlist_items` (
	`playlist_id` text NOT NULL,
	`media_item_id` text NOT NULL,
	`position` integer,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`playlist_id`, `media_item_id`),
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`source_provider` text NOT NULL,
	`provider_playlist_id` text NOT NULL,
	`title` text NOT NULL,
	`source_status` text DEFAULT 'AVAILABLE' NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer,
	`removed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playlists_provider_playlist_uidx` ON `playlists` (`source_provider`,`provider_playlist_id`);--> statement-breakpoint
CREATE INDEX `playlists_channel_idx` ON `playlists` (`channel_id`);--> statement-breakpoint
CREATE INDEX `playlists_source_status_idx` ON `playlists` (`source_status`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_type` text NOT NULL,
	`config_json` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`windows_task_id` text,
	`last_triggered_at` integer,
	`next_expected_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staging_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`media_item_id` text NOT NULL,
	`job_id` text,
	`artifact_type` text NOT NULL,
	`path` text NOT NULL,
	`bytes` integer,
	`sha256` text,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
