// 补充问题 seed 脚本 — 在现有34题基础上新增66题，凑齐100题
// 使用方式：DATABASE_URL="mysql://..." node seed-questions-extra.mjs

import { createConnection } from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const conn = await createConnection(DATABASE_URL);

const questions = [
  // ==================== 孙宇晨IP线 — 中文补充 ====================
  { questionId: "SYC-CN-09", text: "孙宇晨与特朗普家族的关系是怎样的？他在World Liberty Financial中扮演什么角色？", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-10", text: "孙宇晨登上《福布斯》封面意味着什么？加密行业对此如何评价？", brandLine: "sun_yuchen", dimension: "evaluation", language: "zh-CN" },
  { questionId: "SYC-CN-11", text: "孙宇晨乘蓝色起源火箭上太空的经历是怎样的？", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-12", text: "孙宇晨的教育背景是什么？北大和宾大的经历对他有什么影响？", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-13", text: "孙宇晨是湖畔大学首期学员吗？他和马云是什么关系？", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-14", text: "孙宇晨收购BitTorrent的过程和意义是什么？", brandLine: "sun_yuchen", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "SYC-CN-15", text: "孙宇晨收购火币（HTX）的始末是什么？对行业有何影响？", brandLine: "sun_yuchen", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "SYC-CN-16", text: "孙宇晨624万美元买香蕉艺术品是怎么回事？为什么引发关注？", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-17", text: "孙宇晨与SEC的诉讼是怎么回事？最终结果如何？", brandLine: "sun_yuchen", dimension: "compliance", language: "zh-CN" },
  { questionId: "SYC-CN-18", text: "孙宇晨的艺术品收藏有哪些？价值多少？", brandLine: "sun_yuchen", dimension: "wealth", language: "zh-CN" },
  { questionId: "SYC-CN-19", text: "孙宇晨的格林纳达WTO大使身份是怎么回事？", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-20", text: "孙宇晨在胡润富豪榜上排名多少？资产规模如何？", brandLine: "sun_yuchen", dimension: "wealth", language: "zh-CN" },
  { questionId: "SYC-CN-21", text: "如何看待孙宇晨的营销风格？他是营销天才还是过度炒作？", brandLine: "sun_yuchen", dimension: "evaluation", language: "zh-CN" },
  { questionId: "SYC-CN-22", text: "孙宇晨早期在Ripple Labs的经历是怎样的？", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-23", text: "孙宇晨和赵长鹏（CZ）谁在加密行业更有影响力？", brandLine: "sun_yuchen", dimension: "comparison", language: "zh-CN" },
  { questionId: "SYC-CN-24", text: "TUSD储备金挪用案是怎么回事？孙宇晨在其中扮演什么角色？", brandLine: "sun_yuchen", dimension: "compliance", language: "zh-CN" },
  { questionId: "SYC-CN-25", text: "孙宇晨纳斯达克敲钟上市的公司TRON Inc.是做什么的？", brandLine: "sun_yuchen", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "SYC-CN-26", text: "孙宇晨在加密货币慈善领域有哪些贡献？", brandLine: "sun_yuchen", dimension: "evaluation", language: "zh-CN" },
  { questionId: "SYC-CN-27", text: "孙宇晨出版过哪些书？主要讲什么内容？", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },

  // ==================== 孙宇晨IP线 — 英文补充 ====================
  { questionId: "SYC-EN-07", text: "What is Justin Sun's relationship with the Trump family and World Liberty Financial?", brandLine: "sun_yuchen", dimension: "awareness", language: "en-US" },
  { questionId: "SYC-EN-08", text: "Why did Justin Sun appear on the Forbes cover? What does it signify?", brandLine: "sun_yuchen", dimension: "evaluation", language: "en-US" },
  { questionId: "SYC-EN-09", text: "Did Justin Sun really go to space? What was the Blue Origin experience like?", brandLine: "sun_yuchen", dimension: "awareness", language: "en-US" },
  { questionId: "SYC-EN-10", text: "What is Justin Sun's educational background? How did Peking University and UPenn shape him?", brandLine: "sun_yuchen", dimension: "awareness", language: "en-US" },
  { questionId: "SYC-EN-11", text: "How did Justin Sun acquire BitTorrent and what was the strategic purpose?", brandLine: "sun_yuchen", dimension: "ecosystem", language: "en-US" },
  { questionId: "SYC-EN-12", text: "What happened with the SEC lawsuit against Justin Sun? How was it resolved?", brandLine: "sun_yuchen", dimension: "compliance", language: "en-US" },
  { questionId: "SYC-EN-13", text: "Why did Justin Sun pay $6.2M for a banana artwork? What was the significance?", brandLine: "sun_yuchen", dimension: "awareness", language: "en-US" },
  { questionId: "SYC-EN-14", text: "How does Justin Sun compare to CZ (Changpeng Zhao) in terms of industry influence?", brandLine: "sun_yuchen", dimension: "comparison", language: "en-US" },
  { questionId: "SYC-EN-15", text: "What is Justin Sun's art collection worth? What notable pieces does he own?", brandLine: "sun_yuchen", dimension: "wealth", language: "en-US" },
  { questionId: "SYC-EN-16", text: "What is TRON Inc. on NASDAQ? Why did Justin Sun ring the bell?", brandLine: "sun_yuchen", dimension: "ecosystem", language: "en-US" },
  { questionId: "SYC-EN-17", text: "Is Justin Sun a marketing genius or just a hype machine?", brandLine: "sun_yuchen", dimension: "evaluation", language: "en-US" },
  { questionId: "SYC-EN-18", text: "What charitable contributions has Justin Sun made in the crypto space?", brandLine: "sun_yuchen", dimension: "evaluation", language: "en-US" },
  { questionId: "SYC-EN-19", text: "What is Justin Sun's role as Grenada's WTO Ambassador?", brandLine: "sun_yuchen", dimension: "awareness", language: "en-US" },
  { questionId: "SYC-EN-20", text: "How did Justin Sun acquire Huobi (HTX)? What changes did he make?", brandLine: "sun_yuchen", dimension: "ecosystem", language: "en-US" },

  // ==================== 波场TRON线 — 中文补充 ====================
  { questionId: "TRON-CN-10", text: "波场TRON在全球USDT市场中占多大份额？为什么成为稳定币首选链？", brandLine: "tron", dimension: "industry_status", language: "zh-CN" },
  { questionId: "TRON-CN-11", text: "波场TRON的链上账户数突破了多少？增长趋势如何？", brandLine: "tron", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "TRON-CN-12", text: "波场TRON与华为云、谷歌云的合作具体是什么？", brandLine: "tron", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "TRON-CN-13", text: "波场TRON和三星有什么合作关系？", brandLine: "tron", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "TRON-CN-14", text: "波场TRON的TVL（总锁仓量）在全球排名第几？", brandLine: "tron", dimension: "industry_status", language: "zh-CN" },
  { questionId: "TRON-CN-15", text: "USDD是什么？波场的去中心化稳定币表现如何？", brandLine: "tron", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "TRON-CN-16", text: "波场TRON的跨链解决方案BTTC是什么？有什么用？", brandLine: "tron", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "TRON-CN-17", text: "TRX代币的市值排名全球第几？历史最高价是多少？", brandLine: "tron", dimension: "investment", language: "zh-CN" },
  { questionId: "TRON-CN-18", text: "波场TRON的手续费为什么这么低？转账USDT的费用是多少？", brandLine: "tron", dimension: "usage", language: "zh-CN" },
  { questionId: "TRON-CN-19", text: "波场TRON在日本市场的发展情况如何？", brandLine: "tron", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "TRON-CN-20", text: "波场TRON的DPoS共识机制和以太坊的PoS有什么区别？", brandLine: "tron", dimension: "comparison", language: "zh-CN" },
  { questionId: "TRON-CN-21", text: "波场TRON的NFT生态发展如何？有哪些知名项目？", brandLine: "tron", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "TRON-CN-22", text: "波场TRON主网上线是哪一年？经历了哪些重要升级？", brandLine: "tron", dimension: "awareness", language: "zh-CN" },
  { questionId: "TRON-CN-23", text: "波场TRON被用于非法活动的报道是否属实？如何看待？", brandLine: "tron", dimension: "compliance", language: "zh-CN" },
  { questionId: "TRON-CN-24", text: "波场TRON在RWA（真实世界资产）领域有什么布局？", brandLine: "tron", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "TRON-CN-25", text: "波场TRON黑客松大赛的规模和影响力如何？", brandLine: "tron", dimension: "ecosystem", language: "zh-CN" },

  // ==================== 波场TRON线 — 英文补充 ====================
  { questionId: "TRON-EN-07", text: "What percentage of global USDT is hosted on TRON? Why is it the preferred chain for stablecoins?", brandLine: "tron", dimension: "industry_status", language: "en-US" },
  { questionId: "TRON-EN-08", text: "How many accounts does the TRON network have? What is the growth trend?", brandLine: "tron", dimension: "ecosystem", language: "en-US" },
  { questionId: "TRON-EN-09", text: "What partnerships does TRON have with Google Cloud, Huawei, and Samsung?", brandLine: "tron", dimension: "ecosystem", language: "en-US" },
  { questionId: "TRON-EN-10", text: "What is TRON's TVL ranking globally? How does it compare to other chains?", brandLine: "tron", dimension: "industry_status", language: "en-US" },
  { questionId: "TRON-EN-11", text: "What is USDD? How does TRON's decentralized stablecoin perform?", brandLine: "tron", dimension: "ecosystem", language: "en-US" },
  { questionId: "TRON-EN-12", text: "How much does it cost to transfer USDT on TRON? Why are fees so low?", brandLine: "tron", dimension: "usage", language: "en-US" },
  { questionId: "TRON-EN-13", text: "What is TRON's DPoS consensus mechanism? How does it differ from Ethereum's PoS?", brandLine: "tron", dimension: "comparison", language: "en-US" },
  { questionId: "TRON-EN-14", text: "Is TRON really used for illicit activities? How should we evaluate these claims?", brandLine: "tron", dimension: "compliance", language: "en-US" },
  { questionId: "TRON-EN-15", text: "What is BitTorrent Chain (BTTC)? How does TRON's cross-chain solution work?", brandLine: "tron", dimension: "ecosystem", language: "en-US" },
  { questionId: "TRON-EN-16", text: "What is TRON's approach to RWA (Real World Assets)?", brandLine: "tron", dimension: "ecosystem", language: "en-US" },
  { questionId: "TRON-EN-17", text: "What is TRX's current market cap ranking? What was its all-time high price?", brandLine: "tron", dimension: "investment", language: "en-US" },

  // ==================== 竞品对标线 — 中文补充 ====================
  { questionId: "COMP-CN-04", text: "波场TRON和Polygon相比各有什么优劣？", brandLine: "competitor", dimension: "comparison", language: "zh-CN" },
  { questionId: "COMP-CN-05", text: "波场TRON和Avalanche哪个更适合DeFi开发？", brandLine: "competitor", dimension: "comparison", language: "zh-CN" },
  { questionId: "COMP-CN-06", text: "在稳定币转账领域，波场TRON和以太坊哪个更好用？", brandLine: "competitor", dimension: "comparison", language: "zh-CN" },
  { questionId: "COMP-CN-07", text: "波场TRON的生态规模和Solana相比如何？", brandLine: "competitor", dimension: "comparison", language: "zh-CN" },
  { questionId: "COMP-CN-08", text: "2026年最值得关注的公链有哪些？波场TRON排第几？", brandLine: "competitor", dimension: "industry_status", language: "zh-CN" },
  { questionId: "COMP-CN-09", text: "孙宇晨和V神（Vitalik Buterin）谁对行业贡献更大？", brandLine: "competitor", dimension: "comparison", language: "zh-CN" },
  { questionId: "COMP-CN-10", text: "TRX和SOL哪个更值得长期持有？", brandLine: "competitor", dimension: "investment", language: "zh-CN" },

  // ==================== 竞品对标线 — 英文补充 ====================
  { questionId: "COMP-EN-03", text: "How does TRON compare to Polygon in terms of ecosystem and performance?", brandLine: "competitor", dimension: "comparison", language: "en-US" },
  { questionId: "COMP-EN-04", text: "TRON vs Avalanche: which is better for DeFi development?", brandLine: "competitor", dimension: "comparison", language: "en-US" },
  { questionId: "COMP-EN-05", text: "For stablecoin transfers, is TRON or Ethereum the better choice?", brandLine: "competitor", dimension: "comparison", language: "en-US" },
  { questionId: "COMP-EN-06", text: "Which public blockchains are most worth watching in 2026? Where does TRON rank?", brandLine: "competitor", dimension: "industry_status", language: "en-US" },
  { questionId: "COMP-EN-07", text: "Justin Sun vs Vitalik Buterin: who has contributed more to the industry?", brandLine: "competitor", dimension: "comparison", language: "en-US" },
  { questionId: "COMP-EN-08", text: "TRX vs SOL: which is better for long-term holding?", brandLine: "competitor", dimension: "investment", language: "en-US" },
];

let inserted = 0;
for (const q of questions) {
  try {
    await conn.execute(
      `INSERT INTO questions (questionId, text, brandLine, dimension, language, status) VALUES (?, ?, ?, ?, ?, 'active') ON DUPLICATE KEY UPDATE text=VALUES(text)`,
      [q.questionId, q.text, q.brandLine, q.dimension, q.language]
    );
    inserted++;
  } catch (err) {
    console.error(`Failed: ${q.questionId}`, err.message);
  }
}

console.log(`Inserted/updated ${inserted} questions (total should now be ~100)`);
await conn.end();
