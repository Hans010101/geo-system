// Serper.dev search wrapper. Uses the 'news' vertical (dated, higher news purity than web).
// API key is read from globalApiKeys (name = 'Serper'); never hard-coded / env.
import * as db from "../db";

const SERPER_DEFAULT_BASE = "https://google.serper.dev";

export type SerperNewsItem = {
  url: string;
  title: string;
  snippet: string;
  date: string | null; // raw Serper date string, e.g. "3 hours ago" / "Mar 6, 2026"
  source: string | null;
};

async function getSerper(): Promise<{ apiKey: string; base: string }> {
  const key = await db.getGlobalApiKeyByName("Serper");
  if (!key?.apiKey) {
    throw new Error("Serper API key 未配置：请在「全局 API 配置」新增名称为 'Serper' 的条目");
  }
  return { apiKey: key.apiKey, base: (key.baseUrl || SERPER_DEFAULT_BASE).replace(/\/$/, "") };
}

// Search the news vertical for a keyword. tbs e.g. 'qdr:d' (past day) drives freshness.
export async function searchNews(
  keyword: string,
  opts?: { tbs?: string; num?: number }
): Promise<SerperNewsItem[]> {
  const { apiKey, base } = await getSerper();
  const body: Record<string, unknown> = { q: keyword, num: opts?.num ?? 10 };
  if (opts?.tbs) body.tbs = opts.tbs;
  const resp = await fetch(`${base}/news`, {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Serper news ${resp.status}: ${t.slice(0, 200)}`);
  }
  const json: any = await resp.json();
  return (json.news || [])
    .filter((n: any) => n?.link)
    .map((n: any) => ({
      url: n.link as string,
      title: (n.title || "") as string,
      snippet: (n.snippet || "") as string,
      date: (n.date || null) as string | null,
      source: (n.source || null) as string | null,
    }));
}
