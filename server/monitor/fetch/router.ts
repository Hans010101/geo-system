// Pluggable fetch router. Tries engines in ascending level order (cheapest-capable first); first success
// wins. To add a tier, implement FetchEngine and insert it into `engines` — router/pipeline/callers stay
// unchanged.
//
//   L1 self      — plain fetch + readability (free)                    [implemented]
//   L2 (预留)    — Scrapling Fetcher / Node stealth 库: TLS 指纹伪装，处理中等反爬
//   L3 (预留)    — Scrapling StealthyFetcher: 免费过 Cloudflare，需独立 Python 微服务或 Node rebrowser
//   L4 firecrawl — 付费 API 兜底 (budget-gated)                        [implemented]
//
// 引入 L2/L3 的条件: Phase 1 数据显示 >X% 站点卡在 Cloudflare/反爬时评估
// （依据 = monitor_articles 里 fetchEngine='snippet' 的占比 + 反复失败的域名）。
import type { FetchEngine, FetchResult } from "./types";
import { selfEngine } from "./self-engine";
import { firecrawlEngine } from "./firecrawl-engine";
import { log } from "../util";

const engines: FetchEngine[] = [selfEngine, firecrawlEngine].sort((a, b) => a.level - b.level);

export function registeredEngines() {
  return engines.map((e) => ({ name: e.name, level: e.level, costPerPage: e.costPerPage }));
}

// Try each engine in order; return the first success. All fail → keep the Serper snippet so the article
// stays analyzable (marked engine='snippet').
export async function fetchArticle(url: string, snippet: string): Promise<FetchResult> {
  for (const engine of engines) {
    if (engine.canHandle) {
      const ok = await engine.canHandle(url);
      if (!ok) continue; // e.g. firecrawl budget exhausted → skip this engine
    }
    try {
      const result = await engine.fetch(url);
      if (result.success) return result;
    } catch (e: any) {
      log.warn(`fetch engine ${engine.name} threw for ${url}: ${String(e?.message || e).slice(0, 120)}`);
    }
  }
  return {
    success: !!snippet,
    contentMd: snippet || "",
    title: null,
    engine: "snippet",
    costUsd: 0,
    status: snippet ? "partial" : "failed",
  };
}
