// 35天数据保鲜: layered retention for monitor_articles.
// Layer A (implemented, conservative): articles older than 35 days get contentMd cleared (the
// mediumtext storage hog) and archived=true. All lightweight metadata (title/domain/sentiment/
// threat/relevance/publishedAt/sourcePlatform/costs) is KEPT so historical trends (周/月报) and
// GEO penetration (domain joins) keep working — only the full text is gone.
// Layer B (deliberately NOT implemented yet): physical deletion after 90 days. Monthly reports
// need multi-month trend data, so物理删除留待存储真成为问题时再启用。
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { log } from "./util";

export const CLEANUP_DAYS = 35;

export interface CleanupResult {
  archived: number; // rows whose contentMd was cleared this run
  freedBytes: number; // approximate content bytes released
  cutoffMs: number;
}

// Clears contentMd for articles first seen more than CLEANUP_DAYS ago. Idempotent (archived=false
// guard) and cheap — safe to run daily. firstSeenAt is bigint epoch-ms; rows missing it fall back
// to createdAt so nothing dodges retention.
export async function cleanupOldArticles(): Promise<CleanupResult> {
  const db = await getDb();
  const cutoffMs = Date.now() - CLEANUP_DAYS * 24 * 60 * 60 * 1000;
  if (!db) return { archived: 0, freedBytes: 0, cutoffMs };

  // Measure what we're about to free (for the log line), then clear in one UPDATE.
  const sizeRes: any = await db.execute(sql`
    SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(contentMd)), 0) AS bytes
    FROM monitor_articles
    WHERE archived = false
      AND COALESCE(firstSeenAt, UNIX_TIMESTAMP(createdAt) * 1000) < ${cutoffMs}`);
  const sizeRow = (Array.isArray(sizeRes) && Array.isArray(sizeRes[0]) ? sizeRes[0] : sizeRes)?.[0] ?? {};
  const candidates = Number(sizeRow.n) || 0;
  const freedBytes = Number(sizeRow.bytes) || 0;
  if (candidates === 0) {
    log.info("Cleanup: nothing older than retention window", { days: CLEANUP_DAYS });
    return { archived: 0, freedBytes: 0, cutoffMs };
  }

  const res: any = await db.execute(sql`
    UPDATE monitor_articles
    SET contentMd = NULL, archived = true
    WHERE archived = false
      AND COALESCE(firstSeenAt, UNIX_TIMESTAMP(createdAt) * 1000) < ${cutoffMs}`);
  const header = Array.isArray(res) ? res[0] : res;
  const archived = Number(header?.affectedRows) || candidates;
  log.info("Cleanup: archived old article content", {
    archived,
    freedKB: Math.round(freedBytes / 1024),
    cutoff: new Date(cutoffMs).toISOString(),
  });
  return { archived, freedBytes, cutoffMs };
}
