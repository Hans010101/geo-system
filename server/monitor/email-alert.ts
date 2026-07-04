// Internal email alerts via Resend — deliberately minimal (点金 email doc: thin transport, silent
// degrade, failure isolation), and independent from the Telegram path (no shared dispatcher).
//
// ★ Locked recipient (mirrors the TG identity red-line): sendEmailAlert takes NO `to`. The single
// recipient is read from sysConfigs, so a caller physically cannot email anyone else — safe with the
// Resend TEST sender (onboarding@resend.dev), which may ONLY send to the account owner's address.
import * as db from "../db";
import { log } from "./util";

const CFG = { key: "resend_api_key", from: "resend_from", recipient: "alert_email_recipient" };
export const DEFAULT_FROM = "波场舆情监控 <onboarding@resend.dev>"; // Resend 测试发件地址

export async function getEmailAlertConfig(): Promise<{ apiKey: string | null; from: string; recipient: string | null }> {
  return {
    apiKey: (await db.getSysConfig(CFG.key)) || null,
    from: (await db.getSysConfig(CFG.from)) || DEFAULT_FROM,
    recipient: (await db.getSysConfig(CFG.recipient)) || null,
  };
}
export async function setEmailAlertConfig(p: { apiKey?: string; from?: string; recipient?: string }): Promise<void> {
  if (p.apiKey !== undefined && p.apiKey.trim()) await db.setSysConfig(CFG.key, p.apiKey.trim());
  if (p.from !== undefined) await db.setSysConfig(CFG.from, p.from.trim() || DEFAULT_FROM);
  if (p.recipient !== undefined) await db.setSysConfig(CFG.recipient, p.recipient.trim());
}

// Thin sender: one Resend POST, locked recipient, never throws, silent-degrades when unconfigured.
export async function sendEmailAlert(subject: string, html: string): Promise<{ sent: boolean; error?: string }> {
  try {
    // Config load is INSIDE the try — getSysConfig hits the DB and can reject; the sender must never throw.
    const { apiKey, from, recipient } = await getEmailAlertConfig();
    if (!apiKey || !recipient) {
      log.warn(`email alert skipped: ${!apiKey ? "Resend key 未配置" : "收件邮箱未配置"}`); // 静默降级,不报错不阻塞
      return { sent: false, error: !apiKey ? "Resend 未配置" : "收件邮箱未配置" };
    }
    const { Resend } = await import("resend");
    const { error } = await new Resend(apiKey).emails.send({ from, to: recipient, subject, html });
    if (error) { log.warn(`email alert failed: ${(error as any)?.message || error}`); return { sent: false, error: String((error as any)?.message || error).slice(0, 200) }; }
    return { sent: true };
  } catch (e: any) {
    log.warn(`email alert error: ${e?.message || e}`);
    return { sent: false, error: String(e?.message || e).slice(0, 200) };
  }
}

// Escapes for BOTH text and double-quoted-attribute contexts: & < > " ' (url goes in an href="…").
const esc = (s: string | null | undefined) =>
  String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// href guard: only http(s) is allowed through (blocks javascript:/data: and malformed urls → "#").
const safeUrl = (u: string | null | undefined) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "#");
const THREAT_COLOR: Record<string, string> = { 高: "#dc2626", 中: "#f59e0b", 低: "#eab308", "—": "#6b7280" };

// Thin HTML template — table layout + inline CSS for mail-client compatibility (no template engine).
export function buildAlertEmailHtml(a: {
  title: string; domain: string | null; threat: string; sentiment: number | null; stance?: string | null; summary: string | null; url: string; penLine?: string | null;
}): string {
  const tc = THREAT_COLOR[a.threat] || "#6b7280";
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:6px 12px;color:#111827;font-size:13px">${value}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0"><tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
    <tr><td style="background:#EF0027;padding:16px 24px"><span style="color:#ffffff;font-size:16px;font-weight:bold">🚨 波场舆情预警</span></td></tr>
    <tr><td style="padding:20px 24px 8px">
      <div style="font-size:16px;font-weight:bold;color:#111827;line-height:1.5">${esc(a.title)}</div>
    </td></tr>
    <tr><td style="padding:0 12px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${row("威胁等级", `<span style="display:inline-block;background:${tc};color:#fff;border-radius:4px;padding:1px 8px;font-size:12px">${esc(a.threat)}</span>`)}
        ${row("来源", esc(a.domain || "?") + (a.stance ? `（${esc(a.stance === "hostile" ? "敌对" : a.stance === "friendly" ? "友好" : "中立")}）` : ""))}
        ${row("情感", a.sentiment != null ? `${a.sentiment}/5` : "—")}
        ${a.summary ? row("摘要", esc(a.summary).slice(0, 500)) : ""}
        ${a.penLine ? row("GEO穿透", esc(a.penLine)) : ""}
      </table>
    </td></tr>
    <tr><td style="padding:12px 24px 24px">
      <a href="${esc(safeUrl(a.url))}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:13px;padding:9px 18px;border-radius:6px">查看原文 →</a>
    </td></tr>
    <tr><td style="padding:12px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px">
      本邮件由波场舆情监控系统自动发送(内部预警)。发件为 Resend 测试地址,仅投递至配置的收件邮箱。
    </td></tr>
  </table>
</td></tr></table>`;
}
