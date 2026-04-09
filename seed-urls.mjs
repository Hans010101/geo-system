import { createConnection } from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const connection = await createConnection(DATABASE_URL);

// ==================== Expanded URL Match Rules ====================
const urlMatchRules = [
  // === 全球主流科技/金融媒体 ===
  { pattern: "*reuters.com*", sourceType: "neutral", description: "路透社" },
  { pattern: "*bloomberg.com*", sourceType: "neutral", description: "彭博社" },
  { pattern: "*wsj.com*", sourceType: "neutral", description: "华尔街日报" },
  { pattern: "*ft.com*", sourceType: "neutral", description: "金融时报" },
  { pattern: "*nytimes.com*", sourceType: "neutral", description: "纽约时报" },
  { pattern: "*bbc.com*", sourceType: "neutral", description: "BBC" },
  { pattern: "*bbc.co.uk*", sourceType: "neutral", description: "BBC UK" },
  { pattern: "*cnbc.com*", sourceType: "neutral", description: "CNBC" },
  { pattern: "*forbes.com*", sourceType: "friendly", description: "福布斯" },
  { pattern: "*techcrunch.com*", sourceType: "neutral", description: "TechCrunch" },
  { pattern: "*theverge.com*", sourceType: "neutral", description: "The Verge" },
  { pattern: "*wired.com*", sourceType: "neutral", description: "Wired" },
  { pattern: "*theguardian.com*", sourceType: "neutral", description: "卫报" },
  { pattern: "*apnews.com*", sourceType: "neutral", description: "美联社" },
  { pattern: "*fortune.com*", sourceType: "neutral", description: "财富杂志" },
  
  // === 加密/区块链专业媒体 ===
  { pattern: "*coindesk.com*", sourceType: "friendly", description: "CoinDesk" },
  { pattern: "*cointelegraph.com*", sourceType: "friendly", description: "CoinTelegraph" },
  { pattern: "*theblock.co*", sourceType: "neutral", description: "The Block" },
  { pattern: "*decrypt.co*", sourceType: "neutral", description: "Decrypt" },
  { pattern: "*cryptoslate.com*", sourceType: "neutral", description: "CryptoSlate" },
  { pattern: "*coingecko.com*", sourceType: "neutral", description: "CoinGecko" },
  { pattern: "*coinmarketcap.com*", sourceType: "neutral", description: "CoinMarketCap" },
  { pattern: "*defipulse.com*", sourceType: "neutral", description: "DeFi Pulse" },
  { pattern: "*dappradar.com*", sourceType: "neutral", description: "DappRadar" },
  { pattern: "*messari.io*", sourceType: "neutral", description: "Messari" },
  { pattern: "*blockworks.co*", sourceType: "neutral", description: "Blockworks" },
  { pattern: "*unchainedcrypto.com*", sourceType: "neutral", description: "Unchained" },
  { pattern: "*dlnews.com*", sourceType: "neutral", description: "DL News" },
  
  // === 中国大陆主流媒体 ===
  { pattern: "*163.com*", sourceType: "neutral", description: "网易" },
  { pattern: "*sina.com.cn*", sourceType: "neutral", description: "新浪" },
  { pattern: "*sina.cn*", sourceType: "neutral", description: "新浪移动" },
  { pattern: "*weibo.com*", sourceType: "neutral", description: "微博" },
  { pattern: "*sohu.com*", sourceType: "neutral", description: "搜狐" },
  { pattern: "*qq.com*", sourceType: "neutral", description: "腾讯新闻" },
  { pattern: "*ifeng.com*", sourceType: "neutral", description: "凤凰网" },
  { pattern: "*caixin.com*", sourceType: "neutral", description: "财新" },
  { pattern: "*yicai.com*", sourceType: "neutral", description: "第一财经" },
  { pattern: "*jiemian.com*", sourceType: "neutral", description: "界面新闻" },
  { pattern: "*36kr.com*", sourceType: "neutral", description: "36氪" },
  { pattern: "*huxiu.com*", sourceType: "neutral", description: "虎嗅" },
  { pattern: "*thepaper.cn*", sourceType: "neutral", description: "澎湃新闻" },
  { pattern: "*bjnews.com.cn*", sourceType: "neutral", description: "新京报" },
  
  // === 中国自媒体/内容平台 ===
  { pattern: "*baijiahao.baidu.com*", sourceType: "neutral", description: "百家号" },
  { pattern: "*toutiao.com*", sourceType: "neutral", description: "今日头条" },
  { pattern: "*zhihu.com*", sourceType: "neutral", description: "知乎" },
  { pattern: "*bilibili.com*", sourceType: "neutral", description: "B站" },
  { pattern: "*xiaohongshu.com*", sourceType: "neutral", description: "小红书" },
  { pattern: "*xhslink.com*", sourceType: "neutral", description: "小红书短链" },
  { pattern: "*douyin.com*", sourceType: "neutral", description: "抖音" },
  { pattern: "*kuaishou.com*", sourceType: "neutral", description: "快手" },
  { pattern: "*mp.weixin.qq.com*", sourceType: "neutral", description: "微信公众号" },
  { pattern: "*baike.baidu.com*", sourceType: "neutral", description: "百度百科" },
  
  // === 全球社交媒体 ===
  { pattern: "*twitter.com*", sourceType: "neutral", description: "X/Twitter" },
  { pattern: "*x.com*", sourceType: "neutral", description: "X" },
  { pattern: "*reddit.com*", sourceType: "neutral", description: "Reddit" },
  { pattern: "*youtube.com*", sourceType: "neutral", description: "YouTube" },
  { pattern: "*medium.com*", sourceType: "neutral", description: "Medium" },
  { pattern: "*linkedin.com*", sourceType: "neutral", description: "LinkedIn" },
  { pattern: "*facebook.com*", sourceType: "neutral", description: "Facebook" },
  { pattern: "*instagram.com*", sourceType: "neutral", description: "Instagram" },
  { pattern: "*telegram.org*", sourceType: "neutral", description: "Telegram" },
  { pattern: "*discord.com*", sourceType: "neutral", description: "Discord" },
  
  // === 百科/学术 ===
  { pattern: "*wikipedia.org*", sourceType: "neutral", description: "维基百科" },
  { pattern: "*investopedia.com*", sourceType: "neutral", description: "Investopedia" },
  { pattern: "*scholar.google.com*", sourceType: "neutral", description: "Google Scholar" },
  { pattern: "*arxiv.org*", sourceType: "neutral", description: "arXiv" },
  
  // === 监管/政府 ===
  { pattern: "*sec.gov*", sourceType: "unfriendly", description: "SEC美国证监会" },
  { pattern: "*justice.gov*", sourceType: "unfriendly", description: "美国司法部" },
  { pattern: "*fbi.gov*", sourceType: "unfriendly", description: "FBI" },
  { pattern: "*cftc.gov*", sourceType: "unfriendly", description: "CFTC商品期货委" },
  { pattern: "*finra.org*", sourceType: "unfriendly", description: "FINRA" },
  
  // === 己方内容 ===
  { pattern: "*tron.network*", sourceType: "our_content", description: "TRON官网" },
  { pattern: "*tronscan.org*", sourceType: "our_content", description: "TRONScan浏览器" },
  { pattern: "*justinsun*", sourceType: "our_content", description: "孙宇晨官方" },
  { pattern: "*trondao.org*", sourceType: "our_content", description: "TRON DAO" },
  { pattern: "*sun.io*", sourceType: "our_content", description: "SUN.io" },
  { pattern: "*apenft.io*", sourceType: "our_content", description: "APENFT" },
  { pattern: "*bittorrent.com*", sourceType: "our_content", description: "BitTorrent" },
  { pattern: "*just.network*", sourceType: "our_content", description: "JustLend" },
  
  // === 加密KOL/大V常用平台 ===
  { pattern: "*substack.com*", sourceType: "neutral", description: "Substack" },
  { pattern: "*mirror.xyz*", sourceType: "neutral", description: "Mirror" },
  { pattern: "*paragraph.xyz*", sourceType: "neutral", description: "Paragraph" },
  { pattern: "*foresightnews.pro*", sourceType: "neutral", description: "Foresight News" },
  { pattern: "*panewslab.com*", sourceType: "neutral", description: "PANews" },
  { pattern: "*odaily.news*", sourceType: "neutral", description: "Odaily星球日报" },
  { pattern: "*chaincatcher.com*", sourceType: "neutral", description: "ChainCatcher" },
  { pattern: "*techflowpost.com*", sourceType: "neutral", description: "TechFlow" },
  { pattern: "*marsbit.co*", sourceType: "neutral", description: "MarsBit" },
  { pattern: "*jinse.cn*", sourceType: "neutral", description: "金色财经" },
  { pattern: "*8btc.com*", sourceType: "neutral", description: "巴比特" },
  { pattern: "*bishijie.com*", sourceType: "neutral", description: "币世界" },
];

// Delete old rules first (except our_content ones that were manually added)
await connection.execute(`DELETE FROM urlMatchRules`);
console.log("Cleared old URL match rules");

for (const r of urlMatchRules) {
  await connection.execute(
    `INSERT INTO urlMatchRules (pattern, sourceType, description, isActive) VALUES (?, ?, ?, true)`,
    [r.pattern, r.sourceType, r.description]
  );
}
console.log(`Seeded ${urlMatchRules.length} URL match rules`);

// ==================== Expanded Our Content URLs ====================
const ourContentUrls = [
  // TRON 官方
  { url: "https://tron.network/", title: "TRON官网", publishPlatform: "官网", contentType: "official_page" },
  { url: "https://tronscan.org/", title: "TRONScan区块浏览器", publishPlatform: "官网", contentType: "official_page" },
  { url: "https://trondao.org/", title: "TRON DAO官网", publishPlatform: "官网", contentType: "official_page" },
  { url: "https://developers.tron.network/", title: "TRON开发者文档", publishPlatform: "官网", contentType: "official_page" },
  { url: "https://sun.io/", title: "SUN.io DeFi平台", publishPlatform: "官网", contentType: "official_page" },
  { url: "https://just.network/", title: "JustLend借贷协议", publishPlatform: "官网", contentType: "official_page" },
  { url: "https://apenft.io/", title: "APENFT NFT平台", publishPlatform: "官网", contentType: "official_page" },
  { url: "https://www.bittorrent.com/", title: "BitTorrent官网", publishPlatform: "官网", contentType: "official_page" },
  
  // 百科词条
  { url: "https://en.wikipedia.org/wiki/Tron_(blockchain)", title: "TRON Wikipedia英文", publishPlatform: "维基百科", contentType: "wiki" },
  { url: "https://zh.wikipedia.org/wiki/波场", title: "波场TRON维基百科中文", publishPlatform: "维基百科", contentType: "wiki" },
  { url: "https://en.wikipedia.org/wiki/Justin_Sun", title: "Justin Sun Wikipedia", publishPlatform: "维基百科", contentType: "wiki" },
  { url: "https://baike.baidu.com/item/波场/22487573", title: "波场TRON百度百科", publishPlatform: "百度百科", contentType: "wiki" },
  { url: "https://baike.baidu.com/item/孙宇晨", title: "孙宇晨百度百科", publishPlatform: "百度百科", contentType: "wiki" },
  
  // 社交媒体官方账号
  { url: "https://x.com/justinsuntron", title: "孙宇晨X/Twitter", publishPlatform: "X/Twitter", contentType: "official_page" },
  { url: "https://x.com/traborachain", title: "TRON DAO X/Twitter", publishPlatform: "X/Twitter", contentType: "official_page" },
  { url: "https://weibo.com/justinsun", title: "孙宇晨微博", publishPlatform: "微博", contentType: "official_page" },
  
  // 知乎
  { url: "https://www.zhihu.com/topic/20097402", title: "波场TRON知乎话题", publishPlatform: "知乎", contentType: "zhihu_answer" },
  { url: "https://www.zhihu.com/topic/20171395", title: "孙宇晨知乎话题", publishPlatform: "知乎", contentType: "zhihu_answer" },
  
  // 媒体报道（友好）
  { url: "https://www.forbes.com/profile/justin-sun/", title: "福布斯孙宇晨档案", publishPlatform: "福布斯", contentType: "media_report" },
  { url: "https://coinmarketcap.com/currencies/tron/", title: "TRX CoinMarketCap页面", publishPlatform: "CoinMarketCap", contentType: "official_page" },
  { url: "https://www.coingecko.com/en/coins/tron", title: "TRX CoinGecko页面", publishPlatform: "CoinGecko", contentType: "official_page" },
];

// Clear and re-insert
await connection.execute(`DELETE FROM ourContentUrls`);
console.log("Cleared old our content URLs");

for (const u of ourContentUrls) {
  await connection.execute(
    `INSERT INTO ourContentUrls (url, title, publishPlatform, contentType, isActive) VALUES (?, ?, ?, ?, true)`,
    [u.url, u.title, u.publishPlatform, u.contentType]
  );
}
console.log(`Seeded ${ourContentUrls.length} our content URLs`);

await connection.end();
console.log("URL seed complete!");
