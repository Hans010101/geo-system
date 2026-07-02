// 舆情周报/月报 — aggregates the sentiment-monitor side per calendar week/month.
// INDEPENDENT from the GEO weeklyReports (那是 AI 平台情感周报); stored in monitor_reports.
// Dimensions: 总览 / 信源 / 威胁(含环比) / GEO穿透 / 成本. Pure DB aggregation — no LLM cost.
import { sql } from "drizzle-orm";
import * as db from "../db";
import { dispatchNotification } from "../_core/notification";
import { normSql, rawRows } from "./penetration";
import { log } from "./util";

// Asia/Shanghai is fixed UTC+8 (no DST) — safe to shift by a constant and use UTC getters.
const TZ_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;

export type ReportType = "weekly" | "monthly";

export interface ReportPeriod {
  reportType: ReportType;
  reportPeriod: string; // '2026-W27' | '2026-07'
  startMs: number; // inclusive, epoch ms
  endMs: number; // exclusive
}

// ISO week (Monday start; week's year/number determined by its Thursday), boundaries at
// Asia/Shanghai midnight.
export function weeklyPeriodOf(refMs: number): ReportPeriod {
  const d = new Date(refMs + TZ_MS);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  const mondayShifted = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
  const startMs = mondayShifted - TZ_MS;
  const thu = new Date(mondayShifted + 3 * DAY_MS);
  const jan1 = Date.UTC(thu.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thu.getTime() - jan1) / DAY_MS + 1) / 7);
  return {
    reportType: "weekly",
    reportPeriod: `${thu.getUTCFullYear()}-W${String(week).padStart(2, "0")}`,
    startMs,
    endMs: startMs + 7 * DAY_MS,
  };
}

export function monthlyPeriodOf(refMs: number): ReportPeriod {
  const d = new Date(refMs + TZ_MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    reportType: "monthly",
    reportPeriod: `${y}-${String(m + 1).padStart(2, "0")}`,
    startMs: Date.UTC(y, m, 1) - TZ_MS,
    endMs: Date.UTC(y, m + 1, 1) - TZ_MS,
  };
}

// Parse an explicit period string ('2026-W27' / '2026-07'); throws on bad format.
export function parsePeriod(reportType: ReportType, period: string): ReportPeriod {
  if (reportType === "monthly") {
    const m = period.match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new Error(`月报周期格式应为 YYYY-MM,收到: ${period}`);
    return monthlyPeriodOf(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15) - TZ_MS);
  }
  const m = period.match(/^(\d{4})-W(\d{1,2})$/i);
  if (!m) throw new Error(`周报周期格式应为 YYYY-Wnn,收到: ${period}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  // Jan 4 is always in ISO week 1; walk to its Monday, then offset weeks.
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Monday = jan4 - jan4Dow * DAY_MS;
  const mondayShifted = week1Monday + (week - 1) * 7 * DAY_MS;
  const startMs = mondayShifted - TZ_MS;
  // Canonicalize and reject label mismatches: catches W00/W99 and W53 in 52-week years
  // (otherwise '2027-W53' would silently persist a report labeled W53 over the 2028-W01 window).
  const canonical = weeklyPeriodOf(startMs);
  if (canonical.reportPeriod !== `${year}-W${String(week).padStart(2, "0")}`) {
    throw new Error(`无效的周报周期(该年不存在此周): ${period}`);
  }
  return canonical;
}

const fmtDate = (ms: number) => new Date(ms + TZ_MS).toISOString().slice(0, 10);

// Effective time of an article = firstSeenAt (bigint ms), falling back to createdAt.
const SEEN = "COALESCE(firstSeenAt, UNIX_TIMESTAMP(createdAt) * 1000)";

export interface MonitorReportData {
  periodLabel: string; // 'YYYY-MM-DD ~ YYYY-MM-DD'
  overview: {
    total: number;
    effective: number; // relevance high+medium
    bySource: Record<string, number>;
    sentiment: { positive: number; neutral: number; negative: number; unanalyzed: number }; // on effective
    threat: Record<string, number>;
    relevance: Record<string, number>;
  };
  sources: {
    topDomains: { domain: string; articles: number; negatives: number; stance: string | null }[];
    hostileActivity: { domain: string; articles: number; negatives: number }[];
    newDomains: string[]; // first-ever seen during this period
  };
  threats: {
    highThreatList: { title: string | null; domain: string | null; url: string; sentimentScore: number | null }[];
    topNegatives: { title: string | null; domain: string | null; url: string; sentimentScore: number | null; threatLevel: string | null }[];
    compare: {
      prevPeriodLabel: string;
      total: number; prevTotal: number;
      negatives: number; prevNegatives: number;
      highThreat: number; prevHighThreat: number;
    };
  };
  penetration: {
    citedDomainsCount: number; // period-active domains already cited by AI
    amplified: { domain: string; aiPlatforms: number; aiCitations: number; negatives: number; stance: string | null }[];
    newlyAmplifiedHostile: { domain: string; aiPlatforms: number; firstCitedAt: number }[];
  };
  costs: {
    analysisUsd: number;
    fetchUsd: number;
    totalUsd: number;
    byEngine: Record<string, { articles: number; fetchUsd: number }>;
  };
}

async function periodStats(startMs: number, endMs: number) {
  const rows = await rawRows<any>(sql.raw(`
    SELECT COUNT(*) AS total,
      SUM(relevance IN ('high','medium')) AS effective,
      SUM(relevance IN ('high','medium') AND sentimentScore >= 4) AS pos,
      SUM(relevance IN ('high','medium') AND sentimentScore = 3) AS neu,
      SUM(relevance IN ('high','medium') AND sentimentScore <= 2) AS neg,
      SUM(relevance IN ('high','medium') AND sentimentScore IS NULL) AS unanalyzed,
      SUM(threatLevel = 'high') AS high
    FROM monitor_articles WHERE ${SEEN} >= ${startMs} AND ${SEEN} < ${endMs}`));
  const r = rows[0] ?? {};
  return {
    total: Number(r.total) || 0,
    effective: Number(r.effective) || 0,
    pos: Number(r.pos) || 0,
    neu: Number(r.neu) || 0,
    neg: Number(r.neg) || 0,
    unanalyzed: Number(r.unanalyzed) || 0,
    high: Number(r.high) || 0,
  };
}

export async function buildMonitorReport(p: ReportPeriod): Promise<MonitorReportData> {
  const { startMs, endMs } = p;
  const win = `${SEEN} >= ${startMs} AND ${SEEN} < ${endMs}`;
  const prevStart = startMs - (endMs - startMs);
  const cur = await periodStats(startMs, endMs);
  const prev = await periodStats(prevStart, startMs);

  const [bySrcRows, threatRows, relRows] = await Promise.all([
    rawRows<any>(sql.raw(`SELECT COALESCE(sourcePlatform,'unknown') k, COUNT(*) c FROM monitor_articles WHERE ${win} GROUP BY k`)),
    rawRows<any>(sql.raw(`SELECT COALESCE(threatLevel,'unanalyzed') k, COUNT(*) c FROM monitor_articles WHERE ${win} GROUP BY k`)),
    rawRows<any>(sql.raw(`SELECT COALESCE(relevance,'unanalyzed') k, COUNT(*) c FROM monitor_articles WHERE ${win} GROUP BY k`)),
  ]);
  const toMap = (rows: any[]) => Object.fromEntries(rows.map((r) => [String(r.k), Number(r.c) || 0]));

  // —— 信源维度 ——
  const topDomains = (await rawRows<any>(sql.raw(`
    SELECT ma.domain, COUNT(*) articles,
      SUM(ma.relevance IN ('high','medium') AND ma.sentimentScore <= 2) negatives, sr.stance
    FROM monitor_articles ma LEFT JOIN monitor_source_rules sr ON sr.domain = ma.domain
    WHERE ${win.replace(/firstSeenAt/g, "ma.firstSeenAt").replace(/createdAt/g, "ma.createdAt")} AND ma.domain IS NOT NULL AND ma.domain <> ''
    GROUP BY ma.domain, sr.stance ORDER BY articles DESC LIMIT 10`))).map((r) => ({
    domain: String(r.domain), articles: Number(r.articles) || 0, negatives: Number(r.negatives) || 0, stance: r.stance ?? null,
  }));
  const hostileActivity = (await rawRows<any>(sql.raw(`
    SELECT ma.domain, COUNT(*) articles,
      SUM(ma.relevance IN ('high','medium') AND ma.sentimentScore <= 2) negatives
    FROM monitor_articles ma JOIN monitor_source_rules sr ON sr.domain = ma.domain AND sr.stance = 'hostile'
    WHERE ${win.replace(/firstSeenAt/g, "ma.firstSeenAt").replace(/createdAt/g, "ma.createdAt")}
    GROUP BY ma.domain ORDER BY negatives DESC, articles DESC LIMIT 10`))).map((r) => ({
    domain: String(r.domain), articles: Number(r.articles) || 0, negatives: Number(r.negatives) || 0,
  }));
  const newDomains = (await rawRows<any>(sql.raw(`
    SELECT domain FROM monitor_articles WHERE domain IS NOT NULL AND domain <> ''
    GROUP BY domain HAVING MIN(${SEEN}) >= ${startMs} AND MIN(${SEEN}) < ${endMs}
    ORDER BY COUNT(*) DESC LIMIT 20`))).map((r) => String(r.domain));

  // —— 威胁/负面维度 ——
  const highThreatList = (await rawRows<any>(sql.raw(`
    SELECT title, domain, url, sentimentScore FROM monitor_articles
    WHERE ${win} AND threatLevel = 'high' ORDER BY ${SEEN} DESC LIMIT 20`))).map((r) => ({
    title: r.title ?? null, domain: r.domain ?? null, url: String(r.url), sentimentScore: r.sentimentScore == null ? null : Number(r.sentimentScore),
  }));
  const topNegatives = (await rawRows<any>(sql.raw(`
    SELECT title, domain, url, sentimentScore, threatLevel FROM monitor_articles
    WHERE ${win} AND relevance IN ('high','medium') AND sentimentScore <= 2
    ORDER BY threatLevel IS NULL, FIELD(threatLevel,'high','medium','low','none'), sentimentScore ASC LIMIT 10`))).map((r) => ({
    title: r.title ?? null, domain: r.domain ?? null, url: String(r.url),
    sentimentScore: r.sentimentScore == null ? null : Number(r.sentimentScore), threatLevel: r.threatLevel ?? null,
  }));

  // —— GEO 穿透维度 —— (period-active monitor domains × all-time AI citations)
  const penRows = await rawRows<any>(sql.raw(`
    SELECT m.d domain, m.negatives, c.aiPlatforms, c.aiCitations, sr.stance
    FROM (
      SELECT ${normSql("domain")} d,
        SUM(relevance IN ('high','medium') AND sentimentScore <= 2) negatives
      FROM monitor_articles WHERE ${win} AND domain IS NOT NULL AND domain <> '' GROUP BY d
    ) m
    JOIN (
      SELECT ${normSql("ci.domain")} d, COUNT(DISTINCT co.platform) aiPlatforms, COUNT(*) aiCitations
      FROM citations ci JOIN collections co ON ci.collectionId = co.id GROUP BY d
    ) c ON m.d = c.d
    LEFT JOIN monitor_source_rules sr ON sr.domain = m.d
    ORDER BY (sr.stance = 'hostile') DESC, m.negatives DESC, c.aiPlatforms DESC`));
  const citedDomainsCount = penRows.length;
  const amplified = penRows
    .filter((r) => Number(r.negatives) > 0 || r.stance === "hostile")
    .slice(0, 10)
    .map((r) => ({
      domain: String(r.domain), aiPlatforms: Number(r.aiPlatforms) || 0, aiCitations: Number(r.aiCitations) || 0,
      negatives: Number(r.negatives) || 0, stance: r.stance ?? null,
    }));
  // 新进入 AI 引用的敌对/负面信源: first-ever citation of that domain landed inside this period.
  const newlyAmplifiedHostile = (await rawRows<any>(sql.raw(`
    SELECT c.d domain, c.aiPlatforms, c.firstCited
    FROM (
      SELECT ${normSql("ci.domain")} d, COUNT(DISTINCT co.platform) aiPlatforms,
        MIN(UNIX_TIMESTAMP(ci.createdAt) * 1000) firstCited
      FROM citations ci JOIN collections co ON ci.collectionId = co.id GROUP BY d
      HAVING firstCited >= ${startMs} AND firstCited < ${endMs}
    ) c
    JOIN (
      SELECT ${normSql("ma.domain")} d
      FROM monitor_articles ma LEFT JOIN monitor_source_rules sr ON sr.domain = ma.domain
      WHERE (sr.stance = 'hostile' OR (ma.relevance IN ('high','medium') AND ma.sentimentScore <= 2))
      GROUP BY d
    ) m ON m.d = c.d
    ORDER BY c.aiPlatforms DESC LIMIT 10`))).map((r) => ({
    domain: String(r.domain), aiPlatforms: Number(r.aiPlatforms) || 0, firstCitedAt: Number(r.firstCited) || 0,
  }));

  // —— 成本 ——
  const costRows = await rawRows<any>(sql.raw(`
    SELECT COALESCE(fetchEngine,'unknown') engine, COUNT(*) articles,
      COALESCE(SUM(fetchCostUsd), 0) fetchUsd, COALESCE(SUM(costUsd), 0) analysisUsd
    FROM monitor_articles WHERE ${win} GROUP BY engine`));
  const byEngine: MonitorReportData["costs"]["byEngine"] = {};
  let analysisUsd = 0, fetchUsd = 0;
  for (const r of costRows) {
    const f = Number(r.fetchUsd) || 0;
    byEngine[String(r.engine)] = { articles: Number(r.articles) || 0, fetchUsd: Math.round(f * 1e6) / 1e6 };
    fetchUsd += f;
    analysisUsd += Number(r.analysisUsd) || 0;
  }

  return {
    periodLabel: `${fmtDate(startMs)} ~ ${fmtDate(endMs - 1)}`,
    overview: {
      total: cur.total,
      effective: cur.effective,
      bySource: toMap(bySrcRows),
      sentiment: { positive: cur.pos, neutral: cur.neu, negative: cur.neg, unanalyzed: cur.unanalyzed },
      threat: toMap(threatRows),
      relevance: toMap(relRows),
    },
    sources: { topDomains, hostileActivity, newDomains },
    threats: {
      highThreatList,
      topNegatives,
      compare: {
        prevPeriodLabel: `${fmtDate(prevStart)} ~ ${fmtDate(startMs - 1)}`,
        total: cur.total, prevTotal: prev.total,
        negatives: cur.neg, prevNegatives: prev.neg,
        highThreat: cur.high, prevHighThreat: prev.high,
      },
    },
    penetration: { citedDomainsCount, amplified, newlyAmplifiedHostile },
    costs: {
      analysisUsd: Math.round(analysisUsd * 1e6) / 1e6,
      fetchUsd: Math.round(fetchUsd * 1e6) / 1e6,
      totalUsd: Math.round((analysisUsd + fetchUsd) * 1e6) / 1e6,
      byEngine,
    },
  };
}

const PUSH_CFG = "monitor_report_push_enabled"; // default OFF — 确认格式后再开

export async function getReportPushEnabled(): Promise<boolean> {
  return (await db.getSysConfig(PUSH_CFG)) === "true";
}
export async function setReportPushEnabled(v: boolean): Promise<void> {
  await db.setSysConfig(PUSH_CFG, String(v));
}

// Compact text digest for 飞书/TG push (reuses Phase 2 notification channels).
export function buildReportDigest(p: ReportPeriod, d: MonitorReportData): { title: string; content: string } {
  const typeLabel = p.reportType === "weekly" ? "周报" : "月报";
  const c = d.threats.compare;
  const delta = (a: number, b: number) => (a === b ? "持平" : a > b ? `↑${a - b}` : `↓${b - a}`);
  const L: string[] = [];
  L.push(`📈 舆情${typeLabel} ${p.reportPeriod} (${d.periodLabel})`);
  L.push("━━━━━━━━━━━━━━");
  L.push(`新增 ${d.overview.total} 篇(有效 ${d.overview.effective}) | 环比 ${delta(c.total, c.prevTotal)}`);
  L.push(`🟢正 ${d.overview.sentiment.positive} 🟡中 ${d.overview.sentiment.neutral} 🔴负 ${d.overview.sentiment.negative}(环比 ${delta(c.negatives, c.prevNegatives)})`);
  L.push(`高威胁 ${c.highThreat} 篇(环比 ${delta(c.highThreat, c.prevHighThreat)})`);
  if (d.sources.hostileActivity.length > 0)
    L.push(`敌对信源动态: ${d.sources.hostileActivity.slice(0, 3).map((h) => `${h.domain}(${h.articles}篇/负${h.negatives})`).join("、")}`);
  if (d.penetration.newlyAmplifiedHostile.length > 0)
    L.push(`⚠️ 新进入AI引用的风险信源: ${d.penetration.newlyAmplifiedHostile.slice(0, 3).map((x) => `${x.domain}(${x.aiPlatforms}平台)`).join("、")}`);
  L.push(`本期成本 $${d.costs.totalUsd.toFixed(4)}`);
  return { title: `舆情${typeLabel} ${p.reportPeriod} · 新增${d.overview.total}/负面${d.overview.sentiment.negative}`, content: L.join("\n") };
}

// Generate + persist (+ optional push). period omitted => the period containing `now`.
export async function generateMonitorReport(
  reportType: ReportType,
  period?: string
): Promise<{ reportPeriod: string; periodLabel: string; data: MonitorReportData }> {
  const now = Date.now();
  const p = period
    ? parsePeriod(reportType, period)
    : reportType === "weekly"
      ? weeklyPeriodOf(now)
      : monthlyPeriodOf(now);
  const data = await buildMonitorReport(p);
  await db.upsertMonitorReport({
    reportType: p.reportType,
    reportPeriod: p.reportPeriod,
    periodStart: p.startMs,
    periodEnd: p.endMs,
    reportData: data,
    generatedAt: now,
  });
  log.info(`Monitor report generated`, { type: reportType, period: p.reportPeriod, total: data.overview.total });

  if (await getReportPushEnabled()) {
    const msg = buildReportDigest(p, data);
    dispatchNotification({ messageType: "batch_summary", title: msg.title, content: msg.content }).catch((e) =>
      log.warn(`Report push failed: ${e?.message || e}`)
    );
  }
  return { reportPeriod: p.reportPeriod, periodLabel: data.periodLabel, data };
}
