-- Sentiment Monitor (舆情监控) Phase 1 schema.
-- NOTE: drizzle-kit generate also emitted ALTERs for questions.brandLine / alerts.status+dedupKey /
-- collections H1 telemetry cols / questions.coverageDimension — those were already applied to prod by
-- earlier commits (snapshot was stale), so they are intentionally omitted here to keep this migration
-- idempotent against the live DB. This file was applied to prod directly (CREATE TABLE IF NOT EXISTS +
-- guarded ADD COLUMN); see 舆情监控 Phase1 report.
CREATE TABLE `monitor_articles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`url` varchar(768) NOT NULL,
	`urlHash` varchar(64) NOT NULL,
	`domain` varchar(128),
	`title` varchar(512),
	`contentMd` mediumtext,
	`contentHash` varchar(64),
	`publishedAt` bigint,
	`firstSeenAt` bigint,
	`fetchMethod` enum('self','firecrawl','snippet_only'),
	`fetchStatus` enum('full','partial','failed'),
	`matchedKeywords` json,
	`sentimentScore` int,
	`relevance` enum('high','medium','low','irrelevant'),
	`threatLevel` enum('high','medium','low','none'),
	`analysisSummary` text,
	`analyzedAt` bigint,
	`promptTokens` int,
	`completionTokens` int,
	`costUsd` decimal(10,6),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `monitor_articles_id` PRIMARY KEY(`id`),
	CONSTRAINT `monitor_articles_url_unique` UNIQUE(`url`)
);
--> statement-breakpoint
CREATE TABLE `monitor_keywords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keyword` varchar(128) NOT NULL,
	`keywordGroup` varchar(32),
	`searchFreq` enum('hourly','daily') NOT NULL DEFAULT 'daily',
	`isActive` boolean NOT NULL DEFAULT true,
	`priority` int NOT NULL DEFAULT 5,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monitor_keywords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monitor_source_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`domain` varchar(128) NOT NULL,
	`authorityLevel` int NOT NULL DEFAULT 5,
	`stance` enum('hostile','neutral','friendly') NOT NULL DEFAULT 'neutral',
	`notes` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monitor_source_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `monitor_source_rules_domain_unique` UNIQUE(`domain`)
);
--> statement-breakpoint
ALTER TABLE `schedulerConfigs` ADD `monitorEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `schedulerConfigs` ADD `monitorCron` varchar(64) DEFAULT '0 9,21 * * *' NOT NULL;--> statement-breakpoint
ALTER TABLE `schedulerConfigs` ADD `monitorLastRunAt` bigint;--> statement-breakpoint
CREATE INDEX `monitor_articles_urlHash_idx` ON `monitor_articles` (`urlHash`);--> statement-breakpoint
CREATE INDEX `monitor_articles_domain_idx` ON `monitor_articles` (`domain`);