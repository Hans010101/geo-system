// OpenRouter per-model pricing snapshot (refreshed 2026-06-11 from https://openrouter.ai/api/v1/models).
// Units: USD per single token (so cost = tokens × rate, no million-token conversion needed).
// Source of truth is OpenRouter's catalog; refresh by re-curling the endpoint and updating these values
// whenever a model id in PLATFORM_OPENROUTER_MODELS changes or quarterly hygiene.
export type Pricing = { input: number; output: number };

export const OPENROUTER_PRICING: Record<string, Pricing> = {
  "openai/gpt-4o":                       { input: 0.0000025,    output: 0.00001 },
  "perplexity/sonar-pro":                { input: 0.000003,     output: 0.000015 },
  "google/gemini-2.5-flash":             { input: 0.0000003,    output: 0.0000025 },   // also used by analysis path
  "baidu/ernie-4.5-vl-424b-a47b":        { input: 0.00000042,   output: 0.00000125 },
  "anthropic/claude-sonnet-4":           { input: 0.000003,     output: 0.000015 },
  "bytedance-seed/seed-1.6-flash":       { input: 0.000000075,  output: 0.0000003 },
  "moonshotai/kimi-k2":                  { input: 0.00000057,   output: 0.0000023 },
  "deepseek/deepseek-chat-v3-0324":      { input: 0.0000002,    output: 0.00000077 },
  "minimax/minimax-m2.5":                { input: 0.00000015,   output: 0.0000009 },
  "qwen/qwen-plus":                      { input: 0.00000026,   output: 0.00000078 },
  "z-ai/glm-4.7":                        { input: 0.0000004,    output: 0.00000175 },
  "x-ai/grok-4.20":                      { input: 0.00000125,   output: 0.0000025 },
  "meta-llama/llama-4-maverick":         { input: 0.00000015,   output: 0.0000006 },
  "tencent/hunyuan-a13b-instruct":       { input: 0.00000014,   output: 0.00000057 },
};

// Compute USD cost for a single LLM invocation. Returns null when model is unknown or tokens are missing.
export function calcCostUsd(
  model: string | null | undefined,
  promptTokens: number | null | undefined,
  completionTokens: number | null | undefined
): number | null {
  if (!model || promptTokens == null || completionTokens == null) return null;
  const price = OPENROUTER_PRICING[model];
  if (!price) return null;
  // Decimal(10,6) → 6 decimal places, ample for fractions of a cent
  return Math.round((promptTokens * price.input + completionTokens * price.output) * 1_000_000) / 1_000_000;
}

// Identify provider from baseUrl. Mirrors detectProvider in server/routers.ts but lives in shared land
// so the seed/price tables stay co-located with provider naming.
export function detectProviderFromBaseUrl(baseUrl: string | null | undefined): "openrouter" | "bai" | "bailian" | "other" {
  if (!baseUrl) return "other";
  if (baseUrl.includes("b.ai")) return "bai";
  if (baseUrl.includes("openrouter.ai")) return "openrouter";
  if (baseUrl.includes("dashscope.aliyuncs.com") || baseUrl.includes("bailian")) return "bailian";
  return "other";
}
