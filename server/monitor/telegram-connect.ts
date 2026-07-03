// Self-service Telegram binding via a shared bot ("一键连接" like mainstream SaaS):
//   dev configures ONE bot token once → user clicks 连接 → we mint a code + t.me/<bot>?start=<code>
//   link/QR → user presses Start in Telegram → Telegram webhooks POST /api/telegram/webhook with
//   "/start <code>" → we resolve the code to their chat.id and write the notificationConfigs telegram
//   row. No manual token/chat-id entry by the user.
import { randomBytes } from "crypto";
import { eq, and, desc } from "drizzle-orm";
import { getDb, getSysConfig, setSysConfig, upsertNotificationConfig, listNotificationConfigs } from "../db";
import { telegramBindings } from "../../drizzle/schema";
import { sendTelegram } from "../_core/senders/telegram";
import { log } from "./util";

const K = {
  token: "telegram_bot_token",
  username: "telegram_bot_username",
  secret: "telegram_webhook_secret",
};
const CODE_TTL_MS = 15 * 60 * 1000;
// Prod URL for the webhook (Cloud Run). Overridable via the setup call if it ever changes.
export const DEFAULT_BASE_URL = "https://geo-system-kwm3xu534q-an.a.run.app";
const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

export async function getBotToken(): Promise<string | null> {
  return (await getSysConfig(K.token)) || null;
}
// Dev sets the token once (via admin tRPC). Re-fetch the username; clear any stale webhook secret pairing.
export async function setBotToken(token: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  const t = token.trim();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(t)) return { ok: false, error: "token 格式不对(应形如 123456:ABC...)" };
  try {
    const resp = await fetch(api(t, "getMe"));
    const j: any = await resp.json();
    if (!j?.ok || !j.result?.username) return { ok: false, error: `getMe 失败: ${j?.description || resp.status}` };
    await setSysConfig(K.token, t);
    await setSysConfig(K.username, j.result.username);
    return { ok: true, username: j.result.username };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 160) };
  }
}

export async function getBotUsername(): Promise<string | null> {
  return (await getSysConfig(K.username)) || null;
}

async function ensureWebhookSecret(): Promise<string> {
  let s = await getSysConfig(K.secret);
  if (!s) { s = randomBytes(24).toString("hex"); await setSysConfig(K.secret, s); }
  return s;
}
export async function getWebhookSecret(): Promise<string | null> {
  return (await getSysConfig(K.secret)) || null;
}

// Register the webhook with Telegram (once, by dev). Uses a secret_token so we can verify callbacks.
export async function setupWebhook(baseUrl = DEFAULT_BASE_URL): Promise<{ ok: boolean; url?: string; error?: string }> {
  const token = await getBotToken();
  if (!token) return { ok: false, error: "未配置 bot token" };
  const secret = await ensureWebhookSecret();
  const url = `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`;
  try {
    const resp = await fetch(api(token, "setWebhook"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true }),
    });
    const j: any = await resp.json();
    if (!j?.ok) return { ok: false, error: `setWebhook 失败: ${j?.description || resp.status}` };
    // refresh username too
    try {
      const me: any = await (await fetch(api(token, "getMe"))).json();
      if (me?.result?.username) await setSysConfig(K.username, me.result.username);
    } catch {}
    log.info("telegram webhook registered");
    return { ok: true, url };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 160) };
  }
}

const genCode = () => randomBytes(6).toString("hex"); // 12 hex chars, deep-link safe

// User clicks 连接 → mint a code + link. Requires the bot to be configured.
export async function createBindCode(label?: string): Promise<{ ok: boolean; code?: string; link?: string; username?: string; error?: string }> {
  const token = await getBotToken();
  const username = await getBotUsername();
  if (!token || !username) return { ok: false, error: "机器人尚未配置(需开发者先配 bot token)" };
  const db = await getDb();
  if (!db) return { ok: false, error: "db unavailable" };
  const code = genCode();
  await db.insert(telegramBindings).values({ code, label: label?.slice(0, 64) || null, status: "pending", expiresAt: Date.now() + CODE_TTL_MS });
  return { ok: true, code, username, link: `https://t.me/${username}?start=${code}` };
}

// Called by the webhook route. Verifies the secret, parses "/start <code>", binds the chat.
export async function handleTelegramUpdate(update: any, secretHeader: string | undefined): Promise<void> {
  const secret = await getWebhookSecret();
  if (!secret || secretHeader !== secret) { log.warn("telegram webhook: bad/missing secret — ignored"); return; }
  const msg = update?.message;
  const text: string = msg?.text || "";
  const chat = msg?.chat;
  if (!chat?.id || !text.startsWith("/start")) return;
  const token = await getBotToken();
  if (!token) return;
  const chatId = String(chat.id);
  const chatTitle = (chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "").slice(0, 128);
  const chatType = chat.type || "private";
  const parts = text.trim().split(/\s+/);
  const code = parts[1];

  const reply = (t: string) =>
    sendTelegram(token, chatId, { title: "波场舆情预警机器人", content: t }).catch(() => {});

  if (!code) {
    await reply("👋 请从网页「连接 Telegram」按钮打开本对话完成绑定(带绑定码)。");
    return;
  }
  const db = await getDb();
  if (!db) return;
  const rows = await db.select().from(telegramBindings).where(eq(telegramBindings.code, code)).limit(1);
  const b = rows[0];
  if (!b || b.status === "bound") { await reply("⚠️ 绑定码无效或已使用,请回网页重新点「连接」。"); return; }
  if (b.expiresAt && Date.now() > b.expiresAt) { await reply("⚠️ 绑定码已过期(15分钟),请回网页重新点「连接」。"); return; }

  await db.update(telegramBindings)
    .set({ status: "bound", chatId, chatTitle, chatType, boundAt: Date.now() })
    .where(eq(telegramBindings.id, b.id));
  // Single telegram target (upsert by channel). Auto-enable the channel; alerts still gated by the
  // monitor push toggle (realtimeEnabled) + minSeverity.
  await upsertNotificationConfig({ channel: "telegram", botToken: token, chatId, isEnabled: true, minSeverity: "medium" });
  log.info(`telegram bound: ${chatType} ${chatTitle || chatId}`);
  await reply(`✅ 连接成功!${chatTitle ? `（${chatTitle}）` : ""}\n此后「负面实时预警 / 简报」会推送到这里。可在网页关闭连接。`);
}

export async function getTelegramStatus(): Promise<{
  botConfigured: boolean;
  botUsername: string | null;
  webhookConfigured: boolean;
  bound: { chatId: string; chatTitle: string | null; chatType: string | null } | null;
  channelEnabled: boolean;
}> {
  const [token, username, secret] = [await getBotToken(), await getBotUsername(), await getWebhookSecret()];
  const configs = await listNotificationConfigs();
  const tg = configs.find((c: any) => c.channel === "telegram" && c.chatId);
  let bound: any = null;
  if (tg?.chatId) {
    const db = await getDb();
    let title: string | null = null, type: string | null = null;
    if (db) {
      const r = await db.select().from(telegramBindings)
        .where(and(eq(telegramBindings.chatId, tg.chatId), eq(telegramBindings.status, "bound")))
        .orderBy(desc(telegramBindings.boundAt)).limit(1);
      title = r[0]?.chatTitle ?? null; type = r[0]?.chatType ?? null;
    }
    bound = { chatId: tg.chatId, chatTitle: title, chatType: type };
  }
  return {
    botConfigured: !!token,
    botUsername: username,
    webhookConfigured: !!secret,
    bound,
    channelEnabled: !!tg?.isEnabled,
  };
}

export async function sendTelegramTest(): Promise<{ ok: boolean; error?: string }> {
  const token = await getBotToken();
  const configs = await listNotificationConfigs();
  const tg = configs.find((c: any) => c.channel === "telegram" && c.chatId);
  if (!token || !tg?.chatId) return { ok: false, error: "尚未连接 Telegram" };
  const r = await sendTelegram(token, tg.chatId, {
    title: "✅ 测试消息",
    content: "这是一条来自波场舆情监控的测试预警。收到即代表连接正常。",
  });
  return { ok: r.success, error: r.error };
}

// Disconnect: disable + clear the telegram channel target.
export async function unbindTelegram(): Promise<{ ok: boolean }> {
  await upsertNotificationConfig({ channel: "telegram", isEnabled: false, chatId: null as any });
  return { ok: true };
}
