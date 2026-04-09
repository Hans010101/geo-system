CREATE TABLE `alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`alertType` enum('sentiment_drop','new_negative_source','coverage_decline','fact_missing') NOT NULL,
	`severity` enum('critical','high','medium','low') NOT NULL,
	`title` varchar(256) NOT NULL,
	`description` text,
	`relatedCollectionId` int,
	`relatedQuestionId` varchar(32),
	`relatedPlatform` varchar(32),
	`isRead` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `analyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`collectionId` int NOT NULL,
	`sentimentScore` int,
	`sentimentReasoning` text,
	`overallTone` enum('hostile','critical','neutral','favorable','promotional'),
	`keyFacts` json,
	`positivePoints` json,
	`negativePoints` json,
	`targetFactsCheck` json,
	`factualAccuracy` enum('accurate','inaccurate','unverifiable'),
	`inaccurateClaims` json,
	`analysisModel` varchar(64),
	`analyzedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `analyses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `citations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`collectionId` int NOT NULL,
	`url` text NOT NULL,
	`title` varchar(512),
	`domain` varchar(256),
	`position` int DEFAULT 0,
	`sourceType` enum('our_content','friendly','neutral','unfriendly','unknown') NOT NULL DEFAULT 'unknown',
	`isOurContent` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `citations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`questionId` varchar(32) NOT NULL,
	`questionText` text NOT NULL,
	`platform` enum('chatgpt','perplexity','gemini','wenxin','claude','copilot') NOT NULL,
	`language` enum('zh-CN','en-US') NOT NULL,
	`timestamp` bigint NOT NULL,
	`responseText` text,
	`responseLength` int DEFAULT 0,
	`hasSearch` boolean DEFAULT false,
	`modelVersion` varchar(64),
	`status` enum('success','failed','refused','timeout','pending') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`rawResponse` json,
	`batchId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `collections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ourContentUrls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`url` text NOT NULL,
	`title` varchar(512),
	`publishPlatform` varchar(128),
	`publishDate` timestamp,
	`contentType` enum('seo_article','wiki','zhihu_answer','official_page','media_report') DEFAULT 'seo_article',
	`isActive` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ourContentUrls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platformConfigs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform` enum('chatgpt','perplexity','gemini','wenxin','claude','copilot') NOT NULL,
	`displayName` varchar(64) NOT NULL,
	`isEnabled` boolean DEFAULT true,
	`apiKeyEncrypted` text,
	`modelVersion` varchar(64),
	`collectFrequency` varchar(32) DEFAULT 'weekly',
	`extraConfig` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `platformConfigs_id` PRIMARY KEY(`id`),
	CONSTRAINT `platformConfigs_platform_unique` UNIQUE(`platform`)
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`questionId` varchar(32) NOT NULL,
	`text` text NOT NULL,
	`brandLine` enum('sun_yuchen','tron','competitor') NOT NULL,
	`dimension` enum('awareness','evaluation','investment','compliance','comparison','ecosystem','usage','wealth','industry_status') NOT NULL,
	`language` enum('zh-CN','en-US') NOT NULL,
	`status` enum('active','paused','dynamic') NOT NULL DEFAULT 'active',
	`validFrom` timestamp,
	`validUntil` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `questions_id` PRIMARY KEY(`id`),
	CONSTRAINT `questions_questionId_unique` UNIQUE(`questionId`)
);
--> statement-breakpoint
CREATE TABLE `targetFacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`factKey` varchar(128) NOT NULL,
	`factDescription` text NOT NULL,
	`validFrom` timestamp,
	`isActive` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `targetFacts_id` PRIMARY KEY(`id`),
	CONSTRAINT `targetFacts_factKey_unique` UNIQUE(`factKey`)
);
--> statement-breakpoint
CREATE TABLE `urlMatchRules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pattern` varchar(512) NOT NULL,
	`sourceType` enum('our_content','friendly','neutral','unfriendly') NOT NULL,
	`description` varchar(256),
	`isActive` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `urlMatchRules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `weeklyReports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reportWeek` varchar(16) NOT NULL,
	`reportPeriod` varchar(64),
	`summaryMetrics` json,
	`platformBreakdown` json,
	`questionDetails` json,
	`citationAnalysis` json,
	`alertsSummary` json,
	`generatedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `weeklyReports_id` PRIMARY KEY(`id`),
	CONSTRAINT `weeklyReports_reportWeek_unique` UNIQUE(`reportWeek`)
);
