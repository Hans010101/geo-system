// Platform types - 15 mainstream AI platforms
export const PLATFORMS = [
  "chatgpt",
  "perplexity",
  "gemini",
  "wenxin",
  "claude",
  "copilot",
  "doubao",
  "kimi",
  "deepseek",
  "minimax",
  "tongyi",
  "zhipu",
  "grok",
  "llama",
  "hunyuan",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  wenxin: "文心一言",
  claude: "Claude",
  copilot: "Copilot",
  doubao: "豆包",
  kimi: "Kimi",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  tongyi: "通义千问",
  zhipu: "智谱清言",
  grok: "Grok",
  llama: "Llama",
  hunyuan: "混元",
};

export const PLATFORM_COLORS: Record<Platform, string> = {
  chatgpt: "#10a37f",
  perplexity: "#1a73e8",
  gemini: "#8e44ad",
  wenxin: "#2080f0",
  claude: "#d97706",
  copilot: "#0078d4",
  doubao: "#ff6a00",
  kimi: "#6366f1",
  deepseek: "#0ea5e9",
  minimax: "#ec4899",
  tongyi: "#7c3aed",
  zhipu: "#059669",
  grok: "#000000",
  llama: "#3b82f6",
  hunyuan: "#14b8a6",
};

// OpenRouter model mapping for each platform
export const PLATFORM_OPENROUTER_MODELS: Record<Platform, string> = {
  chatgpt: "openai/gpt-4o",
  perplexity: "perplexity/sonar-pro",
  gemini: "google/gemini-2.0-flash-001",
  wenxin: "baidu/ernie-4.5-300b-a47b",
  claude: "anthropic/claude-sonnet-4",
  copilot: "openai/gpt-4o",
  doubao: "bytedance-seed/seed-2.0-lite",
  kimi: "moonshotai/kimi-k2",
  deepseek: "deepseek/deepseek-chat-v3-0324",
  minimax: "minimax/minimax-m2.5",
  tongyi: "qwen/qwen-plus",
  zhipu: "z-ai/glm-4.7",
  grok: "x-ai/grok-3",
  llama: "meta-llama/llama-4-maverick",
  hunyuan: "tencent/hunyuan-a13b-instruct",
};

// Platforms that are better served by Bailian (百炼) than OpenRouter
// doubao on OpenRouter uses Seed models (not actual Doubao), results may differ
export const PLATFORM_RECOMMENDED_PROVIDER: Partial<Record<Platform, string>> = {
  doubao: "百炼",
  wenxin: "百炼",
  tongyi: "百炼",
  hunyuan: "百炼",
};

// Bailian (阿里百炼) model names — used when baseUrl contains dashscope/bailian
export const PLATFORM_BAILIAN_MODELS: Partial<Record<Platform, string>> = {
  doubao: "doubao-1.5-pro-32k",
  deepseek: "deepseek-v3.1",
  kimi: "moonshot-v1-auto",
  tongyi: "qwen-plus",
  zhipu: "glm-4-plus",
  minimax: "minimax-01",
  wenxin: "ernie-4.0-turbo-128k",
  gemini: "gemini-2.0-flash",
};

// Brand line types
export const BRAND_LINES = ["sun_yuchen", "tron", "competitor"] as const;
export type BrandLine = (typeof BRAND_LINES)[number];

export const BRAND_LINE_LABELS: Record<BrandLine, string> = {
  sun_yuchen: "孙宇晨IP线",
  tron: "波场TRON线",
  competitor: "竞品对标",
};

// Dimension types
export const DIMENSIONS = [
  "awareness",
  "evaluation",
  "investment",
  "compliance",
  "comparison",
  "ecosystem",
  "usage",
  "wealth",
  "industry_status",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  awareness: "认知",
  evaluation: "评价",
  investment: "投资判断",
  compliance: "合规/法律",
  comparison: "技术对比",
  ecosystem: "生态数据",
  usage: "使用场景",
  wealth: "财富争议",
  industry_status: "行业地位",
};

// Sentiment types
export const SENTIMENT_LABELS: Record<number, string> = {
  1: "强负面",
  2: "偏负面",
  3: "中性",
  4: "偏正面",
  5: "强正面",
};

export const SENTIMENT_COLORS: Record<number, string> = {
  1: "#ef4444",
  2: "#f97316",
  3: "#eab308",
  4: "#22c55e",
  5: "#10b981",
};

// Source type
export const SOURCE_TYPE_LABELS: Record<string, string> = {
  our_content: "己方布局",
  friendly: "友好来源",
  neutral: "中性来源",
  unfriendly: "不友好来源",
  unknown: "未知来源",
};

export const SOURCE_TYPE_COLORS: Record<string, string> = {
  our_content: "#3b82f6",
  friendly: "#22c55e",
  neutral: "#6b7280",
  unfriendly: "#ef4444",
  unknown: "#9ca3af",
};

// Severity types
export const SEVERITY_LABELS: Record<string, string> = {
  critical: "紧急",
  high: "高",
  medium: "中",
  low: "低",
};

export const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#6b7280",
};

// Content type labels
export const CONTENT_TYPE_LABELS: Record<string, string> = {
  seo_article: "定向稿",
  wiki: "百科",
  zhihu_answer: "知乎回答",
  official_page: "官网页面",
  media_report: "媒体报道",
  social_media: "社交媒体",
  video: "视频内容",
  blog: "博客文章",
};

// Tone labels
export const TONE_LABELS: Record<string, string> = {
  hostile: "敌对",
  critical: "批评",
  neutral: "中性",
  favorable: "友好",
  promotional: "推广",
};
