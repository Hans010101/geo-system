import * as db from "../db";
import { sendTelegramAlert } from "../monitor/telegram-connect";

// This dispatcher now handles ONLY Telegram. Email is a separate, independent path
// (server/monitor/email-alert.ts, called directly at the alert trigger) — 邮件与TG分家.
const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

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
        } else {
          continue; // Only Telegram here; email is its own path (email-alert.ts), feishu removed.
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
