// 简化版中文问题库 — 62 题
import { createConnection } from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const conn = await createConnection(DATABASE_URL);

const questions = [
  // 孙宇晨 IP 线 - 中文 27 题
  { questionId: "SYC-CN-01", text: "孙宇晨是谁", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-02", text: "孙宇晨做什么的", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-03", text: "孙宇晨多大了", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-04", text: "孙宇晨哪里人", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-05", text: "孙宇晨学历", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-06", text: "孙宇晨老婆是谁", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-07", text: "孙宇晨身价多少", brandLine: "sun_yuchen", dimension: "wealth", language: "zh-CN" },
  { questionId: "SYC-CN-08", text: "孙宇晨福布斯排名", brandLine: "sun_yuchen", dimension: "wealth", language: "zh-CN" },
  { questionId: "SYC-CN-09", text: "孙宇晨胡润排名", brandLine: "sun_yuchen", dimension: "wealth", language: "zh-CN" },
  { questionId: "SYC-CN-10", text: "孙宇晨怎么赚钱的", brandLine: "sun_yuchen", dimension: "wealth", language: "zh-CN" },
  { questionId: "SYC-CN-11", text: "孙宇晨创办的项目", brandLine: "sun_yuchen", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "SYC-CN-12", text: "孙宇晨收购火币", brandLine: "sun_yuchen", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "SYC-CN-13", text: "孙宇晨收购 BitTorrent", brandLine: "sun_yuchen", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "SYC-CN-14", text: "TRON Inc 是什么公司", brandLine: "sun_yuchen", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "SYC-CN-15", text: "孙宇晨上太空", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-16", text: "孙宇晨巴菲特午餐", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-17", text: "孙宇晨吃香蕉", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-18", text: "孙宇晨福布斯封面", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-19", text: "孙宇晨纳斯达克敲钟", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-20", text: "孙宇晨和特朗普", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-21", text: "孙宇晨 WTO 大使", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-22", text: "孙宇晨和马云", brandLine: "sun_yuchen", dimension: "awareness", language: "zh-CN" },
  { questionId: "SYC-CN-23", text: "孙宇晨被 SEC 起诉", brandLine: "sun_yuchen", dimension: "compliance", language: "zh-CN" },
  { questionId: "SYC-CN-24", text: "孙宇晨法律问题", brandLine: "sun_yuchen", dimension: "compliance", language: "zh-CN" },
  { questionId: "SYC-CN-25", text: "孙宇晨割韭菜", brandLine: "sun_yuchen", dimension: "evaluation", language: "zh-CN" },
  { questionId: "SYC-CN-26", text: "孙宇晨 TUSD 挪用", brandLine: "sun_yuchen", dimension: "compliance", language: "zh-CN" },
  { questionId: "SYC-CN-27", text: "孙宇晨靠谱吗", brandLine: "sun_yuchen", dimension: "evaluation", language: "zh-CN" },

  // 波场 TRON 线 - 中文 25 题
  { questionId: "TRON-CN-01", text: "波场 TRON 是什么", brandLine: "tron", dimension: "awareness", language: "zh-CN" },
  { questionId: "TRON-CN-02", text: "TRX 币是什么", brandLine: "tron", dimension: "awareness", language: "zh-CN" },
  { questionId: "TRON-CN-03", text: "波场创始人是谁", brandLine: "tron", dimension: "awareness", language: "zh-CN" },
  { questionId: "TRON-CN-04", text: "波场主网什么时候上线的", brandLine: "tron", dimension: "awareness", language: "zh-CN" },
  { questionId: "TRON-CN-05", text: "TRX 值得买吗", brandLine: "tron", dimension: "investment", language: "zh-CN" },
  { questionId: "TRON-CN-06", text: "TRX 币价", brandLine: "tron", dimension: "investment", language: "zh-CN" },
  { questionId: "TRON-CN-07", text: "TRX 历史最高价", brandLine: "tron", dimension: "investment", language: "zh-CN" },
  { questionId: "TRON-CN-08", text: "TRX 市值排名", brandLine: "tron", dimension: "investment", language: "zh-CN" },
  { questionId: "TRON-CN-09", text: "波场链转 USDT 手续费", brandLine: "tron", dimension: "usage", language: "zh-CN" },
  { questionId: "TRON-CN-10", text: "波场钱包怎么用", brandLine: "tron", dimension: "usage", language: "zh-CN" },
  { questionId: "TRON-CN-11", text: "USDT TRC20 是什么", brandLine: "tron", dimension: "usage", language: "zh-CN" },
  { questionId: "TRON-CN-12", text: "波场链上怎么交易", brandLine: "tron", dimension: "usage", language: "zh-CN" },
  { questionId: "TRON-CN-13", text: "波场 USDT 份额", brandLine: "tron", dimension: "industry_status", language: "zh-CN" },
  { questionId: "TRON-CN-14", text: "波场 TVL 排名", brandLine: "tron", dimension: "industry_status", language: "zh-CN" },
  { questionId: "TRON-CN-15", text: "波场账户数", brandLine: "tron", dimension: "industry_status", language: "zh-CN" },
  { questionId: "TRON-CN-16", text: "波场 TPS 多少", brandLine: "tron", dimension: "industry_status", language: "zh-CN" },
  { questionId: "TRON-CN-17", text: "波场生态有哪些项目", brandLine: "tron", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "TRON-CN-18", text: "波场 DeFi", brandLine: "tron", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "TRON-CN-19", text: "USDD 稳定币", brandLine: "tron", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "TRON-CN-20", text: "波场 NFT", brandLine: "tron", dimension: "ecosystem", language: "zh-CN" },
  { questionId: "TRON-CN-21", text: "波场 DPoS 机制", brandLine: "tron", dimension: "comparison", language: "zh-CN" },
  { questionId: "TRON-CN-22", text: "波场安全吗", brandLine: "tron", dimension: "compliance", language: "zh-CN" },
  { questionId: "TRON-CN-23", text: "波场被洗钱用", brandLine: "tron", dimension: "compliance", language: "zh-CN" },
  { questionId: "TRON-CN-24", text: "波场监管风险", brandLine: "tron", dimension: "compliance", language: "zh-CN" },
  { questionId: "TRON-CN-25", text: "波场未来前景", brandLine: "tron", dimension: "evaluation", language: "zh-CN" },

  // 竞品对标线 - 中文 10 题
  { questionId: "COMP-CN-01", text: "TRON 和以太坊", brandLine: "competitor", dimension: "comparison", language: "zh-CN" },
  { questionId: "COMP-CN-02", text: "TRON 和 Solana", brandLine: "competitor", dimension: "comparison", language: "zh-CN" },
  { questionId: "COMP-CN-03", text: "TRON 和 BNB Chain", brandLine: "competitor", dimension: "comparison", language: "zh-CN" },
  { questionId: "COMP-CN-04", text: "TRX 和 SOL 哪个好", brandLine: "competitor", dimension: "investment", language: "zh-CN" },
  { questionId: "COMP-CN-05", text: "TRX 和 ETH 哪个涨得多", brandLine: "competitor", dimension: "investment", language: "zh-CN" },
  { questionId: "COMP-CN-06", text: "公链排名 2026", brandLine: "competitor", dimension: "industry_status", language: "zh-CN" },
  { questionId: "COMP-CN-07", text: "USDT 在哪条链便宜", brandLine: "competitor", dimension: "comparison", language: "zh-CN" },
  { questionId: "COMP-CN-08", text: "孙宇晨和 CZ", brandLine: "competitor", dimension: "comparison", language: "zh-CN" },
  { questionId: "COMP-CN-09", text: "孙宇晨和 V 神", brandLine: "competitor", dimension: "comparison", language: "zh-CN" },
  { questionId: "COMP-CN-10", text: "华人公链有哪些", brandLine: "competitor", dimension: "industry_status", language: "zh-CN" },
];

console.log(`准备导入 ${questions.length} 个中文问题`);

// 1. 归档所有英文问题
const [archiveResult] = await conn.execute(
  `UPDATE questions SET status='archived' WHERE language='en-US'`
);
console.log(`已归档 ${archiveResult.affectedRows} 个英文问题（保留历史数据）`);

// 2. upsert 中文问题
let inserted = 0;
for (const q of questions) {
  try {
    await conn.execute(
      `INSERT INTO questions (questionId, text, brandLine, dimension, language, status)
       VALUES (?, ?, ?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE text=VALUES(text), brandLine=VALUES(brandLine), dimension=VALUES(dimension), status='active'`,
      [q.questionId, q.text, q.brandLine, q.dimension, q.language]
    );
    inserted++;
  } catch (err) {
    console.error(`Failed: ${q.questionId}`, err.message);
  }
}
console.log(`成功 upsert ${inserted} 个中文问题`);

// 3. 对于不在新列表中的旧中文问题，也归档
const newIds = questions.map(q => q.questionId);
const [staleResult] = await conn.execute(
  `UPDATE questions SET status='archived' WHERE language='zh-CN' AND questionId NOT IN (${newIds.map(() => '?').join(',')})`,
  newIds
);
console.log(`归档了 ${staleResult.affectedRows} 个不在新列表中的旧中文问题`);

// 4. 统计结果
const [stats] = await conn.execute(`
  SELECT brandLine, language, status, COUNT(*) as cnt
  FROM questions
  GROUP BY brandLine, language, status
  ORDER BY status DESC, brandLine, language
`);
console.log('\n最终分布统计:');
stats.forEach(row => {
  console.log(`  [${row.status}] ${row.brandLine} / ${row.language}: ${row.cnt} 题`);
});

await conn.end();
