// Orchestrates one monitor cycle: search (Serper) → dedup → fetch (pluggable router) → analyze
// (DeepSeek) → persist. Budget-guarded: Serper/Firecrawl monthly caps + per-cycle article cap.
// Concurrency 3 with per-domain politeness.
import * as db from "../db";
import { searchNews } from "./search";
import { fetchArticle } from "./fetch/router";
import { analyzeArticle } from "./analyzer";
import * as budget from "./budget";
import { normalizeUrl, sha256, domainOf, parseSerperDate, log } from "./util";

const CONCURRENCY = 3; // gentle on external sites
const PER_DOMAIN_MS = 2000; // robots politeness: ≥2s between hits to the same domain (our L1 fetch)
const MAX_CONTENT_CHARS = 200_000; // cap stored markdown

export type MonitorCycleResult = {
  keywords: number;
  serperCalls: number;
  serperBudgetHit: boolean;
  discovered: number;
  newArticles: number;
  inserted: number;
  analyzed: number;
  engineDist: Record<string, number>; // fetchEngine → count (self/firecrawl/snippet/…)
  fetchCostUsd: number;
  analysisCostUsd: number;
  failed: number;
  tbs: string;
};

// engine name → legacy fetchMethod enum value (back-compat column); unknown engines → null.
function toFetchMethod(engine: string): "self" | "firecrawl" | "snippet_only" | null {
  if (engine === "snippet") return "snippet_only";
  if (engine === "self" || engine === "firecrawl") return engine;
  return null;
}

export async function runMonitorCycle(opts?: { tbs?: string }): Promise<MonitorCycleResult> {
  const tbs = opts?.tbs ?? "qdr:d";
  await budget.beginCycle(); // load limits + counters (applies monthly reset / picks up limit changes)
  const maxPerCycle = budget.maxArticlesPerCycle();
  const keywords = await db.listMonitorKeywords(true);

  // 1) Search each active keyword (Serper budget-gated), aggregate unique urls by normalized-url hash.
  let serperCalls = 0;
  let serperBudgetHit = false;
  const discovered = new Map<
    string,
    { url: string; normUrl: string; title: string; snippet: string; date: string | null; matched: Set<string> }
  >();
  for (const kw of keywords) {
    if (!budget.tryConsumeSerper()) {
      serperBudgetHit = true;
      log.warn(`Serper monthly budget exhausted; stopping search after ${serperCalls} calls`);
      break;
    }
    try {
      const items = await searchNews(kw.keyword, { tbs, num: 10 });
      serperCalls++;
      for (const it of items) {
        const normUrl = normalizeUrl(it.url);
        const h = sha256(normUrl);
        const existing = discovered.get(h);
        if (existing) {
          existing.matched.add(kw.keyword);
        } else {
          discovered.set(h, {
            url: it.url,
            normUrl,
            title: it.title,
            snippet: it.snippet,
            date: it.date,
            matched: new Set([kw.keyword]),
          });
        }
      }
    } catch (e: any) {
      log.error(`Serper search failed for "${kw.keyword}": ${String(e?.message || e).slice(0, 160)}`);
    }
  }
  log.info(`Search done: ${keywords.length} keywords, ${serperCalls} serper calls, ${discovered.size} unique urls`);

  // 2) Drop urls already stored (dedup); cap the batch at the budget's per-cycle limit.
  const fresh: { hash: string; url: string; normUrl: string; title: string; snippet: string; date: string | null; matched: string[] }[] = [];
  for (const [h, v] of Array.from(discovered)) {
    const seen = await db.getMonitorArticleByUrlHash(h);
    if (seen) continue;
    fresh.push({ hash: h, url: v.url, normUrl: v.normUrl, title: v.title, snippet: v.snippet, date: v.date, matched: Array.from(v.matched) });
    if (fresh.length >= maxPerCycle) {
      log.warn(`Reached per-cycle cap (${maxPerCycle}); ${discovered.size - fresh.length}+ new urls deferred`);
      break;
    }
  }
  log.info(`Dedup done: ${fresh.length} new articles to process (cap ${maxPerCycle})`);

  const stats: MonitorCycleResult = {
    keywords: keywords.length,
    serperCalls,
    serperBudgetHit,
    discovered: discovered.size,
    newArticles: fresh.length,
    inserted: 0,
    analyzed: 0,
    engineDist: {},
    fetchCostUsd: 0,
    analysisCostUsd: 0,
    failed: 0,
    tbs,
  };

  // 3) Fetch (router) + analyze + persist, with a worker pool + per-domain politeness.
  const lastByDomain = new Map<string, number>();
  const politeWait = async (domain: string) => {
    const now = Date.now();
    const last = lastByDomain.get(domain) || 0;
    const wait = Math.max(0, PER_DOMAIN_MS - (now - last));
    lastByDomain.set(domain, now + wait);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  };

  let cursor = 0;
  const worker = async () => {
    while (cursor < fresh.length) {
      const cur = fresh[cursor++];
      const domain = domainOf(cur.url);
      try {
        if (domain) await politeWait(domain);
        const fr = await fetchArticle(cur.url, cur.snippet);
        stats.engineDist[fr.engine] = (stats.engineDist[fr.engine] || 0) + 1;
        stats.fetchCostUsd += fr.costUsd || 0;
        const fetchStatus = fr.status || (fr.success ? "full" : "failed");
        const contentMd = fr.contentMd ? fr.contentMd.slice(0, MAX_CONTENT_CHARS) : "";

        let analysis = null;
        if (contentMd.length > 0) {
          try {
            analysis = await analyzeArticle({
              url: cur.url,
              title: fr.title || cur.title,
              contentMd,
              snippet: cur.snippet,
              fetchStatus: fetchStatus as any,
            });
          } catch (e: any) {
            log.error(`Analyze failed ${cur.url}: ${String(e?.message || e).slice(0, 160)}`);
          }
        }

        const id = await db.createMonitorArticle({
          url: cur.normUrl.slice(0, 768),
          urlHash: cur.hash,
          domain: domain ? domain.slice(0, 128) : null,
          title: (fr.title || cur.title || "").slice(0, 512) || null,
          contentMd: contentMd || null,
          contentHash: contentMd ? sha256(contentMd) : null,
          publishedAt: parseSerperDate(cur.date),
          firstSeenAt: Date.now(),
          fetchEngine: fr.engine,
          fetchMethod: toFetchMethod(fr.engine) as any,
          fetchStatus: fetchStatus as any,
          fetchCostUsd: String(fr.costUsd || 0),
          matchedKeywords: cur.matched,
          sentimentScore: analysis?.sentimentScore ?? null,
          relevance: analysis?.relevance ?? null,
          threatLevel: analysis?.threatLevel ?? null,
          analysisSummary: analysis?.summary ?? null,
          analyzedAt: analysis ? Date.now() : null,
          promptTokens: analysis?.promptTokens ?? null,
          completionTokens: analysis?.completionTokens ?? null,
          costUsd: analysis?.costUsd != null ? String(analysis.costUsd) : null,
        });
        if (id) stats.inserted++;
        if (analysis) {
          stats.analyzed++;
          stats.analysisCostUsd += analysis.costUsd || 0;
        }
      } catch (e: any) {
        stats.failed++;
        log.error(`Pipeline item failed ${cur.url}: ${String(e?.message || e).slice(0, 160)}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, fresh.length || 1) }, () => worker()));
  stats.fetchCostUsd = Math.round(stats.fetchCostUsd * 1_000_000) / 1_000_000;
  stats.analysisCostUsd = Math.round(stats.analysisCostUsd * 1_000_000) / 1_000_000;
  log.info(`Monitor cycle complete: ${JSON.stringify(stats)}`);
  return stats;
}
