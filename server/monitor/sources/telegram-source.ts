// Telegram broadcast channels as a SocialSource. Zero cost: the public preview page t.me/s/{channel}
// serves recent messages as plain HTML — no API, no login. We parse messages, keyword-filter for
// 孙宇晨/波场/TRON, and hand the pipeline the message text as fullContent.
//
// HONEST SCOPE (validated 2026-07-03): TRON's own official Telegram presence is GROUPS (t.me/s shows
// only metadata) or a dead channel (@Tronscan, last post 2018) — NOT usable. So these are ACTIVE
// crypto-NEWS broadcast channels that cover TRON/Justin Sun, keyword-filtered. Value = fast news
// (often TG-first), not "official TRON channel". @BWEnews (方程式新闻) is a fast Chinese crypto source.
import { log, keywordMatchesText } from "../util";
import type { SocialSource, DiscoveredPost, SearchOpts } from "./types";

// Active broadcast channels (t.me/s reachable) that cover TRON/Justin Sun/HTX. HONEST CEILING (validated
// 2026-07-04): TRON is a low-frequency topic in general crypto broadcast channels (~1/20 msgs), and TRON's
// own channels are groups (t.me/s serves no messages). Best available: wublockchainenglish (吴说, HTX/Sun
// beat) + theblockbeats (律动, 中文) added to the general-news set. RSS tag feeds carry the real signal.
const CHANNELS = ["watcherguru", "cointelegraph", "BWEnews", "wublockchainenglish", "theblockbeats"];
const CACHE_TTL_MS = 8 * 60 * 1000;
const MAX_MSGS_PER_CHANNEL = 40;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

type TgMsg = { url: string; text: string; publishedAt: number | null };
let cache: { at: number; msgs: TgMsg[] } | null = null;

const stripHtml = (s: string) =>
  (s || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

// Parse a t.me/s/{channel} preview page. Each message is wrapped in a .tgme_widget_message_wrap block
// containing a text div, a permalink date-anchor, and a <time datetime>.
export function parseTelegramPreview(html: string): TgMsg[] {
  const out: TgMsg[] = [];
  const blocks = html.split("tgme_widget_message_wrap").slice(1);
  for (const b of blocks) {
    const textM = b.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
    const linkM = b.match(/tgme_widget_message_date"\s+href="(https:\/\/t\.me\/[^"]+)"/);
    const timeM = b.match(/datetime="([^"]+)"/);
    if (!textM || !linkM) continue;
    const text = stripHtml(textM[1]);
    if (text.length < 10) continue;
    out.push({
      url: linkM[1].split("?")[0],
      text: text.slice(0, 4000),
      publishedAt: timeM ? Date.parse(timeM[1]) || null : null,
    });
    if (out.length >= MAX_MSGS_PER_CHANNEL * CHANNELS.length) break;
  }
  return out;
}

async function ensureMessages(): Promise<TgMsg[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.msgs;
  const all: TgMsg[] = [];
  const seen = new Set<string>();
  await Promise.all(
    CHANNELS.map(async (ch) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000); // don't let a hung t.me request stall the cycle
      try {
        const resp = await fetch(`https://t.me/s/${ch}`, { headers: { "User-Agent": UA }, signal: ctrl.signal });
        if (!resp.ok) { log.warn(`telegram: ${ch} HTTP ${resp.status}`); return; }
        const html = await resp.text();
        for (const m of parseTelegramPreview(html).slice(-MAX_MSGS_PER_CHANNEL)) {
          if (seen.has(m.url)) continue;
          seen.add(m.url);
          all.push(m);
        }
      } catch (e: any) {
        log.warn(`telegram: ${ch} failed: ${String(e?.message || e).slice(0, 120)}`);
      } finally {
        clearTimeout(timer);
      }
    })
  );
  cache = { at: Date.now(), msgs: all };
  log.info(`telegram: fetched ${CHANNELS.length} channels → ${all.length} messages`);
  return all;
}

export const telegramSource: SocialSource = {
  name: "telegram",
  platform: "telegram",
  enabled: true,
  async search(keyword: string, _opts?: SearchOpts): Promise<DiscoveredPost[]> {
    const msgs = await ensureMessages();
    if (!keyword.trim()) return [];
    const matched = msgs.filter((m) => keywordMatchesText(keyword, m.text));
    return matched.map((m) => ({
      url: m.url,
      title: m.text.replace(/\s+/g, " ").slice(0, 80),
      fullContent: m.text,
      publishedAt: m.publishedAt,
      sourceName: "telegram",
      sourcePlatform: "telegram",
      fetchEngineHint: "telegram",
      fetchCostUsdHint: 0,
    }));
  },
};

export function __resetTelegramCache() { cache = null; }
