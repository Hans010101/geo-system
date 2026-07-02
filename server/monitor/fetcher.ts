// Two-tier article fetcher: self (fetch + readability + turndown) → Firecrawl fallback → snippet-only.
// Firecrawl key from globalApiKeys (name = 'Firecrawl'). Verified in POC: self wins on 中文 stations
// (e.g. 新浪), Firecrawl wins on hardened intl stations (Reuters/Bloomberg).
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import * as db from "../db";
import { log } from "./util";

export type FetchResult = {
  method: "self" | "firecrawl" | "snippet_only";
  status: "full" | "partial" | "failed";
  contentMd: string;
  title: string | null;
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MIN_FULL_CHARS = 200; // extracted text length that counts as a usable full fetch
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

async function timedFetch(url: string, ms = 25000): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function selfScrape(url: string): Promise<{ ok: boolean; md: string; title: string | null }> {
  const resp = await timedFetch(url);
  if (!resp.ok) return { ok: false, md: "", title: null };
  const html = await resp.text();
  const vc = new VirtualConsole(); // swallow noisy CSS/JS parse errors from jsdom
  const dom = new JSDOM(html, { url, virtualConsole: vc });
  const article = new Readability(dom.window.document).parse();
  const text = (article?.textContent || "").replace(/\s+/g, " ").trim();
  if (text.length < MIN_FULL_CHARS) return { ok: false, md: "", title: article?.title ?? null };
  const md = article?.content ? turndown.turndown(article.content).trim() : text;
  return { ok: md.length > 0, md, title: article?.title ?? null };
}

async function firecrawlScrape(url: string): Promise<{ ok: boolean; md: string; title: string | null }> {
  const key = await db.getGlobalApiKeyByName("Firecrawl");
  if (!key?.apiKey) return { ok: false, md: "", title: null };
  const base = (key.baseUrl || "https://api.firecrawl.dev").replace(/\/$/, "");
  const resp = await fetch(`${base}/v1/scrape`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: 60000 }),
  });
  if (!resp.ok) return { ok: false, md: "", title: null };
  const json: any = await resp.json();
  const d = json?.data || json;
  const md = (d?.markdown || "").trim();
  const title = d?.metadata?.title || null;
  return { ok: md.length >= MIN_FULL_CHARS, md, title };
}

// Try self-scrape, fall back to Firecrawl, finally keep the Serper snippet. Never throws.
export async function fetchArticle(url: string, snippet: string): Promise<FetchResult> {
  try {
    const s = await selfScrape(url);
    if (s.ok) return { method: "self", status: "full", contentMd: s.md, title: s.title };
  } catch (e: any) {
    log.warn(`self-scrape failed ${url}: ${String(e?.message || e).slice(0, 120)}`);
  }
  try {
    const f = await firecrawlScrape(url);
    if (f.ok) return { method: "firecrawl", status: "full", contentMd: f.md, title: f.title };
  } catch (e: any) {
    log.warn(`firecrawl-scrape failed ${url}: ${String(e?.message || e).slice(0, 120)}`);
  }
  return {
    method: "snippet_only",
    status: snippet ? "partial" : "failed",
    contentMd: snippet || "",
    title: null,
  };
}
