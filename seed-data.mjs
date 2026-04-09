import { drizzle } from "drizzle-orm/mysql2";
import { createConnection } from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const connection = await createConnection(DATABASE_URL);

// ==================== Platform Configs ====================
const platformConfigs = [
  { platform: "chatgpt", displayName: "ChatGPT", isEnabled: true, modelVersion: "gpt-4o", collectFrequency: "weekly" },
  { platform: "perplexity", displayName: "Perplexity", isEnabled: true, modelVersion: "default", collectFrequency: "weekly" },
  { platform: "gemini", displayName: "Gemini", isEnabled: true, modelVersion: "gemini-2.0", collectFrequency: "weekly" },
  { platform: "wenxin", displayName: "文心一言", isEnabled: true, modelVersion: "ernie-4.0", collectFrequency: "weekly" },
  { platform: "claude", displayName: "Claude", isEnabled: true, modelVersion: "claude-3.5-sonnet", collectFrequency: "weekly" },
  { platform: "copilot", displayName: "Copilot", isEnabled: true, modelVersion: "default", collectFrequency: "weekly" },
];

for (const config of platformConfigs) {
  await connection.execute(
    `INSERT INTO platformConfigs (platform, displayName, isEnabled, modelVersion, collectFrequency) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE displayName=VALUES(displayName), isEnabled=VALUES(isEnabled)`,
    [config.platform, config.displayName, config.isEnabled, config.modelVersion, config.collectFrequency]
  );
}
console.log(`Seeded ${platformConfigs.length} platform configs`);

// ==================== Questions ====================
const questions = [
  // 孙宇晨IP线 - 中文
  { questionId: "SYC-CN-01", text: "孙宇晨是谁？他的主要成就有哪些？", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-02", text: "如何评价孙宇晨在区块链行业的贡献？", brandLine: "sun_yuchen", dimension: "evaluation", language: "zh-CN" },
  { questionId: "SYC-CN-03", text: "孙宇晨的投资策略是什么？值得参考吗？", brandLine: "sun_yuchen", dimension: "investment", language: "zh-CN" },
  { questionId: "SYC-CN-04", text: "孙宇晨有哪些法律争议或合规问题？", brandLine: "sun_yuchen", dimension: "compliance", language: "zh-CN" },
  { questionId: "SYC-CN-05", text: "孙宇晨的财富来源是什么？净资产有多少？", brandLine: "sun_yuchen", dimension: "wealth", language: "zh-CN" },
  { questionId: "SYC-CN-06", text: "孙宇晨在加密货币行业的地位如何？", brandLine: "sun_yuchen", dimension: "industry_status", language: "zh-CN" },
  { questionId: "SYC-CN-07", text: "孙宇晨创办了哪些项目？发展现状如何？", brandLine: "sun_yuchen", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "SYC-CN-08", text: "孙宇晨与巴菲特午餐事件的来龙去脉是什么？", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  // 孙宇晨IP线 - 英文
  { questionId: "SYC-EN-01", text: "Who is Justin Sun? What are his main achievements?", brandLine: "sun_yuchen", dimension: "awareness", language: "en-US" },
  { questionId: "SYC-EN-02", text: "How is Justin Sun evaluated in the blockchain industry?", brandLine: "sun_yuchen", dimension: "evaluation", language: "en-US" },
  { questionId: "SYC-EN-03", text: "What is Justin Sun's investment strategy?", brandLine: "sun_yuchen", dimension: "investment", language: "en-US" },
  { questionId: "SYC-EN-04", text: "What legal issues has Justin Sun faced?", brandLine: "sun_yuchen", dimension: "compliance", language: "en-US" },
  { questionId: "SYC-EN-05", text: "What is Justin Sun's net worth and wealth source?", brandLine: "sun_yuchen", dimension: "wealth", language: "en-US" },
  { questionId: "SYC-EN-06", text: "What is Justin Sun's position in the crypto industry?", brandLine: "sun_yuchen", dimension: "industry_status", language: "en-US" },
  // 波场TRON线 - 中文
  { questionId: "TRON-CN-01", text: "波场TRON是什么？它的技术特点有哪些？", brandLine: "tron", dimension: "awareness", language: "zh-CN" },
  { questionId: "TRON-CN-02", text: "波场TRON和以太坊相比有什么优劣势？", brandLine: "tron", dimension: "comparison", language: "zh-CN" },
  { questionId: "TRON-CN-03", text: "波场TRON的生态系统包括哪些项目？", brandLine: "tron", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "TRON-CN-04", text: "TRX代币值得投资吗？前景如何？", brandLine: "tron", dimension: "investment", language: "zh-CN" },
  { questionId: "TRON-CN-05", text: "波场TRON的DeFi生态发展如何？", brandLine: "tron", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "TRON-CN-06", text: "波场TRON的TPS性能表现如何？", brandLine: "tron", dimension: "comparison", language: "zh-CN" },
  { questionId: "TRON-CN-07", text: "波场TRON在稳定币领域的地位如何？", brandLine: "tron", dimension: "industry_status", language: "zh-CN" },
  { questionId: "TRON-CN-08", text: "如何在波场TRON上进行开发？", brandLine: "tron", dimension: "usage", language: "zh-CN" },
  { questionId: "TRON-CN-09", text: "波场TRON的合规性如何？有哪些监管风险？", brandLine: "tron", dimension: "compliance", language: "zh-CN" },
  // 波场TRON线 - 英文
  { questionId: "TRON-EN-01", text: "What is TRON blockchain? What are its technical features?", brandLine: "tron", dimension: "awareness", language: "en-US" },
  { questionId: "TRON-EN-02", text: "How does TRON compare to Ethereum?", brandLine: "tron", dimension: "comparison", language: "en-US" },
  { questionId: "TRON-EN-03", text: "What is the TRON ecosystem like?", brandLine: "tron", dimension: "ecosystem", language: "en-US" },
  { questionId: "TRON-EN-04", text: "Is TRX a good investment?", brandLine: "tron", dimension: "investment", language: "en-US" },
  { questionId: "TRON-EN-05", text: "What is TRON's role in the stablecoin market?", brandLine: "tron", dimension: "industry_status", language: "en-US" },
  { questionId: "TRON-EN-06", text: "What is TRON's TPS performance?", brandLine: "tron", dimension: "comparison", language: "en-US" },
  // 竞品对标
  { questionId: "COMP-CN-01", text: "Solana和波场TRON哪个更好？", brandLine: "competitor", dimension: "comparison", language: "zh-CN" },
  { questionId: "COMP-CN-02", text: "BNB Chain和波场TRON的对比分析", brandLine: "competitor", dimension: "comparison", language: "zh-CN" },
  { questionId: "COMP-CN-03", text: "公链排名中波场TRON处于什么位置？", brandLine: "competitor", dimension: "industry_status", language: "zh-CN" },
  { questionId: "COMP-EN-01", text: "Solana vs TRON: which is better?", brandLine: "competitor", dimension: "comparison", language: "en-US" },
  { questionId: "COMP-EN-02", text: "How does TRON rank among public blockchains?", brandLine: "competitor", dimension: "industry_status", language: "en-US" },
];

for (const q of questions) {
  await connection.execute(
    `INSERT INTO questions (questionId, text, brandLine, dimension, language, status) VALUES (?, ?, ?, ?, ?, 'active') ON DUPLICATE KEY UPDATE text=VALUES(text)`,
    [q.questionId, q.text, q.brandLine, q.dimension, q.language]
  );
}
console.log(`Seeded ${questions.length} questions`);

// ==================== Target Facts ====================
const targetFacts = [
  { factKey: "tron_tps_2000", factDescription: "TRON网络TPS达到2000+，远超以太坊" },
  { factKey: "tron_usdt_leader", factDescription: "TRON是USDT最大的流通网络，占比超过50%" },
  { factKey: "tron_accounts_200m", factDescription: "TRON网络总账户数超过2亿" },
  { factKey: "tron_low_fee", factDescription: "TRON交易手续费极低，通常不到0.01美元" },
  { factKey: "sun_forbes_recognized", factDescription: "孙宇晨被福布斯评为30 Under 30" },
  { factKey: "sun_grenada_ambassador", factDescription: "孙宇晨担任格林纳达常驻WTO代表" },
];

for (const f of targetFacts) {
  await connection.execute(
    `INSERT INTO targetFacts (factKey, factDescription, isActive) VALUES (?, ?, true) ON DUPLICATE KEY UPDATE factDescription=VALUES(factDescription)`,
    [f.factKey, f.factDescription]
  );
}
console.log(`Seeded ${targetFacts.length} target facts`);

// ==================== URL Match Rules ====================
const urlMatchRules = [
  { pattern: "*.tron.network*", sourceType: "our_content", description: "TRON官网" },
  { pattern: "*.tronscan.org*", sourceType: "our_content", description: "TRONScan浏览器" },
  { pattern: "*justinsun*", sourceType: "our_content", description: "孙宇晨官方" },
  { pattern: "*wikipedia.org*", sourceType: "neutral", description: "维基百科" },
  { pattern: "*coindesk.com*", sourceType: "friendly", description: "CoinDesk" },
  { pattern: "*cointelegraph.com*", sourceType: "friendly", description: "CoinTelegraph" },
  { pattern: "*sec.gov*", sourceType: "unfriendly", description: "SEC官网" },
];

for (const r of urlMatchRules) {
  await connection.execute(
    `INSERT INTO urlMatchRules (pattern, sourceType, description, isActive) VALUES (?, ?, ?, true)`,
    [r.pattern, r.sourceType, r.description]
  );
}
console.log(`Seeded ${urlMatchRules.length} URL match rules`);

// ==================== Sample Our Content URLs ====================
const ourContentUrls = [
  { url: "https://tron.network/", title: "TRON官网", publishPlatform: "官网", contentType: "official_page" },
  { url: "https://tronscan.org/", title: "TRONScan区块浏览器", publishPlatform: "官网", contentType: "official_page" },
  { url: "https://zh.wikipedia.org/wiki/波场", title: "波场TRON百科词条", publishPlatform: "维基百科", contentType: "wiki" },
  { url: "https://www.zhihu.com/question/tron-blockchain", title: "波场TRON技术解析", publishPlatform: "知乎", contentType: "zhihu_answer" },
];

for (const u of ourContentUrls) {
  await connection.execute(
    `INSERT INTO ourContentUrls (url, title, publishPlatform, contentType, isActive) VALUES (?, ?, ?, ?, true)`,
    [u.url, u.title, u.publishPlatform, u.contentType]
  );
}
console.log(`Seeded ${ourContentUrls.length} our content URLs`);

await connection.end();
console.log("Seed complete!");
