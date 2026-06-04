import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, developerProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { invokeLLM } from "./_core/llm";
import { nanoid } from "nanoid";
import { PLATFORMS, PLATFORM_OPENROUTER_MODELS, PLATFORM_BAILIAN_MODELS, PLATFORM_BAI_MODELS, BAI_SUPPORTED_PLATFORMS, BAI_BASE_URL, OPENROUTER_BASE_URL, PLATFORM_RECOMMENDED_PROVIDER, PLATFORM_LABELS, type Platform, type LLMProvider } from "@shared/geo-types";
import { ENV } from "./_core/env";
import { dispatchNotification } from "./_core/notification";
import { formatAlertMessage, formatBatchSummary } from "./_core/senders/templates";

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
  // Persist the cancel so other instances / a restart honor it (the in-memory Set is
  // process-local). Only flip records still "pending" so we never clobber a finished one.
  void (async () => {
    try {
      const c = await db.getCollectionById(id);
      if (c && c.status === "pending") {
        await db.updateCollection(id, { status: "cancelled", errorMessage: "cancelled by user" });
      }
    } catch { /* best-effort */ }
  })();
}

function isCancelled(id: number): boolean {
  return cancelledIds.has(id);
}

// Cross-instance cancel check: the local Set OR a persisted "cancelled" status. Used at the
// few decision points where a stale write would otherwise resurrect a cancelled collection.
async function isCancelledNow(id: number): Promise<boolean> {
  if (cancelledIds.has(id)) return true;
  try {
    const c = await db.getCollectionById(id);
    return c?.status === "cancelled";
  } catch {
    return false;
  }
}

// ==================== Graceful Shutdown ====================
// When the process is asked to terminate, stop *starting* new collection work so in-flight
// requests can drain instead of leaving half-written records. Wired from the server entry.
let shuttingDown = false;
export function beginShutdown() { shuttingDown = true; }
export function isShuttingDown() { return shuttingDown; }

// ==================== Global Outbound LLM Rate Limiter ====================
// Caps concurrent outbound LLM requests and enforces a minimum spacing between launches, so
// overlapping batches (plus analysis/citation calls) can't stampede a provider into 429s.
const LLM_MAX_CONCURRENCY = Number(process.env.LLM_MAX_CONCURRENCY || 4);
const LLM_MIN_INTERVAL_MS = Number(process.env.LLM_MIN_INTERVAL_MS || 250);
let llmActive = 0;
let llmLastStart = 0;
const llmWaiters: (() => void)[] = [];
async function acquireLlmSlot(): Promise<void> {
  if (llmActive >= LLM_MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => llmWaiters.push(resolve));
  }
  llmActive++;
  const wait = llmLastStart + LLM_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  llmLastStart = Date.now();
}
function releaseLlmSlot(): void {
  llmActive = Math.max(0, llmActive - 1);
  const next = llmWaiters.shift();
  if (next) next();
}
export async function withLlmRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  await acquireLlmSlot();
  try {
    return await fn();
  } finally {
    releaseLlmSlot();
  }
}

// ==================== Stale Collection Cleanup ====================
// Collections that stay "pending" far longer than any collection should take were almost
// certainly abandoned by a crashed/restarted process. Mark them failed so they surface in
// health stats and can be retried, instead of lingering forever. Safe to call on an interval.
// Failure-rate alerting thresholds for a completed batch.
const FAILURE_ALERT_RATE = Number(process.env.FAILURE_ALERT_RATE || 0.3);
const FAILURE_ALERT_MIN_SETTLED = Number(process.env.FAILURE_ALERT_MIN_SETTLED || 5);

const STALE_PENDING_MINUTES = Number(process.env.STALE_PENDING_MINUTES || 15);
export async function cleanupStaleCollections(): Promise<number> {
  try {
    const database = await db.getDb();
    if (!database) return 0;
    const { collections } = await import("../drizzle/schema");
    const { sql, eq, and } = await import("drizzle-orm");
    const stale = await database
      .select({ id: collections.id })
      .from(collections)
      .where(and(
        eq(collections.status, "pending"),
        sql`${collections.createdAt} < DATE_SUB(NOW(), INTERVAL ${sql.raw(String(STALE_PENDING_MINUTES))} MINUTE)`,
      ));
    for (const s of stale) {
      await db.updateCollection(s.id, { status: "failed", errorMessage: "stale-timeout: abandoned in pending state" });
    }
    if (stale.length > 0) log.warn(`Cleaned up ${stale.length} stale pending collection(s)`);
    return stale.length;
  } catch (error: any) {
    log.warn(`Stale cleanup failed: ${error.message}`);
    return 0;
  }
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

// Kill-switch: BAI is temporarily disabled because its baseUrl/model ids were never
// verified, which spiked the collection error rate. While this is false, all routing
// runs through OpenRouter and BAI keys are ignored everywhere (primary + fallback).
// Flip back to true (and re-verify PLATFORM_BAI_MODELS via /models) to re-enable.
const BAI_ENABLED = false;

// Resolve the active globalApiKey for a given provider, or null if none configured.
async function getActiveKeyForProvider(provider: LLMProvider): Promise<{ apiKey: string; baseUrl: string } | null> {
  // While BAI is disabled, treat it as if no key were configured so it never gets
  // picked as primary, fallback, or analysis provider.
  if (provider === "bai" && !BAI_ENABLED) return null;
  const keys = await db.listGlobalApiKeys();
  for (const k of keys) {
    if (!k.isActive || !k.apiKey || !k.baseUrl) continue;
    if (detectProvider(k.baseUrl) === provider) {
      return { apiKey: k.apiKey, baseUrl: k.baseUrl };
    }
  }
  return null;
}

// Read the configured primary provider (sysConfig key=llm_primary_provider).
// Default is OpenRouter; while BAI is disabled we force OpenRouter regardless of the
// stored value so a lingering "bai" setting can't route traffic to the dead provider.
async function getPrimaryProvider(): Promise<LLMProvider> {
  if (!BAI_ENABLED) return "openrouter";
  const v = await db.getSysConfig("llm_primary_provider");
  return v === "openrouter" ? "openrouter" : "bai";
}

// Core routing decision for a platform's collection call.
// Returns { provider, apiKey, baseUrl, model, reason }.
// Rules:
//   1. BAI-uncovered platform → always OpenRouter (regardless of switch).
//   2. BAI-covered platform → primary provider if it has an active key; otherwise fall back to the other provider.
//   3. If neither provider has a key → caller decides (falls through to platform key / env in resolveApiConfigChain).
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
// Build an *ordered list* of API configs to try for a platform, so callExternalLLM can
// fail over to the next provider when a call actually fails (not just when a key is missing).
// Priority: platform own key > primary provider > fallback provider > legacy coveredPlatforms key > env OpenRouter.
type ApiCandidate = {
  apiKey: string;
  baseUrl: string;
  model: string;
  source: "platform" | "global" | "env";
  label: string;
};

async function resolveApiConfigChain(platform: string): Promise<ApiCandidate[]> {
  const candidates: ApiCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: ApiCandidate) => {
    // Dedupe identical baseUrl+model+key so we don't burn retries on the same endpoint twice.
    const k = `${c.baseUrl}|${c.model}|${c.apiKey.slice(0, 8)}`;
    if (seen.has(k)) return;
    seen.add(k);
    candidates.push(c);
  };

  const p = platform as Platform;

  // 1. Platform's own API key
  const platformConfig = await db.getPlatformConfig(platform);
  if (platformConfig?.apiKeyEncrypted && platformConfig?.apiBaseUrl) {
    push({
      apiKey: platformConfig.apiKeyEncrypted,
      baseUrl: platformConfig.apiBaseUrl,
      model: platformConfig.modelVersion || resolveModelForBaseUrl(platform, platformConfig.apiBaseUrl),
      source: "platform",
      label: "platform",
    });
  }

  // 2. Provider chain: primary then the other provider (real hot-standby failover).
  //    BAI-uncovered platforms only ever use OpenRouter. getActiveKeyForProvider returns
  //    null for disabled/unconfigured providers, so BAI is skipped while BAI_ENABLED=false.
  let providerOrder: LLMProvider[];
  if (!BAI_SUPPORTED_PLATFORMS.includes(p)) {
    providerOrder = ["openrouter"];
  } else {
    const primary = await getPrimaryProvider();
    const other: LLMProvider = primary === "bai" ? "openrouter" : "bai";
    providerOrder = [primary, other];
  }
  for (const prov of providerOrder) {
    const key = await getActiveKeyForProvider(prov);
    if (key) {
      push({
        apiKey: key.apiKey,
        baseUrl: key.baseUrl,
        model: resolveModelForBaseUrl(platform, key.baseUrl),
        source: "global",
        label: prov,
      });
    }
  }

  // 2b. Legacy: any globalApiKey that explicitly lists this platform in coveredPlatforms
  // (e.g. 阿里百炼). BAI / OpenRouter records are already handled above.
  const globalKeys = await db.listGlobalApiKeys();
  for (const gk of globalKeys) {
    if (!gk.isActive || !gk.apiKey || !gk.baseUrl) continue;
    const prov = detectProvider(gk.baseUrl);
    if (prov === "bai" || prov === "openrouter") continue;
    const covered = (gk.coveredPlatforms as string[]) || [];
    if (covered.includes(platform)) {
      push({
        apiKey: gk.apiKey,
        baseUrl: gk.baseUrl,
        model: resolveModelForBaseUrl(platform, gk.baseUrl),
        source: "global",
        label: gk.name || "legacy",
      });
    }
  }

  // 3. Environment variable fallback (OpenRouter)
  if (ENV.openrouterApiKey) {
    push({
      apiKey: ENV.openrouterApiKey,
      baseUrl: ENV.openrouterBaseUrl || "https://openrouter.ai/api/v1",
      model: PLATFORM_OPENROUTER_MODELS[p] || "openai/gpt-4o",
      source: "env",
      label: "env-openrouter",
    });
  }

  log.info(`resolveApiConfigChain: ${platform} → ${candidates.length} candidate(s): [${candidates.map(c => `${c.label}:${c.model}`).join(", ")}]`);
  return candidates;
}

// Get any active API key (for analysis/citation extraction)
// Also resolves a suitable model based on the provider
function resolveAnalysisModel(baseUrl: string): string {
  if (baseUrl.includes("b.ai")) return "gemini-3-flash";
  if (baseUrl.includes("dashscope") || baseUrl.includes("aliyun")) return "qwen-turbo";
  if (baseUrl.includes("openrouter")) return "google/gemini-2.0-flash-001";
  return "google/gemini-2.0-flash-001";
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
  // Legacy: try any other active global key (e.g. 阿里百炼). Skip BAI while disabled.
  const globalKeys = await db.listGlobalApiKeys();
  for (const gk of globalKeys) {
    if (!gk.isActive || !gk.apiKey || !gk.baseUrl) continue;
    if (detectProvider(gk.baseUrl) === "bai" && !BAI_ENABLED) continue;
    return { apiKey: gk.apiKey, baseUrl: gk.baseUrl, model: resolveAnalysisModel(gk.baseUrl) };
  }
  // Fallback to env
  if (ENV.openrouterApiKey) {
    const baseUrl = ENV.openrouterBaseUrl || "https://openrouter.ai/api/v1";
    return { apiKey: ENV.openrouterApiKey, baseUrl, model: "openai/gpt-4o" };
  }
  return null;
}

// ==================== External LLM Call ====================
// Decide whether an error is worth retrying *against the same provider*.
// - HTTP errors carry an explicit `retryable` flag (5xx / 429 → yes; 4xx / model-not-found → no).
// - Timeouts (AbortError) and network errors have no flag → retry.
function isRetryableError(error: any): boolean {
  if (error && typeof error.retryable === "boolean") return error.retryable;
  return true;
}

async function callExternalLLM(
  platform: string,
  messages: { role: string; content: string }[],
  traceId: string
): Promise<{ content: string; model: string; source: string }> {
  const candidates = await resolveApiConfigChain(platform);

  if (candidates.length === 0) {
    throw new Error(`该平台 (${platform}) 未配置 API Key，请在「平台配置」或「全局 API 配置」中设置`);
  }

  const maxRetriesPerCandidate = Number(process.env.LLM_MAX_RETRIES || 3);
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 60000);
  let lastError: any;

  for (let ci = 0; ci < candidates.length; ci++) {
    const config = candidates[ci];

    for (let attempt = 1; attempt <= maxRetriesPerCandidate; attempt++) {
      try {
        log.info(`Calling external API for ${platform} (provider=${config.label}, attempt ${attempt}/${maxRetriesPerCandidate})`, {
          traceId, source: config.source, model: config.model,
        });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

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

        let response: Response;
        try {
          response = await withLlmRateLimit(() =>
            fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                model: config.model,
                messages,
                max_tokens: 4096,
              }),
              signal: controller.signal,
            })
          );
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          const errText = await response.text();
          // Model-not-found: not retryable on this provider, but failing over to the next
          // candidate may succeed, so keep the helpful message and let the loop advance.
          if (errText.includes("not a valid model") || errText.includes("model_not_found") || errText.includes("does not exist")) {
            const rec = PLATFORM_RECOMMENDED_PROVIDER[platform as Platform];
            const hint = rec ? `，推荐使用「${rec}」提供商` : "";
            const err: any = new Error(`该平台 (${PLATFORM_LABELS[platform as Platform] || platform}) 的模型 ${config.model} 在当前 API 提供商中不可用${hint}`);
            err.retryable = false;
            throw err;
          }
          const err: any = new Error(`API ${response.status}: ${errText.slice(0, 200)}`);
          // Retry only transient server-side / rate-limit errors; 4xx (auth, bad request) are not retryable.
          err.retryable = response.status >= 500 || response.status === 429;
          throw err;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "";

        log.info(`External API success for ${platform}`, {
          traceId, provider: config.label, model: data.model || config.model, contentLength: content.length,
        });

        return {
          content,
          model: data.model || config.model,
          source: config.source,
        };
      } catch (error: any) {
        lastError = error;
        const retryable = isRetryableError(error);
        log.warn(`External API attempt ${attempt} failed for ${platform} (provider=${config.label}, retryable=${retryable}): ${error.message}`, { traceId });
        if (retryable && attempt < maxRetriesPerCandidate) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
          continue;
        }
        // Non-retryable, or retries exhausted → stop hammering this provider.
        break;
      }
    }

    if (ci < candidates.length - 1) {
      log.warn(`Provider ${config.label} failed for ${platform}, failing over to next candidate`, { traceId });
    }
  }

  throw lastError ?? new Error(`All providers failed for ${platform}`);
}

// ==================== Collection Execution (P0-1: No more simulation) ====================
async function executeCollection(
  collectionId: number,
  question: { questionId: string; text: string; language: string },
  platform: string
): Promise<{ success: boolean; error?: string }> {
  const traceId = `col-${collectionId}-${nanoid(6)}`;

  if (isShuttingDown()) {
    log.info(`Collection ${collectionId} not started: server shutting down`, { traceId });
    return { success: false, error: "shutting-down" };
  }

  if (await isCancelledNow(collectionId)) {
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

    const { content: responseText, model: rawModel, source: apiSource } = await callExternalLLM(
      platform,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: question.text },
      ],
      traceId
    );

    if (await isCancelledNow(collectionId)) {
      log.info(`Collection ${collectionId} cancelled after LLM call`, { traceId });
      return { success: false, error: "cancelled" };
    }

    const platformConfig = await db.getPlatformConfig(platform);
    const modelVersion = platformConfig?.modelVersion || PLATFORM_OPENROUTER_MODELS[platform as Platform] || rawModel;

    await db.updateCollection(collectionId, {
      responseText,
      responseLength: responseText.length,
      hasSearch: true,
      modelVersion,
      status: "success",
    });

    // Citation extraction + AI analysis are independent (different tables) — run concurrently
    // instead of serially to cut per-item wall time. Both swallow their own errors, so this
    // never rejects. Outbound LLM concurrency is still bounded by withLlmRateLimit.
    if (!isCancelled(collectionId)) {
      await Promise.all([
        extractCitations(collectionId, responseText, traceId),
        analyzeCollection(collectionId, question.text, responseText, traceId),
      ]);
    }

    // Alert checking (depends on the analysis row written above)
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
        const extractionResult = await withLlmRateLimit(() => invokeLLM({
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
        }));

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
async function checkAlerts(
  collectionId: number,
  question: { questionId: string; text: string },
  platform: string,
  traceId: string
) {
  try {
    const analysis = await db.getAnalysisByCollectionId(collectionId);
    if (!analysis) return;

    if (analysis.sentimentScore && analysis.sentimentScore <= 2) {
      const severity = analysis.sentimentScore === 1 ? "critical" : "high";
      const alertData = {
        alertType: "sentiment_drop" as const,
        severity: severity as "critical" | "high",
        title: `${platform} 对问题 ${question.questionId} 给出负面回答`,
        description: analysis.sentimentReasoning || `情感评分: ${analysis.sentimentScore}/5`,
        relatedCollectionId: collectionId,
        relatedQuestionId: question.questionId,
        relatedPlatform: platform,
      };
      const alertId = await db.createAlert(alertData);
      log.info(`Alert created: sentiment_drop for ${platform}`, { traceId });

      // Push notification
      const msg = formatAlertMessage({ ...alertData, severity });
      dispatchNotification({
        messageType: "alert", alertId, severity,
        title: msg.title, content: msg.content,
        dedupKey: `${question.questionId}:${platform}:sentiment_drop`,
      }).catch(err => log.warn(`Notification dispatch failed: ${err.message}`, { traceId }));
    }

    if (analysis.factualAccuracy === "inaccurate") {
      const claims = (analysis.inaccurateClaims as string[]) || [];
      const alertData = {
        alertType: "fact_missing" as const,
        severity: "medium" as const,
        title: `${platform} 对问题 ${question.questionId} 存在事实错误`,
        description: claims.length > 0 ? `不准确声明: ${claims.join("; ")}` : "检测到事实性错误",
        relatedCollectionId: collectionId,
        relatedQuestionId: question.questionId,
        relatedPlatform: platform,
      };
      const alertId = await db.createAlert(alertData);
      log.info(`Alert created: fact_missing for ${platform}`, { traceId });

      const msg = formatAlertMessage({ ...alertData, severity: "medium" });
      dispatchNotification({
        messageType: "alert", alertId, severity: "medium",
        title: msg.title, content: msg.content,
        dedupKey: `${question.questionId}:${platform}:fact_missing`,
      }).catch(err => log.warn(`Notification dispatch failed: ${err.message}`, { traceId }));
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

    const result = await withLlmRateLimit(() => invokeLLM({
      apiKey: analysisApiKey.apiKey,
      baseUrl: analysisApiKey.baseUrl,
      model: analysisApiKey.model,
      messages: [
        { role: "system", content: "You are a professional brand reputation analyst. Always respond with valid JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }));

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
async function runBatchConcurrently(
  tasks: { collectionId: number; question: any; platform: string }[],
  batchId: string,
  concurrency: number = 5
) {
  // Dynamic import p-limit (ESM module)
  const pLimit = (await import("p-limit")).default;
  const limit = pLimit(concurrency);

  log.info(`Starting batch ${batchId}: ${tasks.length} tasks, concurrency=${concurrency}`);

  const results = await Promise.allSettled(
    tasks.map((task) =>
      limit(async () => {
        return executeCollection(
          task.collectionId,
          {
            questionId: task.question.questionId,
            text: task.question.text,
            language: task.question.language,
          },
          task.platform
        );
      })
    )
  );

  let completed = 0;
  let failed = 0;
  results.forEach((r) => {
    if (r.status === "fulfilled" && r.value.success) completed++;
    else failed++;
  });

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
      // List view never renders the full answer; skip the large responseText/rawResponse
      // blobs. The detail sheet fetches the full row via collections.get.
      return db.listCollections({ ...(input || {}), includeResponseText: false });
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
  executeNextBatch: adminProcedure
    .input(z.object({
      batchId: z.string(),
      concurrency: z.number().min(1).max(10).optional(),
    }))
    .mutation(async ({ input }) => {
      const concurrency = input.concurrency || 5;
      const progress = await db.getBatchProgress(input.batchId);

      // Get pending collections for this batch
      const pendingResult = await db.listCollections({
        batchId: input.batchId,
        status: "pending",
        limit: concurrency,
        offset: 0,
      });
      const pending = pendingResult.data;

      if (pending.length === 0) {
        return { completed: 0, failed: 0, remaining: 0, total: progress.total };
      }

      // Execute synchronously (await) — not fire-and-forget
      let completed = 0;
      let failed = 0;
      const results = await Promise.allSettled(
        pending.map(async (col) => {
          const question = await db.getQuestionById(col.questionId);
          if (!question) {
            await db.updateCollection(col.id, { status: "failed", errorMessage: "Question not found" });
            return { success: false };
          }
          return executeCollection(
            col.id,
            { questionId: question.questionId, text: question.text, language: question.language },
            col.platform
          );
        })
      );

      results.forEach((r) => {
        if (r.status === "fulfilled" && r.value.success) completed++;
        else failed++;
      });

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

        // Failure-rate alert: if a meaningful share of this batch failed, push a system
        // notification so a provider/config regression is caught within minutes.
        try {
          const settled = updatedProgress.completed + updatedProgress.failed;
          const failRate = settled > 0 ? updatedProgress.failed / settled : 0;
          if (settled >= FAILURE_ALERT_MIN_SETTLED && failRate >= FAILURE_ALERT_RATE) {
            const pct = Math.round(failRate * 100);
            dispatchNotification({
              messageType: "alert",
              title: `采集失败率偏高：${pct}%（批次 ${input.batchId}）`,
              content: `本批次共 ${updatedProgress.total} 项，失败 ${updatedProgress.failed} / 已完成 ${settled}（失败率 ${pct}%）。请检查 API 提供商配置与额度。`,
              severity: failRate >= 0.6 ? "critical" : "high",
              dedupKey: `batch_failrate:${input.batchId}`,
            }).catch(() => {});
            log.warn(`High failure rate for batch ${input.batchId}: ${pct}% (${updatedProgress.failed}/${settled})`);
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
        // Mark failed (not pending→pending, which was a no-op) so the records surface in
        // health stats and can be retried via batchRetry.
        await db.updateCollection(s.id, { status: "failed", errorMessage: "stale-timeout: reset by admin" });
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

      // Find success collections without analysis
      const missing = await database
        .select({ id: collections.id, questionText: collections.questionText, responseText: collections.responseText })
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
  // Collection health / error-rate overview for the dashboard. Surfaces per-platform
  // success rate, top error messages, and successful-but-unanalyzed records.
  collectionHealth: protectedProcedure
    .input(z.object({ hours: z.number().min(1).max(720).optional() }).optional())
    .query(async ({ input }) => {
      const hours = input?.hours ?? 24;
      const sinceMs = Date.now() - hours * 60 * 60 * 1000;
      const stats = await db.getCollectionHealthStats(sinceMs);
      return { hours, ...stats };
    }),

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
      if (input.provider === "bai" && !BAI_ENABLED) {
        throw new Error("B.AI 已暂时停用，当前仅支持 OpenRouter 作为主用 Provider");
      }
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
      const alertsList = await db.listAlerts({ startTime, endTime, limit: 50 });

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
  running: false,
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
      if (schedulerState.running) {
        log.warn("Scheduled collection skipped: previous run still in progress");
        return;
      }
      if (isShuttingDown()) {
        log.warn("Scheduled collection skipped: server shutting down");
        return;
      }
      schedulerState.running = true;
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
      } finally {
        schedulerState.running = false;
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
});

export type AppRouter = typeof appRouter;

// Internal helpers exposed for unit testing only — not part of the tRPC surface.
export const __testing = {
  resolveApiConfigChain,
  callExternalLLM,
  isRetryableError,
  BAI_ENABLED,
};
