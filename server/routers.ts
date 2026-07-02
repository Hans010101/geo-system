import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, developerProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { invokeLLM } from "./_core/llm";
import { nanoid } from "nanoid";
import { PLATFORMS, PLATFORM_OPENROUTER_MODELS, PLATFORM_BAILIAN_MODELS, PLATFORM_BAI_MODELS, BAI_SUPPORTED_PLATFORMS, BAI_BASE_URL, OPENROUTER_BASE_URL, PLATFORM_RECOMMENDED_PROVIDER, PLATFORM_LABELS, type Platform, type LLMProvider } from "@shared/geo-types";
import { calcCostUsd, detectProviderFromBaseUrl } from "@shared/llm-pricing";
import { ENV } from "./_core/env";
import { dispatchNotification } from "./_core/notification";
import { formatAlertMessage, formatBatchSummary } from "./_core/senders/templates";
import { runMonitorCycle, reanalyzeArticle, type MonitorCycleResult } from "./monitor/pipeline";
import * as monitorBudget from "./monitor/budget";
import { refreshCookieViaBrowser, getCookieStatus } from "./monitor/sources/binance-cookie";
import { getPushConfig, setPushConfig } from "./monitor/notify";

// ==================== Structured Logger ====================
function createLogger(module: string) {
  const fmt = (level: string, msg: string, meta?: Record<string, any>) => {
    const ts = new Date().toISOString();
    const metaStr = meta ? " " + JSON.stringify(meta) : "";
    return `[${ts}] [${level}] [${module}]${meta?.traceId ? ` [trace:${meta.traceId}]` : ""} ${msg}${metaStr}`;
  };
  return {
    info: (msg: string, meta?: Record<string, any>) => console.log(fmt("INFO", msg, meta)),
    warn: (msg: string, meta?: Record<string, any>) => console.warn(fmt("WARN", msg, meta)),
    error: (msg: string, meta?: Record<string, any>) => console.error(fmt("ERROR", msg, meta)),
  };
}

const log = createLogger("GEO");

// ==================== API Key Masking ====================
function maskApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

// ==================== Global Cancellation Registry ====================
const cancelledIds = new Set<number>();

function cancelCollection(id: number) {
  cancelledIds.add(id);
  setTimeout(() => cancelledIds.delete(id), 5 * 60 * 1000);
}

function isCancelled(id: number): boolean {
  return cancelledIds.has(id);
}

// ==================== Model Name Resolution ====================
// Pick the correct model name based on which API provider is being used
function resolveModelForBaseUrl(platform: string, baseUrl: string, platformModelOverride?: string | null): string {
  if (platformModelOverride) return platformModelOverride;
  const p = platform as Platform;
  if (baseUrl.includes("b.ai")) {
    return PLATFORM_BAI_MODELS[p] || PLATFORM_OPENROUTER_MODELS[p] || "gpt-5.2";
  }
  if (baseUrl.includes("dashscope.aliyuncs.com") || baseUrl.includes("bailian")) {
    return PLATFORM_BAILIAN_MODELS[p] || PLATFORM_OPENROUTER_MODELS[p] || "qwen-plus";
  }
  if (baseUrl.includes("openrouter.ai")) {
    return PLATFORM_OPENROUTER_MODELS[p] || "openai/gpt-4o";
  }
  // Unknown provider — try OpenRouter format as default
  return PLATFORM_OPENROUTER_MODELS[p] || "openai/gpt-4o";
}

// ==================== Provider Routing (BAI ⇄ OpenRouter) ====================
// Identify a globalApiKey record's provider purely by its baseUrl. No schema change needed.
function detectProvider(baseUrl: string | null | undefined): LLMProvider | "other" {
  if (!baseUrl) return "other";
  if (baseUrl.includes("b.ai")) return "bai";
  if (baseUrl.includes("openrouter.ai")) return "openrouter";
  return "other";
}

// Resolve the active globalApiKey for a given provider, or null if none configured.
async function getActiveKeyForProvider(provider: LLMProvider): Promise<{ apiKey: string; baseUrl: string } | null> {
  const keys = await db.listGlobalApiKeys();
  for (const k of keys) {
    if (!k.isActive || !k.apiKey || !k.baseUrl) continue;
    if (detectProvider(k.baseUrl) === provider) {
      return { apiKey: k.apiKey, baseUrl: k.baseUrl };
    }
  }
  return null;
}

// Read the configured primary provider (sysConfig key=llm_primary_provider), defaulting to 'bai'.
async function getPrimaryProvider(): Promise<LLMProvider> {
  const v = await db.getSysConfig("llm_primary_provider");
  return v === "openrouter" ? "openrouter" : "bai";
}

// Core routing decision for a platform's collection call.
// Returns { provider, apiKey, baseUrl, model, reason }.
// Rules:
//   1. BAI-uncovered platform → always OpenRouter (regardless of switch).
//   2. BAI-covered platform → primary provider if it has an active key; otherwise fall back to the other provider.
//   3. If neither provider has a key → caller decides (falls through to platform key / env in resolveApiConfig).
async function resolveProviderForPlatform(platform: string): Promise<{
  provider: LLMProvider | null;
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
  reason: string;
}> {
  const p = platform as Platform;

  // Rule 1: BAI doesn't cover this platform → always OpenRouter
  if (!BAI_SUPPORTED_PLATFORMS.includes(p)) {
    const orKey = await getActiveKeyForProvider("openrouter");
    if (orKey) {
      return {
        provider: "openrouter",
        apiKey: orKey.apiKey,
        baseUrl: orKey.baseUrl,
        model: resolveModelForBaseUrl(platform, orKey.baseUrl),
        reason: "platform-not-covered-by-bai",
      };
    }
    return { provider: null, apiKey: null, baseUrl: null, model: PLATFORM_OPENROUTER_MODELS[p] || "openai/gpt-4o", reason: "openrouter-key-missing" };
  }

  // Rule 2 / 3: primary, then fallback
  const primary = await getPrimaryProvider();
  const primaryKey = await getActiveKeyForProvider(primary);
  if (primaryKey) {
    return {
      provider: primary,
      apiKey: primaryKey.apiKey,
      baseUrl: primaryKey.baseUrl,
      model: resolveModelForBaseUrl(platform, primaryKey.baseUrl),
      reason: "primary",
    };
  }
  const fallback: LLMProvider = primary === "bai" ? "openrouter" : "bai";
  const fallbackKey = await getActiveKeyForProvider(fallback);
  if (fallbackKey) {
    return {
      provider: fallback,
      apiKey: fallbackKey.apiKey,
      baseUrl: fallbackKey.baseUrl,
      model: resolveModelForBaseUrl(platform, fallbackKey.baseUrl),
      reason: `fallback-from-${primary}-missing-key`,
    };
  }
  return { provider: null, apiKey: null, baseUrl: null, model: "openai/gpt-4o", reason: "no-provider-key-available" };
}

// ==================== Global API Key Resolution ====================
// Priority: platform own key > global key (coveredPlatforms) > env OpenRouter > error
async function resolveApiConfig(platform: string): Promise<{
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
  source: "platform" | "global" | "env" | "none";
}> {
  const platformConfig = await db.getPlatformConfig(platform);

  // 1. Platform's own API key
  if (platformConfig?.apiKeyEncrypted && platformConfig?.apiBaseUrl) {
    const model = platformConfig.modelVersion ||
      resolveModelForBaseUrl(platform, platformConfig.apiBaseUrl);
    return {
      apiKey: platformConfig.apiKeyEncrypted,
      baseUrl: platformConfig.apiBaseUrl,
      model,
      source: "platform",
    };
  }

  // 2. Provider router: BAI (primary) ⇄ OpenRouter (hot standby)
  //    See resolveProviderForPlatform: BAI-uncovered platforms always go through OpenRouter;
  //    BAI-covered platforms use the configured primary, falling back to the other if the
  //    primary has no active key.
  const routed = await resolveProviderForPlatform(platform);
  if (routed.apiKey && routed.baseUrl) {
    log.info(`resolveApiConfig: ${platform} routed to provider=${routed.provider} (${routed.reason}), model=${routed.model}, baseUrl=${routed.baseUrl}`);
    return {
      apiKey: routed.apiKey,
      baseUrl: routed.baseUrl,
      model: routed.model,
      source: "global",
    };
  }

  // 2b. Legacy fallback: any globalApiKey that explicitly lists this platform in coveredPlatforms
  // (e.g. 阿里百炼 still covers Chinese platforms). Keeps existing 百炼 config working.
  const globalKeys = await db.listGlobalApiKeys();
  for (const gk of globalKeys) {
    if (!gk.isActive || !gk.apiKey || !gk.baseUrl) continue;
    // Skip BAI / OpenRouter records here — already handled above.
    const prov = detectProvider(gk.baseUrl);
    if (prov === "bai" || prov === "openrouter") continue;
    const covered = (gk.coveredPlatforms as string[]) || [];
    if (covered.includes(platform)) {
      const model = resolveModelForBaseUrl(platform, gk.baseUrl);
      log.info(`resolveApiConfig: ${platform} matched legacy global key "${gk.name}", model=${model}, baseUrl=${gk.baseUrl}`);
      return { apiKey: gk.apiKey, baseUrl: gk.baseUrl, model, source: "global" };
    }
  }

  // 3. Environment variable fallback (OpenRouter)
  if (ENV.openrouterApiKey) {
    const model = PLATFORM_OPENROUTER_MODELS[platform as Platform] || "openai/gpt-4o";
    log.info(`resolveApiConfig: ${platform} using env OpenRouter fallback, model=${model}`);
    return {
      apiKey: ENV.openrouterApiKey,
      baseUrl: ENV.openrouterBaseUrl || "https://openrouter.ai/api/v1",
      model,
      source: "env",
    };
  }

  log.info(`resolveApiConfig: no key found for ${platform}, globalKeys=${globalKeys.length}`);
  return { apiKey: null, baseUrl: null, model: "openai/gpt-4o", source: "none" };
}

// Get any active API key (for analysis/citation extraction)
// Also resolves a suitable model based on the provider
function resolveAnalysisModel(baseUrl: string): string {
  if (baseUrl.includes("b.ai")) return "gemini-3-flash";
  if (baseUrl.includes("dashscope") || baseUrl.includes("aliyun")) return "qwen-turbo";
  // gemini-2.0-flash-001 was retired from OpenRouter; use gemini-2.5-flash for analysis
  if (baseUrl.includes("openrouter")) return "google/gemini-2.5-flash";
  return "google/gemini-2.5-flash";
}

// For analysis/citation extraction we also respect the primary-provider switch.
// Order: primary provider (BAI or OpenRouter) → fallback provider → other legacy keys → env.
async function getAnyActiveApiKey(): Promise<{ apiKey: string; baseUrl: string; model: string } | null> {
  const primary = await getPrimaryProvider();
  const primaryKey = await getActiveKeyForProvider(primary);
  if (primaryKey) {
    return { apiKey: primaryKey.apiKey, baseUrl: primaryKey.baseUrl, model: resolveAnalysisModel(primaryKey.baseUrl) };
  }
  const fallback: LLMProvider = primary === "bai" ? "openrouter" : "bai";
  const fallbackKey = await getActiveKeyForProvider(fallback);
  if (fallbackKey) {
    return { apiKey: fallbackKey.apiKey, baseUrl: fallbackKey.baseUrl, model: resolveAnalysisModel(fallbackKey.baseUrl) };
  }
  // Legacy: try any other active global key (e.g. 阿里百炼)
  const globalKeys = await db.listGlobalApiKeys();
  for (const gk of globalKeys) {
    if (gk.isActive && gk.apiKey && gk.baseUrl) {
      return { apiKey: gk.apiKey, baseUrl: gk.baseUrl, model: resolveAnalysisModel(gk.baseUrl) };
    }
  }
  // Fallback to env
  if (ENV.openrouterApiKey) {
    const baseUrl = ENV.openrouterBaseUrl || "https://openrouter.ai/api/v1";
    return { apiKey: ENV.openrouterApiKey, baseUrl, model: "openai/gpt-4o" };
  }
  return null;
}

// ==================== External LLM Call ====================
// H1 (2026-06): now returns full telemetry (model, realModel, latency, usage, cost, rawResponse, provider).
// Callers (executeCollection) persist these to collections.* for downstream cost/perf analysis.
export type LLMCallTelemetry = {
  content: string;
  /** Model we asked for (config.model — resolved from PLATFORM_OPENROUTER_MODELS constants) */
  model: string;
  /** Model the API actually used (data.model — may rewrite to a routed variant on OpenRouter) */
  realModel: string;
  /** 'platform' | 'global' | 'env' — where the apiKey came from */
  source: string;
  /** 'openrouter' | 'bai' | 'bailian' | 'other' */
  provider: "openrouter" | "bai" | "bailian" | "other";
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  costUsd: number | null;
  rawResponse: any;
};

async function callExternalLLM(
  platform: string,
  messages: { role: string; content: string }[],
  traceId: string
): Promise<LLMCallTelemetry> {
  const config = await resolveApiConfig(platform);

  if (!config.apiKey || !config.baseUrl || config.source === "none") {
    throw new Error(`该平台 (${platform}) 未配置 API Key，请在「平台配置」或「全局 API 配置」中设置`);
  }

  const maxRetries = 3;
  // Bumped from 60s → 200s so it covers slow-generating long-tail platforms (zhipu max 185s observed).
  // Previously the AbortController was canceled right after `fetch()` resolved headers, so body
  // streaming was effectively unbounded — masking the real per-call duration. Now timer is cleared
  // only after the full body is consumed, so the deadline covers the entire request.
  const timeoutMs = 200000;

  const provider = detectProviderFromBaseUrl(config.baseUrl);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      log.info(`Calling external API for ${platform} (attempt ${attempt}/${maxRetries})`, {
        traceId, source: config.source, model: config.model,
      });

      // OpenRouter likes HTTP-Referer + X-Title for attribution; BAI / 百炼 don't.
      const isOpenRouter = config.baseUrl.includes("openrouter.ai");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      };
      if (isOpenRouter) {
        headers["HTTP-Referer"] = "https://geo-system.app";
        headers["X-Title"] = "GEO System";
      }
      const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.model,
          messages,
          max_tokens: 4096,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        clearTimeout(timer);
        // Detect model-not-found errors and give a helpful message
        if (errText.includes("not a valid model") || errText.includes("model_not_found") || errText.includes("does not exist")) {
          const rec = PLATFORM_RECOMMENDED_PROVIDER[platform as Platform];
          const hint = rec ? `，推荐使用「${rec}」提供商` : "";
          throw new Error(`该平台 (${PLATFORM_LABELS[platform as Platform] || platform}) 的模型 ${config.model} 在当前 API 提供商中不可用${hint}`);
        }
        throw new Error(`API ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      // Clear timer only after body fully consumed — guarantees timeoutMs covers the entire request
      clearTimeout(timer);
      const latencyMs = Date.now() - t0;
      const content = data.choices?.[0]?.message?.content || "";

      const promptTokens = data.usage?.prompt_tokens ?? null;
      const completionTokens = data.usage?.completion_tokens ?? null;
      const totalTokens = data.usage?.total_tokens ?? (promptTokens != null && completionTokens != null ? promptTokens + completionTokens : null);
      // Cost on OpenRouter is computed from the price table (input/output per-token). We charge on `config.model`
      // (what we requested) so the math matches OPENROUTER_PRICING; data.model may rewrite to a routed variant.
      const costUsd = provider === "openrouter" ? calcCostUsd(config.model, promptTokens, completionTokens) : null;

      log.info(`External API success for ${platform}`, {
        traceId, model: data.model || config.model, contentLength: content.length, latencyMs,
        promptTokens, completionTokens, costUsd,
      });

      return {
        content,
        model: config.model,
        realModel: data.model || config.model,
        source: config.source,
        provider,
        promptTokens,
        completionTokens,
        totalTokens,
        latencyMs,
        costUsd,
        rawResponse: data,
      };
    } catch (error: any) {
      clearTimeout(timer);
      log.warn(`External API attempt ${attempt} failed for ${platform}: ${error.message}`, { traceId });
      if (attempt === maxRetries) {
        throw error;
      }
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }

  throw new Error(`All retry attempts failed for ${platform}`);
}

// ==================== Collection Execution (P0-1: No more simulation) ====================
async function executeCollection(
  collectionId: number,
  question: { questionId: string; text: string; language: string },
  platform: string
): Promise<{ success: boolean; error?: string }> {
  const traceId = `col-${collectionId}-${nanoid(6)}`;

  if (isCancelled(collectionId)) {
    log.info(`Collection ${collectionId} cancelled before execution`, { traceId });
    return { success: false, error: "cancelled" };
  }

  try {
    // P0-1: Send the actual question directly (no "simulating" prompt)
    const systemPrompt = question.language === "zh-CN"
      ? `请详细回答以下问题。如果涉及人物、项目或组织，请提供相关背景、事实和多角度观点。如果有参考来源，请注明来源名称或链接。`
      : `Please answer the following question in detail. If it involves people, projects, or organizations, provide relevant background, facts, and multiple perspectives. If you have reference sources, please cite them by name or URL.`;

    if (isCancelled(collectionId)) {
      return { success: false, error: "cancelled" };
    }

    log.info(`Starting collection for Q:${question.questionId} on ${platform}`, { traceId });

    const telemetry = await callExternalLLM(
      platform,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: question.text },
      ],
      traceId
    );
    const responseText = telemetry.content;
    const apiSource = telemetry.source;

    if (isCancelled(collectionId)) {
      log.info(`Collection ${collectionId} cancelled after LLM call`, { traceId });
      return { success: false, error: "cancelled" };
    }

    // H1-b (2026-06): modelVersion is the model we ACTUALLY requested (telemetry.model = config.model
    // resolved from constants). Ignore the platformConfigs.modelVersion override which was full of
    // stale/incorrect values from past UI edits. The override would only re-enter the picture for
    // platforms with their own dedicated API key (resolveApiConfig path 1, already handled there).
    const modelVersion = telemetry.model;

    await db.updateCollection(collectionId, {
      responseText,
      responseLength: responseText.length,
      hasSearch: true,
      modelVersion,
      status: "success",
      // H1 telemetry (provider/realModel/tokens/latency/cost/rawResponse)
      provider: telemetry.provider,
      realModel: telemetry.realModel,
      promptTokens: telemetry.promptTokens,
      completionTokens: telemetry.completionTokens,
      totalTokens: telemetry.totalTokens,
      latencyMs: telemetry.latencyMs,
      costUsd: telemetry.costUsd != null ? String(telemetry.costUsd) : null,
      rawResponse: telemetry.rawResponse,
    });

    // Citation extraction (enhanced)
    if (!isCancelled(collectionId)) {
      await extractCitations(collectionId, responseText, traceId);
    }

    // AI analysis
    if (!isCancelled(collectionId)) {
      await analyzeCollection(collectionId, question.text, responseText, traceId);
    }

    // Alert checking
    if (!isCancelled(collectionId)) {
      await checkAlerts(collectionId, question, platform, traceId);
    }

    log.info(`Collection ${collectionId} completed successfully`, {
      traceId, platform, apiSource, modelVersion, responseLength: responseText.length,
    });

    return { success: true };
  } catch (error: any) {
    log.error(`Collection ${collectionId} failed: ${error.message}`, { traceId, platform });
    if (!isCancelled(collectionId)) {
      try {
        await db.updateCollection(collectionId, {
          status: "failed",
          errorMessage: error.message,
        });
      } catch (dbError) {
        log.warn(`DB update failed for collection ${collectionId} (likely deleted)`, { traceId });
      }
    }
    return { success: false, error: error.message };
  }
}

// ==================== Citation Extraction (P0-3: Enhanced) ====================
async function extractCitations(collectionId: number, responseText: string, traceId: string) {
  try {
    // Step 1: Regex extraction of explicit URLs
    const urlRegex = /https?:\/\/[^\s\)>\]"'，。、；：]+/g;
    const urls = responseText.match(urlRegex) || [];
    const urlMatchRules = await db.listUrlMatchRules();

    const regexCitations = urls.map((url, index) => {
      let domain = "";
      try { domain = new URL(url).hostname; } catch { domain = url; }

      let sourceType: "our_content" | "friendly" | "neutral" | "unfriendly" | "unknown" = "unknown";
      let isOurContent = false;

      for (const rule of urlMatchRules) {
        const pattern = rule.pattern.replace(/\*/g, ".*");
        if (new RegExp(pattern, "i").test(url)) {
          sourceType = rule.sourceType as any;
          if (rule.sourceType === "our_content") isOurContent = true;
          break;
        }
      }

      return {
        collectionId,
        url,
        domain,
        position: index + 1,
        sourceType,
        isOurContent,
        title: null as string | null,
      };
    });

    if (regexCitations.length > 0) {
      await db.createCitations(regexCitations);
      log.info(`Extracted ${regexCitations.length} URL citations via regex`, { traceId });
    }

    // Step 2: LLM-assisted extraction of implicit references (P0-3)
    // Only run if the response is long enough and we have an API key
    const citationApiKey = await getAnyActiveApiKey();
    if (responseText.length > 200 && citationApiKey) {
      try {
        const extractionResult = await invokeLLM({
          apiKey: citationApiKey.apiKey,
          baseUrl: citationApiKey.baseUrl,
          model: citationApiKey.model,
          messages: [
            {
              role: "system",
              content: `你是一个引用源提取专家。从给定的AI回答文本中，识别所有被提及的信息来源、媒体、网站、报告或机构。
只提取那些在文本中没有给出完整URL的隐式引用（如"据XX报道"、"根据XX数据"、"XX指出"等）。
不要提取已经有完整URL的引用。
返回JSON数组格式：[{"source_name": "来源名称", "context": "引用上下文（20字以内）"}]
如果没有隐式引用，返回空数组 []。`,
            },
            { role: "user", content: responseText.slice(0, 3000) },
          ],
          response_format: { type: "json_object" },
        });

        const llmContent = typeof extractionResult.choices[0]?.message?.content === "string"
          ? extractionResult.choices[0].message.content
          : "[]";

        let implicitRefs: any[] = [];
        try {
          const parsed = JSON.parse(llmContent);
          implicitRefs = Array.isArray(parsed) ? parsed : (parsed.sources || parsed.references || []);
        } catch {
          const arrMatch = llmContent.match(/\[[\s\S]*\]/);
          if (arrMatch) implicitRefs = JSON.parse(arrMatch[0]);
        }

        if (implicitRefs.length > 0) {
          const llmCitations = implicitRefs.slice(0, 10).map((ref: any, idx: number) => {
            const sourceName = ref.source_name || ref.name || "未知来源";
            // Try to match source name against URL rules for classification
            let sourceType: "our_content" | "friendly" | "neutral" | "unfriendly" | "unknown" = "unknown";
            let isOurContent = false;

            for (const rule of urlMatchRules) {
              if (rule.description && sourceName.toLowerCase().includes(rule.description.toLowerCase())) {
                sourceType = rule.sourceType as any;
                if (rule.sourceType === "our_content") isOurContent = true;
                break;
              }
            }

            return {
              collectionId,
              url: `implicit://${sourceName.replace(/\s+/g, "_")}`,
              domain: sourceName,
              position: regexCitations.length + idx + 1,
              sourceType,
              isOurContent,
              title: ref.context || sourceName,
            };
          });

          await db.createCitations(llmCitations);
          log.info(`Extracted ${llmCitations.length} implicit citations via LLM`, { traceId });
        }
      } catch (llmError: any) {
        log.warn(`LLM citation extraction failed: ${llmError.message}`, { traceId });
      }
    }
  } catch (error: any) {
    log.error(`Citation extraction failed: ${error.message}`, { traceId });
  }
}

// ==================== Alert Checking ====================
// Window during which a same (qid×platform×alertType) won't re-fire (H3 dedup).
const ALERT_DEDUP_HOURS = 7 * 24;

// H3 (2026-06) — sentiment_drop is now a RELATIVE trigger:
//   - First-time collection of (qid, platform) has no prior baseline → never fires.
//   - Subsequent collections fire only when current score < prior score AND current ≤ 2.
//     (a 4→3 drop or a 3→3 stationary doesn't fire; absolute negative + actual deterioration does.)
// Combined with the 7-day dedup window this eliminated 77% of historical noise per the May audit.
async function checkAlerts(
  collectionId: number,
  question: { questionId: string; text: string },
  platform: string,
  traceId: string
) {
  try {
    const analysis = await db.getAnalysisByCollectionId(collectionId);
    if (!analysis) return;

    // ===== sentiment_drop (H3 relative trigger) =====
    if (analysis.sentimentScore != null && analysis.sentimentScore <= 2) {
      const dedupKey = `${question.questionId}:${platform}:sentiment_drop`;
      const recent = await db.findRecentAlertByDedupKey(dedupKey, ALERT_DEDUP_HOURS);
      if (recent) {
        log.info(`Alert skipped (dedup): sentiment_drop for ${platform}:${question.questionId} — last ${recent.createdAt?.toISOString()}`, { traceId });
      } else {
        const priorScore = await db.getPriorSentimentScore(question.questionId, platform, collectionId);
        // First time for this (qid, platform) → no baseline, don't fire (avoids new-question-bank burst)
        if (priorScore == null) {
          log.info(`Alert skipped (no prior score): sentiment_drop for ${platform}:${question.questionId} — first-time pair`, { traceId });
        } else if (analysis.sentimentScore >= priorScore) {
          log.info(`Alert skipped (no deterioration): sentiment_drop for ${platform}:${question.questionId} — prior=${priorScore} now=${analysis.sentimentScore}`, { traceId });
        } else {
          const severity = analysis.sentimentScore === 1 ? "critical" : "high";
          const alertData = {
            alertType: "sentiment_drop" as const,
            severity: severity as "critical" | "high",
            title: `${platform} 对问题 ${question.questionId} 给出负面回答`,
            description: `情感评分 ${priorScore} → ${analysis.sentimentScore}：${analysis.sentimentReasoning || ""}`.slice(0, 1000),
            relatedCollectionId: collectionId,
            relatedQuestionId: question.questionId,
            relatedPlatform: platform,
            dedupKey,
          };
          const alertId = await db.createAlert(alertData);
          log.info(`Alert created: sentiment_drop for ${platform} (prior=${priorScore} now=${analysis.sentimentScore})`, { traceId });

          const msg = formatAlertMessage({ ...alertData, severity });
          dispatchNotification({
            messageType: "alert", alertId, severity,
            title: msg.title, content: msg.content,
            dedupKey,
          }).catch(err => log.warn(`Notification dispatch failed: ${err.message}`, { traceId }));
        }
      }
    }

    // ===== fact_missing (still absolute, with 7d dedup) =====
    if (analysis.factualAccuracy === "inaccurate") {
      const dedupKey = `${question.questionId}:${platform}:fact_missing`;
      const recent = await db.findRecentAlertByDedupKey(dedupKey, ALERT_DEDUP_HOURS);
      if (recent) {
        log.info(`Alert skipped (dedup): fact_missing for ${platform}:${question.questionId} — last ${recent.createdAt?.toISOString()}`, { traceId });
      } else {
        const claims = (analysis.inaccurateClaims as string[]) || [];
        const alertData = {
          alertType: "fact_missing" as const,
          severity: "medium" as const,
          title: `${platform} 对问题 ${question.questionId} 存在事实错误`,
          description: claims.length > 0 ? `不准确声明: ${claims.join("; ")}` : "检测到事实性错误",
          relatedCollectionId: collectionId,
          relatedQuestionId: question.questionId,
          relatedPlatform: platform,
          dedupKey,
        };
        const alertId = await db.createAlert(alertData);
        log.info(`Alert created: fact_missing for ${platform}`, { traceId });

        const msg = formatAlertMessage({ ...alertData, severity: "medium" });
        dispatchNotification({
          messageType: "alert", alertId, severity: "medium",
          title: msg.title, content: msg.content,
          dedupKey,
        }).catch(err => log.warn(`Notification dispatch failed: ${err.message}`, { traceId }));
      }
    }
  } catch (error: any) {
    log.error(`Alert check failed: ${error.message}`, { traceId });
  }
}

// ==================== Analysis Helper ====================
async function analyzeCollection(collectionId: number, questionText: string, responseText: string, traceId: string) {
  try {
    const analysisApiKey = await getAnyActiveApiKey();
    if (!analysisApiKey) {
      log.warn(`Skipping analysis for collection ${collectionId}: no active API key`, { traceId });
      return;
    }

    const activeTargetFacts = await db.listTargetFacts(true);
    const targetFactKeys = activeTargetFacts.map((f) => f.factKey);

    const prompt = `你是一个专业的品牌声誉分析师。请对以下AI平台的回答进行分析。

## 被分析的问题
${questionText}

## 被分析的回答
${responseText}

## 请输出以下JSON格式的分析结果（仅输出JSON，不要其他内容）：

{
  "sentiment_score": <1-5的整数，1=强负面，2=偏负面，3=中性，4=偏正面，5=强正面>,
  "sentiment_reasoning": "<评分理由，50字以内>",
  "key_facts_mentioned": ["<回答中提到的关键事实>"],
  "negative_points_mentioned": ["<回答中提到的负面信息>"],
  "positive_points_mentioned": ["<回答中提到的正面信息>"],
  "factual_accuracy": "<accurate|inaccurate|unverifiable>",
  "inaccurate_claims": ["<如有不准确的声明列出>"],
  "overall_tone": "<hostile|critical|neutral|favorable|promotional>",
  "target_facts_check": {
${targetFactKeys.map((k) => `    "${k}": <true|false>`).join(",\n")}
  }
}`;

    const result = await invokeLLM({
      apiKey: analysisApiKey.apiKey,
      baseUrl: analysisApiKey.baseUrl,
      model: analysisApiKey.model,
      messages: [
        { role: "system", content: "You are a professional brand reputation analyst. Always respond with valid JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const content = typeof result.choices[0]?.message?.content === "string"
      ? result.choices[0].message.content
      : "";

    let analysisData: any;
    try {
      analysisData = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Failed to parse analysis response");
      }
    }

    await db.createAnalysis({
      collectionId,
      sentimentScore: Math.min(5, Math.max(1, analysisData.sentiment_score || 3)),
      sentimentReasoning: analysisData.sentiment_reasoning || "",
      overallTone: analysisData.overall_tone || "neutral",
      keyFacts: analysisData.key_facts_mentioned || [],
      positivePoints: analysisData.positive_points_mentioned || [],
      negativePoints: analysisData.negative_points_mentioned || [],
      targetFactsCheck: analysisData.target_facts_check || {},
      factualAccuracy: analysisData.factual_accuracy || "unverifiable",
      inaccurateClaims: analysisData.inaccurate_claims || [],
      analysisModel: result.model || "llm",
      analyzedAt: Date.now(),
    });

    log.info(`Analysis completed for collection ${collectionId}`, {
      traceId,
      sentimentScore: analysisData.sentiment_score,
      tone: analysisData.overall_tone,
    });
  } catch (error: any) {
    log.error(`Analysis failed for collection ${collectionId}: ${error.message}`, { traceId });
  }
}

// ==================== Concurrent Batch Engine (P0-2) ====================
// Streaming concurrent execution: keeps `concurrency` slots full, a slow cell never blocks others.
// Used by both runBatchConcurrently (scheduler) and executeNextBatch (frontend poll).
async function runCollectionsConcurrently(
  tasks: { collectionId: number; question: { questionId: string; text: string; language: string }; platform: string }[],
  concurrency: number
): Promise<{ completed: number; failed: number }> {
  const pLimit = (await import("p-limit")).default;
  const limit = pLimit(concurrency);

  const results = await Promise.allSettled(
    tasks.map((task) =>
      limit(async () => executeCollection(task.collectionId, task.question, task.platform))
    )
  );

  let completed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.success) completed++;
    else failed++;
  }
  return { completed, failed };
}

async function runBatchConcurrently(
  tasks: { collectionId: number; question: any; platform: string }[],
  batchId: string,
  concurrency: number = 5
) {
  log.info(`Starting batch ${batchId}: ${tasks.length} tasks, concurrency=${concurrency}`);
  const normalized = tasks.map((t) => ({
    collectionId: t.collectionId,
    question: {
      questionId: t.question.questionId,
      text: t.question.text,
      language: t.question.language,
    },
    platform: t.platform,
  }));
  const { completed, failed } = await runCollectionsConcurrently(normalized, concurrency);
  log.info(`Batch ${batchId} finished: ${completed} success, ${failed} failed out of ${tasks.length}`);
}

// ==================== Questions Router ====================
const questionsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        brandLine: z.string().optional(),
        dimension: z.string().optional(),
        language: z.string().optional(),
        status: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return db.listQuestions(input || {});
    }),

  get: protectedProcedure
    .input(z.object({ questionId: z.string() }))
    .query(async ({ input }) => {
      return db.getQuestionById(input.questionId);
    }),

  create: adminProcedure
    .input(
      z.object({
        questionId: z.string().min(1),
        text: z.string().min(1),
        brandLine: z.enum(["sun_yuchen", "tron", "competitor"]),
        dimension: z.enum([
          "awareness", "evaluation", "investment", "compliance",
          "comparison", "ecosystem", "usage", "wealth", "industry_status",
        ]),
        language: z.enum(["zh-CN", "en-US"]),
        status: z.enum(["active", "paused", "dynamic"]).default("active"),
        validFrom: z.date().optional().nullable(),
        validUntil: z.date().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      await db.createQuestion({
        questionId: input.questionId,
        text: input.text,
        brandLine: input.brandLine,
        dimension: input.dimension,
        language: input.language,
        status: input.status,
        validFrom: input.validFrom ?? undefined,
        validUntil: input.validUntil ?? undefined,
      });
      return { success: true };
    }),

  update: adminProcedure
    .input(
      z.object({
        questionId: z.string(),
        text: z.string().optional(),
        brandLine: z.enum(["sun_yuchen", "tron", "competitor"]).optional(),
        dimension: z.enum([
          "awareness", "evaluation", "investment", "compliance",
          "comparison", "ecosystem", "usage", "wealth", "industry_status",
        ]).optional(),
        language: z.enum(["zh-CN", "en-US"]).optional(),
        status: z.enum(["active", "paused", "dynamic"]).optional(),
        validFrom: z.date().optional().nullable(),
        validUntil: z.date().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const { questionId, ...data } = input;
      await db.updateQuestion(questionId, data as any);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ questionId: z.string() }))
    .mutation(async ({ input }) => {
      await db.deleteQuestion(input.questionId);
      return { success: true };
    }),
});

// ==================== Collections Router ====================
const collectionsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        questionId: z.string().optional(),
        platform: z.string().optional(),
        batchId: z.string().optional(),
        status: z.string().optional(),
        startTime: z.number().optional(),
        endTime: z.number().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return db.listCollections(input || {});
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const collection = await db.getCollectionById(input.id);
      if (!collection) return null;
      const citationsList = await db.getCitationsByCollectionId(input.id);
      const analysis = await db.getAnalysisByCollectionId(input.id);
      return { ...collection, citations: citationsList, analysis };
    }),

  // Manual trigger: collect one question on one platform
  trigger: adminProcedure
    .input(
      z.object({
        questionId: z.string(),
        platform: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const question = await db.getQuestionById(input.questionId);
      if (!question) throw new Error("Question not found");

      const batchId = `manual-${nanoid(8)}`;
      const collectionId = await db.createCollection({
        questionId: question.questionId,
        questionText: question.text,
        platform: input.platform,
        language: question.language,
        timestamp: Date.now(),
        status: "pending",
        batchId,
      });

      if (collectionId) {
        const result = await executeCollection(
          collectionId,
          { questionId: question.questionId, text: question.text, language: question.language },
          input.platform
        );
        return { success: result.success, collectionId, batchId, error: result.error };
      }
      return { success: false };
    }),

  // Single question → all enabled platforms
  triggerAllPlatforms: adminProcedure
    .input(z.object({ questionId: z.string() }))
    .mutation(async ({ input }) => {
      const question = await db.getQuestionById(input.questionId);
      if (!question) throw new Error("Question not found");

      const platformConfigsList = await db.listPlatformConfigs();
      const enabledPlatforms = platformConfigsList.filter((p) => p.isEnabled).map((p) => p.platform);
      if (enabledPlatforms.length === 0) {
        return { success: false, message: "No enabled platforms", batchId: "", totalCreated: 0 };
      }

      const batchId = `single-q-${nanoid(8)}`;
      let totalCreated = 0;
      for (const platform of enabledPlatforms) {
        const id = await db.createCollection({
          questionId: question.questionId,
          questionText: question.text,
          platform,
          language: question.language,
          timestamp: Date.now(),
          status: "pending",
          batchId,
        });
        if (id) totalCreated++;
      }

      return { success: true, batchId, totalCreated };
    }),

  // Single platform → all active questions
  triggerAllQuestions: adminProcedure
    .input(z.object({ platform: z.string() }))
    .mutation(async ({ input }) => {
      const questionsList = await db.listQuestions({ status: "active" });
      if (questionsList.length === 0) {
        return { success: false, message: "No active questions", batchId: "", totalCreated: 0 };
      }

      const batchId = `single-p-${nanoid(8)}`;
      let totalCreated = 0;
      for (const question of questionsList) {
        const id = await db.createCollection({
          questionId: question.questionId,
          questionText: question.text,
          platform: input.platform,
          language: question.language,
          timestamp: Date.now(),
          status: "pending",
          batchId,
        });
        if (id) totalCreated++;
      }

      return { success: true, batchId, totalCreated };
    }),

  // Batch trigger: creates all pending records, NO background execution
  batchTrigger: adminProcedure
    .input(
      z.object({
        concurrency: z.number().min(1).max(20).optional(),
      }).optional()
    )
    .mutation(async ({ input }) => {
      const batchId = `batch-${nanoid(8)}`;
      const questionsList = await db.listQuestions({ status: "active" });
      const platformConfigsList = await db.listPlatformConfigs();
      const enabledPlatforms = platformConfigsList.filter((p) => p.isEnabled).map((p) => p.platform);

      if (enabledPlatforms.length === 0) {
        return { success: false, message: "No enabled platforms", batchId, totalCreated: 0 };
      }

      let totalCreated = 0;
      for (const question of questionsList) {
        for (const platform of enabledPlatforms) {
          const collectionId = await db.createCollection({
            questionId: question.questionId,
            questionText: question.text,
            platform,
            language: question.language,
            timestamp: Date.now(),
            status: "pending",
            batchId,
          });
          if (collectionId) totalCreated++;
        }
      }

      return { success: true, batchId, totalCreated };
    }),

  // Execute next batch of pending items — called by frontend polling
  // Streaming concurrent execution: prefetch up to concurrency*3 pending rows (capped at 15) and
  // process via p-limit pool so a slow cell never blocks faster ones in the same round.
  // Per-round duration is bounded by Cloud Run 5min timeout; un-finished rows stay 'pending' and
  // get retried by the next poll round, so increasing the prefetch is safe.
  executeNextBatch: adminProcedure
    .input(z.object({
      batchId: z.string(),
      concurrency: z.number().min(1).max(10).optional(),
    }))
    .mutation(async ({ input }) => {
      const concurrency = input.concurrency || 5;
      // Prefetch more than concurrency so the p-limit pool stays full as cells complete.
      // Capped at 15 to stay well under Cloud Run 5min limit even if many cells hit the 200s timeout.
      const prefetch = Math.min(concurrency * 3, 15);
      const progress = await db.getBatchProgress(input.batchId);

      // Get pending collections for this batch
      const pendingResult = await db.listCollections({
        batchId: input.batchId,
        status: "pending",
        limit: prefetch,
        offset: 0,
      });
      const pending = pendingResult.data;

      if (pending.length === 0) {
        return { completed: 0, failed: 0, remaining: 0, total: progress.total };
      }

      // Resolve questions for each pending row up front; mark as failed any with missing question
      const tasks: { collectionId: number; question: { questionId: string; text: string; language: string }; platform: string }[] = [];
      let failed = 0;
      for (const col of pending) {
        const question = await db.getQuestionById(col.questionId);
        if (!question) {
          await db.updateCollection(col.id, { status: "failed", errorMessage: "Question not found" });
          failed++;
          continue;
        }
        tasks.push({
          collectionId: col.id,
          question: { questionId: question.questionId, text: question.text, language: question.language },
          platform: col.platform,
        });
      }

      // Streaming concurrent execution (shared helper)
      const result = await runCollectionsConcurrently(tasks, concurrency);
      const completed = result.completed;
      failed += result.failed;

      // Recount remaining
      const updatedProgress = await db.getBatchProgress(input.batchId);

      // Batch completion notification
      if (updatedProgress.pending === 0) {
        try {
          const batchAlerts = await db.listAlertsByBatchCollections(input.batchId);
          if (batchAlerts.length > 0) {
            const msg = formatBatchSummary({
              batchId: input.batchId,
              total: updatedProgress.total,
              completed: updatedProgress.completed,
              failed: updatedProgress.failed,
              alertCount: batchAlerts.length,
              alerts: batchAlerts.map(a => ({ severity: a.severity, title: a.title })),
            });
            dispatchNotification({
              messageType: "batch_summary", batchId: input.batchId,
              title: msg.title, content: msg.content,
              severity: batchAlerts.some(a => a.severity === "critical") ? "critical" : "high",
            }).catch(() => {});
          }
        } catch {}
      }

      return {
        completed,
        failed,
        remaining: updatedProgress.pending,
        total: updatedProgress.total,
      };
    }),

  // Get batch progress
  batchProgress: protectedProcedure
    .input(z.object({ batchId: z.string() }))
    .query(async ({ input }) => {
      return db.getBatchProgress(input.batchId);
    }),

  // Reset stale pending records (stuck > 5 min)
  resetStale: adminProcedure
    .input(z.object({ batchId: z.string().optional() }).optional())
    .mutation(async ({ input }) => {
      const database = await db.getDb();
      if (!database) return { reset: 0 };
      const { collections } = await import("../drizzle/schema");
      const { sql, eq, and } = await import("drizzle-orm");
      const conditions = [
        eq(collections.status, "pending"),
        sql`${collections.createdAt} < DATE_SUB(NOW(), INTERVAL 5 MINUTE)`,
      ];
      if (input?.batchId) {
        conditions.push(eq(collections.batchId, input.batchId));
      }
      const stale = await database.select({ id: collections.id }).from(collections).where(and(...conditions));
      for (const s of stale) {
        await db.updateCollection(s.id, { status: "pending" });
      }
      return { reset: stale.length };
    }),

  // Batch delete collection records
  batchDelete: adminProcedure
    .input(z.object({ ids: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      if (input.ids.length === 0) return { success: true, deleted: 0 };

      for (const id of input.ids) {
        cancelCollection(id);
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      const deleted = await db.batchDeleteCollections(input.ids);
      return { success: true, deleted };
    }),

  // Batch retry: reset to pending so executeNextBatch can pick them up
  batchRetry: adminProcedure
    .input(z.object({ ids: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      if (input.ids.length === 0) return { success: true, retried: 0, batchId: "" };
      const collections = await db.getCollectionsByIds(input.ids);
      const batchId = `retry-${nanoid(8)}`;

      for (const col of collections) {
        await db.updateCollection(col.id, { status: "pending", errorMessage: null, batchId });
      }

      return { success: true, retried: collections.length, batchId };
    }),

  // Data export: CSV format for collection records
  exportCsv: protectedProcedure
    .input(
      z.object({
        questionId: z.string().optional(),
        platform: z.string().optional(),
        status: z.string().optional(),
        startTime: z.number().optional(),
        endTime: z.number().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const result = await db.listCollections({ ...(input || {}), limit: 5000 });
      return result.data;
    }),

  getLatestByQuestionAndPlatform: protectedProcedure
    .input(z.object({ questionId: z.string(), platform: z.string() }))
    .query(async ({ input }) => {
      const result = await db.listCollections({
        questionId: input.questionId,
        platform: input.platform,
        status: "success",
        limit: 1,
        offset: 0,
      });
      return { collectionId: result.data[0]?.id ?? null };
    }),

  reanalyze: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const collection = await db.getCollectionById(input.id);
      if (!collection) throw new Error("Collection not found");
      if (!collection.responseText) throw new Error("No response text to analyze");

      const traceId = `reanalyze-${input.id}-${nanoid(6)}`;
      log.info(`Reanalyzing collection ${input.id}`, { traceId });

      // Delete existing analysis to prevent duplicates
      await db.deleteAnalysisByCollectionId(input.id);

      await analyzeCollection(input.id, collection.questionText, collection.responseText, traceId);
      await extractCitations(input.id, collection.responseText, traceId);
      // H4 (2026-06): match executeCollection behavior — fire checkAlerts after analysis.
      // The H3 dedup + relative-trigger logic prevents reanalysis bursts from creating noise.
      await checkAlerts(input.id, { questionId: collection.questionId, text: collection.questionText }, collection.platform, traceId);

      return { success: true };
    }),

  // Batch reanalyze: find N success collections without analysis, run analysis
  reanalyzeAll: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(50).optional() }).optional())
    .mutation(async ({ input }) => {
      const batchSize = input?.limit || 10;
      const database = await db.getDb();
      if (!database) return { analyzed: 0, total: 0 };
      const { collections, analyses } = await import("../drizzle/schema");
      const { eq, sql, isNull } = await import("drizzle-orm");

      // Find success collections without analysis (incl. fields needed to fire checkAlerts after)
      const missing = await database
        .select({
          id: collections.id,
          questionId: collections.questionId,
          platform: collections.platform,
          questionText: collections.questionText,
          responseText: collections.responseText,
        })
        .from(collections)
        .leftJoin(analyses, eq(analyses.collectionId, collections.id))
        .where(sql`${collections.status} = 'success' AND ${collections.responseText} IS NOT NULL AND ${analyses.id} IS NULL`)
        .limit(batchSize);

      const totalMissing = (await database
        .select({ count: sql<number>`COUNT(DISTINCT ${collections.id})` })
        .from(collections)
        .leftJoin(analyses, eq(analyses.collectionId, collections.id))
        .where(sql`${collections.status} = 'success' AND ${collections.responseText} IS NOT NULL AND ${analyses.id} IS NULL`)
      )[0]?.count || 0;

      let analyzed = 0;
      for (const col of missing) {
        const traceId = `bulk-analyze-${col.id}-${nanoid(4)}`;
        try {
          await analyzeCollection(col.id, col.questionText, col.responseText!, traceId);
          // H4 (2026-06): also fire checkAlerts so reanalysis backfill produces the same alerts
          // executeCollection would have. H3 dedup keeps the burst from creating noise.
          await checkAlerts(col.id, { questionId: col.questionId, text: col.questionText }, col.platform, traceId);
          analyzed++;
        } catch (err: any) {
          log.error(`Bulk analyze failed for ${col.id}: ${err.message}`, { traceId });
        }
      }

      return { analyzed, total: Number(totalMissing) };
    }),
});

// ==================== Dashboard Router ====================
const dashboardRouter = router({
  summary: protectedProcedure
    .input(
      z.object({
        startTime: z.number().optional(),
        endTime: z.number().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return db.getDashboardSummary(input?.startTime, input?.endTime);
    }),

  heatmap: protectedProcedure
    .input(
      z.object({
        startTime: z.number().optional(),
        endTime: z.number().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return db.getHeatmapData(input?.startTime, input?.endTime);
    }),

  sentimentTrend: protectedProcedure
    .input(
      z.object({
        questionId: z.string(),
        platform: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return db.getSentimentTrend(input.questionId, input.platform);
    }),
});

// ==================== Citations Router ====================
const citationsRouter = router({
  top: protectedProcedure
    .input(
      z.object({
        limit: z.number().optional(),
        startTime: z.number().optional(),
        endTime: z.number().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return db.getTopCitedUrls(input?.limit || 20, input?.startTime, input?.endTime);
    }),

  domainDistribution: protectedProcedure
    .input(
      z.object({
        startTime: z.number().optional(),
        endTime: z.number().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return db.getCitationDomainDistribution(input?.startTime, input?.endTime);
    }),

  byCollection: protectedProcedure
    .input(z.object({ collectionId: z.number() }))
    .query(async ({ input }) => {
      return db.getCitationsByCollectionId(input.collectionId);
    }),

  uncitedContent: protectedProcedure
    .input(
      z.object({
        startTime: z.number().optional(),
        endTime: z.number().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return db.getUncitedOurContent(input?.startTime, input?.endTime);
    }),
});

// ==================== Our Content URLs Router ====================
const ourContentRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        isActive: z.boolean().optional(),
        contentType: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return db.listOurContentUrls(input || {});
    }),

  create: adminProcedure
    .input(
      z.object({
        url: z.string().min(1),
        title: z.string().optional(),
        publishPlatform: z.string().optional(),
        publishDate: z.date().optional().nullable(),
        contentType: z.enum(["seo_article", "wiki", "zhihu_answer", "official_page", "media_report"]).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await db.createOurContentUrl(input as any);
      return { success: true };
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        url: z.string().optional(),
        title: z.string().optional(),
        publishPlatform: z.string().optional(),
        publishDate: z.date().optional().nullable(),
        contentType: z.enum(["seo_article", "wiki", "zhihu_answer", "official_page", "media_report"]).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateOurContentUrl(id, data as any);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteOurContentUrl(input.id);
      return { success: true };
    }),

  batchCreate: adminProcedure
    .input(
      z.object({
        items: z.array(
          z.object({
            url: z.string().min(1),
            title: z.string().optional(),
            publishPlatform: z.string().optional(),
            contentType: z.enum(["seo_article", "wiki", "zhihu_answer", "official_page", "media_report"]).optional(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      await db.batchCreateOurContentUrls(input.items as any[]);
      return { success: true, count: input.items.length };
    }),
});

// ==================== Target Facts Router ====================
const targetFactsRouter = router({
  list: protectedProcedure
    .input(z.object({ activeOnly: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      return db.listTargetFacts(input?.activeOnly);
    }),

  create: adminProcedure
    .input(
      z.object({
        factKey: z.string().min(1),
        factDescription: z.string().min(1),
        validFrom: z.date().optional().nullable(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await db.createTargetFact(input as any);
      return { success: true };
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        factKey: z.string().optional(),
        factDescription: z.string().optional(),
        validFrom: z.date().optional().nullable(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateTargetFact(id, data as any);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteTargetFact(input.id);
      return { success: true };
    }),
});

// ==================== Alerts Router ====================
const alertsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        severity: z.string().optional(),
        isRead: z.boolean().optional(),
        // H2 (2026-06): status filter; defaults to 'active' in db.listAlerts
        status: z.enum(["active", "resolved", "dismissed"]).optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return db.listAlerts(input || {});
    }),

  markRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.markAlertRead(input.id);
      return { success: true };
    }),

  markAllRead: protectedProcedure.mutation(async () => {
    await db.markAllAlertsRead();
    return { success: true };
  }),

  // H2 (2026-06): explicit workflow transitions
  resolve: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.setAlertStatus(input.id, "resolved");
      return { success: true };
    }),

  dismiss: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.setAlertStatus(input.id, "dismissed");
      return { success: true };
    }),
});

// ==================== Platform Configs Router ====================
const platformConfigsRouter = router({
  list: protectedProcedure.query(async () => {
    return db.listPlatformConfigs();
  }),

  upsert: adminProcedure
    .input(
      z.object({
        platform: z.string().min(1),
        displayName: z.string().min(1),
        isEnabled: z.boolean().optional(),
        apiKeyEncrypted: z.string().optional().nullable(),
        apiBaseUrl: z.string().optional().nullable(),
        modelVersion: z.string().optional(),
        collectFrequency: z.string().optional(),
        extraConfig: z.any().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await db.upsertPlatformConfig(input as any);
      return { success: true };
    }),

  // Global API settings — check if any key is configured
  getGlobalApiConfig: protectedProcedure.query(async () => {
    const key = await getAnyActiveApiKey();
    return {
      hasApiKey: !!key,
    };
  }),

  // Delete a platform config
  delete: adminProcedure
    .input(z.object({ platform: z.string() }))
    .mutation(async ({ input }) => {
      await db.deletePlatformConfig(input.platform);
      return { success: true };
    }),
});

// ==================== Global API Keys Router (P3-1: Masked output) ====================
const globalApiKeysRouter = router({
  list: protectedProcedure.query(async () => {
    const keys = await db.listGlobalApiKeys();
    // Return masked API keys + detected provider — exclude raw apiKey field
    return keys.map((k) => {
      const { apiKey: rawKey, ...rest } = k;
      return {
        ...rest,
        apiKeyMasked: maskApiKey(rawKey),
        provider: detectProvider(k.baseUrl), // 'bai' | 'openrouter' | 'other'
      };
    });
  }),

  upsert: adminProcedure
    .input(
      z.object({
        id: z.number().optional(),
        name: z.string().min(1),
        apiKey: z.string().optional().nullable(),
        baseUrl: z.string().optional().nullable(),
        coveredPlatforms: z.array(z.string()).optional(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // When editing an existing key, don't overwrite apiKey/baseUrl with null/empty
      // (frontend doesn't receive the raw apiKey, so it sends null on edit)
      if (input.id) {
        const existing = await db.listGlobalApiKeys().then(keys => keys.find(k => k.id === input.id));
        if (existing) {
          if (!input.apiKey) input.apiKey = existing.apiKey;
          if (!input.baseUrl) input.baseUrl = existing.baseUrl;
        }
      }
      await db.upsertGlobalApiKey(input as any);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteGlobalApiKey(input.id);
      return { success: true };
    }),

  // Test a provider connection by calling GET /v1/models.
  // Accepts either an existing key id (uses stored apiKey) or an inline apiKey+baseUrl pair
  // (so the user can validate before saving).
  testConnection: adminProcedure
    .input(
      z.object({
        id: z.number().optional(),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      let apiKey = input.apiKey || "";
      let baseUrl = input.baseUrl || "";
      if (input.id) {
        const existing = (await db.listGlobalApiKeys()).find((k) => k.id === input.id);
        if (!existing) throw new Error("Key not found");
        apiKey = existing.apiKey || "";
        baseUrl = existing.baseUrl || "";
      }
      if (!apiKey || !baseUrl) throw new Error("apiKey and baseUrl required");
      try {
        const url = `${baseUrl.replace(/\/$/, "")}/models`;
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!resp.ok) {
          const t = await resp.text();
          return { success: false, error: `HTTP ${resp.status}: ${t.slice(0, 200)}`, modelCount: 0, sampleModels: [] as string[] };
        }
        const data: any = await resp.json();
        const models: any[] = data?.data || data?.models || [];
        const sample = models.slice(0, 10).map((m: any) => m.id || m.name || String(m));
        return { success: true, modelCount: models.length, sampleModels: sample, provider: detectProvider(baseUrl) };
      } catch (e: any) {
        return { success: false, error: String(e?.message || e).slice(0, 300), modelCount: 0, sampleModels: [] as string[] };
      }
    }),

  // For each platform, compute its current active provider and the fallback one.
  // Used by the ConfigPlatforms route-preview table.
  routePreview: protectedProcedure.query(async () => {
    const primary = await getPrimaryProvider();
    const baiAvail = !!(await getActiveKeyForProvider("bai"));
    const orAvail = !!(await getActiveKeyForProvider("openrouter"));
    const rows: { platform: string; actual: "bai" | "openrouter" | "none"; fallback: "bai" | "openrouter" | "none"; reason: string }[] = [];
    for (const platform of PLATFORMS) {
      const r = await resolveProviderForPlatform(platform);
      const actual = (r.provider ?? "none") as "bai" | "openrouter" | "none";
      let fallback: "bai" | "openrouter" | "none" = "none";
      if (BAI_SUPPORTED_PLATFORMS.includes(platform)) {
        if (actual === "bai") fallback = orAvail ? "openrouter" : "none";
        else if (actual === "openrouter") fallback = baiAvail ? "bai" : "none";
      } else {
        fallback = "none"; // BAI-uncovered: no fallback (OpenRouter is the only option)
      }
      rows.push({ platform, actual, fallback, reason: r.reason });
    }
    return { primary, rows, baiAvailable: baiAvail, openrouterAvailable: orAvail };
  }),
});

// ==================== System Configs Router ====================
const sysConfigsRouter = router({
  getPrimaryProvider: protectedProcedure.query(async () => {
    return await getPrimaryProvider();
  }),
  setPrimaryProvider: adminProcedure
    .input(z.object({ provider: z.enum(["bai", "openrouter"]) }))
    .mutation(async ({ input }) => {
      await db.setSysConfig("llm_primary_provider", input.provider);
      log.info(`Primary LLM provider switched to: ${input.provider}`);
      return { success: true, provider: input.provider };
    }),
});

// ==================== Weekly Reports Router ====================
const weeklyReportsRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async ({ input }) => {
      return db.listWeeklyReports(input?.limit || 12);
    }),

  get: protectedProcedure
    .input(z.object({ reportWeek: z.string() }))
    .query(async ({ input }) => {
      return db.getWeeklyReport(input.reportWeek);
    }),

  generate: adminProcedure
    .input(z.object({ reportWeek: z.string() }))
    .mutation(async ({ input }) => {
      const weekMatch = input.reportWeek.match(/^(\d{4})-W(\d{2})$/);
      if (!weekMatch) throw new Error("Invalid week format. Use YYYY-WNN");

      const year = parseInt(weekMatch[1]);
      const week = parseInt(weekMatch[2]);

      const jan1 = new Date(year, 0, 1);
      const dayOfWeek = jan1.getDay();
      const startDate = new Date(jan1);
      startDate.setDate(jan1.getDate() + (week - 1) * 7 - dayOfWeek + 1);
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 7);

      const startTime = startDate.getTime();
      const endTime = endDate.getTime();

      const summary = await db.getDashboardSummary(startTime, endTime);
      const heatmap = await db.getHeatmapData(startTime, endTime);
      const topCited = await db.getTopCitedUrls(20, startTime, endTime);
      const alertsList = await db.listAlerts({ limit: 50 });

      const reportPeriod = `${startDate.toISOString().split("T")[0]} ~ ${endDate.toISOString().split("T")[0]}`;

      await db.upsertWeeklyReport({
        reportWeek: input.reportWeek,
        reportPeriod,
        summaryMetrics: summary,
        platformBreakdown: summary?.platformBreakdown || [],
        questionDetails: heatmap,
        citationAnalysis: { topCited },
        alertsSummary: alertsList.data.slice(0, 10),
        generatedAt: Date.now(),
      });

      return { success: true, reportWeek: input.reportWeek };
    }),
});

// ==================== URL Match Rules Router ====================
const urlMatchRulesRouter = router({
  list: protectedProcedure.query(async () => {
    return db.listUrlMatchRules();
  }),

  create: adminProcedure
    .input(
      z.object({
        pattern: z.string().min(1),
        sourceType: z.enum(["our_content", "friendly", "neutral", "unfriendly"]),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await db.createUrlMatchRule(input as any);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteUrlMatchRule(input.id);
      return { success: true };
    }),
});

// ==================== Scheduler Router (P1-2: Cron scheduling) ====================
const schedulerRouter = router({
  getConfig: protectedProcedure.query(async () => {
    return {
      enabled: schedulerState.enabled,
      cronExpression: schedulerState.cronExpression,
      lastRunAt: schedulerState.lastRunAt,
      nextRunAt: schedulerState.nextRunAt,
      concurrency: schedulerState.concurrency,
    };
  }),

  updateConfig: adminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        cronExpression: z.string().optional(),
        concurrency: z.number().min(1).max(20).optional(),
      })
    )
    .mutation(async ({ input }) => {
      schedulerState.enabled = input.enabled;
      if (input.cronExpression) schedulerState.cronExpression = input.cronExpression;
      if (input.concurrency) schedulerState.concurrency = input.concurrency;

      // Persist to database
      await db.upsertSchedulerConfig({
        enabled: schedulerState.enabled,
        cronExpression: schedulerState.cronExpression,
        concurrency: schedulerState.concurrency,
      });

      // Re-initialize the cron job
      await initScheduler();

      return { success: true, ...schedulerState };
    }),
});

// ==================== Scheduler State & Init ====================
const schedulerState = {
  enabled: false,
  cronExpression: "0 8 * * *", // Default: daily at 8:00 AM
  lastRunAt: null as number | null,
  nextRunAt: null as number | null,
  concurrency: 5,
  job: null as any,
};

async function initScheduler() {
  // Stop existing job if any
  if (schedulerState.job) {
    schedulerState.job.stop();
    schedulerState.job = null;
  }

  if (!schedulerState.enabled) {
    schedulerState.nextRunAt = null;
    log.info("Scheduler disabled");
    return;
  }

  try {
    const cron = await import("node-cron");
    const task = cron.schedule(schedulerState.cronExpression, async () => {
      log.info("Scheduled collection triggered");
      schedulerState.lastRunAt = Date.now();
      db.upsertSchedulerConfig({ lastRunAt: schedulerState.lastRunAt }).catch(() => {});

      try {
        const questionsList = await db.listQuestions({ status: "active" });
        const platformConfigsList = await db.listPlatformConfigs();
        const enabledPlatforms = platformConfigsList.filter((p: any) => p.isEnabled).map((p: any) => p.platform);

        if (enabledPlatforms.length === 0 || questionsList.length === 0) {
          log.warn("Scheduled collection skipped: no enabled platforms or active questions");
          return;
        }

        const batchId = `scheduled-${nanoid(8)}`;
        const tasks: { collectionId: number; question: any; platform: string }[] = [];

        for (const question of questionsList) {
          for (const platform of enabledPlatforms) {
            const collectionId = await db.createCollection({
              questionId: question.questionId,
              questionText: question.text,
              platform,
              language: question.language,
              timestamp: Date.now(),
              status: "pending",
              batchId,
            });
            if (collectionId) {
              tasks.push({ collectionId, question, platform });
            }
          }
        }

        await runBatchConcurrently(tasks, batchId, schedulerState.concurrency);
      } catch (error: any) {
        log.error(`Scheduled collection failed: ${error.message}`);
      }
    }, {
      timezone: "Asia/Shanghai",
    });

    schedulerState.job = task;
    log.info(`Scheduler initialized: ${schedulerState.cronExpression}`);

    // Calculate next run time (approximate)
    schedulerState.nextRunAt = Date.now() + 24 * 60 * 60 * 1000; // rough estimate
  } catch (error: any) {
    log.error(`Failed to initialize scheduler: ${error.message}`);
  }
}

// ==================== Load Scheduler Config from DB ====================
(async () => {
  try {
    const saved = await db.getSchedulerConfig();
    if (saved) {
      schedulerState.enabled = saved.enabled;
      schedulerState.cronExpression = saved.cronExpression;
      schedulerState.concurrency = saved.concurrency;
      schedulerState.lastRunAt = saved.lastRunAt;
      await initScheduler();
    }
  } catch (error: any) {
    log.warn(`Failed to load scheduler config from DB: ${error.message}`);
  }
})();

// ==================== Users Router (developer only) ====================
// ==================== Notifications Router (developer only) ====================
const notificationsRouter = router({
  listConfigs: developerProcedure.query(async () => {
    return db.listNotificationConfigs();
  }),

  upsertConfig: developerProcedure
    .input(z.object({
      channel: z.enum(["feishu", "telegram", "email"]),
      isEnabled: z.boolean().optional(),
      webhookUrl: z.string().optional().nullable(),
      botToken: z.string().optional().nullable(),
      chatId: z.string().optional().nullable(),
      smtpHost: z.string().optional().nullable(),
      smtpPort: z.number().optional().nullable(),
      smtpUser: z.string().optional().nullable(),
      smtpPass: z.string().optional().nullable(),
      emailFrom: z.string().optional().nullable(),
      emailTo: z.array(z.string()).optional().nullable(),
      minSeverity: z.enum(["critical", "high", "medium", "low"]).optional(),
      silentStart: z.string().optional().nullable(),
      silentEnd: z.string().optional().nullable(),
    }))
    .mutation(async ({ input }) => {
      await db.upsertNotificationConfig(input as any);
      return { success: true };
    }),

  testChannel: developerProcedure
    .input(z.object({ channel: z.enum(["feishu", "telegram", "email"]) }))
    .mutation(async ({ input }) => {
      const config = (await db.listNotificationConfigs()).find(c => c.channel === input.channel);
      if (!config) return { success: false, error: "Channel not configured" };

      const { sendFeishu, sendTelegram, sendEmail } = await import("./_core/senders");
      const testMsg = { title: "TRON GEO 系统 - 测试通知", content: "这是一条测试消息，确认推送渠道配置正确。\n时间: " + new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) };

      if (input.channel === "feishu" && config.webhookUrl) {
        return sendFeishu(config.webhookUrl, testMsg);
      } else if (input.channel === "telegram" && config.botToken && config.chatId) {
        return sendTelegram(config.botToken, config.chatId, testMsg);
      } else if (input.channel === "email" && config.smtpHost && config.smtpUser && config.emailFrom) {
        return sendEmail({
          smtpHost: config.smtpHost, smtpPort: config.smtpPort || 465,
          smtpUser: config.smtpUser, smtpPass: config.smtpPass || "",
          from: config.emailFrom, to: (config.emailTo as string[]) || [],
        }, testMsg);
      }
      return { success: false, error: "Channel not fully configured" };
    }),

  listLogs: developerProcedure
    .input(z.object({
      channel: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.listNotificationLogs(input || {});
    }),
});

const usersRouter = router({
  list: developerProcedure.query(async () => {
    const all = await db.listUsers();
    // Strip passwordHash from response
    return all.map(({ passwordHash, ...rest }) => rest);
  }),

  updateRole: developerProcedure
    .input(z.object({
      id: z.number(),
      role: z.enum(["user", "admin"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const target = await db.getUserById(input.id);
      if (!target) throw new Error("User not found");
      if (target.role === "developer") throw new Error("Cannot modify developer role");
      await db.updateUserRole(input.id, input.role);
      return { success: true };
    }),

  delete: developerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const target = await db.getUserById(input.id);
      if (!target) throw new Error("User not found");
      if (target.role === "developer") throw new Error("Cannot delete developer");
      if (target.id === ctx.user.id) throw new Error("Cannot delete yourself");
      await db.deleteUser(input.id);
      return { success: true };
    }),

  ban: developerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const target = await db.getUserById(input.id);
      if (!target) throw new Error("User not found");
      if (target.role === "developer") throw new Error("Cannot ban developer");
      await db.setUserBanned(input.id, true);
      return { success: true };
    }),

  unban: developerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const target = await db.getUserById(input.id);
      if (!target) throw new Error("User not found");
      await db.setUserBanned(input.id, false);
      return { success: true };
    }),
});

// ==================== Sentiment Monitor (舆情监控 Phase 1) ====================
const monitorSchedulerState = {
  enabled: false,
  cronExpression: "0 9,21 * * *", // 09:00 & 21:00 daily (Asia/Shanghai)
  lastRunAt: null as number | null,
  job: null as any,
};
let monitorCycleRunning = false;

// Single-flight guard so manual triggers and cron never overlap.
async function runMonitorCycleGuarded(tbs?: string): Promise<MonitorCycleResult | null> {
  if (monitorCycleRunning) {
    log.warn("Monitor cycle already running; skipping this trigger");
    return null;
  }
  monitorCycleRunning = true;
  try {
    const res = await runMonitorCycle(tbs ? { tbs } : undefined);
    monitorSchedulerState.lastRunAt = Date.now();
    await db.upsertSchedulerConfig({ monitorLastRunAt: monitorSchedulerState.lastRunAt }).catch(() => {});
    return res;
  } finally {
    monitorCycleRunning = false;
  }
}

async function initMonitorScheduler() {
  if (monitorSchedulerState.job) {
    monitorSchedulerState.job.stop();
    monitorSchedulerState.job = null;
  }
  if (!monitorSchedulerState.enabled) {
    log.info("Monitor scheduler disabled");
    return;
  }
  try {
    const cron = await import("node-cron");
    monitorSchedulerState.job = cron.schedule(
      monitorSchedulerState.cronExpression,
      () => {
        log.info("Scheduled monitor cycle triggered");
        runMonitorCycleGuarded().catch((e) => log.error(`Scheduled monitor cycle failed: ${e.message}`));
      },
      { timezone: "Asia/Shanghai" }
    );
    log.info(`Monitor scheduler initialized: ${monitorSchedulerState.cronExpression}`);
  } catch (error: any) {
    log.error(`Failed to initialize monitor scheduler: ${error.message}`);
  }
}

// Load monitor scheduler config from DB at boot (default OFF until the user enables it).
(async () => {
  try {
    const saved = await db.getSchedulerConfig();
    if (saved) {
      monitorSchedulerState.enabled = (saved as any).monitorEnabled ?? false;
      monitorSchedulerState.cronExpression = (saved as any).monitorCron ?? "0 9,21 * * *";
      monitorSchedulerState.lastRunAt = (saved as any).monitorLastRunAt ?? null;
      await initMonitorScheduler();
    }
  } catch (error: any) {
    log.warn(`Failed to load monitor scheduler config from DB: ${error.message}`);
  }
})();

const monitorRouter = router({
  // All authenticated users can view monitor data.
  listArticles: protectedProcedure
    .input(
      z
        .object({
          page: z.number().min(0).optional(),
          pageSize: z.number().min(1).max(100).optional(),
          threatLevel: z.enum(["high", "medium", "low", "none"]).optional(),
          stance: z.enum(["hostile", "neutral", "friendly"]).optional(),
          relevance: z.enum(["high", "medium", "low", "irrelevant"]).optional(),
          sourcePlatform: z.string().optional(),
          focus: z.boolean().optional(), // default view: high+medium only
          startTime: z.number().optional(),
          endTime: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const pageSize = input?.pageSize ?? 50;
      const page = input?.page ?? 0;
      return db.listMonitorArticles({
        threatLevel: input?.threatLevel,
        stance: input?.stance,
        relevance: input?.relevance,
        sourcePlatform: input?.sourcePlatform,
        focus: input?.focus,
        startTime: input?.startTime,
        endTime: input?.endTime,
        limit: pageSize,
        offset: page * pageSize,
      });
    }),

  getArticle: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    return db.getMonitorArticleById(input.id);
  }),

  stats: protectedProcedure.query(async () => {
    return db.getMonitorStats();
  }),

  getBudgetStatus: protectedProcedure.query(async () => {
    return monitorBudget.readBudget();
  }),

  listSourceRules: protectedProcedure.query(async () => {
    return db.listMonitorSourceRules();
  }),

  // admin+ operations
  triggerCycle: adminProcedure.mutation(async () => {
    const res = await runMonitorCycleGuarded();
    if (!res) return { success: false, running: true, message: "已有一轮监控正在运行" };
    return { success: true, running: false, result: res };
  }),

  reanalyzeArticle: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const ok = await reanalyzeArticle(input.id);
    return { success: ok };
  }),

  // 币安广场 AWS WAF cookie status + on-demand refresh (needs Chromium; in Cloud Run this reports
  // whether in-container refresh works — else refresh externally and it lands in sysConfigs).
  binanceCookieStatus: protectedProcedure.query(async () => getCookieStatus()),
  refreshBinanceCookie: adminProcedure.mutation(async () => refreshCookieViaBrowser()),

  // Phase 2 push config: briefing/realtime toggles + briefing mode (channels + silent hours live in
  // notificationConfigs, managed at /config/notifications).
  getPushConfig: protectedProcedure.query(async () => getPushConfig()),
  setPushConfig: adminProcedure
    .input(
      z.object({
        briefingEnabled: z.boolean().optional(),
        briefingMode: z.enum(["every", "negative_only"]).optional(),
        realtimeEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await setPushConfig(input);
      return { success: true, ...(await getPushConfig()) };
    }),

  getSchedule: protectedProcedure.query(async () => ({
    enabled: monitorSchedulerState.enabled,
    cronExpression: monitorSchedulerState.cronExpression,
    lastRunAt: monitorSchedulerState.lastRunAt,
    running: monitorCycleRunning,
  })),

  setSchedule: adminProcedure
    .input(z.object({ enabled: z.boolean(), cronExpression: z.string().optional() }))
    .mutation(async ({ input }) => {
      monitorSchedulerState.enabled = input.enabled;
      if (input.cronExpression) monitorSchedulerState.cronExpression = input.cronExpression;
      await db.upsertSchedulerConfig({
        monitorEnabled: monitorSchedulerState.enabled,
        monitorCron: monitorSchedulerState.cronExpression,
      });
      await initMonitorScheduler();
      return {
        success: true,
        enabled: monitorSchedulerState.enabled,
        cronExpression: monitorSchedulerState.cronExpression,
      };
    }),

  listKeywords: adminProcedure.query(async () => {
    return db.listMonitorKeywords(false);
  }),

  upsertKeyword: adminProcedure
    .input(
      z.object({
        id: z.number().optional(),
        keyword: z.string().min(1),
        keywordGroup: z.string().optional().nullable(),
        searchFreq: z.enum(["hourly", "daily"]).optional(),
        isActive: z.boolean().optional(),
        priority: z.number().min(0).max(10).optional(),
      })
    )
    .mutation(async ({ input }) => {
      await db.upsertMonitorKeyword({
        id: input.id,
        keyword: input.keyword.trim(),
        keywordGroup: input.keywordGroup ?? null,
        searchFreq: input.searchFreq ?? "daily",
        isActive: input.isActive ?? true,
        priority: input.priority ?? 5,
      });
      return { success: true };
    }),

  toggleKeyword: adminProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      await db.toggleMonitorKeyword(input.id, input.isActive);
      return { success: true };
    }),

  deleteKeyword: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await db.deleteMonitorKeyword(input.id);
    return { success: true };
  }),
});

// ==================== App Router ====================
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  questions: questionsRouter,
  collections: collectionsRouter,
  dashboard: dashboardRouter,
  citations: citationsRouter,
  ourContent: ourContentRouter,
  targetFacts: targetFactsRouter,
  alerts: alertsRouter,
  platformConfigs: platformConfigsRouter,
  globalApiKeys: globalApiKeysRouter,
  sysConfigs: sysConfigsRouter,
  weeklyReports: weeklyReportsRouter,
  urlMatchRules: urlMatchRulesRouter,
  scheduler: schedulerRouter,
  users: usersRouter,
  notifications: notificationsRouter,
  monitor: monitorRouter,
});

export type AppRouter = typeof appRouter;
