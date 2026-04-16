CREATE TABLE `notificationConfigs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channel` enum('feishu','telegram','email') NOT NULL,
	`isEnabled` boolean NOT NULL DEFAULT false,
	`webhookUrl` text,
	`botToken` varchar(256),
	`chatId` varchar(64),
	`smtpHost` varchar(128),
	`smtpPort` int,
	`smtpUser` varchar(128),
	`smtpPass` varchar(256),
	`emailFrom` varchar(256),
	`emailTo` json,
	`minSeverity` enum('critical','high','medium','low') NOT NULL DEFAULT 'high',
	`silentStart` varchar(5) DEFAULT '23:00',
	`silentEnd` varchar(5) DEFAULT '08:00',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notificationConfigs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notificationLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channel` enum('feishu','telegram','email') NOT NULL,
	`alertId` int,
	`batchId` varchar(64),
	`messageType` enum('alert','batch_summary') NOT NULL DEFAULT 'alert',
	`title` varchar(256) NOT NULL,
	`content` text,
	`success` boolean NOT NULL,
	`errorMessage` text,
	`dedupKey` varchar(256),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notificationLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `isBanned` boolean DEFAULT false NOT NULL;