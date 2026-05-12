CREATE TABLE `sysConfigs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`configKey` varchar(64) NOT NULL,
	`configValue` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sysConfigs_id` PRIMARY KEY(`id`),
	CONSTRAINT `sysConfigs_configKey_unique` UNIQUE(`configKey`)
);
--> statement-breakpoint
ALTER TABLE `questions` MODIFY COLUMN `status` enum('active','paused','dynamic','archived') NOT NULL DEFAULT 'active';