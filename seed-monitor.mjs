// Seed sentiment-monitor keywords + source rules. Idempotent (safe to re-run).
// Usage: DATABASE_URL="mysql://..." node seed-monitor.mjs
import { createConnection } from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const conn = await createConnection(DATABASE_URL);

// --- Keywords (8) ---
const KEYWORDS = [
  // 孙宇晨核心 (syc) — 中文走 gl=cn, 英文走 gl=us;priority>=8 → qdr:d(新鲜), 其余 → qdr:w(覆盖)
  { keyword: "孙宇晨", keywordGroup: "syc", priority: 10 },
  { keyword: "Justin Sun", keywordGroup: "syc", priority: 10 },
  { keyword: "孙宇晨 波场", keywordGroup: "syc", priority: 9 },
  { keyword: "孙宇晨 SEC", keywordGroup: "syc", priority: 7 },
  { keyword: "孙宇晨 起诉", keywordGroup: "syc", priority: 8 },
  { keyword: "孙宇晨 诉讼", keywordGroup: "syc", priority: 8 },
  { keyword: "Justin Sun lawsuit", keywordGroup: "syc", priority: 8 },
  { keyword: "Justin Sun SEC", keywordGroup: "syc", priority: 7 },
  // 波场项目 (tron)
  { keyword: "波场 TRON", keywordGroup: "tron", priority: 9 },
  { keyword: "波场", keywordGroup: "tron", priority: 8 },
  { keyword: "TRON TRX", keywordGroup: "tron", priority: 8 },
  { keyword: "TRX 波场", keywordGroup: "tron", priority: 7 },
  { keyword: "波场链", keywordGroup: "tron", priority: 6 },
  { keyword: "USDD 稳定币", keywordGroup: "tron", priority: 6 },
  // 关联实体/事件 (syc-rel) — 真实舆情高发区
  { keyword: "孙宇晨 火币", keywordGroup: "syc-rel", priority: 8 },
  { keyword: "孙宇晨 HTX", keywordGroup: "syc-rel", priority: 8 },
  { keyword: "孙宇晨 特朗普", keywordGroup: "syc-rel", priority: 8 },
  { keyword: "Justin Sun Trump", keywordGroup: "syc-rel", priority: 8 },
  { keyword: "Justin Sun WLFI", keywordGroup: "syc-rel", priority: 7 },
  { keyword: "孙宇晨 洗钱", keywordGroup: "syc-rel", priority: 8 },
  { keyword: "Justin Sun fraud", keywordGroup: "syc-rel", priority: 8 },
  // 英文舆情 (intl)
  { keyword: "Justin Sun crypto", keywordGroup: "intl", priority: 6 },
  { keyword: "Tron founder", keywordGroup: "intl", priority: 6 },
];
const [existingKw] = await conn.query("SELECT keyword FROM monitor_keywords");
const have = new Set(existingKw.map((r) => r.keyword));
let kwAdded = 0;
for (const k of KEYWORDS) {
  if (have.has(k.keyword)) continue;
  await conn.query(
    "INSERT INTO monitor_keywords (keyword, keywordGroup, searchFreq, isActive, priority) VALUES (?, ?, 'daily', 1, ?)",
    [k.keyword, k.keywordGroup, k.priority]
  );
  kwAdded++;
}

// --- Source rules (from GEO citation analysis) ---
const RULES = [
  { domain: "bloomberg.com", authorityLevel: 9, stance: "hostile", notes: "国际财经主流，付费墙" },
  { domain: "reuters.com", authorityLevel: 9, stance: "hostile", notes: "国际通讯社" },
  { domain: "wsj.com", authorityLevel: 9, stance: "hostile", notes: "华尔街日报，付费墙" },
  { domain: "caixin.com", authorityLevel: 8, stance: "hostile", notes: "财新，付费墙" },
  { domain: "theblock.co", authorityLevel: 7, stance: "hostile", notes: "加密垂直，偏批评" },
  { domain: "coindesk.com", authorityLevel: 7, stance: "hostile", notes: "加密垂直，偏批评" },
  { domain: "tron.network", authorityLevel: 10, stance: "friendly", notes: "波场官方" },
  { domain: "tronscan.org", authorityLevel: 9, stance: "friendly", notes: "官方浏览器" },
  { domain: "sun.io", authorityLevel: 8, stance: "friendly", notes: "SUN 官方" },
  { domain: "sina.com.cn", authorityLevel: 6, stance: "neutral", notes: "新浪财经" },
  { domain: "jiemian.com", authorityLevel: 6, stance: "neutral", notes: "界面新闻" },
  { domain: "panewslab.com", authorityLevel: 5, stance: "neutral", notes: "PANews 加密媒体" },
  { domain: "36kr.com", authorityLevel: 6, stance: "neutral", notes: "36氪" },
];
let ruleUpserts = 0;
for (const r of RULES) {
  await conn.query(
    `INSERT INTO monitor_source_rules (domain, authorityLevel, stance, notes) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE authorityLevel=VALUES(authorityLevel), stance=VALUES(stance), notes=VALUES(notes)`,
    [r.domain, r.authorityLevel, r.stance, r.notes]
  );
  ruleUpserts++;
}

// --- Budget guardrail defaults (sysConfigs, set-if-absent so user tuning isn't clobbered) ---
const BUDGET_DEFAULTS = {
  monitor_firecrawl_monthly_limit: "800",
  monitor_serper_monthly_limit: "2000",
  monitor_max_articles_per_cycle: "50",
};
let budgetSet = 0;
for (const [k, v] of Object.entries(BUDGET_DEFAULTS)) {
  const [ex] = await conn.query("SELECT id FROM sysConfigs WHERE configKey=? LIMIT 1", [k]);
  if (ex.length === 0) {
    await conn.query("INSERT INTO sysConfigs (configKey, configValue) VALUES (?, ?)", [k, v]);
    budgetSet++;
  }
}

const [[kc]] = await conn.query("SELECT COUNT(*) c FROM monitor_keywords");
const [[rc]] = await conn.query("SELECT COUNT(*) c FROM monitor_source_rules");
console.log(`keywords: +${kwAdded} added, ${kc.c} total | source rules: ${ruleUpserts} upserted, ${rc.c} total | budget defaults: +${budgetSet} set`);
await conn.end();
