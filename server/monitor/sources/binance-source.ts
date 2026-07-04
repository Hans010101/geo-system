// 币安广场 (Binance Square) as a SocialSource. Uses the internal search API validated in
// binance-square-poc.md (POST .../feed/search/list, unsigned) with a WAF cookie from sysConfigs.
// The API returns full post text → DiscoveredPost.fullContent is set → pipeline skips the fetch router
// (no Firecrawl cost). If no valid cookie, returns [] gracefully (rest of the pipeline unaffected).
import { randomUUID } from "crypto";
import { getStoredCookie, BINANCE_UA } from "./binance-cookie";
import { log, fetchWithTimeout } from "../util";
import type { SocialSource, DiscoveredPost, SearchOpts } from "./types";

const SEARCH_API = "https://www.binance.com/bapi/composite/v2/friendly/pgc/feed/search/list";
const POST_CARD_TYPES = new Set(["BUZZ_SHORT", "BUZZ_LONG"]); // actual posts; skip KOL groups/widgets

export const binanceSquareSource: SocialSource = {
  name: "binance_square",
  platform: "binance_square",
  enabled: true,
  async search(keyword: string, opts?: SearchOpts): Promise<DiscoveredPost[]> {
    const cookie = await getStoredCookie();
    if (!cookie) {
      log.warn(`binance_square: no valid WAF cookie — skipping "${keyword}" (refresh via admin trigger or external cron)`);
      return [];
    }
    try {
      const traceId = randomUUID();
      const resp = await fetchWithTimeout(SEARCH_API, {
        method: "POST",
        headers: {
          // captured template (device-info/versioncode/clienttype/csrftoken/lang/…) — required by the gateway
          versioncode: "2.61.0", // fallback; overridden by captured template if present
          ...cookie.headers,
          "content-type": "application/json",
          "user-agent": BINANCE_UA,
          "bnc-uuid": cookie.bncUuid,
          "x-trace-id": traceId,
          "x-ui-request-trace": traceId,
          cookie: cookie.cookie,
          referer: "https://www.binance.com/zh-CN/square",
        },
        body: JSON.stringify({ scene: "web", pageIndex: 1, pageSize: opts?.num ?? 20, searchContent: keyword, type: 1 }), // type 1 = 内容(posts); 2=创作者, 3=话题
      }, 20000);
      if (!resp.ok) {
        log.warn(`binance_square "${keyword}": HTTP ${resp.status}`);
        return [];
      }
      const j: any = await resp.json();
      if (j?.code !== "000000") {
        log.warn(`binance_square "${keyword}": code ${j?.code} (cookie may be stale)`);
        return [];
      }
      const vos: any[] = j?.data?.vos || [];
      const out: DiscoveredPost[] = [];
      for (const v of vos) {
        if (!POST_CARD_TYPES.has(v.cardType)) continue;
        const content = (v.content || "").toString().trim();
        if (content.length < 10) continue;
        out.push({
          url: v.webLink || `https://www.binance.com/zh-CN/square/post/${v.id}`,
          title: content.replace(/\s+/g, " ").slice(0, 80),
          fullContent: content,
          author: v.authorName || v.username || null,
          publishedAt: v.date ? Number(v.date) * 1000 : null,
          sourceName: "binance_square",
          sourcePlatform: "binance_square",
        });
      }
      return out;
    } catch (e: any) {
      log.error(`binance_square "${keyword}": ${String(e?.message || e).slice(0, 150)}`);
      return [];
    }
  },
};
