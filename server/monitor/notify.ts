// Phase 2 push: periodic briefing + high-threat real-time alert. Reuses the existing notification system
// (dispatchNotification → notificationConfigs channels, which already applies severity threshold, silent
// hours, and 24h dedup). Both pushes are gated by sysConfigs toggles (default OFF — enable after
// confirming format on a test channel, so we never auto-push to a production group).
import * as db from "../db";
import { dispatchNotification } from "../_core/notification";
import { SOURCE_PLATFORM_LABELS } from "./sources/registry";
import { log, normalizeDomain } from "./util";
import { getDomainAiCitation, getSourcePenetration } from "./penetration";
import { sendEmailAlert, buildAlertEmailHtml } from "./email-alert";

const CFG = {
  briefingEnabled: "monitor_briefing_enabled",
  briefingMode: "monitor_briefing_mode", // 'every' | 'negative_only'
  realtimeEnabled: "monitor_realtime_enabled",
  alertMinThreat: "monitor_alert_min_threat", // 'high' | 'medium' | 'low' — min threat that triggers a real-time alert
};

// Threat ordering. Default alert threshold is 'medium': 'high' alone is often 0 articles (the threat
// model is conservative), so only-high would page never; 'medium' catches real negatives without the
// low-threat noise. threatLevel is only assigned to negative articles (纯负面才计威胁), so meeting the
// threshold already implies negative.
const THREAT_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 };
export async function getAlertMinThreat(): Promise<"high" | "medium" | "low"> {
  const v = (await db.getSysConfig(CFG.alertMinThreat)) as any;
  return v === "high" || v === "medium" || v === "low" ? v : "medium";
}
export async function alertThresholdMet(threatLevel: string | null | undefined): Promise<boolean> {
  const min = await getAlertMinThreat();
  return (THREAT_RANK[threatLevel || "none"] ?? 0) >= THREAT_RANK[min];
}

export type BriefingItem = {
  title: string;
  url: string;
  sourcePlatform: string;
  domain: string | null;
  relevance: string | null;
  sentimentScore: number | null;
  threatLevel: string | null;
};

export async function getPushConfig(): Promise<{ briefingEnabled: boolean; briefingMode: string; realtimeEnabled: boolean; alertMinThreat: string }> {
  const truthy = (v: string | null, d: boolean) => (v == null ? d : v === "true");
  return {
    briefingEnabled: truthy(await db.getSysConfig(CFG.briefingEnabled), false),
    briefingMode: (await db.getSysConfig(CFG.briefingMode)) || "every",
    realtimeEnabled: truthy(await db.getSysConfig(CFG.realtimeEnabled), false),
    alertMinThreat: await getAlertMinThreat(),
  };
}

export async function setPushConfig(p: { briefingEnabled?: boolean; briefingMode?: string; realtimeEnabled?: boolean; alertMinThreat?: string }): Promise<void> {
  if (p.briefingEnabled !== undefined) await db.setSysConfig(CFG.briefingEnabled, String(p.briefingEnabled));
  if (p.briefingMode !== undefined) await db.setSysConfig(CFG.briefingMode, p.briefingMode);
  if (p.realtimeEnabled !== undefined) await db.setSysConfig(CFG.realtimeEnabled, String(p.realtimeEnabled));
  if (p.alertMinThreat && ["high", "medium", "low"].includes(p.alertMinThreat)) await db.setSysConfig(CFG.alertMinThreat, p.alertMinThreat);
}

const srcLabel = (p: string) => SOURCE_PLATFORM_LABELS[p] || p;
// flagged = negative (sentiment<=2) or high/medium threat; ranked so high threat + most-negative float up.
const isFlagged = (i: BriefingItem) => (i.sentimentScore ?? 3) <= 2 || i.threatLevel === "high" || i.threatLevel === "medium";
const rank = (i: BriefingItem) =>
  (i.threatLevel === "high" ? 100 : i.threatLevel === "medium" ? 50 : 0) + (i.sentimentScore != null ? (5 - i.sentimentScore) * 5 : 0);

export function buildBriefing(
  items: BriefingItem[],
  cycle: { keywords: number; sourceCount: number; newArticles: number },
  stats: { monthCostUsd: number; total: number },
  // Phase 3: normalized domain -> # of AI platforms already citing it (for "已入AI" annotation).
  aiReach?: Map<string, number>
): { title: string; content: string } {
  const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  const pos = items.filter((i) => (i.sentimentScore ?? 3) >= 4).length;
  const neu = items.filter((i) => (i.sentimentScore ?? 3) === 3).length;
  const neg = items.filter((i) => (i.sentimentScore ?? 3) <= 2).length;
  const high = items.filter((i) => i.threatLevel === "high").length;
  const flagged = items.filter(isFlagged).sort((a, b) => rank(b) - rank(a)).slice(0, 10);

  const L: string[] = [];
  L.push(`📊 舆情监测简报 · ${now}`);
  L.push(`本轮扫描 ${cycle.keywords} 关键词 × ${cycle.sourceCount} 信源`);
  L.push("━━━━━━━━━━━━━━");
  L.push(`🆕 新发现 ${cycle.newArticles} 篇 | 高威胁 ${high} 篇 | 需复核 ${flagged.length} 篇`);
  L.push("");
  L.push(`情绪分布(高相关 ${items.length} 篇):`);
  L.push(`🟢 正面 ${pos}    🟡 中性 ${neu}    🔴 负面 ${neg}`);
  if (flagged.length > 0) {
    L.push("");
    L.push("⚠️ 需关注:");
    flagged.forEach((it, i) => {
      const tag = it.threatLevel === "high" ? "🔴高威胁" : (it.sentimentScore ?? 3) <= 2 ? "🔴负面" : "🟡关注";
      const reach = aiReach?.get(normalizeDomain(it.domain)) ?? 0;
      const penTag = reach > 0 ? ` · 🔴已影响${reach}个AI平台` : "";
      L.push(`${i + 1}. [${tag}] ${it.title.slice(0, 48)} - ${srcLabel(it.sourcePlatform)}${it.domain ? "/" + it.domain : ""}${penTag}`);
      L.push(`   ${it.url}`);
    });
  } else {
    L.push("");
    L.push("✅ 本轮未发现新增负面");
  }
  L.push("━━━━━━━━━━━━━━");
  L.push(`本月成本 $${stats.monthCostUsd.toFixed(4)} | 累计文章 ${stats.total}`);
  return { title: `舆情简报 · 新增${cycle.newArticles}/负面${neg}/高威胁${high}`, content: L.join("\n") };
}

// Returns whether it was actually dispatched (for reporting).
export async function sendBriefing(items: BriefingItem[], cycle: { keywords: number; sourceCount: number; newArticles: number }): Promise<{ sent: boolean; reason?: string; content?: string }> {
  const cfg = await getPushConfig();
  const negOrHigh = items.filter((i) => (i.sentimentScore ?? 3) <= 2 || i.threatLevel === "high").length;
  const stats = await db.getMonitorStats();
  // Phase 3: one query → map of monitored domain → # AI platforms already citing it, to flag amplified sources.
  const aiReach = new Map<string, number>();
  try {
    for (const s of await getSourcePenetration()) if (s.aiPlatforms > 0) aiReach.set(s.domain, s.aiPlatforms);
  } catch (e: any) {
    log.warn(`Briefing penetration lookup failed: ${e?.message || e}`);
  }
  const msg = buildBriefing(items, cycle, { monthCostUsd: stats?.monthCostUsd || 0, total: stats?.total || 0 }, aiReach);
  if (!cfg.briefingEnabled) return { sent: false, reason: "briefing disabled", content: msg.content };
  if (cfg.briefingMode === "negative_only" && negOrHigh === 0) return { sent: false, reason: "negative_only mode, nothing to report", content: msg.content };
  await dispatchNotification({ messageType: "batch_summary", title: msg.title, content: msg.content }); // no dedupKey (intentional per-cycle), no severity gating
  log.info(`Briefing dispatched (high/medium items ${items.length}, neg/high ${negOrHigh})`);
  return { sent: true, content: msg.content };
}

// High-threat real-time alert: creates a negative_article alert + dispatches immediately. Deduped by
// urlHash so the same article never re-alerts. Returns whether an alert was created.
export async function dispatchHighThreatAlert(a: {
  url: string;
  urlHash: string;
  title: string;
  domain: string | null;
  sentimentScore: number | null;
  summary: string | null;
  threatLevel?: string | null; // actual threat of THIS article (may be medium now that threshold is configurable)
}): Promise<{ created: boolean; content?: string }> {
  const cfg = await getPushConfig();
  const dedupKey = `negative_article:${a.urlHash}`;
  const recent = await db.findRecentAlertByDedupKey(dedupKey, 24);
  if (recent) {
    log.info(`High-threat alert skipped (dedup) ${a.url}`);
    return { created: false };
  }
  const rule = a.domain ? await db.getMonitorSourceRuleByDomain(a.domain) : undefined;
  const stanceLabel = rule?.stance === "hostile" ? "敌对" : rule?.stance === "friendly" ? "友好" : "中立";
  // Phase 3: is this source already feeding AI answers? If so this negative can propagate into AI output.
  let pen = { aiPlatforms: 0, platformList: [] as string[], citationCount: 0, domain: "" };
  try {
    if (a.domain) pen = await getDomainAiCitation(a.domain);
  } catch (e: any) {
    log.warn(`High-threat penetration lookup failed: ${e?.message || e}`);
  }
  const amplified = pen.aiPlatforms > 0;
  const threat = a.threatLevel === "high" ? "高" : a.threatLevel === "medium" ? "中" : a.threatLevel === "low" ? "低" : "—";
  // Severity: an AI-amplified or sentiment=1 negative is worst (critical); else map threat→high/medium.
  const severity = a.sentimentScore === 1 || amplified ? "critical" : a.threatLevel === "high" ? "high" : "medium";
  const penLine = amplified
    ? `\n🔴 GEO 穿透: 此信源已被 ${pen.aiPlatforms} 个 AI 平台引用（${pen.platformList.slice(0, 6).join("/")}${pen.platformList.length > 6 ? "…" : ""}，累计 ${pen.citationCount} 次）— 负面正被 AI 放大`
    : "";
  const content =
    `🚨 负面舆情预警\n${a.title.slice(0, 100)}\n` +
    `来源: ${a.domain || "?"}（${stanceLabel}） | 威胁: ${threat}${amplified ? " | ⚠️已入AI引用" : ""}\n` +
    `${(a.summary || "").slice(0, 300)}${penLine}\n原文: ${a.url}`;
  const alertId = await db.createAlert({
    alertType: "negative_article" as any,
    severity: severity as any,
    title: `负面舆情[威胁${threat}]: ${a.title.slice(0, 76)}`,
    description: content.slice(0, 1000),
    relatedPlatform: a.domain ? a.domain.slice(0, 32) : null,
    dedupKey,
  } as any);

  if (cfg.realtimeEnabled) {
    const notifyTitle = `【${amplified ? "危·已入AI" : threat}】负面舆情 - ${a.domain || ""}`;
    // Telegram (via the shared dispatcher) — fire-and-forget, isolated.
    dispatchNotification({ messageType: "alert", alertId, severity, title: notifyTitle, content, dedupKey }).catch((e) =>
      log.warn(`High-threat notify failed: ${e.message}`)
    );
    // Email — INDEPENDENT path (原则: 邮件与TG分家), fire-and-forget, locked recipient, silent-degrades.
    const emailHtml = buildAlertEmailHtml({ title: a.title, domain: a.domain, threat, sentiment: a.sentimentScore, stance: rule?.stance ?? null, summary: a.summary, url: a.url, penLine: penLine.replace(/^\n/, "") || null });
    sendEmailAlert(`【负面舆情·威胁${threat}】${a.title.slice(0, 50)}`, emailHtml).catch((e) => log.warn(`High-threat email failed: ${e.message}`));
    log.info(`High-threat alert created + dispatched ${a.url}`);
  } else {
    log.info(`High-threat alert row created (realtime push disabled) ${a.url}`);
  }
  return { created: true, content };
}
