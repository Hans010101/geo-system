// Cost guardrails for the monitor. Limits + monthly usage counters live in sysConfigs (single source of
// truth); counters lazily reset on month rollover. Within a cycle, reservations go through synchronous
// critical sections against an in-memory snapshot so concurrent workers can't overshoot a limit.
import * as db from "../db";
import { log } from "./util";

const KEYS = {
  firecrawlLimit: "monitor_firecrawl_monthly_limit",
  serperLimit: "monitor_serper_monthly_limit",
  maxPerCycle: "monitor_max_articles_per_cycle",
  firecrawlUsed: "monitor_firecrawl_used_this_month",
  serperUsed: "monitor_serper_used_this_month",
  month: "monitor_counters_month",
};
export const DEFAULTS = { firecrawlLimit: 800, serperLimit: 2000, maxPerCycle: 50 };
// Firecrawl scrape = 1 credit/page. Rough USD conversion for cost accounting (Hobby $16 / ~19k credits).
export const FIRECRAWL_USD_PER_CREDIT = 0.00083;

// Live in-memory snapshot for the current cycle (populated by beginCycle()).
let live = {
  month: "",
  firecrawlUsed: 0,
  serperUsed: 0,
  firecrawlLimit: DEFAULTS.firecrawlLimit,
  serperLimit: DEFAULTS.serperLimit,
  maxPerCycle: DEFAULTS.maxPerCycle,
};

function currentMonth(): string {
  // YYYY-MM in Asia/Shanghai (matches the cron tz), so the reset boundary is the local 1st.
  const shifted = new Date(Date.now() + 8 * 3600 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function num(key: string, def: number): Promise<number> {
  const v = await db.getSysConfig(key);
  if (v == null || v === "") return def;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? def : n;
}

// Reset counters if the stored month is stale. Returns the (possibly reset) used counts.
async function ensureMonth(): Promise<{ firecrawlUsed: number; serperUsed: number }> {
  const cur = currentMonth();
  const stored = await db.getSysConfig(KEYS.month);
  if (stored !== cur) {
    await db.setSysConfig(KEYS.firecrawlUsed, "0");
    await db.setSysConfig(KEYS.serperUsed, "0");
    await db.setSysConfig(KEYS.month, cur);
    log.info(`Monitor budget counters reset for ${cur}`);
    return { firecrawlUsed: 0, serperUsed: 0 };
  }
  return { firecrawlUsed: await num(KEYS.firecrawlUsed, 0), serperUsed: await num(KEYS.serperUsed, 0) };
}

// Load fresh state from DB into `live`. Call at the start of a cycle so limit changes + monthly resets apply.
export async function beginCycle(): Promise<void> {
  const { firecrawlUsed, serperUsed } = await ensureMonth();
  live = {
    month: currentMonth(),
    firecrawlUsed,
    serperUsed,
    firecrawlLimit: await num(KEYS.firecrawlLimit, DEFAULTS.firecrawlLimit),
    serperLimit: await num(KEYS.serperLimit, DEFAULTS.serperLimit),
    maxPerCycle: await num(KEYS.maxPerCycle, DEFAULTS.maxPerCycle),
  };
  log.info(`Monitor budget: firecrawl ${live.firecrawlUsed}/${live.firecrawlLimit}, serper ${live.serperUsed}/${live.serperLimit}, max/cycle ${live.maxPerCycle}`);
}

export function hasFirecrawlBudget(): boolean {
  return live.firecrawlUsed < live.firecrawlLimit;
}

// Atomic reserve (synchronous critical section — no await between check and increment).
export function tryConsumeFirecrawl(): boolean {
  if (live.firecrawlUsed >= live.firecrawlLimit) return false;
  live.firecrawlUsed++;
  db.setSysConfig(KEYS.firecrawlUsed, String(live.firecrawlUsed)).catch(() => {});
  return true;
}

export function tryConsumeSerper(): boolean {
  if (live.serperUsed >= live.serperLimit) return false;
  live.serperUsed++;
  db.setSysConfig(KEYS.serperUsed, String(live.serperUsed)).catch(() => {});
  return true;
}

export function maxArticlesPerCycle(): number {
  return live.maxPerCycle;
}

// Fresh read from DB for UI / stats (independent of the cycle snapshot).
export async function readBudget() {
  const { firecrawlUsed, serperUsed } = await ensureMonth();
  return {
    month: currentMonth(),
    firecrawl: { used: firecrawlUsed, limit: await num(KEYS.firecrawlLimit, DEFAULTS.firecrawlLimit) },
    serper: { used: serperUsed, limit: await num(KEYS.serperLimit, DEFAULTS.serperLimit) },
    maxArticlesPerCycle: await num(KEYS.maxPerCycle, DEFAULTS.maxPerCycle),
  };
}
