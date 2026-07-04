import * as db from "../db";
import { sendEmail } from "./senders";
import { sendTelegramAlert } from "../monitor/telegram-connect";

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// System-level Resend config (set once by admin). From defaults to Resend's test sender.
const RESEND = { key: "resend_api_key", from: "resend_from" };
export const DEFAULT_RESEND_FROM = "波场舆情监控 <onboarding@resend.dev>";
export async function getResendConfig(): Promise<{ apiKey: string | null; from: string }> {
  return { apiKey: (await db.getSysConfig(RESEND.key)) || null, from: (await db.getSysConfig(RESEND.from)) || DEFAULT_RESEND_FROM };
}
export async function setResendConfig(p: { apiKey?: string; from?: string }): Promise<void> {
  if (p.apiKey !== undefined && p.apiKey.trim()) await db.setSysConfig(RESEND.key, p.apiKey.trim());
  if (p.from !== undefined) await db.setSysConfig(RESEND.from, p.from.trim());
}

function isInSilentHours(silentStart: string | null, silentEnd: string | null): boolean {
  if (!silentStart || !silentEnd) return false;
  // Get current time in Asia/Shanghai
  const now = new Date();
  const shanghaiTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  const hh = shanghaiTime.getHours();
  const mm = shanghaiTime.getMinutes();
  const current = hh * 60 + mm;
  const [sh, sm] = silentStart.split(":").map(Number);
  const [eh, em] = silentEnd.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start <= end) return current >= start && current < end;
  // Crosses midnight (e.g. 23:00 - 08:00)
  return current >= start || current < end;
}

export async function dispatchNotification(payload: {
  messageType: "alert" | "batch_summary";
  alertId?: number;
  batchId?: string;
  title: string;
  content: string;
  severity?: string;
  dedupKey?: string;
}): Promise<void> {
  try {
    const configs = await db.listNotificationConfigs();
    for (const config of configs) {
      if (!config.isEnabled) continue;

      // Check severity threshold
      if (payload.severity && config.minSeverity) {
        const payloadRank = SEVERITY_RANK[payload.severity] || 0;
        const minRank = SEVERITY_RANK[config.minSeverity] || 0;
        if (payloadRank < minRank) continue;
      }

      // Check silent hours
      if (isInSilentHours(config.silentStart, config.silentEnd)) continue;

      // Dedup check
      if (payload.dedupKey) {
        const key = `${config.channel}:${payload.dedupKey}`;
        const recent = await db.findRecentNotificationLog(key, 24);
        if (recent) continue;
      }

      // Send — 原则6: one channel failing (throw or error) must NOT affect the others.
      try {
        let result: { success: boolean; error?: string } = { success: false, error: "Unknown channel" };
        const msg = { title: payload.title, content: payload.content, severity: payload.severity };

        if (config.channel === "telegram") {
          result = await sendTelegramAlert(msg); // 原则1: sender reads token+chat_id internally, no id passed
        } else if (config.channel === "email" && Array.isArray(config.emailTo) && (config.emailTo as string[]).length) {
          const rc = await getResendConfig();
          if (!rc.apiKey) continue; // Resend not configured system-wide → skip email
          result = await sendEmail({ apiKey: rc.apiKey, from: rc.from, to: config.emailTo as string[] }, msg);
        } else {
          continue; // Channel not fully configured (feishu removed)
        }

        await db.createNotificationLog({
          channel: config.channel,
          alertId: payload.alertId || null,
          batchId: payload.batchId || null,
          messageType: payload.messageType,
          title: payload.title,
          content: payload.content,
          success: result.success,
          errorMessage: result.error || null,
          dedupKey: payload.dedupKey ? `${config.channel}:${payload.dedupKey}` : null,
        });
      } catch (chErr: any) {
        console.warn(`[notify] ${config.channel} failed (isolated):`, chErr?.message || chErr);
      }
    }
  } catch (err: any) {
    console.error("[Notification] dispatch failed:", err.message);
  }
}
