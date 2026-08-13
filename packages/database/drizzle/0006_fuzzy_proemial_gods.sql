CREATE TABLE `recovery_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source_id` text NOT NULL,
	`provider_root_id` text,
	`provider_media_id` text NOT NULL,
	`artifact_type` text NOT NULL,
	`relative_path` text,
	`provider_file_id` text,
	`bytes` integer,
	`sha256` text,
	`status` text NOT NULL,
	`metadata_updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `recovery_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `recovery_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recovery_artifacts_media_idx` ON `recovery_artifacts` (`session_id`,`provider_media_id`);--> statement-breakpoint
CREATE TABLE `recovery_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source_id` text NOT NULL,
	`source_provider` text NOT NULL,
	`provider_channel_id` text NOT NULL,
	`title` text NOT NULL,
	`source_status` text NOT NULL,
	`published_at` integer,
	`last_seen_at` integer,
	`metadata_updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `recovery_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `recovery_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_channels_session_source_provider_uidx` ON `recovery_channels` (`session_id`,`source_id`,`source_provider`,`provider_channel_id`);--> statement-breakpoint
CREATE INDEX `recovery_channels_identity_idx` ON `recovery_channels` (`session_id`,`source_provider`,`provider_channel_id`);--> statement-breakpoint
CREATE TABLE `recovery_copies` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source_id` text NOT NULL,
	`provider_root_id` text,
	`source_provider` text NOT NULL,
	`provider_media_id` text NOT NULL,
	`destination_type` text NOT NULL,
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
	`quality_profile` text,
	`content_generation` text,
	`verification_strength` text,
	`status` text NOT NULL,
	`verified_at` integer,
	`metadata_updated_at` integer NOT NULL,
	`provider_metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `recovery_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `recovery_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recovery_copies_identity_idx` ON `recovery_copies` (`session_id`,`source_provider`,`provider_media_id`);--> statement-breakpoint
CREATE INDEX `recovery_copies_destination_idx` ON `recovery_copies` (`session_id`,`destination_type`,`source_id`,`provider_root_id`);--> statement-breakpoint
CREATE TABLE `recovery_drive_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source_id` text NOT NULL,
	`provider_object_id` text NOT NULL,
	`parent_provider_object_id` text,
	`current_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`bytes` integer,
	`modified_at` integer,
	`logical_key` text,
	`object_type` text,
	`app_properties_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `recovery_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `recovery_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_drive_objects_session_source_provider_uidx` ON `recovery_drive_objects` (`session_id`,`source_id`,`provider_object_id`);--> statement-breakpoint
CREATE INDEX `recovery_drive_objects_parent_idx` ON `recovery_drive_objects` (`session_id`,`source_id`,`parent_provider_object_id`);--> statement-breakpoint
CREATE INDEX `recovery_drive_objects_logical_key_idx` ON `recovery_drive_objects` (`session_id`,`source_id`,`logical_key`);--> statement-breakpoint
CREATE TABLE `recovery_media` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source_id` text NOT NULL,
	`source_provider` text NOT NULL,
	`provider_channel_id` text NOT NULL,
	`provider_media_id` text NOT NULL,
	`media_type` text NOT NULL,
	`title` text NOT NULL,
	`original_title` text NOT NULL,
	`source_url` text NOT NULL,
	`source_status` text NOT NULL,
	`published_at` integer,
	`duration_seconds` integer,
	`thumbnail_url` text,
	`metadata_updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `recovery_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `recovery_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_media_session_source_provider_uidx` ON `recovery_media` (`session_id`,`source_id`,`source_provider`,`provider_media_id`);--> statement-breakpoint
CREATE INDEX `recovery_media_identity_idx` ON `recovery_media` (`session_id`,`source_provider`,`provider_media_id`);--> statement-breakpoint
CREATE TABLE `recovery_playlist_items` (
	`session_id` text NOT NULL,
	`source_id` text NOT NULL,
	`provider_playlist_id` text NOT NULL,
	`provider_media_id` text NOT NULL,
	`position` integer,
	`metadata_updated_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `source_id`, `provider_playlist_id`, `provider_media_id`),
	FOREIGN KEY (`session_id`) REFERENCES `recovery_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `recovery_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recovery_playlist_items_playlist_idx` ON `recovery_playlist_items` (`session_id`,`provider_playlist_id`);--> statement-breakpoint
CREATE TABLE `recovery_playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source_id` text NOT NULL,
	`source_provider` text NOT NULL,
	`provider_channel_id` text NOT NULL,
	`provider_playlist_id` text NOT NULL,
	`title` text NOT NULL,
	`source_status` text NOT NULL,
	`metadata_updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `recovery_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `recovery_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_playlists_session_source_provider_uidx` ON `recovery_playlists` (`session_id`,`source_id`,`source_provider`,`provider_playlist_id`);--> statement-breakpoint
CREATE INDEX `recovery_playlists_identity_idx` ON `recovery_playlists` (`session_id`,`source_provider`,`provider_playlist_id`);--> statement-breakpoint
CREATE TABLE `recovery_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`progress_phase` text,
	`progress_processed` integer DEFAULT 0 NOT NULL,
	`progress_total` integer,
	`error_message_safe` text,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recovery_sessions_status_updated_idx` ON `recovery_sessions` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `recovery_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source_type` text NOT NULL,
	`status` text NOT NULL,
	`label` text NOT NULL,
	`root_path` text,
	`account_id` text,
	`volume_guid` text,
	`volume_serial` text,
	`filesystem_type` text,
	`last_known_mount_path` text,
	`discovered_root_count` integer DEFAULT 0 NOT NULL,
	`error_message_safe` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `recovery_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recovery_sources_session_idx` ON `recovery_sources` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `recovery_sources_account_idx` ON `recovery_sources` (`account_id`);--> statement-breakpoint
CREATE TABLE `recovery_warnings` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source_id` text,
	`code` text NOT NULL,
	`entity_key` text,
	`message_safe` text NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `recovery_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `recovery_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recovery_warnings_session_code_idx` ON `recovery_warnings` (`session_id`,`code`,`created_at`);