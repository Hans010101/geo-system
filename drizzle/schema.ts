import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  mediumtext,
  timestamp,
  varchar,
  boolean,
  json,
  bigint,
  decimal,
  index,
} from "drizzle-orm/mysql-core";

// ==================== Users ====================
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("passwordHash", { length: 256 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", "developer"]).default("user").notNull(),
  isBanned: boolean("isBanned").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ==================== Questions (问题库) ====================
export const questions = mysqlTable("questions", {
  id: int("id").autoincrement().primaryKey(),
  questionId: varchar("questionId", { length: 32 }).notNull().unique(),
  text: text("text").notNull(),
  brandLine: mysqlEnum("brandLine", [
    "sun_yuchen", "tron", "competitor",  // legacy lines (archived questions)
    "syc_emo", "tron_emo", "tron_rec", "syc_rec",  // v3 lines: 情绪类 / 推荐类
  ]).notNull(),
  dimension: mysqlEnum("dimension", [
    "awareness",
    "evaluation",
    "investment",
    "compliance",
    "comparison",
    "ecosystem",
    "usage",
    "wealth",
    "industry_status",
  ]).notNull(),
  // Free-form 2nd-axis tag for v3 question bank (覆盖维度). Optional, supplements `dimension`.
  coverageDimension: varchar("coverageDimension", { length: 64 }),
  language: mysqlEnum("language", ["zh-CN", "en-US"]).notNull(),
  status: mysqlEnum("status", ["active", "paused", "dynamic", "archived"]).default("active").notNull(),
  validFrom: timestamp("validFrom"),
  validUntil: timestamp("validUntil"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Question = typeof questions.$inferSelect;
export type InsertQuestion = typeof questions.$inferInsert;

// ==================== Collections (采集记录) ====================
// Use varchar for platform to support dynamic platform list
export const collections = mysqlTable("collections", {
  id: int("id").autoincrement().primaryKey(),
  questionId: varchar("questionId", { length: 32 }).notNull(),
  questionText: text("questionText").notNull(),
  platform: varchar("platform", { length: 32 }).notNull(),
  language: mysqlEnum("language", ["zh-CN", "en-US"]).notNull(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  responseText: text("responseText"),
  responseLength: int("responseLength").default(0),
  hasSearch: boolean("hasSearch").default(false),
  modelVersion: varchar("modelVersion", { length: 64 }),
  status: mysqlEnum("status", ["success", "failed", "refused", "timeout", "pending"])
    .default("pending")
    .notNull(),
  errorMessage: text("errorMessage"),
  rawResponse: json("rawResponse"),
  batchId: varchar("batchId", { length: 64 }),
  // H1 telemetry (2026-06): identify provider + actual model + token consumption + perf/cost
  provider: varchar("provider", { length: 32 }),       // 'openrouter' | 'bai' | 'bailian' | 'platform' | null
  realModel: varchar("realModel", { length: 128 }),    // model id echoed back by the API (data.model)
  promptTokens: int("promptTokens"),
  completionTokens: int("completionTokens"),
  totalTokens: int("totalTokens"),
  latencyMs: int("latencyMs"),
  costUsd: decimal("costUsd", { precision: 10, scale: 6 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Collection = typeof collections.$inferSelect;
export type InsertCollection = typeof collections.$inferInsert;

// ==================== Citations (引用源) ====================
export const citations = mysqlTable("citations", {
  id: int("id").autoincrement().primaryKey(),
  collectionId: int("collectionId").notNull(),
  url: text("url").notNull(),
  title: varchar("title", { length: 512 }),
  domain: varchar("domain", { length: 256 }),
  position: int("position").default(0),
  sourceType: mysqlEnum("sourceType", [
    "our_content",
    "friendly",
    "neutral",
    "unfriendly",
    "unknown",
  ]).default("unknown").notNull(),
  isOurContent: boolean("isOurContent").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Citation = typeof citations.$inferSelect;
export type InsertCitation = typeof citations.$inferInsert;

// ==================== Analyses (分析结果) ====================
export const analyses = mysqlTable("analyses", {
  id: int("id").autoincrement().primaryKey(),
  collectionId: int("collectionId").notNull(),
  sentimentScore: int("sentimentScore"),
  sentimentReasoning: text("sentimentReasoning"),
  overallTone: mysqlEnum("overallTone", [
    "hostile",
    "critical",
    "neutral",
    "favorable",
    "promotional",
  ]),
  keyFacts: json("keyFacts"),
  positivePoints: json("positivePoints"),
  negativePoints: json("negativePoints"),
  targetFactsCheck: json("targetFactsCheck"),
  factualAccuracy: mysqlEnum("factualAccuracy", ["accurate", "inaccurate", "unverifiable"]),
  inaccurateClaims: json("inaccurateClaims"),
  analysisModel: varchar("analysisModel", { length: 64 }),
  analyzedAt: bigint("analyzedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Analysis = typeof analyses.$inferSelect;
export type InsertAnalysis = typeof analyses.$inferInsert;

// ==================== Our Content URLs (己方内容URL库) ====================
export const ourContentUrls = mysqlTable("ourContentUrls", {
  id: int("id").autoincrement().primaryKey(),
  url: text("url").notNull(),
  title: varchar("title", { length: 512 }),
  publishPlatform: varchar("publishPlatform", { length: 128 }),
  publishDate: timestamp("publishDate"),
  contentType: mysqlEnum("contentType", [
    "seo_article",
    "wiki",
    "zhihu_answer",
    "official_page",
    "media_report",
  ]).default("seo_article"),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OurContentUrl = typeof ourContentUrls.$inferSelect;
export type InsertOurContentUrl = typeof ourContentUrls.$inferInsert;

// ==================== Target Facts (目标事实配置) ====================
export const targetFacts = mysqlTable("targetFacts", {
  id: int("id").autoincrement().primaryKey(),
  factKey: varchar("factKey", { length: 128 }).notNull().unique(),
  factDescription: text("factDescription").notNull(),
  validFrom: timestamp("validFrom"),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TargetFact = typeof targetFacts.$inferSelect;
export type InsertTargetFact = typeof targetFacts.$inferInsert;

// ==================== Alerts (预警记录) ====================
export const alerts = mysqlTable("alerts", {
  id: int("id").autoincrement().primaryKey(),
  alertType: mysqlEnum("alertType", [
    "sentiment_drop",
    "new_negative_source",
    "coverage_decline",
    "fact_missing",
    "negative_article",
  ]).notNull(),
  severity: mysqlEnum("severity", ["critical", "high", "medium", "low"]).notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  relatedCollectionId: int("relatedCollectionId"),
  relatedQuestionId: varchar("relatedQuestionId", { length: 32 }),
  relatedPlatform: varchar("relatedPlatform", { length: 32 }),
  isRead: boolean("isRead").default(false),
  // H2 (2026-06): workflow status + dedup key for cross-process de-duplication
  status: mysqlEnum("status", ["active", "resolved", "dismissed"]).default("active").notNull(),
  dedupKey: varchar("dedupKey", { length: 256 }),  // `${qid}:${platform}:${alertType}`
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = typeof alerts.$inferInsert;

// ==================== Platform Configs (平台配置) ====================
// Use varchar for platform to support dynamic platform list
export const platformConfigs = mysqlTable("platformConfigs", {
  id: int("id").autoincrement().primaryKey(),
  platform: varchar("platform", { length: 32 }).notNull().unique(),
  displayName: varchar("displayName", { length: 64 }).notNull(),
  isEnabled: boolean("isEnabled").default(true),
  apiKeyEncrypted: text("apiKeyEncrypted"),
  apiBaseUrl: text("apiBaseUrl"), // NEW: API base URL for OpenRouter/百炼 etc.
  modelVersion: varchar("modelVersion", { length: 128 }),
  collectFrequency: varchar("collectFrequency", { length: 32 }).default("weekly"),
  extraConfig: json("extraConfig"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PlatformConfig = typeof platformConfigs.$inferSelect;
export type InsertPlatformConfig = typeof platformConfigs.$inferInsert;

// ==================== Weekly Reports (周报) ====================
export const weeklyReports = mysqlTable("weeklyReports", {
  id: int("id").autoincrement().primaryKey(),
  reportWeek: varchar("reportWeek", { length: 16 }).notNull().unique(),
  reportPeriod: varchar("reportPeriod", { length: 64 }),
  summaryMetrics: json("summaryMetrics"),
  platformBreakdown: json("platformBreakdown"),
  questionDetails: json("questionDetails"),
  citationAnalysis: json("citationAnalysis"),
  alertsSummary: json("alertsSummary"),
  generatedAt: bigint("generatedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WeeklyReport = typeof weeklyReports.$inferSelect;
export type InsertWeeklyReport = typeof weeklyReports.$inferInsert;

// ==================== Global API Keys (全局聚合平台API配置) ====================
export const globalApiKeys = mysqlTable("globalApiKeys", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 64 }).notNull(), // e.g. "阿里百炼", "OpenRouter"
  apiKey: text("apiKey"), // encrypted/stored API key
  baseUrl: text("baseUrl"), // e.g. https://dashscope.aliyuncs.com/compatible-mode/v1
  coveredPlatforms: json("coveredPlatforms"), // string[] of platform keys this key covers
  isActive: boolean("isActive").default(true),
  sortOrder: int("sortOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type GlobalApiKey = typeof globalApiKeys.$inferSelect;
export type InsertGlobalApiKey = typeof globalApiKeys.$inferInsert;

// ==================== URL Match Rules (域名通配规则) ====================
export const urlMatchRules = mysqlTable("urlMatchRules", {
  id: int("id").autoincrement().primaryKey(),
  pattern: varchar("pattern", { length: 512 }).notNull(),
  sourceType: mysqlEnum("sourceType", [
    "our_content",
    "friendly",
    "neutral",
    "unfriendly",
  ]).notNull(),
  description: varchar("description", { length: 256 }),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UrlMatchRule = typeof urlMatchRules.$inferSelect;
export type InsertUrlMatchRule = typeof urlMatchRules.$inferInsert;

// ==================== Scheduler Configs (定时采集配置持久化) ====================
export const schedulerConfigs = mysqlTable("schedulerConfigs", {
  id: int("id").autoincrement().primaryKey(),
  enabled: boolean("enabled").default(false).notNull(),
  cronExpression: varchar("cronExpression", { length: 64 }).default("0 8 * * *").notNull(),
  concurrency: int("concurrency").default(5).notNull(),
  lastRunAt: bigint("lastRunAt", { mode: "number" }),
  // Sentiment monitor scheduler (Phase 1, 2026-07): independent toggle, default OFF until verified.
  monitorEnabled: boolean("monitorEnabled").default(false).notNull(),
  monitorCron: varchar("monitorCron", { length: 64 }).default("0 9,21 * * *").notNull(),
  monitorLastRunAt: bigint("monitorLastRunAt", { mode: "number" }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SchedulerConfig = typeof schedulerConfigs.$inferSelect;
export type InsertSchedulerConfig = typeof schedulerConfigs.$inferInsert;

// ==================== Notification Configs (通知渠道配置) ====================
export const notificationConfigs = mysqlTable("notificationConfigs", {
  id: int("id").autoincrement().primaryKey(),
  channel: mysqlEnum("channel", ["feishu", "telegram", "email"]).notNull(),
  isEnabled: boolean("isEnabled").default(false).notNull(),
  webhookUrl: text("webhookUrl"),
  botToken: varchar("botToken", { length: 256 }),
  chatId: varchar("chatId", { length: 64 }),
  smtpHost: varchar("smtpHost", { length: 128 }),
  smtpPort: int("smtpPort"),
  smtpUser: varchar("smtpUser", { length: 128 }),
  smtpPass: varchar("smtpPass", { length: 256 }),
  emailFrom: varchar("emailFrom", { length: 256 }),
  emailTo: json("emailTo"),
  minSeverity: mysqlEnum("minSeverity", ["critical", "high", "medium", "low"]).default("high").notNull(),
  silentStart: varchar("silentStart", { length: 5 }).default("23:00"),
  silentEnd: varchar("silentEnd", { length: 5 }).default("08:00"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NotificationConfig = typeof notificationConfigs.$inferSelect;
export type InsertNotificationConfig = typeof notificationConfigs.$inferInsert;

// ==================== Notification Logs (推送日志) ====================
export const notificationLogs = mysqlTable("notificationLogs", {
  id: int("id").autoincrement().primaryKey(),
  channel: mysqlEnum("channel", ["feishu", "telegram", "email"]).notNull(),
  alertId: int("alertId"),
  batchId: varchar("batchId", { length: 64 }),
  messageType: mysqlEnum("messageType", ["alert", "batch_summary"]).default("alert").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  content: text("content"),
  success: boolean("success").notNull(),
  errorMessage: text("errorMessage"),
  dedupKey: varchar("dedupKey", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type NotificationLog = typeof notificationLogs.$inferSelect;
export type InsertNotificationLog = typeof notificationLogs.$inferInsert;

// ==================== System Configs (单例 key-value 配置) ====================
// Generic key-value store for system-level singletons.
// Current keys in use:
//   - "llm_primary_provider": "bai" | "openrouter" (default "bai")
export const sysConfigs = mysqlTable("sysConfigs", {
  id: int("id").autoincrement().primaryKey(),
  configKey: varchar("configKey", { length: 64 }).notNull().unique(),
  configValue: text("configValue"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SysConfig = typeof sysConfigs.$inferSelect;
export type InsertSysConfig = typeof sysConfigs.$inferInsert;

// ==================== Sentiment Monitor (舆情监控 Phase 1, 2026-07) ====================
// Keywords to search for on each monitor cycle (Serper news).
export const monitorKeywords = mysqlTable("monitor_keywords", {
  id: int("id").autoincrement().primaryKey(),
  keyword: varchar("keyword", { length: 128 }).notNull(),
  keywordGroup: varchar("keywordGroup", { length: 32 }), // e.g. 'syc' | 'tron' | 'competitor'
  searchFreq: mysqlEnum("searchFreq", ["hourly", "daily"]).default("daily").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  priority: int("priority").default(5).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MonitorKeyword = typeof monitorKeywords.$inferSelect;
export type InsertMonitorKeyword = typeof monitorKeywords.$inferInsert;

// Discovered + fetched + analyzed articles. url UNIQUE for dedup; urlHash = sha256(normalized url).
// Time fields are bigint epoch-ms to match analyses.analyzedAt / collections.timestamp.
export const monitorArticles = mysqlTable(
  "monitor_articles",
  {
    id: int("id").autoincrement().primaryKey(),
    url: varchar("url", { length: 768 }).notNull().unique(),
    urlHash: varchar("urlHash", { length: 64 }).notNull(),
    domain: varchar("domain", { length: 128 }),
    title: varchar("title", { length: 512 }),
    contentMd: mediumtext("contentMd"),
    contentHash: varchar("contentHash", { length: 64 }),
    publishedAt: bigint("publishedAt", { mode: "number" }), // best-effort parse of Serper date
    firstSeenAt: bigint("firstSeenAt", { mode: "number" }), // when we discovered it
    fetchMethod: mysqlEnum("fetchMethod", ["self", "firecrawl", "snippet_only"]),
    fetchStatus: mysqlEnum("fetchStatus", ["full", "partial", "failed"]),
    fetchEngine: varchar("fetchEngine", { length: 16 }), // pluggable engine name: 'self'|'firecrawl'|'snippet'|'binance_api'|(future) — varchar, not enum, so new engines need no migration
    sourcePlatform: varchar("sourcePlatform", { length: 32 }), // discovery source: 'web'(serper) | 'binance_square' | (future 'x'|'reddit')
    matchedKeywords: json("matchedKeywords"), // string[] of keywords that surfaced this url
    sentimentScore: int("sentimentScore"), // 1-5, DeepSeek
    relevance: mysqlEnum("relevance", ["high", "medium", "low", "irrelevant"]),
    relevanceReason: varchar("relevanceReason", { length: 512 }), // one-line why this relevance level (核查用)
    threatLevel: mysqlEnum("threatLevel", ["high", "medium", "low", "none"]),
    analysisSummary: text("analysisSummary"),
    analyzedAt: bigint("analyzedAt", { mode: "number" }),
    // Cost/token telemetry — mirrors collections.* (H1 pattern)
    promptTokens: int("promptTokens"),
    completionTokens: int("completionTokens"),
    costUsd: decimal("costUsd", { precision: 10, scale: 6 }), // analysis (LLM) cost
    fetchCostUsd: decimal("fetchCostUsd", { precision: 10, scale: 6 }).default("0"), // fetch cost: L1=0, L4=firecrawl credit折算
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("monitor_articles_urlHash_idx").on(table.urlHash),
    index("monitor_articles_domain_idx").on(table.domain),
  ]
);

export type MonitorArticle = typeof monitorArticles.$inferSelect;
export type InsertMonitorArticle = typeof monitorArticles.$inferInsert;

// Per-domain authority + stance, used to weight threat level. Seeded from GEO citation analysis.
export const monitorSourceRules = mysqlTable("monitor_source_rules", {
  id: int("id").autoincrement().primaryKey(),
  domain: varchar("domain", { length: 128 }).notNull().unique(),
  authorityLevel: int("authorityLevel").default(5).notNull(), // 1-10
  stance: mysqlEnum("stance", ["hostile", "neutral", "friendly"]).default("neutral").notNull(),
  notes: varchar("notes", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MonitorSourceRule = typeof monitorSourceRules.$inferSelect;
export type InsertMonitorSourceRule = typeof monitorSourceRules.$inferInsert;
