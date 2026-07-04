// Gate 广场 (Gate Square) as a SocialSource. Gate sits behind Akamai — our direct/self fetch gets 403
// and Gate's keyword search page doesn't render server-side, so the ONLY viable path is Firecrawl
// rendering the 广场 feed page. One render (1 credit) returns ~50 fresh UGC posts WITH their body text,
// so we parse post {author,url,body} out of the markdown, keyword-filter on the body, and hand the pipeline
// fullContent directly (no per-post render). The render is cached for a cycle so all keywords share 1 credit,
// budget-gated via the shared monthly Firecrawl counter. Language filtering (zh/en only) happens in the pipeline.
import * as db from "../../db";
import * as budget from "../budget";
import { log, parseSerperDate, keywordMatchesText, fetchWithTimeout } from "../util";
import type { SocialSource, DiscoveredPost, SearchOpts } from "./types";

// TRON/TRX topic feeds — the 广场 "Latest" firehose is generic (≈0 TRON UGC/snapshot), but these
// topic pages are TRON-dedicated UGC and render fine through Firecrawl. 2 renders = 2 credits/cycle.
const LIST_URLS = ["https://www.gate.com/post/topic/TRON", "https://www.gate.com/post/topic/TRX"];
const CACHE_TTL_MS = 8 * 60 * 1000; // one monitor cycle shares a single render pass
const MAX_POSTS = 80; // safety cap on parsed posts per render

type ParsedPost = { url: string; author: string | null; body: string; publishedAt: number | null };

let cache: { at: number; posts: ParsedPost[]; renderCostUsd: number; costClaimed: boolean } | null = null;

async function firecrawlMarkdown(url: string): Promise<string> {
  const key = await db.getGlobalApiKeyByName("Firecrawl");
  if (!key?.apiKey) throw new Error("no firecrawl key");
  const base = (key.baseUrl || "https://api.firecrawl.dev").replace(/\/$/, "");
  const resp = await fetchWithTimeout(`${base}/v1/scrape`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: 55000 }),
  }, 65000); // client abort above Firecrawl's 55s server-side scrape timeout
  if (!resp.ok) throw new Error(`firecrawl HTTP ${resp.status}`);
  const json: any = await resp.json();
  return (json?.data?.markdown || json?.markdown || "").trim();
}

// Parse the 广场 feed markdown into posts. Each block looks like:
//   [AuthorName](https://www.gate.com/profile/…)
//   [1h ago](https://www.gate.com/post/status/12345)
//   Follow
//   <body line(s)>
// We anchor on the status link, take the nearest preceding profile label as author, and collect the
// text lines after it (until the next status anchor), stripping images / pure-link (ticker/nav) lines.
export function parseGateFeed(md: string): ParsedPost[] {
  const lines = md.split("\n").map((l) => l.trim());
  const anchors: { i: number; url: string; age: string | null }[] = [];
  lines.forEach((l, i) => {
    const m = l.match(/\[([^\]]*)\]\((https?:\/\/[^)]*?\/post\/status\/\d+)\)/);
    if (m) anchors.push({ i, url: m[2].split("?")[0], age: /\bago\b|刚刚|分钟|小时|now/i.test(m[1]) ? m[1] : null });
  });
  const out: ParsedPost[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < anchors.length; k++) {
    const start = anchors[k].i;
    const end = k + 1 < anchors.length ? anchors[k + 1].i : lines.length;
    if (seen.has(anchors[k].url)) continue;
    let author: string | null = null;
    for (let j = start; j >= Math.max(0, start - 4); j--) {
      const am = lines[j].match(/^\[([^\]]+)\]\(https?:\/\/[^)]*\/profile\/[^)]*\)/);
      if (am) { author = am[1]; break; }
    }
    const bodyLines: string[] = [];
    for (let j = start + 1; j < end; j++) {
      const l = lines[j];
      if (!l || l === "Follow" || l === "LIVE") continue;
      if (/^!\[/.test(l)) continue; // image
      if (/^\[[^\]]*\]\([^)]*\)$/.test(l)) continue; // pure-link line (ticker/profile/nav widget)
      const txt = l.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*`]+/g, "").trim(); // links → text
      if (txt.length >= 2) bodyLines.push(txt);
    }
    const body = bodyLines.join(" ").replace(/\s+/g, " ").trim();
    if (body.length < 15) continue; // skip empty/widget-only blocks
    seen.add(anchors[k].url);
    out.push({ url: anchors[k].url, author, body: body.slice(0, 4000), publishedAt: parseSerperDate(anchors[k].age) });
    if (out.length >= MAX_POSTS) break;
  }
  return out;
}

async function ensureFeed(): Promise<ParsedPost[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.posts;
  const all: ParsedPost[] = [];
  const seen = new Set<string>();
  let creditsUsed = 0;
  for (const url of LIST_URLS) {
    if (!budget.hasFirecrawlBudget() || !budget.tryConsumeFirecrawl()) {
      log.warn("gate_square: Firecrawl budget exhausted — stopping feed render early");
      break;
    }
    creditsUsed++;
    try {
      const md = await firecrawlMarkdown(url);
      for (const p of parseGateFeed(md)) if (!seen.has(p.url)) { seen.add(p.url); all.push(p); }
    } catch (e: any) {
      log.error(`gate_square: render failed ${url}: ${String(e?.message || e).slice(0, 120)}`);
      // credit already consumed (Firecrawl bills per call) — keep going to the next feed
    }
  }
  if (creditsUsed === 0) return cache?.posts || []; // no budget at all → reuse stale cache if present
  cache = { at: Date.now(), posts: all, renderCostUsd: budget.FIRECRAWL_USD_PER_CREDIT * creditsUsed, costClaimed: false };
  log.info(`gate_square: rendered ${creditsUsed} topic feed(s) (${creditsUsed} credits) → ${all.length} UGC posts parsed`);
  return all;
}

export const gateSquareSource: SocialSource = {
  name: "gate_square",
  platform: "gate_square",
  enabled: true,
  async search(keyword: string, _opts?: SearchOpts): Promise<DiscoveredPost[]> {
    const posts = await ensureFeed();
    if (!keyword.trim()) return [];
    const matched = posts.filter((p) => keywordMatchesText(keyword, p.body));
    return matched.map((p) => {
      // Attribute the single per-cycle render credit to the first post that actually surfaces.
      let costHint = 0;
      if (cache && !cache.costClaimed) { costHint = cache.renderCostUsd; cache.costClaimed = true; }
      return {
        url: p.url,
        title: p.body.replace(/\s+/g, " ").slice(0, 80),
        fullContent: p.body,
        author: p.author,
        publishedAt: p.publishedAt,
        sourceName: "gate_square",
        sourcePlatform: "gate_square",
        fetchEngineHint: "gate_firecrawl",
        fetchCostUsdHint: costHint,
      };
    });
  },
};

// test-only: reset the module cache between runs
export function __resetGateCache() { cache = null; }
