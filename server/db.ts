import { eq, desc, asc, and, gte, lte, sql, inArray, like, count, avg } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  questions,
  collections,
  citations,
  analyses,
  ourContentUrls,
  targetFacts,
  alerts,
  platformConfigs,
  weeklyReports,
  urlMatchRules,
  globalApiKeys,
  schedulerConfigs,
  notificationConfigs,
  notificationLogs,
  sysConfigs,
  monitorKeywords,
  monitorArticles,
  monitorSourceRules,
  type InsertQuestion,
  type InsertCollection,
  type InsertCitation,
  type InsertAnalysis,
  type InsertOurContentUrl,
  type InsertTargetFact,
  type InsertAlert,
  type InsertPlatformConfig,
  type InsertWeeklyReport,
  type InsertUrlMatchRule,
  type InsertGlobalApiKey,
  type InsertSchedulerConfig,
  type InsertNotificationConfig,
  type InsertNotificationLog,
  type InsertMonitorKeyword,
  type InsertMonitorArticle,
} from "../drizzle/schema";


let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const rawUrl = process.env.DATABASE_URL;
      // mysql2 URL parser ignores ?socketPath=, so parse it manually
      const url = new URL(rawUrl);
      const socketPath = url.searchParams.get("socketPath");
      if (socketPath) {
        const mysql2 = await import("mysql2");
        const pool = mysql2.createPool({
          host: "localhost",
          user: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
          database: url.pathname.slice(1), // remove leading /
          socketPath,
          waitForConnections: true,
          connectionLimit: 10,
        });
        _db = drizzle(pool);
      } else {
        _db = drizzle(rawUrl);
      }
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ==================== User Helpers ====================
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod", "passwordHash"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function listUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(asc(users.id));
}

export async function updateUserRole(id: number, role: "user" | "admin" | "developer") {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ role }).where(eq(users.id, id));
}

export async function deleteUser(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(users).where(eq(users.id, id));
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function setUserBanned(id: number, isBanned: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ isBanned }).where(eq(users.id, id));
}

// ==================== Questions Helpers ====================
export async function listQuestions(filters?: {
  brandLine?: string;
  dimension?: string;
  language?: string;
  status?: string;
  includeArchived?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.brandLine) conditions.push(eq(questions.brandLine, filters.brandLine as any));
  if (filters?.dimension) conditions.push(eq(questions.dimension, filters.dimension as any));
  if (filters?.language) conditions.push(eq(questions.language, filters.language as any));
  if (filters?.status) {
    conditions.push(eq(questions.status, filters.status as any));
  } else if (!filters?.includeArchived) {
    // By default, exclude archived questions
    conditions.push(sql`${questions.status} != 'archived'`);
  }
  if (conditions.length > 0) {
    return db.select().from(questions).where(and(...conditions)).orderBy(asc(questions.questionId));
  }
  return db.select().from(questions).orderBy(asc(questions.questionId));
}

export async function getQuestionById(questionId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(questions).where(eq(questions.questionId, questionId)).limit(1);
  return result[0];
}

export async function createQuestion(data: InsertQuestion) {
  const db = await getDb();
  if (!db) return;
  await db.insert(questions).values(data);
}

export async function updateQuestion(questionId: string, data: Partial<InsertQuestion>) {
  const db = await getDb();
  if (!db) return;
  await db.update(questions).set(data).where(eq(questions.questionId, questionId));
}

export async function deleteQuestion(questionId: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(questions).where(eq(questions.questionId, questionId));
}

// ==================== Collections Helpers ====================
export async function listCollections(filters?: {
  questionId?: string;
  platform?: string;
  batchId?: string;
  status?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const conditions = [];
  if (filters?.questionId) conditions.push(eq(collections.questionId, filters.questionId));
  if (filters?.platform) conditions.push(eq(collections.platform, filters.platform as any));
  if (filters?.batchId) conditions.push(eq(collections.batchId, filters.batchId));
  if (filters?.status) conditions.push(eq(collections.status, filters.status as any));
  if (filters?.startTime) conditions.push(gte(collections.timestamp, filters.startTime));
  if (filters?.endTime) conditions.push(lte(collections.timestamp, filters.endTime));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, totalResult] = await Promise.all([
    db
      .select()
      .from(collections)
      .where(whereClause)
      .orderBy(desc(collections.timestamp))
      .limit(filters?.limit || 50)
      .offset(filters?.offset || 0),
    db.select({ count: count() }).from(collections).where(whereClause),
  ]);

  return { data, total: totalResult[0]?.count || 0 };
}

export async function getCollectionById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(collections).where(eq(collections.id, id)).limit(1);
  return result[0];
}

export async function createCollection(data: InsertCollection) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(collections).values(data);
  return result[0].insertId;
}

export async function updateCollection(id: number, data: Partial<InsertCollection>) {
  const db = await getDb();
  if (!db) return;
  await db.update(collections).set(data).where(eq(collections.id, id));
}

// ==================== Citations Helpers ====================
export async function getCitationsByCollectionId(collectionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(citations).where(eq(citations.collectionId, collectionId)).orderBy(asc(citations.position));
}

export async function createCitations(data: InsertCitation[]) {
  const db = await getDb();
  if (!db) return;
  if (data.length === 0) return;
  await db.insert(citations).values(data);
}

export async function getTopCitedUrls(limit: number = 20, startTime?: number, endTime?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (startTime || endTime) {
    const collectionIds = await db
      .select({ id: collections.id })
      .from(collections)
      .where(
        and(
          startTime ? gte(collections.timestamp, startTime) : undefined,
          endTime ? lte(collections.timestamp, endTime) : undefined
        )
      );
    if (collectionIds.length > 0) {
      conditions.push(
        inArray(
          citations.collectionId,
          collectionIds.map((c) => c.id)
        )
      );
    }
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  return db
    .select({
      domain: citations.domain,
      url: citations.url,
      title: citations.title,
      sourceType: citations.sourceType,
      citationCount: count(),
    })
    .from(citations)
    .where(whereClause)
    .groupBy(citations.url, citations.domain, citations.title, citations.sourceType)
    .orderBy(desc(count()))
    .limit(limit);
}

export async function getCitationDomainDistribution(startTime?: number, endTime?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (startTime || endTime) {
    const collectionIds = await db
      .select({ id: collections.id })
      .from(collections)
      .where(
        and(
          startTime ? gte(collections.timestamp, startTime) : undefined,
          endTime ? lte(collections.timestamp, endTime) : undefined
        )
      );
    if (collectionIds.length > 0) {
      conditions.push(
        inArray(
          citations.collectionId,
          collectionIds.map((c) => c.id)
        )
      );
    }
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  return db
    .select({
      domain: citations.domain,
      count: count(),
      sourceType: citations.sourceType,
    })
    .from(citations)
    .where(whereClause)
    .groupBy(citations.domain, citations.sourceType)
    .orderBy(desc(count()));
}

// ==================== Analyses Helpers ====================
export async function getAnalysisByCollectionId(collectionId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(analyses).where(eq(analyses.collectionId, collectionId)).limit(1);
  return result[0];
}

export async function createAnalysis(data: InsertAnalysis) {
  const db = await getDb();
  if (!db) return;
  await db.insert(analyses).values(data);
}

export async function deleteAnalysisByCollectionId(collectionId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(analyses).where(eq(analyses.collectionId, collectionId));
}

export async function getSentimentTrend(questionId: string, platform?: string) {
  const db = await getDb();
  if (!db) return [];
  // Get collections for this question, optionally filtered by platform
  const conditions = [eq(collections.questionId, questionId)];
  if (platform) conditions.push(eq(collections.platform, platform as any));
  conditions.push(eq(collections.status, "success"));

  const collectionList = await db
    .select({ id: collections.id, timestamp: collections.timestamp, platform: collections.platform })
    .from(collections)
    .where(and(...conditions))
    .orderBy(asc(collections.timestamp));

  if (collectionList.length === 0) return [];

  const collectionIds = collectionList.map((c) => c.id);
  const analysisList = await db
    .select()
    .from(analyses)
    .where(inArray(analyses.collectionId, collectionIds));

  const analysisMap = new Map(analysisList.map((a) => [a.collectionId, a]));

  return collectionList.map((c) => ({
    timestamp: c.timestamp,
    platform: c.platform,
    sentimentScore: analysisMap.get(c.id)?.sentimentScore || null,
    overallTone: analysisMap.get(c.id)?.overallTone || null,
  }));
}

// ==================== Dashboard Helpers ====================
export async function getDashboardSummary(startTime?: number, endTime?: number) {
  const db = await getDb();
  if (!db) return null;

  const conditions = [eq(collections.status, "success")];
  if (startTime) conditions.push(gte(collections.timestamp, startTime));
  if (endTime) conditions.push(lte(collections.timestamp, endTime));
  const whereClause = and(...conditions);

  // 1. Total collections count + platform breakdown via SQL aggregation
  const totalResult = await db
    .select({ count: count() })
    .from(collections)
    .where(whereClause);
  const totalCollections = totalResult[0]?.count || 0;

  if (totalCollections === 0) {
    return {
      overallSentimentAvg: 0,
      friendlySourceRate: 0,
      targetFactsCoverage: 0,
      ourContentRate: 0,
      alertCount: 0,
      platformBreakdown: [],
      totalCollections: 0,
    };
  }

  // 2. Overall sentiment average via SQL AVG with JOIN
  const sentimentResult = await db
    .select({ avgScore: avg(analyses.sentimentScore) })
    .from(analyses)
    .innerJoin(collections, eq(analyses.collectionId, collections.id))
    .where(whereClause);
  const overallSentimentAvg = Number(sentimentResult[0]?.avgScore) || 0;

  // 3. Citation stats via SQL COUNT + conditional aggregation
  const citationStatsResult = await db
    .select({
      total: count(),
      friendlyCount: sql<number>`SUM(CASE WHEN ${citations.sourceType} IN ('our_content', 'friendly') THEN 1 ELSE 0 END)`,
      ourContentCount: sql<number>`SUM(CASE WHEN ${citations.isOurContent} = true THEN 1 ELSE 0 END)`,
    })
    .from(citations)
    .innerJoin(collections, eq(citations.collectionId, collections.id))
    .where(whereClause);
  const totalCitations = citationStatsResult[0]?.total || 0;
  const friendlyCount = Number(citationStatsResult[0]?.friendlyCount) || 0;
  const ourContentCount = Number(citationStatsResult[0]?.ourContentCount) || 0;
  const friendlySourceRate = totalCitations > 0 ? friendlyCount / totalCitations : 0;
  const ourContentRate = totalCitations > 0 ? ourContentCount / totalCitations : 0;

  // 4. Alerts count
  const alertConditions = [];
  if (startTime) alertConditions.push(gte(alerts.createdAt, new Date(startTime)));
  if (endTime) alertConditions.push(lte(alerts.createdAt, new Date(endTime)));
  const alertResult = await db
    .select({ count: count() })
    .from(alerts)
    .where(alertConditions.length > 0 ? and(...alertConditions) : undefined);

  // 5. Target facts coverage — still needs in-memory (JSON column)
  let targetFactsCoverage = 0;
  const factsRows = await db
    .select({ targetFactsCheck: analyses.targetFactsCheck })
    .from(analyses)
    .innerJoin(collections, eq(analyses.collectionId, collections.id))
    .where(and(whereClause, sql`${analyses.targetFactsCheck} IS NOT NULL`));
  if (factsRows.length > 0) {
    let trueCount = 0;
    let totalFactCount = 0;
    factsRows.forEach((row) => {
      const fc = row.targetFactsCheck as Record<string, boolean>;
      if (fc) {
        Object.values(fc).forEach((v) => {
          totalFactCount++;
          if (v) trueCount++;
        });
      }
    });
    targetFactsCoverage = totalFactCount > 0 ? trueCount / totalFactCount : 0;
  }

  // 6. Platform breakdown via SQL GROUP BY
  const platformStats = await db
    .select({
      platform: collections.platform,
      collectionCount: count(),
      sentimentAvg: avg(analyses.sentimentScore),
    })
    .from(collections)
    .leftJoin(analyses, eq(analyses.collectionId, collections.id))
    .where(whereClause)
    .groupBy(collections.platform);

  const platformCitationStats = await db
    .select({
      platform: collections.platform,
      citationCount: count(),
    })
    .from(citations)
    .innerJoin(collections, eq(citations.collectionId, collections.id))
    .where(whereClause)
    .groupBy(collections.platform);
  const citationByPlatform = new Map(platformCitationStats.map(p => [p.platform, p.citationCount]));

  // Top domains per platform
  const topDomainsResult = await db
    .select({
      platform: collections.platform,
      domain: citations.domain,
      domainCount: count(),
    })
    .from(citations)
    .innerJoin(collections, eq(citations.collectionId, collections.id))
    .where(whereClause)
    .groupBy(collections.platform, citations.domain)
    .orderBy(desc(count()));

  const topDomainsByPlatform = new Map<string, { domain: string; count: number }[]>();
  topDomainsResult.forEach((row) => {
    if (!row.domain) return;
    const list = topDomainsByPlatform.get(row.platform) || [];
    if (list.length < 3) {
      list.push({ domain: row.domain, count: row.domainCount });
      topDomainsByPlatform.set(row.platform, list);
    }
  });

  const platformBreakdown = platformStats.map((p) => ({
    platform: p.platform,
    sentimentAvg: Number(p.sentimentAvg) || 0,
    collectionCount: p.collectionCount,
    citationCountAvg: p.collectionCount > 0
      ? (citationByPlatform.get(p.platform) || 0) / p.collectionCount
      : 0,
    topDomains: topDomainsByPlatform.get(p.platform) || [],
  }));

  return {
    overallSentimentAvg: Math.round(overallSentimentAvg * 10) / 10,
    friendlySourceRate: Math.round(friendlySourceRate * 1000) / 10,
    targetFactsCoverage: Math.round(targetFactsCoverage * 1000) / 10,
    ourContentRate: Math.round(ourContentRate * 1000) / 10,
    alertCount: alertResult[0]?.count || 0,
    platformBreakdown,
    totalCollections,
  };
}

// ==================== Our Content URLs Helpers ====================
export async function listOurContentUrls(filters?: { isActive?: boolean; contentType?: string }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.isActive !== undefined) conditions.push(eq(ourContentUrls.isActive, filters.isActive));
  if (filters?.contentType) conditions.push(eq(ourContentUrls.contentType, filters.contentType as any));
  if (conditions.length > 0) {
    return db.select().from(ourContentUrls).where(and(...conditions)).orderBy(desc(ourContentUrls.createdAt));
  }
  return db.select().from(ourContentUrls).orderBy(desc(ourContentUrls.createdAt));
}

export async function createOurContentUrl(data: InsertOurContentUrl) {
  const db = await getDb();
  if (!db) return;
  await db.insert(ourContentUrls).values(data);
}

export async function updateOurContentUrl(id: number, data: Partial<InsertOurContentUrl>) {
  const db = await getDb();
  if (!db) return;
  await db.update(ourContentUrls).set(data).where(eq(ourContentUrls.id, id));
}

export async function deleteOurContentUrl(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(ourContentUrls).where(eq(ourContentUrls.id, id));
}

export async function batchCreateOurContentUrls(data: InsertOurContentUrl[]) {
  const db = await getDb();
  if (!db) return;
  if (data.length === 0) return;
  await db.insert(ourContentUrls).values(data);
}

// ==================== Target Facts Helpers ====================
export async function listTargetFacts(activeOnly?: boolean) {
  const db = await getDb();
  if (!db) return [];
  if (activeOnly) {
    return db.select().from(targetFacts).where(eq(targetFacts.isActive, true)).orderBy(asc(targetFacts.factKey));
  }
  return db.select().from(targetFacts).orderBy(asc(targetFacts.factKey));
}

export async function createTargetFact(data: InsertTargetFact) {
  const db = await getDb();
  if (!db) return;
  await db.insert(targetFacts).values(data);
}

export async function updateTargetFact(id: number, data: Partial<InsertTargetFact>) {
  const db = await getDb();
  if (!db) return;
  await db.update(targetFacts).set(data).where(eq(targetFacts.id, id));
}

export async function deleteTargetFact(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(targetFacts).where(eq(targetFacts.id, id));
}

// ==================== Alerts Helpers ====================
export async function listAlerts(filters?: { severity?: string; isRead?: boolean; status?: "active" | "resolved" | "dismissed"; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const conditions = [];
  if (filters?.severity) conditions.push(eq(alerts.severity, filters.severity as any));
  if (filters?.isRead !== undefined) conditions.push(eq(alerts.isRead, filters.isRead));
  // H2 (2026-06): default to active-only when no status given, so resolved/dismissed are hidden.
  conditions.push(eq(alerts.status, (filters?.status ?? "active") as any));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, totalResult] = await Promise.all([
    db.select({
      id: alerts.id,
      alertType: alerts.alertType,
      severity: alerts.severity,
      title: alerts.title,
      description: alerts.description,
      relatedCollectionId: alerts.relatedCollectionId,
      relatedQuestionId: alerts.relatedQuestionId,
      relatedPlatform: alerts.relatedPlatform,
      isRead: alerts.isRead,
      status: alerts.status,
      dedupKey: alerts.dedupKey,
      createdAt: alerts.createdAt,
      questionText: questions.text,
    })
    .from(alerts)
    .leftJoin(questions, eq(alerts.relatedQuestionId, questions.questionId))
    .where(whereClause)
    .orderBy(desc(alerts.createdAt))
    .limit(filters?.limit || 100)
    .offset(filters?.offset || 0),
    db.select({ count: count() }).from(alerts).where(whereClause),
  ]);

  return { data, total: totalResult[0]?.count || 0 };
}

export async function createAlert(data: InsertAlert): Promise<number | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.insert(alerts).values(data);
  return (result as any)[0]?.insertId;
}

export async function markAlertRead(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(alerts).set({ isRead: true }).where(eq(alerts.id, id));
}

export async function markAllAlertsRead() {
  const db = await getDb();
  if (!db) return;
  await db.update(alerts).set({ isRead: true }).where(eq(alerts.isRead, false));
}

// H2 (2026-06): explicit workflow status mutations.
export async function setAlertStatus(id: number, status: "active" | "resolved" | "dismissed") {
  const db = await getDb();
  if (!db) return;
  // resolving/dismissing implies read
  const patch: Record<string, unknown> = { status };
  if (status !== "active") patch.isRead = true;
  await db.update(alerts).set(patch).where(eq(alerts.id, id));
}

// H3 (2026-06): "has the same (qid×platform×type) been alerted recently?" check.
// Used by checkAlerts to dedupe within the configured window before inserting a new row.
export async function findRecentAlertByDedupKey(dedupKey: string, withinHours = 7 * 24): Promise<{ id: number; createdAt: Date | null } | null> {
  const db = await getDb();
  if (!db) return null;
  const cutoff = new Date(Date.now() - withinHours * 3600 * 1000);
  const rows = await db
    .select({ id: alerts.id, createdAt: alerts.createdAt })
    .from(alerts)
    .where(and(eq(alerts.dedupKey, dedupKey), gte(alerts.createdAt, cutoff)))
    .orderBy(desc(alerts.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

// H3 (2026-06): fetch the most recent prior sentimentScore for the same (questionId, platform)
// excluding the current collection. Used for relative-trigger decision in checkAlerts.
// Returns null when no prior analyzed collection exists (i.e. first-time-of-pair).
export async function getPriorSentimentScore(questionId: string, platform: string, excludeCollectionId: number): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ score: analyses.sentimentScore, collectionId: collections.id })
    .from(analyses)
    .innerJoin(collections, eq(analyses.collectionId, collections.id))
    .where(and(
      eq(collections.questionId, questionId),
      eq(collections.platform, platform),
      eq(collections.status, "success" as any),
      sql`${collections.id} <> ${excludeCollectionId}`,
      sql`${analyses.sentimentScore} IS NOT NULL`,
    ))
    .orderBy(desc(collections.id))
    .limit(1);
  return rows[0]?.score ?? null;
}

// ==================== Platform Configs Helpers ====================
export async function listPlatformConfigs() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(platformConfigs).orderBy(asc(platformConfigs.platform));
}

export async function getPlatformConfig(platform: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(platformConfigs)
    .where(eq(platformConfigs.platform, platform as any))
    .limit(1);
  return result[0];
}

export async function upsertPlatformConfig(data: InsertPlatformConfig) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(platformConfigs)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        displayName: data.displayName,
        isEnabled: data.isEnabled,
        apiKeyEncrypted: data.apiKeyEncrypted,
        apiBaseUrl: data.apiBaseUrl,
        modelVersion: data.modelVersion,
        collectFrequency: data.collectFrequency,
        extraConfig: data.extraConfig,
      },
    });
}

export async function deletePlatformConfig(platform: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(platformConfigs).where(eq(platformConfigs.platform, platform as any));
}

// ==================== Global API Keys Helpers ====================
export async function listGlobalApiKeys() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(globalApiKeys).orderBy(globalApiKeys.sortOrder);
}

export async function upsertGlobalApiKey(data: InsertGlobalApiKey & { id?: number }) {
  const db = await getDb();
  if (!db) return;
  if (data.id) {
    // Update existing
    await db
      .update(globalApiKeys)
      .set({
        name: data.name,
        apiKey: data.apiKey,
        baseUrl: data.baseUrl,
        coveredPlatforms: data.coveredPlatforms,
        isActive: data.isActive,
        sortOrder: data.sortOrder,
      })
      .where(eq(globalApiKeys.id, data.id));
  } else {
    // Insert new
    await db.insert(globalApiKeys).values({
      name: data.name,
      apiKey: data.apiKey,
      baseUrl: data.baseUrl,
      coveredPlatforms: data.coveredPlatforms,
      isActive: data.isActive ?? true,
      sortOrder: data.sortOrder ?? 0,
    });
  }
}

export async function deleteGlobalApiKey(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(globalApiKeys).where(eq(globalApiKeys.id, id));
}

// ==================== Weekly Reports Helpers ====================
export async function getWeeklyReport(reportWeek: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(weeklyReports)
    .where(eq(weeklyReports.reportWeek, reportWeek))
    .limit(1);
  return result[0];
}

export async function listWeeklyReports(limit: number = 12) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(weeklyReports).orderBy(desc(weeklyReports.reportWeek)).limit(limit);
}

export async function upsertWeeklyReport(data: InsertWeeklyReport) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(weeklyReports)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        reportPeriod: data.reportPeriod,
        summaryMetrics: data.summaryMetrics,
        platformBreakdown: data.platformBreakdown,
        questionDetails: data.questionDetails,
        citationAnalysis: data.citationAnalysis,
        alertsSummary: data.alertsSummary,
        generatedAt: data.generatedAt,
      },
    });
}

// ==================== URL Match Rules Helpers ====================
export async function listUrlMatchRules() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(urlMatchRules).where(eq(urlMatchRules.isActive, true));
}

export async function createUrlMatchRule(data: InsertUrlMatchRule) {
  const db = await getDb();
  if (!db) return;
  await db.insert(urlMatchRules).values(data);
}

export async function deleteUrlMatchRule(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(urlMatchRules).where(eq(urlMatchRules.id, id));
}

// ==================== Batch Progress Helper ====================
export async function getBatchProgress(batchId: string) {
  const db = await getDb();
  if (!db) return { total: 0, completed: 0, failed: 0, pending: 0 };
  const batchCollections = await db
    .select({ status: collections.status })
    .from(collections)
    .where(eq(collections.batchId, batchId));
  const total = batchCollections.length;
  const completed = batchCollections.filter((c) => c.status === "success").length;
  const failed = batchCollections.filter((c) => c.status === "failed" || c.status === "refused").length;
  const pending = batchCollections.filter((c) => c.status === "pending").length;
  return { total, completed, failed, pending };
}

// ==================== Heatmap Data Helper ====================
export async function getHeatmapData(startTime?: number, endTime?: number) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(collections.status, "success")];
  if (startTime) conditions.push(gte(collections.timestamp, startTime));
  if (endTime) conditions.push(lte(collections.timestamp, endTime));

  const collectionList = await db
    .select({
      id: collections.id,
      questionId: collections.questionId,
      platform: collections.platform,
    })
    .from(collections)
    .where(and(...conditions));

  if (collectionList.length === 0) return [];

  const collectionIds = collectionList.map((c) => c.id);
  const analysisList = await db
    .select({ collectionId: analyses.collectionId, sentimentScore: analyses.sentimentScore })
    .from(analyses)
    .where(inArray(analyses.collectionId, collectionIds));

  const analysisMap = new Map(analysisList.map((a) => [a.collectionId, a.sentimentScore]));

  // Group by questionId + platform
  const heatmap: Record<string, Record<string, number[]>> = {};
  collectionList.forEach((c) => {
    if (!heatmap[c.questionId]) heatmap[c.questionId] = {};
    if (!heatmap[c.questionId][c.platform]) heatmap[c.questionId][c.platform] = [];
    const score = analysisMap.get(c.id);
    if (score) heatmap[c.questionId][c.platform].push(score);
  });

  const result: { questionId: string; platform: string; avgScore: number }[] = [];
  Object.entries(heatmap).forEach(([qid, platforms]) => {
    Object.entries(platforms).forEach(([platform, scores]) => {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      result.push({ questionId: qid, platform, avgScore: Math.round(avg * 10) / 10 });
    });
  });

  return result;
}

// ==================== Uncited Our Content Helper ====================
export async function getUncitedOurContent(startTime?: number, endTime?: number) {
  const db = await getDb();
  if (!db) return [];

  const allOurUrls = await db
    .select()
    .from(ourContentUrls)
    .where(eq(ourContentUrls.isActive, true));

  if (allOurUrls.length === 0) return [];

  // Get all cited URLs in the time range
  const conditions = [];
  if (startTime || endTime) {
    const collectionIds = await db
      .select({ id: collections.id })
      .from(collections)
      .where(
        and(
          startTime ? gte(collections.timestamp, startTime) : undefined,
          endTime ? lte(collections.timestamp, endTime) : undefined
        )
      );
    if (collectionIds.length > 0) {
      conditions.push(
        inArray(
          citations.collectionId,
          collectionIds.map((c) => c.id)
        )
      );
    }
  }
  conditions.push(eq(citations.isOurContent, true));

  const citedUrls = await db
    .select({ url: citations.url })
    .from(citations)
    .where(and(...conditions));

  const citedUrlSet = new Set(citedUrls.map((c) => c.url));

  return allOurUrls.filter((u) => !citedUrlSet.has(u.url as string));
}

// ==================== Batch Collection Operations ====================

export async function batchDeleteCollections(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = await getDb();
  if (!db) return 0;
  // Delete related citations and analyses first
  await db.delete(citations).where(inArray(citations.collectionId, ids));
  await db.delete(analyses).where(inArray(analyses.collectionId, ids));
  const result = await db.delete(collections).where(inArray(collections.id, ids));
  return (result as any)?.[0]?.affectedRows ?? ids.length;
}

export async function getCollectionsByIds(ids: number[]) {
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  return db.select().from(collections).where(inArray(collections.id, ids));
}

// ==================== Scheduler Config Helpers ====================
export async function getSchedulerConfig() {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(schedulerConfigs).limit(1);
  return result[0] ?? null;
}

export async function upsertSchedulerConfig(data: Partial<InsertSchedulerConfig>) {
  const db = await getDb();
  if (!db) return;
  const existing = await getSchedulerConfig();
  if (existing) {
    const updateSet: Record<string, unknown> = {};
    if (data.enabled !== undefined) updateSet.enabled = data.enabled;
    if (data.cronExpression !== undefined) updateSet.cronExpression = data.cronExpression;
    if (data.concurrency !== undefined) updateSet.concurrency = data.concurrency;
    if (data.lastRunAt !== undefined) updateSet.lastRunAt = data.lastRunAt;
    if (data.monitorEnabled !== undefined) updateSet.monitorEnabled = data.monitorEnabled;
    if (data.monitorCron !== undefined) updateSet.monitorCron = data.monitorCron;
    if (data.monitorLastRunAt !== undefined) updateSet.monitorLastRunAt = data.monitorLastRunAt;
    if (Object.keys(updateSet).length > 0) {
      await db.update(schedulerConfigs).set(updateSet).where(eq(schedulerConfigs.id, existing.id));
    }
  } else {
    await db.insert(schedulerConfigs).values({
      enabled: data.enabled ?? false,
      cronExpression: data.cronExpression ?? "0 8 * * *",
      concurrency: data.concurrency ?? 5,
      lastRunAt: data.lastRunAt ?? null,
    });
  }
}

// ==================== System Config (singleton k/v) Helpers ====================
export async function getSysConfig(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(sysConfigs)
    .where(eq(sysConfigs.configKey, key))
    .limit(1);
  return result[0]?.configValue ?? null;
}

export async function setSysConfig(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select()
    .from(sysConfigs)
    .where(eq(sysConfigs.configKey, key))
    .limit(1);
  if (existing[0]) {
    await db
      .update(sysConfigs)
      .set({ configValue: value })
      .where(eq(sysConfigs.id, existing[0].id));
  } else {
    await db.insert(sysConfigs).values({ configKey: key, configValue: value });
  }
}

// ==================== Notification Config Helpers ====================
export async function listNotificationConfigs() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notificationConfigs).orderBy(asc(notificationConfigs.id));
}

export async function upsertNotificationConfig(data: Partial<InsertNotificationConfig> & { channel: "feishu" | "telegram" | "email" }) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(notificationConfigs).where(eq(notificationConfigs.channel, data.channel)).limit(1);
  if (existing.length > 0) {
    const updateSet: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k !== "channel" && k !== "id" && v !== undefined) updateSet[k] = v;
    }
    if (Object.keys(updateSet).length > 0) {
      await db.update(notificationConfigs).set(updateSet).where(eq(notificationConfigs.id, existing[0].id));
    }
  } else {
    await db.insert(notificationConfigs).values(data as InsertNotificationConfig);
  }
}

// ==================== Notification Log Helpers ====================
export async function createNotificationLog(data: InsertNotificationLog) {
  const db = await getDb();
  if (!db) return;
  await db.insert(notificationLogs).values(data);
}

export async function findRecentNotificationLog(dedupKey: string, withinHours: number) {
  const db = await getDb();
  if (!db) return undefined;
  const cutoff = new Date(Date.now() - withinHours * 60 * 60 * 1000);
  const result = await db.select().from(notificationLogs)
    .where(and(
      eq(notificationLogs.dedupKey, dedupKey),
      eq(notificationLogs.success, true),
      gte(notificationLogs.createdAt, cutoff),
    ))
    .limit(1);
  return result[0];
}

export async function listNotificationLogs(filters?: { channel?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const conditions = [];
  if (filters?.channel) conditions.push(eq(notificationLogs.channel, filters.channel as any));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const [data, totalResult] = await Promise.all([
    db.select().from(notificationLogs).where(whereClause).orderBy(desc(notificationLogs.createdAt)).limit(filters?.limit || 50).offset(filters?.offset || 0),
    db.select({ count: count() }).from(notificationLogs).where(whereClause),
  ]);
  return { data, total: totalResult[0]?.count || 0 };
}

export async function listAlertsByBatchCollections(batchId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: alerts.id, alertType: alerts.alertType, severity: alerts.severity,
    title: alerts.title, description: alerts.description,
    relatedPlatform: alerts.relatedPlatform, relatedQuestionId: alerts.relatedQuestionId,
  })
  .from(alerts)
  .innerJoin(collections, eq(alerts.relatedCollectionId, collections.id))
  .where(eq(collections.batchId, batchId))
  .orderBy(desc(alerts.createdAt));
}

// ==================== Global API Key by Name (Serper / Firecrawl / LLM providers) ====================
// Sentiment monitor stores Serper/Firecrawl keys as globalApiKeys rows (name = 'Serper' | 'Firecrawl').
export async function getGlobalApiKeyByName(name: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(globalApiKeys)
    .where(and(eq(globalApiKeys.name, name), eq(globalApiKeys.isActive, true)))
    .limit(1);
  return rows[0];
}

// ==================== Sentiment Monitor Helpers (Phase 1) ====================
export async function listMonitorKeywords(activeOnly = false) {
  const db = await getDb();
  if (!db) return [];
  if (activeOnly) {
    return db
      .select()
      .from(monitorKeywords)
      .where(eq(monitorKeywords.isActive, true))
      .orderBy(desc(monitorKeywords.priority), asc(monitorKeywords.id));
  }
  return db.select().from(monitorKeywords).orderBy(desc(monitorKeywords.priority), asc(monitorKeywords.id));
}

export async function upsertMonitorKeyword(data: InsertMonitorKeyword & { id?: number }) {
  const db = await getDb();
  if (!db) return;
  if (data.id) {
    await db
      .update(monitorKeywords)
      .set({
        keyword: data.keyword,
        keywordGroup: data.keywordGroup,
        searchFreq: data.searchFreq,
        isActive: data.isActive,
        priority: data.priority,
      })
      .where(eq(monitorKeywords.id, data.id));
  } else {
    await db.insert(monitorKeywords).values(data);
  }
}

export async function toggleMonitorKeyword(id: number, isActive: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.update(monitorKeywords).set({ isActive }).where(eq(monitorKeywords.id, id));
}

export async function deleteMonitorKeyword(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(monitorKeywords).where(eq(monitorKeywords.id, id));
}

export async function listMonitorSourceRules() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(monitorSourceRules).orderBy(desc(monitorSourceRules.authorityLevel));
}

export async function getMonitorSourceRuleByDomain(domain: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(monitorSourceRules)
    .where(eq(monitorSourceRules.domain, domain))
    .limit(1);
  return rows[0];
}

// Dedup lookup: urlHash = sha256(normalized url)
export async function getMonitorArticleByUrlHash(urlHash: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select({ id: monitorArticles.id, url: monitorArticles.url })
    .from(monitorArticles)
    .where(eq(monitorArticles.urlHash, urlHash))
    .limit(1);
  return rows[0];
}

export async function createMonitorArticle(data: InsertMonitorArticle) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(monitorArticles).values(data);
  return result[0].insertId;
}

export async function updateMonitorArticle(id: number, data: Partial<InsertMonitorArticle>) {
  const db = await getDb();
  if (!db) return;
  await db.update(monitorArticles).set(data).where(eq(monitorArticles.id, id));
}

// Full detail incl. contentMd + joined source stance/authority.
export async function getMonitorArticleById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(monitorArticles).where(eq(monitorArticles.id, id)).limit(1);
  const article = rows[0];
  if (!article) return undefined;
  const rule = article.domain ? await getMonitorSourceRuleByDomain(article.domain) : undefined;
  return { ...article, stance: rule?.stance ?? null, authorityLevel: rule?.authorityLevel ?? null };
}

// List for the table — skips the big contentMd field (mirrors listCollections), leftJoins stance.
export async function listMonitorArticles(filters?: {
  threatLevel?: string;
  stance?: string;
  relevance?: string;
  sourcePlatform?: string;
  focus?: boolean; // default view: only high+medium (hide low/irrelevant noise)
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const conditions = [];
  if (filters?.threatLevel) conditions.push(eq(monitorArticles.threatLevel, filters.threatLevel as any));
  if (filters?.sourcePlatform) conditions.push(eq(monitorArticles.sourcePlatform, filters.sourcePlatform));
  if (filters?.relevance) conditions.push(eq(monitorArticles.relevance, filters.relevance as any));
  else if (filters?.focus) conditions.push(inArray(monitorArticles.relevance, ["high", "medium"] as any));
  if (filters?.startTime) conditions.push(gte(monitorArticles.firstSeenAt, filters.startTime));
  if (filters?.endTime) conditions.push(lte(monitorArticles.firstSeenAt, filters.endTime));
  if (filters?.stance) conditions.push(eq(monitorSourceRules.stance, filters.stance as any));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const listSelect = {
    id: monitorArticles.id,
    url: monitorArticles.url,
    domain: monitorArticles.domain,
    title: monitorArticles.title,
    publishedAt: monitorArticles.publishedAt,
    firstSeenAt: monitorArticles.firstSeenAt,
    fetchEngine: monitorArticles.fetchEngine,
    fetchStatus: monitorArticles.fetchStatus,
    fetchCostUsd: monitorArticles.fetchCostUsd,
    sourcePlatform: monitorArticles.sourcePlatform,
    matchedKeywords: monitorArticles.matchedKeywords,
    sentimentScore: monitorArticles.sentimentScore,
    relevance: monitorArticles.relevance,
    relevanceReason: monitorArticles.relevanceReason,
    threatLevel: monitorArticles.threatLevel,
    analysisSummary: monitorArticles.analysisSummary,
    analyzedAt: monitorArticles.analyzedAt,
    costUsd: monitorArticles.costUsd,
    stance: monitorSourceRules.stance,
    authorityLevel: monitorSourceRules.authorityLevel,
  };
  const [data, totalResult] = await Promise.all([
    db
      .select(listSelect)
      .from(monitorArticles)
      .leftJoin(monitorSourceRules, eq(monitorArticles.domain, monitorSourceRules.domain))
      .where(whereClause)
      .orderBy(desc(monitorArticles.firstSeenAt))
      .limit(filters?.limit || 50)
      .offset(filters?.offset || 0),
    db
      .select({ count: count() })
      .from(monitorArticles)
      .leftJoin(monitorSourceRules, eq(monitorArticles.domain, monitorSourceRules.domain))
      .where(whereClause),
  ]);
  return { data, total: totalResult[0]?.count || 0 };
}

export async function getMonitorStats() {
  const db = await getDb();
  if (!db) return null;
  const now = Date.now();
  const dayStart = now - 24 * 60 * 60 * 1000;
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;
  const monthStart = now - 30 * 24 * 60 * 60 * 1000;

  const [totalRow] = await db.select({ c: count() }).from(monitorArticles);
  const [todayRow] = await db
    .select({ c: count() })
    .from(monitorArticles)
    .where(gte(monitorArticles.firstSeenAt, dayStart));
  const [weekRow] = await db
    .select({ c: count() })
    .from(monitorArticles)
    .where(gte(monitorArticles.firstSeenAt, weekStart));
  const [highThreatRow] = await db
    .select({ c: count() })
    .from(monitorArticles)
    .where(eq(monitorArticles.threatLevel, "high"));
  const threatDist = await db
    .select({ threatLevel: monitorArticles.threatLevel, c: count() })
    .from(monitorArticles)
    .groupBy(monitorArticles.threatLevel);
  const [costRow] = await db
    .select({
      analysis: sql<string>`COALESCE(SUM(${monitorArticles.costUsd}), 0)`,
      fetch: sql<string>`COALESCE(SUM(${monitorArticles.fetchCostUsd}), 0)`,
    })
    .from(monitorArticles)
    .where(gte(monitorArticles.firstSeenAt, monthStart));

  // Engine distribution (all-time) — shows how much the free L1 path absorbs vs paid L4.
  const engineRows = await db
    .select({ engine: monitorArticles.fetchEngine, c: count() })
    .from(monitorArticles)
    .groupBy(monitorArticles.fetchEngine);
  const sourceRows = await db
    .select({ src: monitorArticles.sourcePlatform, c: count() })
    .from(monitorArticles)
    .groupBy(monitorArticles.sourcePlatform);

  const threatDistribution: Record<string, number> = {};
  for (const r of threatDist) threatDistribution[r.threatLevel ?? "unanalyzed"] = r.c;
  const engineDistribution: Record<string, number> = {};
  for (const r of engineRows) engineDistribution[r.engine ?? "unknown"] = r.c;
  const sourceDistribution: Record<string, number> = {};
  for (const r of sourceRows) sourceDistribution[r.src ?? "unknown"] = r.c;

  const monthAnalysisCostUsd = Number(costRow?.analysis || 0);
  const monthFetchCostUsd = Number(costRow?.fetch || 0);
  return {
    total: totalRow?.c || 0,
    todayNew: todayRow?.c || 0,
    weekTotal: weekRow?.c || 0,
    highThreat: highThreatRow?.c || 0,
    threatDistribution,
    engineDistribution,
    sourceDistribution,
    monthAnalysisCostUsd,
    monthFetchCostUsd,
    monthCostUsd: Math.round((monthAnalysisCostUsd + monthFetchCostUsd) * 1_000_000) / 1_000_000,
  };
}
