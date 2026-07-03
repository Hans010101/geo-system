// Shared display maps for the sentiment-monitor UI.
export const THREAT_META: Record<string, { label: string; color: string }> = {
  high: { label: "高威胁", color: "#dc2626" },
  medium: { label: "中威胁", color: "#ea580c" },
  low: { label: "低威胁", color: "#ca8a04" },
  none: { label: "无威胁", color: "#9ca3af" },
};

export const STANCE_META: Record<string, { label: string; color: string }> = {
  hostile: { label: "敌对", color: "#dc2626" },
  neutral: { label: "中立", color: "#6b7280" },
  friendly: { label: "友好", color: "#16a34a" },
};

export const RELEVANCE_LABELS: Record<string, string> = {
  high: "高相关",
  medium: "中相关",
  low: "低相关",
  irrelevant: "无关",
};

export const FETCH_ENGINE_LABELS: Record<string, string> = {
  self: "自建 L1",
  firecrawl: "Firecrawl L4",
  snippet: "仅摘要",
  snippet_only: "仅摘要", // legacy value tolerance
};

export const SOURCE_PLATFORM_META: Record<string, { label: string; color: string }> = {
  web: { label: "Web/新闻", color: "#6b7280" },
  binance_square: { label: "币安广场", color: "#f0b90b" }, // Binance yellow
  gate_square: { label: "Gate广场", color: "#2354e6" }, // Gate blue
  rss: { label: "RSS媒体", color: "#ea580c" }, // RSS orange
  telegram: { label: "Telegram", color: "#229ED4" }, // Telegram blue
  x: { label: "X", color: "#111827" },
  reddit: { label: "Reddit", color: "#ff4500" },
};

export const SENTIMENT_MONITOR_COLORS: Record<number, string> = {
  1: "#dc2626",
  2: "#f97316",
  3: "#9ca3af",
  4: "#22c55e",
  5: "#16a34a",
};
