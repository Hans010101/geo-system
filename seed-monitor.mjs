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
  { keyword: "孙宇晨", keywordGroup: "syc", priority: 10 },
  { keyword: "孙宇晨 SEC", keywordGroup: "syc", priority: 8 },
  { keyword: "波场", keywordGroup: "tron", priority: 9 },
  { keyword: "TRON TRX", keywordGroup: "tron", priority: 7 },
  { keyword: "Justin Sun", keywordGroup: "syc", priority: 8 },
  { keyword: "Justin Sun TRON", keywordGroup: "tron", priority: 7 },
  { keyword: "TUSD 孙宇晨", keywordGroup: "syc", priority: 6 },
  { keyword: "WLFI Justin Sun", keywordGroup: "syc", priority: 6 },
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

const [[kc]] = await conn.query("SELECT COUNT(*) c FROM monitor_keywords");
const [[rc]] = await conn.query("SELECT COUNT(*) c FROM monitor_source_rules");
console.log(`keywords: +${kwAdded} added, ${kc.c} total | source rules: ${ruleUpserts} upserted, ${rc.c} total`);
await conn.end();
