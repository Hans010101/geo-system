CREATE TABLE `schedulerConfigs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`cronExpression` varchar(64) NOT NULL DEFAULT '0 8 * * *',
	`concurrency` int NOT NULL DEFAULT 5,
	`lastRunAt` bigint,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `schedulerConfigs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(256);