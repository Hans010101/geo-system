import type { SendResult } from "./feishu";

// Email via Resend. System-level api key + From live in sysConfigs (set once by the admin); the
// recipient list is per notificationConfigs email row. Users only enter recipient addresses.
export async function sendEmail(
  config: { apiKey: string; from: string; to: string[] },
  payload: { title: string; content: string }
): Promise<SendResult> {
  try {
    const to = (config.to || []).filter(Boolean);
    if (!config.apiKey) return { success: false, error: "Resend 未配置(缺 api key)" };
    if (!to.length) return { success: false, error: "无收件邮箱" };
    const { Resend } = await import("resend");
    const resend = new Resend(config.apiKey);
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#EF0027;color:white;padding:16px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:16px">波场舆情监控 - 预警通知</h2>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
        <h3 style="margin:0 0 12px">${esc(payload.title)}</h3>
        <p style="color:#4b5563;line-height:1.6;white-space:pre-wrap">${esc(payload.content)}</p>
      </div>
    </div>`;
    const { error } = await resend.emails.send({ from: config.from, to, subject: payload.title, html });
    if (error) return { success: false, error: String((error as any)?.message || error).slice(0, 200) };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: String(err?.message || err).slice(0, 200) };
  }
}
