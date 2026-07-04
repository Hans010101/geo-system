// DeepSeek (via OpenRouter) analysis for a monitored article. Prompt structure mirrors the production
// analyzeCollection (server/routers.ts), extended for monitoring: relevance + sentiment + summary + entities.
// threatLevel is computed deterministically from source authority × sentiment intensity × stance × relevance.
import { invokeLLM } from "../_core/llm";
import { calcCostUsd } from "@shared/llm-pricing";
import * as db from "../db";
import { domainOf } from "./util";

const ANALYSIS_MODEL = "deepseek/deepseek-chat";

export type Relevance = "high" | "medium" | "low" | "irrelevant";
export type ThreatLevel = "high" | "medium" | "low" | "none";

export type MonitorAnalysis = {
  relevance: Relevance;
  relevanceReason: string;
  sentimentScore: number;
  threatLevel: ThreatLevel;
  summary: string;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
};

// Deterministic threat = negative-sentiment intensity × source authority × relevance weight, shifted by stance.
function computeThreat(
  sentimentScore: number,
  relevance: Relevance,
  authorityLevel: number,
  stance: "hostile" | "neutral" | "friendly"
): ThreatLevel {
  if (relevance === "irrelevant") return "none";
  const neg = sentimentScore <= 2 ? 3 - sentimentScore : 0; // 1→2, 2→1, ≥3→0 (only negatives threaten)
  if (neg === 0) return "none";
  const relWeight: Record<Relevance, number> = { high: 1, medium: 0.7, low: 0.4, irrelevant: 0 };
  let score = neg * authorityLevel * relWeight[relevance];
  if (stance === "hostile") score += 3;
  else if (stance === "friendly") score -= 2;
  if (score >= 13) return "high";
  if (score >= 6) return "medium";
  if (score > 0) return "low";
  return "none";
}

function buildPrompt(title: string, body: string, partial: boolean): string {
  return `你是一个专业的品牌声誉分析师。监控对象是"孙宇晨(Justin Sun) / 波场(TRON、TRX 及其官方项目)"。请判断这篇文章与监控对象的相关性、情感立场，并总结。

## 相关性(relevance)判定标准 —— 严格按"文章的主体/核心议题"判断，不是"有没有提到"：
- high: 文章的**主体/核心议题就是孙宇晨本人，或波场 TRON/TRX/其官方项目的重大声誉事件**（诉讼、监管、和解、上市、重大合作、安全事故、重大负面指控等）。标题或首段就在讲他们。
- medium: 孙宇晨/波场是文章的**重要角色之一，但不是唯一主体**（例如"特朗普加密项目遇冷，孙宇晨是主要投资人之一"）。
- low: 只是**顺带提及 / 背景引用 / 行情噪音**（讲整个加密行业时列举到名字；或 TRX 币价预测、涨跌、网络指标、交易量/活跃地址创新高这类纯行情文章）。
- irrelevant: 完全无关、同名误匹配、或仅在无关榜单/制裁名单里被列一笔。

## 判定示例(few-shot)：
- "Why one of Trump crypto's biggest backers is sounding the alarm"（主体是特朗普币，孙宇晨只是backer之一）→ medium
- "Justin Sun takes Trump family crypto firm to court"（主体就是孙宇晨的起诉行为）→ high
- "TRX Price Prediction: Treasury Tops 700M Tokens"（主体是币价/持仓预测，孙宇晨/波场顺带）→ low
- "US Treasury Sanctions 134 Wallets Linked to ISIS-K"（主体是反恐制裁，TRX 仅被列名）→ irrelevant

## 文章标题
${title || "(无标题)"}

## 文章正文${partial ? "（仅摘要，内容可能不完整，请据现有信息判断；主体不明时不要轻易判 high）" : ""}
${body}

## 请仅输出以下 JSON（不要输出其他任何内容）：
{
  "relevance": "<high|medium|low|irrelevant>",
  "relevance_reason": "<一句话说明为什么判这个等级，点明文章主体是谁>",
  "sentiment_score": <1-5的整数，对监控对象的立场：1=强负面，2=偏负面，3=中性，4=偏正面，5=强正面；若 irrelevant 填 3>,
  "summary": "<100字以内中文摘要，说明文章讲了什么、对品牌是利好还是利空>",
  "key_entities": ["<涉及的关键实体，最多5个>"]
}`;
}

export async function analyzeArticle(input: {
  url: string;
  title: string | null;
  contentMd: string;
  snippet: string;
  fetchStatus: "full" | "partial" | "failed";
}): Promise<MonitorAnalysis> {
  const orKey = await db.getGlobalApiKeyByName("OpenRouter");
  if (!orKey?.apiKey || !orKey.baseUrl) {
    throw new Error("OpenRouter key 未配置：舆情分析需要「全局 API 配置」中名为 'OpenRouter' 的有效条目");
  }
  const body = (input.contentMd || input.snippet || "").slice(0, 6000);
  const partial = input.fetchStatus !== "full";

  const result = await invokeLLM({
    apiKey: orKey.apiKey,
    baseUrl: orKey.baseUrl,
    model: ANALYSIS_MODEL,
    messages: [
      { role: "system", content: "You are a professional brand reputation analyst. Always respond with valid JSON only." },
      { role: "user", content: buildPrompt(input.title || "", body, partial) },
    ],
    response_format: { type: "json_object" },
    timeoutMs: 60000, // analysis is a small JSON reply; a hung call must not stall the cycle
  });

  const content =
    typeof result.choices?.[0]?.message?.content === "string" ? (result.choices[0].message.content as string) : "";
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("分析响应无法解析为 JSON");
    parsed = JSON.parse(m[0]);
  }

  const usage: any = result.usage || {};
  const promptTokens = usage.prompt_tokens ?? null;
  const completionTokens = usage.completion_tokens ?? null;
  // OpenRouter returns authoritative usage.cost; fall back to the price table.
  const costUsd =
    typeof usage.cost === "number" ? usage.cost : calcCostUsd(ANALYSIS_MODEL, promptTokens, completionTokens);

  const relevance: Relevance = ["high", "medium", "low", "irrelevant"].includes(parsed.relevance)
    ? parsed.relevance
    : "low";
  const relevanceReason = (parsed.relevance_reason || parsed.relevanceReason || "").toString().slice(0, 500);
  const rawScore = parseInt(parsed.sentiment_score ?? parsed.sentimentScore, 10);
  const sentimentScore = Math.min(5, Math.max(1, Number.isNaN(rawScore) ? 3 : rawScore));

  const domain = domainOf(input.url);
  const rule = domain ? await db.getMonitorSourceRuleByDomain(domain) : undefined;
  const threatLevel = computeThreat(
    sentimentScore,
    relevance,
    rule?.authorityLevel ?? 5,
    (rule?.stance as any) ?? "neutral"
  );

  const entities = Array.isArray(parsed.key_entities) ? parsed.key_entities.slice(0, 5).join("、") : "";
  const summary = `${(parsed.summary || "").toString().slice(0, 480)}${entities ? `\n关键实体: ${entities}` : ""}`;

  return { relevance, relevanceReason, sentimentScore, threatLevel, summary, promptTokens, completionTokens, costUsd };
}
