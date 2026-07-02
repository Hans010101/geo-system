// Serper news wrapped as a SocialSource. Returns url+snippet (no fullContent) → pipeline fetches full
// text via the fetch router (unchanged behavior).
import { searchNews } from "../search";
import { parseSerperDate } from "../util";
import type { SocialSource, DiscoveredPost, SearchOpts } from "./types";

export const serperSource: SocialSource = {
  name: "serper",
  platform: "web",
  enabled: true,
  async search(keyword: string, opts?: SearchOpts): Promise<DiscoveredPost[]> {
    const items = await searchNews(keyword, opts);
    return items.map((it): DiscoveredPost => ({
      url: it.url,
      title: it.title || "",
      contentSnippet: it.snippet || "",
      author: it.source || null,
      publishedAt: parseSerperDate(it.date),
      sourceName: "serper",
      sourcePlatform: "web",
    }));
  },
};
