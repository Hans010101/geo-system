// English crypto-media RSS as a SocialSource. Zero cost: pull each feed's XML once per cycle (cached),
// keyword-filter items for 孙宇晨/波场/TRON, hand the pipeline the item text as fullContent → no Serper
// call, no Firecrawl render. Feeds validated 2026-07-03 (see web3-sources-survey.md); Cointelegraph's
// TRON-tag feed is TRON-dedicated. Adding/removing a feed = edit FEEDS.
import Parser from "rss-parser";
import { log, keywordMatchesText } from "../util";
import type { SocialSource, DiscoveredPost, SearchOpts } from "./types";

// Two tiers: (A) TRON/Justin-Sun-DEDICATED tag feeds — nearly 100% on-topic, the real signal (validated
// 2026-07-04, density 10-36/feed); (B) general crypto feeds — ~0 TRON density but zero marginal cost and
// occasionally catch a mainstream TRON story before it's tagged. TRON news is sparse, so most tag-feed
// items are weeks old (why the RSS collect window is widened to 30d in the pipeline, RSS-only).
const FEEDS = [
  // (A) TRON / Justin Sun dedicated
  "https://cointelegraph.com/rss/tag/tron",
  "https://cointelegraph.com/rss/tag/justin-sun",
  "https://www.newsbtc.com/tag/tron/feed/", // freshest dedicated feed (often <2d)
  "https://www.newsbtc.com/tag/justin-sun/feed/",
  "https://cryptopotato.com/tag/tron/feed/",
  "https://coingape.com/tag/tron/feed/",
  "https://cryptoslate.com/tag/justin-sun/feed/",
  // (B) general (low TRON density, kept for recall at zero cost)
  "https://cointelegraph.com/rss",
  "https://www.coindesk.com/arc/outboundfeeds/rss/",
  "https://decrypt.co/feed",
  "https://blockworks.co/feed",
];
const CACHE_TTL_MS = 8 * 60 * 1000; // one monitor cycle shares one pull of all feeds
const MAX_ITEMS_PER_FEED = 40;
const MIN_FULL_CHARS = 200; // shorter than this → let the pipeline fetch the full article (self L1, free)

// Fetch the XML ourselves with AbortController (rss-parser's own timeout rejects the promise but leaks
// the socket on a hung feed — abort() actually destroys the connection), then parseString.
const parser = new Parser();
const FEED_TIMEOUT_MS = 20000;
async function fetchFeed(url: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FEED_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers: { "User-Agent": "geo-monitor/1.0 (+rss)" }, signal: ctrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await parser.parseString(await resp.text());
  } finally {
    clearTimeout(timer);
  }
}

type FeedItem = { url: string; title: string; text: string; publishedAt: number | null };
let cache: { at: number; items: FeedItem[] } | null = null;

const stripHtml = (s: string) =>
  (s || "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

async function ensureFeeds(): Promise<FeedItem[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.items;
  const items: FeedItem[] = [];
  const seen = new Set<string>();
  await Promise.all(
    FEEDS.map(async (url) => {
      try {
        const feed = await fetchFeed(url);
        for (const it of (feed.items || []).slice(0, MAX_ITEMS_PER_FEED)) {
          const link = (it.link || "").trim();
          if (!link || seen.has(link)) continue;
          seen.add(link);
          const body = stripHtml((it as any)["content:encoded"] || it.content || it.contentSnippet || it.summary || "");
          items.push({
            url: link,
            title: (it.title || "").trim().slice(0, 200),
            text: body,
            publishedAt: it.isoDate ? Date.parse(it.isoDate) : it.pubDate ? Date.parse(it.pubDate) : null,
          });
        }
      } catch (e: any) {
        log.warn(`rss: feed failed ${url}: ${String(e?.message || e).slice(0, 120)}`);
      }
    })
  );
  cache = { at: Date.now(), items };
  log.info(`rss: pulled ${FEEDS.length} feeds → ${items.length} unique items`);
  return items;
}

export const rssSource: SocialSource = {
  name: "rss",
  platform: "rss",
  enabled: true,
  async search(keyword: string, _opts?: SearchOpts): Promise<DiscoveredPost[]> {
    const items = await ensureFeeds();
    if (!keyword.trim()) return [];
    const matched = items.filter((it) => keywordMatchesText(keyword, `${it.title} ${it.text}`));
    return matched.map((it) => {
      const full = it.text.length >= MIN_FULL_CHARS;
      return {
        url: it.url,
        title: it.title || it.text.slice(0, 80),
        // Long RSS body → use as fullContent (zero fetch). Short → contentSnippet, pipeline self-fetches (L1, free).
        ...(full ? { fullContent: it.text, fetchEngineHint: "rss", fetchCostUsdHint: 0 } : { contentSnippet: it.text }),
        publishedAt: it.publishedAt,
        sourceName: "rss",
        sourcePlatform: "rss",
      } as DiscoveredPost;
    });
  },
};

export function __resetRssCache() { cache = null; }
