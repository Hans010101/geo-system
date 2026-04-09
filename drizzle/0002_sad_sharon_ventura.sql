ALTER TABLE `collections` MODIFY COLUMN `platform` varchar(32) NOT NULL;--> statement-breakpoint
ALTER TABLE `platformConfigs` MODIFY COLUMN `platform` varchar(32) NOT NULL;--> statement-breakpoint
ALTER TABLE `platformConfigs` MODIFY COLUMN `modelVersion` varchar(128);--> statement-breakpoint
ALTER TABLE `platformConfigs` ADD `apiBaseUrl` text;