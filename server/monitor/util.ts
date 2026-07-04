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

// fetch with a HARD client-side timeout. node's fetch has no default total timeout, so a hung/slow
// upstream (Serper/Firecrawl/binance/LLM) would otherwise stall the ENTIRE monitor cycle indefinitely.
// AbortController.abort() actually destroys the socket (unlike a body-level "timeout" field, which is
// only the upstream's own deadline). On timeout the fetch rejects → the caller's try/catch skips that
// one request and the cycle continues.
export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 20000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`request timeout after ${ms}ms`)), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

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

// Entity-aware keyword match for feed/broadcast sources (Gate/RSS/Telegram) whose items aren't
// keyword-searched at the API — we pull the whole feed then filter locally. A text is relevant to a
// monitor keyword only if it names one of our CORE entities that the keyword also references. Latin
// tickers/names use word boundaries ("TRON" ≠ "electron"); CJK uses substring; generic qualifiers in
// the keyword (SEC/lawsuit/起诉/Trump…) are ignored (they'd match unrelated items).
const CJK_ENTITIES = ["孙宇晨", "波场链", "波场", "孙哥", "火币"];
const LATIN_ENTITIES = ["justin sun", "tron", "trx", "usdd", "wlfi", "htx"];
function latinWordHit(lowText: string, e: string): boolean {
  const pat = e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![a-z0-9])\\$?${pat}(?![a-z0-9])`, "i").test(lowText);
}
export function keywordMatchesText(keyword: string, text: string): boolean {
  if (!keyword || !text) return false;
  const kwLow = keyword.toLowerCase();
  const low = text.toLowerCase();
  for (const e of CJK_ENTITIES) if (keyword.includes(e) && text.includes(e)) return true;
  for (const e of LATIN_ENTITIES) if (kwLow.includes(e) && latinWordHit(low, e)) return true;
  return false;
}

// Language gate for the monitor: keep 中文 + English, drop foreign-dominant posts (币安/Gate 广场是
//多语言平台,会返回阿拉伯语/日语/韩语等无关内容). Script-share heuristic — no external dep.
// Conservative: only rejects when a non-CJK/Latin script clearly DOMINATES and there is little
// zh/en; ambiguous/short text is KEPT (don't over-filter). Known limit: Japanese written mostly in
// kanji can read as zh (kanji∩hanzi overlap) — acceptable, our domain rarely sees it; kana-heavy JP is caught.
export function detectContentLang(text: string | null | undefined): { lang: string; allowed: boolean } {
  const t = text || "";
  let han = 0, latin = 0, arabic = 0, kana = 0, hangul = 0, thai = 0, cyr = 0, deva = 0, letters = 0;
  for (const ch of t) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x4e00 && cp <= 0x9fff) { han++; letters++; }
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) { latin++; letters++; }
    else if (cp >= 0x600 && cp <= 0x6ff) { arabic++; letters++; }
    else if (cp >= 0x3040 && cp <= 0x30ff) { kana++; letters++; } // hiragana + katakana
    else if (cp >= 0xac00 && cp <= 0xd7af) { hangul++; letters++; }
    else if (cp >= 0xe00 && cp <= 0xe7f) { thai++; letters++; }
    else if (cp >= 0x400 && cp <= 0x4ff) { cyr++; letters++; }
    else if (cp >= 0x900 && cp <= 0x97f) { deva++; letters++; }
  }
  if (letters < 3) return { lang: "unknown", allowed: true }; // too short to judge → keep
  // Dominant-script wins. kana/hangul are Japanese/Korean-exclusive (Chinese never uses them), so
  // han-presence must NOT rescue a kana-heavy post — dominance handles that uniformly.
  const scripts: [string, number][] = [
    ["zh", han], ["en", latin], ["arabic", arabic], ["japanese", kana],
    ["korean", hangul], ["thai", thai], ["cyrillic", cyr], ["devanagari", deva],
  ];
  let domName = "unknown", domCnt = 0;
  for (const [n, cnt] of scripts) if (cnt > domCnt) { domCnt = cnt; domName = n; }
  const domShare = domCnt / letters;
  if (domName === "zh" || domName === "en") return { lang: domName, allowed: true };
  if (domShare > 0.15) return { lang: domName, allowed: false }; // foreign script dominates → drop
  // no clear dominant foreign script → fall back to any zh/en presence, else keep as unknown
  if (han / letters >= 0.1) return { lang: "zh", allowed: true };
  if (latin / letters >= 0.3) return { lang: "en", allowed: true };
  return { lang: "unknown", allowed: true };
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
