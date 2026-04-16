import type { SendResult } from "./feishu";

export async function sendTelegram(botToken: string, chatId: string, payload: { title: string; content: string }): Promise<SendResult> {
  try {
    const text = `<b>${escapeHtml(payload.title)}</b>\n\n${escapeHtml(payload.content)}`;
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${err.slice(0, 200)}` };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
