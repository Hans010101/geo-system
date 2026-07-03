// Unified "social source" abstraction. Every discovery source (Serper, 币安广场, future X/Reddit)
// implements SocialSource and returns DiscoveredPost[]. Adding a source = implement + register in
// registry.ts; the pipeline doesn't change.
export type SearchOpts = { tbs?: string; num?: number; gl?: string; hl?: string };

export interface DiscoveredPost {
  url: string;
  title: string;
  contentSnippet?: string; // short snippet (e.g. Serper) — used if no fullContent
  fullContent?: string; // full text when the source returns it (e.g. 币安广场 API) → pipeline skips fetch
  author?: string | null;
  publishedAt?: number | null; // epoch ms
  sourceName: string; // machine id: 'serper' | 'binance_square'
  sourcePlatform: string; // stored/display key: 'web' | 'binance_square'
  // When a source returns fullContent it paid for (e.g. Gate via a Firecrawl list render), it can
  // stamp the engine + attributed cost so the pipeline records them instead of the "source_api"/0 default.
  fetchEngineHint?: string;
  fetchCostUsdHint?: number;
}

export interface SocialSource {
  name: string; // 'serper' | 'binance_square' | (future 'x' | 'reddit')
  platform: string; // stored sourcePlatform key
  enabled: boolean;
  search(keyword: string, opts?: SearchOpts): Promise<DiscoveredPost[]>;
}
