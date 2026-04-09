import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, developerProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { invokeLLM } from "./_core/llm";
import { nanoid } from "nanoid";
import { PLATFORMS, PLATFORM_OPENROUTER_MODELS, PLATFORM_BAILIAN_MODELS, type Platform } from "@shared/geo-types";
import { ENV } from "./_core/env";

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
  if (baseUrl.includes("dashscope.aliyuncs.com") || baseUrl.includes("bailian")) {
    return PLATFORM_BAILIAN_MODELS[p] || PLATFORM_OPENROUTER_MODELS[p] || "qwen-plus";
  }
  if (baseUrl.includes("openrouter.ai")) {
    return PLATFORM_OPENROUTER_MODELS[p] || "openai/gpt-4o";
  }
  // Unknown provider — try OpenRouter format as default
  return PLATFORM_OPENROUTER_MODELS[p] || "openai/gpt-4o";
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

  // 2. Global API keys - find one that covers this platform
  const globalKeys = await db.listGlobalApiKeys();
  for (const gk of globalKeys) {
    if (!gk.isActive || !gk.apiKey || !gk.baseUrl) {
      log.info(`Skipping global key "${gk.name}": active=${gk.isActive}, hasKey=${!!gk.apiKey}, hasUrl=${!!gk.baseUrl}`);
      continue;
    }
    const covered = (gk.coveredPlatforms as string[]) || [];
    if (covered.includes(platform)) {
      const model = platformConfig?.modelVersion ||
        resolveModelForBaseUrl(platform, gk.baseUrl);
      log.info(`resolveApiConfig: ${platform} matched global key "${gk.name}", model=${model}`);
      return {
        apiKey: gk.apiKey,
        baseUrl: gk.baseUrl,
        model,
        source: "global",
      };
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
async function getAnyActiveApiKey(): Promise<{ apiKey: string; baseUrl: string } | null> {
  const globalKeys = await db.listGlobalApiKeys();
  for (const gk of globalKeys) {
    if (gk.isActive && gk.apiKey && gk.baseUrl) {
      return { apiKey: gk.apiKey, baseUrl: gk.baseUrl };
    }
  }
  // Fallback to env
  if (ENV.openrouterApiKey) {
    return { apiKey: ENV.openrouterApiKey, baseUrl: ENV.openrouterBaseUrl || "https://openrouter.ai/api/v1" };
  }
  return null;
}

// ==================== External LLM Call ====================
async function callExternalLLM(
  platform: string,
  messages: { role: string; content: string }[],
  traceId: string
): Promise<{ content: string; model: string; source: string }> {
  const config = await resolveApiConfig(platform);

  if (!config.apiKey || !config.baseUrl || config.source === "none") {
    throw new Error(`该平台 (${platform}) 未配置 API Key，请在「平台配置」或「全局 API 配置」中设置`);
  }

  const maxRetries = 3;
  const timeoutMs = 60000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log.info(`Calling external API for ${platform} (attempt ${attempt}/${maxRetries})`, {
        traceId, source: config.source, model: config.model,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
          "HTTP-Referer": "https://geo-system.app",
          "X-Title": "GEO System",
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          max_tokens: 4096,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";

      log.info(`External API success for ${platform}`, {
        traceId, model: data.model || config.model, contentLength: content.length,
      });

      return {
        content,
        model: data.model || config.model,
        source: config.source,
      };
    } catch (error: any) {
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

    const { content: responseText, model: rawModel, source: apiSource } = await callExternalLLM(
      platform,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: question.text },
      ],
      traceId
    );

    if (isCancelled(collectionId)) {
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
      await db.createAlert({
        alertType: "sentiment_drop",
        severity: analysis.sentimentScore === 1 ? "critical" : "high",
        title: `${platform} 对问题 ${question.questionId} 给出负面回答`,
        description: analysis.sentimentReasoning || `情感评分: ${analysis.sentimentScore}/5`,
        relatedCollectionId: collectionId,
        relatedQuestionId: question.questionId,
        relatedPlatform: platform,
      });
      log.info(`Alert created: sentiment_drop for ${platform}`, { traceId });
    }

    if (analysis.factualAccuracy === "inaccurate") {
      const claims = (analysis.inaccurateClaims as string[]) || [];
      await db.createAlert({
        alertType: "fact_missing",
        severity: "medium",
        title: `${platform} 对问题 ${question.questionId} 存在事实错误`,
        description: claims.length > 0 ? `不准确声明: ${claims.join("; ")}` : "检测到事实性错误",
        relatedCollectionId: collectionId,
        relatedQuestionId: question.questionId,
        relatedPlatform: platform,
      });
      log.info(`Alert created: fact_missing for ${platform}`, { traceId });
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

  // Batch trigger: P0-2 concurrent execution with p-limit
  batchTrigger: adminProcedure
    .input(
      z.object({
        concurrency: z.number().min(1).max(20).optional(),
      }).optional()
    )
    .mutation(async ({ input }) => {
      const batchId = `batch-${nanoid(8)}`;
      const concurrency = input?.concurrency || 5;
      const questionsList = await db.listQuestions({ status: "active" });
      const platformConfigsList = await db.listPlatformConfigs();
      const enabledPlatforms = platformConfigsList.filter((p) => p.isEnabled).map((p) => p.platform);

      if (enabledPlatforms.length === 0) {
        return { success: false, message: "No enabled platforms" };
      }

      // Create all collection records first
      const tasks: { collectionId: number; question: typeof questionsList[0]; platform: string }[] = [];
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

      // Fire and forget: run concurrently in background
      runBatchConcurrently(tasks, batchId, concurrency).catch((err) => {
        log.error(`Batch ${batchId} execution error: ${err.message}`);
      });

      return { success: true, batchId, totalCreated: tasks.length, concurrency };
    }),

  // Get batch progress
  batchProgress: protectedProcedure
    .input(z.object({ batchId: z.string() }))
    .query(async ({ input }) => {
      return db.getBatchProgress(input.batchId);
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

  // Batch retry (re-execute) collection records - now concurrent
  batchRetry: adminProcedure
    .input(z.object({ ids: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      if (input.ids.length === 0) return { success: true, retried: 0 };
      const collections = await db.getCollectionsByIds(input.ids);

      // Reset status to pending first
      for (const col of collections) {
        await db.updateCollection(col.id, { status: "pending", errorMessage: null });
      }

      const tasks = collections.map((col) => ({
        collectionId: col.id,
        question: { questionId: col.questionId, text: col.questionText, language: col.language || "zh-CN" },
        platform: col.platform,
      }));

      // Fire and forget concurrent retry
      const batchId = `retry-${nanoid(8)}`;
      runBatchConcurrently(tasks, batchId, 5).catch((err) => {
        log.error(`Retry batch error: ${err.message}`);
      });

      return { success: true, retried: collections.length };
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
        limit: z.number().optional(),
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
    // Return masked API keys — exclude raw apiKey field
    return keys.map((k) => {
      const { apiKey: rawKey, ...rest } = k;
      return { ...rest, apiKeyMasked: maskApiKey(rawKey) };
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
        alertsSummary: alertsList.slice(0, 10),
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
  weeklyReports: weeklyReportsRouter,
  urlMatchRules: urlMatchRulesRouter,
  scheduler: schedulerRouter,
  users: usersRouter,
});

export type AppRouter = typeof appRouter;
