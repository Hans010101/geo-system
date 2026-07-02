// AWS WAF cookie + request-header template for 币安广场, stored in sysConfigs. The binance source reads
// them; refresh happens out-of-band (admin trigger or external cron on a Chromium box) so the shared
// Cloud Run container never needs to bundle/launch Chromium.
import * as db from "../../db";
import { log } from "../util";

export const BINANCE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const K = {
  cookie: "binance_cookie",
  expire: "binance_cookie_expire",
  uuid: "binance_bnc_uuid",
  headers: "binance_headers", // captured bapi header template (device-info/versioncode/clienttype/…)
};

export async function getStoredCookie(): Promise<{ cookie: string; bncUuid: string; headers: Record<string, string> } | null> {
  const cookie = await db.getSysConfig(K.cookie);
  if (!cookie) return null;
  const expire = Number((await db.getSysConfig(K.expire)) || 0);
  if (expire && Date.now() > expire) {
    log.warn("binance WAF cookie expired — refresh needed");
    return null;
  }
  let headers: Record<string, string> = {};
  try {
    headers = JSON.parse((await db.getSysConfig(K.headers)) || "{}");
  } catch {}
  return { cookie, bncUuid: (await db.getSysConfig(K.uuid)) || "", headers };
}

export async function storeCookie(cookie: string, bncUuid: string, headers: Record<string, string>, ttlMs = 3 * 3600 * 1000): Promise<void> {
  await db.setSysConfig(K.cookie, cookie);
  await db.setSysConfig(K.uuid, bncUuid);
  await db.setSysConfig(K.headers, JSON.stringify(headers || {}));
  await db.setSysConfig(K.expire, String(Date.now() + ttlMs));
}

export async function getCookieStatus(): Promise<{ present: boolean; expireAt: number | null; valid: boolean }> {
  const cookie = await db.getSysConfig(K.cookie);
  const expire = Number((await db.getSysConfig(K.expire)) || 0);
  return { present: !!cookie, expireAt: expire || null, valid: !!cookie && (!expire || Date.now() <= expire) };
}

// Best-effort refresh via headless Chromium (playwright-core). Solves the WAF challenge and captures the
// real bapi request headers (device-info/versioncode/…) so server-side API calls match a browser. Requires
// a Chromium executable (env BINANCE_CHROMIUM_PATH or a system channel); in Cloud Run (none) returns
// ok:false — caller falls back to an externally-refreshed cookie. Never throws.
const DROP_HEADERS = new Set(["cookie", "host", "content-length", "accept-encoding", "x-trace-id", "x-ui-request-trace", "bnc-uuid"]);

export async function refreshCookieViaBrowser(): Promise<{ ok: boolean; error?: string }> {
  let browser: any;
  try {
    const pw: any = await import("playwright-core");
    const executablePath = process.env.BINANCE_CHROMIUM_PATH || undefined;
    browser = await pw.chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : { channel: "chromium" }),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const ctx = await browser.newContext({ userAgent: BINANCE_UA, locale: "zh-CN" });
    const page = await ctx.newPage();
    let searchHeaders: Record<string, string> | null = null;
    let feedHeaders: Record<string, string> | null = null;
    const grab = (h: Record<string, string>) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(h)) {
        if (k.startsWith(":") || DROP_HEADERS.has(k.toLowerCase())) continue;
        out[k] = v;
      }
      return out;
    };
    page.on("request", (req: any) => {
      const u = req.url();
      if (!/binance\.com\/bapi\/composite/.test(u)) return;
      const out = grab(req.headers());
      // The search POST carries the full template incl. versioncode; prefer it. Feed is a fallback.
      if (/feed\/search\/list/.test(u)) searchHeaders = out;
      else if (!feedHeaders && out["device-info"]) feedHeaders = out;
    });
    // Drive an actual search so feed/search/list fires and we capture its exact headers.
    await page.goto("https://www.binance.com/zh-CN/square/search?q=%E5%AD%99%E5%AE%87%E6%99%A8", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(4000);
    try {
      const box = await page.$('input[type="search"], input[placeholder*="搜索"], input[placeholder*="Search"]');
      if (box) {
        await box.click();
        await box.fill("孙宇晨");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(6000);
      }
    } catch {}
    const capturedHeaders: Record<string, string> | null = searchHeaders || feedHeaders;
    const cookies = await ctx.cookies();
    const cookieStr = cookies.map((c: any) => `${c.name}=${c.value}`).join("; ");
    const bncUuid = cookies.find((c: any) => c.name === "bnc-uuid")?.value || "";
    if (!/aws-waf-token/.test(cookieStr)) return { ok: false, error: "no aws-waf-token obtained (WAF not solved)" };
    await storeCookie(cookieStr, bncUuid, capturedHeaders || {});
    log.info(`binance WAF cookie refreshed via browser (bapi headers captured: ${!!capturedHeaders})`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  } finally {
    try { await browser?.close(); } catch {}
  }
}
