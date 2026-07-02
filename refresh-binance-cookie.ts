// External refresher for the 币安广场 AWS WAF cookie. Solves the WAF challenge in a headless browser and
// writes the cookie + bapi header template into sysConfigs, which the deployed binance source reads.
//
// The shared Cloud Run container does NOT bundle Chromium (avoids OOM/bloat risk to the whole app), so
// this runs OUT-OF-BAND on any box with Chromium and should be scheduled ~every 2-3h (cron / CI):
//   BINANCE_CHROMIUM_PATH="/path/to/chromium" DATABASE_URL="mysql://..." pnpm tsx refresh-binance-cookie.ts
// (Omit BINANCE_CHROMIUM_PATH if a `chromium` channel browser is installed via `npx playwright install`.)
import { refreshCookieViaBrowser, getCookieStatus } from "./server/monitor/sources/binance-cookie";

const r = await refreshCookieViaBrowser();
console.log("refresh:", JSON.stringify(r));
console.log("status:", JSON.stringify(await getCookieStatus()));
process.exit(r.ok ? 0 : 1);
