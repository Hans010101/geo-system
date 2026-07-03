// English crypto-media RSS as a SocialSource. Zero cost: pull each feed's XML once per cycle (cached),
// keyword-filter items for 孙宇晨/波场/TRON, hand the pipeline the item text as fullContent → no Serper
// call, no Firecrawl render. Feeds validated 2026-07-03 (see web3-sources-survey.md); Cointelegraph's
// TRON-tag feed is TRON-dedicated. Adding/removing a feed = edit FEEDS.
import Parser from "rss-parser";
import { log, keywordMatchesText } from "../util";
import type { SocialSource, DiscoveredPost, SearchOpts } from "./types";

const FEEDS = [
  "https://cointelegraph.com/rss/tag/tron", // TRON-dedicated
  "https://cointelegraph.com/rss",
  "https://www.coindesk.com/arc/outboundfeeds/rss/",
  "https://decrypt.co/feed",
  "https://blockworks.co/feed",
];
const CACHE_TTL_MS = 8 * 60 * 1000; // one monitor cycle shares one pull of all feeds
const MAX_ITEMS_PER_FEED = 40;
const MIN_FULL_CHARS = 200; // shorter than this → let the pipeline fetch the full article (self L1, free)

const parser = new Parser({ timeout: 20000, headers: { "User-Agent": "geo-monitor/1.0 (+rss)" } });

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
        const feed = await parser.parseURL(url);
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
