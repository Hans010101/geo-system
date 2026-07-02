// L4: Firecrawl scrape fallback for hardened stations (Reuters/Bloomberg …). Budget-gated: skipped when
// the monthly Firecrawl credit limit is hit. Key from globalApiKeys (name='Firecrawl').
import * as db from "../../db";
import * as budget from "../budget";
import type { FetchEngine, FetchResult } from "./types";

const MIN_FULL_CHARS = 200;

export const firecrawlEngine: FetchEngine = {
  name: "firecrawl",
  level: 4,
  costPerPage: budget.FIRECRAWL_USD_PER_CREDIT, // 1 credit / page
  // Guardrail: don't even attempt when the monthly budget is exhausted.
  canHandle(): boolean {
    return budget.hasFirecrawlBudget();
  },
  async fetch(url: string): Promise<FetchResult> {
    // Atomic reserve of one credit (race-safe). If the budget is gone, bail → router falls to snippet.
    if (!budget.tryConsumeFirecrawl()) {
      return { success: false, engine: "firecrawl", costUsd: 0, status: "failed", error: "firecrawl budget exhausted" };
    }
    const cost = budget.FIRECRAWL_USD_PER_CREDIT; // charged per attempt (firecrawl bills per call)
    try {
      const key = await db.getGlobalApiKeyByName("Firecrawl");
      if (!key?.apiKey) return { success: false, engine: "firecrawl", costUsd: 0, status: "failed", error: "no firecrawl key" };
      const base = (key.baseUrl || "https://api.firecrawl.dev").replace(/\/$/, "");
      const resp = await fetch(`${base}/v1/scrape`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: 60000 }),
      });
      if (!resp.ok) return { success: false, engine: "firecrawl", costUsd: cost, status: "failed", error: `HTTP ${resp.status}` };
      const json: any = await resp.json();
      const d = json?.data || json;
      const md = (d?.markdown || "").trim();
      const title = d?.metadata?.title || null;
      return { success: md.length >= MIN_FULL_CHARS, contentMd: md, title, engine: "firecrawl", costUsd: cost, status: "full" };
    } catch (e: any) {
      return { success: false, engine: "firecrawl", costUsd: cost, status: "failed", error: String(e?.message || e).slice(0, 120) };
    }
  },
};
