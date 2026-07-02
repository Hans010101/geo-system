// GEO 穿透联动 (Phase 3): bridge the upstream sentiment monitor with the downstream AI-citation
// dataset. Both sides carry a `domain`; we JOIN on a normalized domain key to answer:
//   • getSourcePenetration()      — per source: sentiment activity × AI-citation reach × risk
//   • getArticlePenetration(id)   — is THIS article's source already cited by AI, and where?
//   • getCitationSourceActivity() — reverse lens: AI-cited sources, what are they publishing now?
//
// monitor_articles.domain is clean (domainOf). citations.domain is DIRTY (explicit URLs store a
// hostname; implicit LLM citations store a source NAME like "彭博社"). normalizeDomain() + the
// SQL twin below reconcile the hostname variants; source-name rows simply never match a hostname.
import { sql } from "drizzle-orm";
import { getDb, getMonitorArticleById } from "../db";
import { normalizeDomain, log } from "./util";

// SQL twin of normalizeDomain() in util.ts — MUST stay equivalent for the JOIN to be consistent.
// LOWER first (so scheme stripping is case-insensitive like the JS regex) -> strip http(s):// ->
// host-only (before first '/') -> before first ':' (port) -> strip leading www.
// (citations.domain never actually carries a scheme, but keeping this in lock-step avoids silent drift.)
export function normSql(col: string): string {
  return `TRIM(LEADING 'www.' FROM SUBSTRING_INDEX(SUBSTRING_INDEX(REPLACE(REPLACE(LOWER(TRIM(${col})),'https://',''),'http://',''),'/',1),':',1))`;
}

// drizzle(mysql2) .execute() resolves to the raw driver result [rows, fields]; be defensive.
export async function rawRows<T = any>(query: any): Promise<T[]> {
  const db = await getDb();
  if (!db) return [];
  const res: any = await db.execute(query);
  if (Array.isArray(res) && Array.isArray(res[0])) return res[0] as T[];
  if (Array.isArray(res)) return res as T[];
  return (res?.rows ?? []) as T[];
}

export type PenetrationCategory = "amplified" | "potential" | "cited_neutral" | "low";

export interface SourcePenetration {
  domain: string;
  // sentiment side
  articles: number;
  negatives: number; // negative (sentiment<=2) among high/medium relevance
  highThreat: number;
  avgSentiment: number | null;
  latestAt: number | null; // epoch ms
  // GEO / AI-citation side
  aiCitations: number;
  aiPlatforms: number;
  platformList: string[];
  // source rule
  stance: "hostile" | "neutral" | "friendly" | null;
  authorityLevel: number | null;
  // derived
  category: PenetrationCategory;
  riskLevel: "high" | "medium" | "low";
  riskScore: number;
}

function classify(r: {
  negatives: number;
  highThreat: number;
  aiPlatforms: number;
  stance: string | null;
}): { category: PenetrationCategory; riskLevel: "high" | "medium" | "low"; riskScore: number } {
  const hostile = r.stance === "hostile";
  const cited = r.aiPlatforms > 0;
  const negative = r.negatives > 0 || r.highThreat > 0;
  const riskScore =
    r.aiPlatforms * 3 + r.negatives * 2 + r.highThreat * 4 + (hostile ? 5 : 0);
  if (cited && (hostile || negative)) {
    // already feeding AI answers AND hostile/negative → the source has been amplified
    return { category: "amplified", riskLevel: "high", riskScore };
  }
  if (!cited && (hostile || negative)) {
    // producing negatives but not yet cited by AI → watch window before it penetrates
    return { category: "potential", riskLevel: "medium", riskScore };
  }
  if (cited) {
    // cited by AI but currently neutral about us
    return { category: "cited_neutral", riskLevel: "low", riskScore };
  }
  return { category: "low", riskLevel: "low", riskScore };
}

// Per-source penetration matrix: every monitored source (domain), enriched with how far it has
// penetrated the AI-citation layer. Ordered most-penetrated/most-negative first.
export async function getSourcePenetration(opts?: { days?: number }): Promise<SourcePenetration[]> {
  const days = opts?.days;
  const windowClause =
    days && Number.isInteger(days) && days > 0
      ? `AND createdAt >= (NOW() - INTERVAL ${days} DAY)`
      : "";
  const query = sql.raw(`
    SELECT m.domain AS domain, m.articles AS articles, m.negatives AS negatives,
           m.highThreat AS highThreat, m.avgSentiment AS avgSentiment, m.latestAt AS latestAt,
           COALESCE(c.aiCitations, 0) AS aiCitations, COALESCE(c.aiPlatforms, 0) AS aiPlatforms,
           c.platformList AS platformList, sr.stance AS stance, sr.authorityLevel AS authorityLevel
    FROM (
      SELECT ${normSql("domain")} AS domain,
             COUNT(*) AS articles,
             SUM(CASE WHEN sentimentScore <= 2 AND relevance IN ('high','medium') THEN 1 ELSE 0 END) AS negatives,
             SUM(CASE WHEN threatLevel = 'high' THEN 1 ELSE 0 END) AS highThreat,
             ROUND(AVG(sentimentScore), 2) AS avgSentiment,
             MAX(publishedAt) AS latestAt
      FROM monitor_articles
      WHERE domain IS NOT NULL AND domain <> '' ${windowClause}
      GROUP BY ${normSql("domain")}
    ) m
    LEFT JOIN (
      SELECT ${normSql("ci.domain")} AS domain,
             COUNT(*) AS aiCitations,
             COUNT(DISTINCT co.platform) AS aiPlatforms,
             GROUP_CONCAT(DISTINCT co.platform ORDER BY co.platform SEPARATOR ',') AS platformList
      FROM citations ci JOIN collections co ON ci.collectionId = co.id
      GROUP BY ${normSql("ci.domain")}
    ) c ON m.domain = c.domain
    LEFT JOIN monitor_source_rules sr ON sr.domain = m.domain
    ORDER BY aiPlatforms DESC, negatives DESC, highThreat DESC, articles DESC
  `);
  const rows = await rawRows<any>(query);
  return rows.map((r) => {
    const base = {
      domain: String(r.domain),
      articles: Number(r.articles) || 0,
      negatives: Number(r.negatives) || 0,
      highThreat: Number(r.highThreat) || 0,
      avgSentiment: r.avgSentiment == null ? null : Number(r.avgSentiment),
      latestAt: r.latestAt == null ? null : Number(r.latestAt),
      aiCitations: Number(r.aiCitations) || 0,
      aiPlatforms: Number(r.aiPlatforms) || 0,
      platformList: r.platformList ? String(r.platformList).split(",").filter(Boolean) : [],
      stance: (r.stance ?? null) as SourcePenetration["stance"],
      authorityLevel: r.authorityLevel == null ? null : Number(r.authorityLevel),
    };
    return { ...base, ...classify(base) };
  });
}

export interface DomainAiCitation {
  domain: string; // normalized
  aiPlatforms: number;
  platformList: string[];
  citationCount: number;
}

// Lightweight primitive: how far has a single domain penetrated the AI-citation layer?
// Reused by getArticlePenetration() and by the alert/briefing integration (notify.ts).
export async function getDomainAiCitation(rawDomain: string | null | undefined): Promise<DomainAiCitation> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return { domain: "", aiPlatforms: 0, platformList: [], citationCount: 0 };
  const rows = await rawRows<{ platform: string; c: number }>(sql`
    SELECT co.platform AS platform, COUNT(*) AS c
    FROM citations ci JOIN collections co ON ci.collectionId = co.id
    WHERE ${sql.raw(normSql("ci.domain"))} = ${domain}
    GROUP BY co.platform
    ORDER BY c DESC`);
  const platformList = rows.map((r) => String(r.platform));
  const citationCount = rows.reduce((s, r) => s + (Number(r.c) || 0), 0);
  return { domain, aiPlatforms: platformList.length, platformList, citationCount };
}

export interface ArticlePenetration extends DomainAiCitation {
  articleId: number;
  cited: boolean;
  questions: { platform: string; questionText: string; count: number }[];
  sameDomainArticles: number;
  stance: "hostile" | "neutral" | "friendly" | null;
  authorityLevel: number | null;
  // AI-propagation risk: high-authority + negative article + already AI-cited = highest
  propagationRisk: "high" | "medium" | "low";
}

// For a single monitored article: is its source already cited by AI, on which platforms/questions,
// and how severe is the AI-propagation risk (authority × negativity × already-cited).
export async function getArticlePenetration(articleId: number): Promise<ArticlePenetration | null> {
  const article = await getMonitorArticleById(articleId);
  if (!article) return null;
  const cit = await getDomainAiCitation(article.domain);
  const domain = cit.domain;

  let questions: ArticlePenetration["questions"] = [];
  let sameDomainArticles = 0;
  if (domain) {
    const qRows = await rawRows<{ platform: string; questionText: string; c: number }>(sql`
      SELECT co.platform AS platform, co.questionText AS questionText, COUNT(*) AS c
      FROM citations ci JOIN collections co ON ci.collectionId = co.id
      WHERE ${sql.raw(normSql("ci.domain"))} = ${domain}
      GROUP BY co.platform, co.questionText
      ORDER BY c DESC
      LIMIT 12`);
    questions = qRows.map((r) => ({
      platform: String(r.platform),
      questionText: String(r.questionText ?? ""),
      count: Number(r.c) || 0,
    }));
    const cntRows = await rawRows<{ n: number }>(sql`
      SELECT COUNT(*) AS n FROM monitor_articles
      WHERE ${sql.raw(normSql("domain"))} = ${domain}`);
    sameDomainArticles = Number(cntRows[0]?.n) || 0;
  }

  const stance = ((article as any).stance ?? null) as ArticlePenetration["stance"];
  const authorityLevel =
    (article as any).authorityLevel == null ? null : Number((article as any).authorityLevel);
  const negative = (article.sentimentScore ?? 3) <= 2 || article.threatLevel === "high";
  let propagationRisk: "high" | "medium" | "low" = "low";
  if (cit.aiPlatforms > 0 && negative && (stance === "hostile" || (authorityLevel ?? 0) >= 7)) {
    propagationRisk = "high";
  } else if (cit.aiPlatforms > 0 && (negative || stance === "hostile")) {
    propagationRisk = "medium";
  }

  return {
    articleId,
    ...cit,
    cited: cit.aiPlatforms > 0,
    questions,
    sameDomainArticles,
    stance,
    authorityLevel,
    propagationRisk,
  };
}

export interface CitationSourceActivity {
  domain: string;
  aiPlatforms: number;
  aiCitations: number;
  platformList: string[];
  stance: "hostile" | "neutral" | "friendly" | null;
  articles: number;
  negatives: number;
  latest: { title: string | null; url: string; sentimentScore: number | null; publishedAt: number | null } | null;
}

// Reverse lens: start from the sources AI is already citing, and surface what they are publishing
// about us now (esp. negatives). Answers "an AI-trusted source just went hostile — act."
export async function getCitationSourceActivity(opts?: { limit?: number }): Promise<CitationSourceActivity[]> {
  const limit = opts?.limit && Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 40;
  // Cited domains that also appear in the monitor, most-negative / most-penetrated first.
  const rows = await rawRows<any>(
    sql.raw(`
    SELECT c.domain AS domain, c.aiCitations AS aiCitations, c.aiPlatforms AS aiPlatforms,
           c.platformList AS platformList, sr.stance AS stance,
           m.articles AS articles, m.negatives AS negatives
    FROM (
      SELECT ${normSql("ci.domain")} AS domain, COUNT(*) AS aiCitations,
             COUNT(DISTINCT co.platform) AS aiPlatforms,
             GROUP_CONCAT(DISTINCT co.platform ORDER BY co.platform SEPARATOR ',') AS platformList
      FROM citations ci JOIN collections co ON ci.collectionId = co.id
      GROUP BY ${normSql("ci.domain")}
    ) c
    JOIN (
      SELECT ${normSql("domain")} AS domain, COUNT(*) AS articles,
             SUM(CASE WHEN sentimentScore <= 2 AND relevance IN ('high','medium') THEN 1 ELSE 0 END) AS negatives
      FROM monitor_articles WHERE domain IS NOT NULL AND domain <> ''
      GROUP BY ${normSql("domain")}
    ) m ON c.domain = m.domain
    LEFT JOIN monitor_source_rules sr ON sr.domain = c.domain
    ORDER BY (sr.stance = 'hostile') DESC, m.negatives DESC, c.aiPlatforms DESC
    LIMIT ${limit}
  `),
  );
  if (rows.length === 0) return [];

  // Pull the latest monitor article per domain in one query, pick newest in JS.
  const domains = rows.map((r) => String(r.domain));
  const latestByDomain = new Map<string, CitationSourceActivity["latest"]>();
  const latestRows = await rawRows<any>(sql`
    SELECT ${sql.raw(normSql("domain"))} AS domain, title, url, sentimentScore, publishedAt, createdAt
    FROM monitor_articles
    WHERE ${sql.raw(normSql("domain"))} IN (${sql.join(domains, sql`, `)})
    ORDER BY COALESCE(publishedAt, UNIX_TIMESTAMP(createdAt) * 1000) DESC`);
  for (const r of latestRows) {
    const d = String(r.domain);
    if (!latestByDomain.has(d)) {
      latestByDomain.set(d, {
        title: r.title ?? null,
        url: String(r.url),
        sentimentScore: r.sentimentScore == null ? null : Number(r.sentimentScore),
        publishedAt: r.publishedAt == null ? null : Number(r.publishedAt),
      });
    }
  }

  return rows.map((r) => ({
    domain: String(r.domain),
    aiCitations: Number(r.aiCitations) || 0,
    aiPlatforms: Number(r.aiPlatforms) || 0,
    platformList: r.platformList ? String(r.platformList).split(",").filter(Boolean) : [],
    stance: (r.stance ?? null) as CitationSourceActivity["stance"],
    articles: Number(r.articles) || 0,
    negatives: Number(r.negatives) || 0,
    latest: latestByDomain.get(String(r.domain)) ?? null,
  }));
}
