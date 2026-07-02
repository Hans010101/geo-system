// Shared helpers for the sentiment-monitor engine.
import { createHash } from "crypto";

export function createMonitorLogger(module = "MONITOR") {
  const fmt = (level: string, msg: string, meta?: Record<string, any>) => {
    const ts = new Date().toISOString();
    const metaStr = meta ? " " + JSON.stringify(meta) : "";
    return `[${ts}] [${level}] [${module}] ${msg}${metaStr}`;
  };
  return {
    info: (msg: string, meta?: Record<string, any>) => console.log(fmt("INFO", msg, meta)),
    warn: (msg: string, meta?: Record<string, any>) => console.warn(fmt("WARN", msg, meta)),
    error: (msg: string, meta?: Record<string, any>) => console.error(fmt("ERROR", msg, meta)),
  };
}

export const log = createMonitorLogger();

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// Normalize a URL for dedup: drop protocol-insignificant bits, tracking params, fragment, trailing slash.
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const dropParam = (k: string) =>
      /^(utm_|spm|from$|ref$|ref_|src$|source$|fbclid$|gclid$|scm$)/.test(k);
    const kept: [string, string][] = [];
    u.searchParams.forEach((v, k) => {
      if (!dropParam(k)) kept.push([k, v]);
    });
    kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    // rebuild search deterministically
    const usp = new URLSearchParams();
    for (const [k, v] of kept) usp.append(k, v);
    u.search = usp.toString() ? `?${usp.toString()}` : "";
    let s = `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}${u.pathname}${u.search}`;
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

export function urlHash(normalizedUrl: string): string {
  return sha256(normalizeUrl(normalizedUrl));
}

export function hasCJK(s: string): boolean {
  return /[一-鿿]/.test(s || "");
}

export function domainOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Canonical domain key used to JOIN the two sides of the GEO-penetration analysis:
// monitor_articles.domain (already clean via domainOf) and citations.domain (DIRTY — a mix of
// real hostnames from explicit URLs and descriptive source names from implicit LLM citations).
// Rules: lowercase, strip scheme, keep only the host (drop path/query), strip port, strip leading "www.".
//   "https://www.Bloomberg.com/news/x" / "BLOOMBERG.COM:443" / "www.bloomberg.com" -> "bloomberg.com"
//   descriptive source names ("彭博社", "Reuters") normalize to lowercase text and simply won't match a hostname.
// IMPORTANT: the SQL side (server/monitor/penetration.ts NORM_SQL) MUST stay byte-for-byte equivalent to this.
export function normalizeDomain(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // strip scheme (http://, https://, implicit://, ...)
  s = s.split("/")[0]; // host only — drop path/query/fragment
  s = s.split(":")[0]; // drop port
  s = s.replace(/^www\./, ""); // drop leading www.
  return s.trim();
}

// Best-effort parse of a Serper date string ("3 hours ago", "Mar 6, 2026", "2 days ago") → epoch ms.
export function parseSerperDate(s: string | null | undefined, now = Date.now()): number | null {
  if (!s) return null;
  const rel = s.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unitMs: Record<string, number> = {
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
      month: 2_592_000_000,
      year: 31_536_000_000,
    };
    const ms = unitMs[rel[2].toLowerCase()] || 0;
    return now - n * ms;
  }
  const abs = Date.parse(s);
  return Number.isNaN(abs) ? null : abs;
}
