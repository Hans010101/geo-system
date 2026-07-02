// Orchestrates one monitor cycle across all enabled SocialSources: search → cross-source dedup →
// (fetch router unless the source already gave fullContent) → DeepSeek analyze → persist.
// Budget-guarded (Serper monthly cap; per-cycle article cap). Concurrency 3 with per-domain politeness.
import * as db from "../db";
import { fetchArticle } from "./fetch/router";
import { analyzeArticle } from "./analyzer";
import * as budget from "./budget";
import { enabledSources } from "./sources/registry";
import type { DiscoveredPost } from "./sources/types";
import { dispatchHighThreatAlert, sendBriefing, type BriefingItem } from "./notify";
import { normalizeUrl, sha256, domainOf, hasCJK, log } from "./util";

const CONCURRENCY = 3;
const PER_DOMAIN_MS = 2000;
const MAX_CONTENT_CHARS = 200_000;

export type MonitorCycleResult = {
  keywords: number;
  serperCalls: number;
  serperBudgetHit: boolean;
  discovered: number;
  newArticles: number;
  inserted: number;
  analyzed: number;
  engineDist: Record<string, number>; // fetchEngine → count (self/firecrawl/snippet/source_api)
  sourceDist: Record<string, number>; // sourcePlatform → count (web/binance_square)
  fetchCostUsd: number;
  analysisCostUsd: number;
  failed: number;
  realtimeAlerts: number; // high-threat alerts created this cycle
  briefingSent: boolean;
  tbs: string;
};

function toFetchMethod(engine: string): "self" | "firecrawl" | "snippet_only" | null {
  if (engine === "snippet") return "snippet_only";
  if (engine === "self" || engine === "firecrawl") return engine;
  return null; // 'source_api' and future engines have no legacy enum value
}

type FreshItem = { hash: string; post: DiscoveredPost; normUrl: string; matched: string[] };

export async function runMonitorCycle(opts?: { tbs?: string }): Promise<MonitorCycleResult> {
  const tbsOverride = opts?.tbs;
  await budget.beginCycle();
  const maxPerCycle = budget.maxArticlesPerCycle();
  const keywords = await db.listMonitorKeywords(true);
  const srcs = enabledSources();

  // 1) Every enabled source × every active keyword → aggregate unique posts (cross-source, by norm-url).
  let serperCalls = 0;
  let serperBudgetHit = false;
  let serperExhausted = false;
  const discovered = new Map<string, { post: DiscoveredPost; normUrl: string; matched: Set<string> }>();
  for (const kw of keywords) {
    const zh = hasCJK(kw.keyword);
    const kwTbs = tbsOverride ?? (kw.priority >= 8 ? "qdr:d" : "qdr:w");
    for (const source of srcs) {
      // Budget applies to Serper only (币安 API is free).
      if (source.name === "serper") {
        if (serperExhausted) continue;
        if (!budget.tryConsumeSerper()) {
          serperExhausted = true;
          serperBudgetHit = true;
          log.warn("Serper monthly budget exhausted; skipping remaining Serper searches");
          continue;
        }
      }
      try {
        const posts = await source.search(kw.keyword, { tbs: kwTbs, num: 20, gl: zh ? "cn" : "us", hl: zh ? "zh-cn" : "en" });
        if (source.name === "serper") serperCalls++;
        for (const p of posts) {
          if (!p.url) continue;
          const normUrl = normalizeUrl(p.url);
          const h = sha256(normUrl);
          const existing = discovered.get(h);
          if (existing) existing.matched.add(kw.keyword);
          else discovered.set(h, { post: p, normUrl, matched: new Set([kw.keyword]) });
        }
      } catch (e: any) {
        log.error(`source ${source.name} failed for "${kw.keyword}": ${String(e?.message || e).slice(0, 160)}`);
      }
    }
  }
  log.info(`Search done: ${keywords.length} keywords × ${srcs.length} sources → ${discovered.size} unique posts (serperCalls ${serperCalls})`);

  // 2) Drop already-stored (dedup vs DB), cap the batch.
  const fresh: FreshItem[] = [];
  for (const [h, v] of Array.from(discovered)) {
    if (await db.getMonitorArticleByUrlHash(h)) continue;
    fresh.push({ hash: h, post: v.post, normUrl: v.normUrl, matched: Array.from(v.matched) });
    if (fresh.length >= maxPerCycle) {
      log.warn(`Reached per-cycle cap (${maxPerCycle}); ${discovered.size - fresh.length}+ new posts deferred`);
      break;
    }
  }
  log.info(`Dedup done: ${fresh.length} new posts to process (cap ${maxPerCycle})`);

  const stats: MonitorCycleResult = {
    keywords: keywords.length, serperCalls, serperBudgetHit, discovered: discovered.size,
    newArticles: fresh.length, inserted: 0, analyzed: 0, engineDist: {}, sourceDist: {},
    fetchCostUsd: 0, analysisCostUsd: 0, failed: 0, realtimeAlerts: 0, briefingSent: false,
    tbs: tbsOverride ?? "auto(d/w)",
  };
  const briefingItems: BriefingItem[] = []; // relevance high/medium, collected for the briefing

  // 3) Fetch (only if the source didn't give fullContent) + analyze + persist.
  const lastByDomain = new Map<string, number>();
  const politeWait = async (domain: string) => {
    const now = Date.now();
    const wait = Math.max(0, PER_DOMAIN_MS - (now - (lastByDomain.get(domain) || 0)));
    lastByDomain.set(domain, now + wait);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  };

  let cursor = 0;
  const worker = async () => {
    while (cursor < fresh.length) {
      const cur = fresh[cursor++];
      const p = cur.post;
      const domain = domainOf(p.url);
      try {
        let contentMd: string;
        let title: string;
        let fetchEngine: string;
        let fetchStatus: "full" | "partial" | "failed";
        let fetchCostUsd = 0;

        if (p.fullContent && p.fullContent.length > 0) {
          // Source (e.g. 币安广场 API) already returned full text → skip the fetch router entirely.
          contentMd = p.fullContent.slice(0, MAX_CONTENT_CHARS);
          title = p.title || contentMd.slice(0, 80);
          fetchEngine = "source_api";
          fetchStatus = "full";
        } else {
          if (domain) await politeWait(domain);
          const fr = await fetchArticle(p.url, p.contentSnippet || "");
          contentMd = fr.contentMd ? fr.contentMd.slice(0, MAX_CONTENT_CHARS) : "";
          title = fr.title || p.title || "";
          fetchEngine = fr.engine;
          fetchStatus = (fr.status || (fr.success ? "full" : "failed")) as any;
          fetchCostUsd = fr.costUsd || 0;
        }
        stats.engineDist[fetchEngine] = (stats.engineDist[fetchEngine] || 0) + 1;
        stats.sourceDist[p.sourcePlatform] = (stats.sourceDist[p.sourcePlatform] || 0) + 1;
        stats.fetchCostUsd += fetchCostUsd;

        let analysis = null;
        if (contentMd.length > 0) {
          try {
            analysis = await analyzeArticle({ url: p.url, title, contentMd, snippet: p.contentSnippet || "", fetchStatus });
          } catch (e: any) {
            log.error(`Analyze failed ${p.url}: ${String(e?.message || e).slice(0, 160)}`);
          }
        }

        const id = await db.createMonitorArticle({
          url: cur.normUrl.slice(0, 768),
          urlHash: cur.hash,
          domain: domain ? domain.slice(0, 128) : null,
          title: (title || "").slice(0, 512) || null,
          contentMd: contentMd || null,
          contentHash: contentMd ? sha256(contentMd) : null,
          publishedAt: p.publishedAt ?? null,
          firstSeenAt: Date.now(),
          fetchEngine,
          fetchMethod: toFetchMethod(fetchEngine) as any,
          fetchStatus: fetchStatus as any,
          fetchCostUsd: String(fetchCostUsd),
          sourcePlatform: p.sourcePlatform,
          matchedKeywords: cur.matched,
          sentimentScore: analysis?.sentimentScore ?? null,
          relevance: analysis?.relevance ?? null,
          relevanceReason: analysis?.relevanceReason ?? null,
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
          // Collect high/medium relevance for the briefing (low/irrelevant excluded → no noise).
          if (analysis.relevance === "high" || analysis.relevance === "medium") {
            briefingItems.push({
              title: title || "",
              url: p.url,
              sourcePlatform: p.sourcePlatform,
              domain: domain || null,
              relevance: analysis.relevance,
              sentimentScore: analysis.sentimentScore,
              threatLevel: analysis.threatLevel,
            });
          }
          // High-threat → immediate real-time alert (deduped by urlHash inside).
          if (analysis.threatLevel === "high") {
            try {
              const res = await dispatchHighThreatAlert({
                url: p.url,
                urlHash: cur.hash,
                title: title || "",
                domain: domain || null,
                sentimentScore: analysis.sentimentScore,
                summary: analysis.summary,
              });
              if (res.created) stats.realtimeAlerts++;
            } catch (e: any) {
              log.error(`High-threat alert failed ${p.url}: ${String(e?.message || e).slice(0, 120)}`);
            }
          }
        }
      } catch (e: any) {
        stats.failed++;
        log.error(`Pipeline item failed ${p.url}: ${String(e?.message || e).slice(0, 160)}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, fresh.length || 1) }, () => worker()));
  stats.fetchCostUsd = Math.round(stats.fetchCostUsd * 1_000_000) / 1_000_000;
  stats.analysisCostUsd = Math.round(stats.analysisCostUsd * 1_000_000) / 1_000_000;

  // Briefing after the cycle (gated by sysConfig; default OFF until enabled on a test channel).
  try {
    const b = await sendBriefing(briefingItems, { keywords: keywords.length, sourceCount: srcs.length, newArticles: stats.inserted });
    stats.briefingSent = b.sent;
  } catch (e: any) {
    log.error(`Briefing dispatch failed: ${String(e?.message || e).slice(0, 160)}`);
  }

  log.info(`Monitor cycle complete: ${JSON.stringify(stats)}`);
  return stats;
}

// Re-run the analyzer on an already-stored article (using its saved content) under the current prompt.
export async function reanalyzeArticle(id: number): Promise<boolean> {
  const a = await db.getMonitorArticleById(id);
  if (!a) return false;
  const analysis = await analyzeArticle({
    url: a.url,
    title: a.title,
    contentMd: a.contentMd || "",
    snippet: "",
    fetchStatus: (a.fetchStatus as any) || "full",
  });
  await db.updateMonitorArticle(id, {
    sentimentScore: analysis.sentimentScore,
    relevance: analysis.relevance,
    relevanceReason: analysis.relevanceReason,
    threatLevel: analysis.threatLevel,
    analysisSummary: analysis.summary,
    analyzedAt: Date.now(),
    promptTokens: analysis.promptTokens,
    completionTokens: analysis.completionTokens,
    costUsd: analysis.costUsd != null ? String(analysis.costUsd) : null,
  });
  return true;
}
