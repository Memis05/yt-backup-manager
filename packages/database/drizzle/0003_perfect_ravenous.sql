ALTER TABLE `accounts` ADD `connection_state` text DEFAULT 'CONNECTED' NOT NULL;--> statement-breakpoint
CREATE INDEX `account_channels_channel_idx` ON `account_channels` (`channel_id`);