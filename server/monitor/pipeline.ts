// Orchestrates one monitor cycle: search (Serper) → dedup → fetch (self/firecrawl/snippet) → analyze
// (DeepSeek) → persist. Guarded by a per-cycle cap; concurrency 3 with per-domain politeness.
import * as db from "../db";
import { searchNews } from "./search";
import { fetchArticle } from "./fetcher";
import { analyzeArticle } from "./analyzer";
import { normalizeUrl, sha256, domainOf, parseSerperDate, log } from "./util";

const MAX_PER_CYCLE = 50; // budget guardrail: never process more than N new articles per run
const CONCURRENCY = 3; // gentle on external sites
const PER_DOMAIN_MS = 2000; // robots politeness: ≥2s between hits to the same domain
const MAX_CONTENT_CHARS = 200_000; // cap stored markdown

export type MonitorCycleResult = {
  keywords: number;
  serperCalls: number;
  discovered: number;
  newArticles: number;
  inserted: number;
  analyzed: number;
  fetchMethods: { self: number; firecrawl: number; snippet_only: number };
  costUsd: number;
  failed: number;
  tbs: string;
};

export async function runMonitorCycle(opts?: { tbs?: string }): Promise<MonitorCycleResult> {
  const tbs = opts?.tbs ?? "qdr:d";
  const keywords = await db.listMonitorKeywords(true);

  // 1) Search every active keyword, aggregate unique urls (by normalized-url hash).
  let serperCalls = 0;
  const discovered = new Map<string, { url: string; normUrl: string; title: string; snippet: string; date: string | null; matched: Set<string> }>();
  for (const kw of keywords) {
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

  // 2) Drop urls already stored (dedup); cap the batch.
  const fresh: { hash: string; url: string; normUrl: string; title: string; snippet: string; date: string | null; matched: string[] }[] = [];
  for (const [h, v] of Array.from(discovered)) {
    const seen = await db.getMonitorArticleByUrlHash(h);
    if (seen) continue;
    fresh.push({ hash: h, url: v.url, normUrl: v.normUrl, title: v.title, snippet: v.snippet, date: v.date, matched: Array.from(v.matched) });
    if (fresh.length >= MAX_PER_CYCLE) {
      log.warn(`Reached per-cycle cap (${MAX_PER_CYCLE}); ${discovered.size - fresh.length}+ new urls deferred to next run`);
      break;
    }
  }
  log.info(`Dedup done: ${fresh.length} new articles to process`);

  const stats: MonitorCycleResult = {
    keywords: keywords.length,
    serperCalls,
    discovered: discovered.size,
    newArticles: fresh.length,
    inserted: 0,
    analyzed: 0,
    fetchMethods: { self: 0, firecrawl: 0, snippet_only: 0 },
    costUsd: 0,
    failed: 0,
    tbs,
  };

  // 3) Fetch + analyze + persist, with a worker pool + per-domain politeness gate.
  const lastByDomain = new Map<string, number>();
  const politeWait = async (domain: string) => {
    const now = Date.now();
    const last = lastByDomain.get(domain) || 0;
    const wait = Math.max(0, PER_DOMAIN_MS - (now - last));
    lastByDomain.set(domain, now + wait); // reserve the slot so concurrent workers queue
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
        stats.fetchMethods[fr.method]++;

        let analysis = null;
        try {
          analysis = await analyzeArticle({
            url: cur.url,
            title: fr.title || cur.title,
            contentMd: fr.contentMd,
            snippet: cur.snippet,
            fetchStatus: fr.status,
          });
        } catch (e: any) {
          log.error(`Analyze failed ${cur.url}: ${String(e?.message || e).slice(0, 160)}`);
        }

        const contentMd = fr.contentMd ? fr.contentMd.slice(0, MAX_CONTENT_CHARS) : null;
        const id = await db.createMonitorArticle({
          url: cur.normUrl.slice(0, 768),
          urlHash: cur.hash,
          domain: domain ? domain.slice(0, 128) : null,
          title: (fr.title || cur.title || "").slice(0, 512) || null,
          contentMd,
          contentHash: contentMd ? sha256(contentMd) : null,
          publishedAt: parseSerperDate(cur.date),
          firstSeenAt: Date.now(),
          fetchMethod: fr.method,
          fetchStatus: fr.status,
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
          stats.costUsd += analysis.costUsd || 0;
        }
      } catch (e: any) {
        stats.failed++;
        log.error(`Pipeline item failed ${cur.url}: ${String(e?.message || e).slice(0, 160)}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, fresh.length || 1) }, () => worker()));
  stats.costUsd = Math.round(stats.costUsd * 1_000_000) / 1_000_000;
  log.info(`Monitor cycle complete: ${JSON.stringify(stats)}`);
  return stats;
}
