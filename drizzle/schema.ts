import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  boolean,
  json,
  bigint,
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
  brandLine: mysqlEnum("brandLine", ["sun_yuchen", "tron", "competitor"]).notNull(),
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
  language: mysqlEnum("language", ["zh-CN", "en-US"]).notNull(),
  status: mysqlEnum("status", ["active", "paused", "dynamic"]).default("active").notNull(),
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
  ]).notNull(),
  severity: mysqlEnum("severity", ["critical", "high", "medium", "low"]).notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  relatedCollectionId: int("relatedCollectionId"),
  relatedQuestionId: varchar("relatedQuestionId", { length: 32 }),
  relatedPlatform: varchar("relatedPlatform", { length: 32 }),
  isRead: boolean("isRead").default(false),
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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SchedulerConfig = typeof schedulerConfigs.$inferSelect;
export type InsertSchedulerConfig = typeof schedulerConfigs.$inferInsert;
