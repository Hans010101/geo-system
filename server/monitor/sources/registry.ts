// Source registry. Add a new SocialSource here (and it flows through the pipeline unchanged).
import type { SocialSource } from "./types";
import { serperSource } from "./serper-source";
import { binanceSquareSource } from "./binance-source";
import { gateSquareSource } from "./gate-source";

export const sources: SocialSource[] = [serperSource, binanceSquareSource, gateSquareSource];

export function enabledSources(): SocialSource[] {
  return sources.filter((s) => s.enabled);
}

// Display labels for sourcePlatform keys (kept in sync with the frontend map).
export const SOURCE_PLATFORM_LABELS: Record<string, string> = {
  web: "Web/新闻",
  binance_square: "币安广场",
  gate_square: "Gate广场",
};
