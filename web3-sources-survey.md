# Web3 信息源全面普查 —— 孙宇晨/波场舆情

**日期**: 2026-07-03 | **目标**: 找出"孙宇晨/波场舆情有价值 + 技术可低成本接入"的信息源,按可达性分档 | **性质**: 纯调研,不接入(S级零成本者可顺手接)
**方法**: 🧪实测 = 本次 curl/Firecrawl 亲测;🔎调研 = 2026 现状 web 研究。写路径原为 `/home/claude/`,该机(macOS)无此目录,落在项目根,与既有 POC 报告(binance-square-poc.md 等)同处。
**当前已接入源**: 币安广场(内部API+cookie,🟢)、Web/Serper(全网发现+自建/Firecrawl抓取)、Gate广场(Firecrawl topic feed,🟡,2026-07-03新接)。

---

## 一、可达性分档定义(按币安广场模式类比)

| 档 | 含义 | 成本 | 类比 |
|---|---|---|---|
| 🟢 **S** | 有内部API/RSS,游客可见,直接拿全文,零/极低成本 | ~$0 | 币安广场API、RSS |
| 🟡 **A** | 能抓但需 Firecrawl 渲染或轻量自建爬虫,吃 credits 但可控 | 低 | Gate广场、即刻 |
| 🟠 **B** | 需 OAuth/token/第三方付费API | 低-中(按量) | twitterapi.io、CryptoPanic PRO |
| 🔴 **C** | 硬登录墙/强反爬/已死站,自建不可行 → 供应商或剔除 | 高/不可行 | 微博、小红书、抖音 |

---

## 二、全品类信源大表

### A. 交易所内容社区

| 平台 | 孙/波内容 | 价值 | 可达 | 接入方式 | 成本 | 荐 |
|---|---|---|---|---|---|---|
| **币安广场** | 有(多) | 高 | 🟢S | 内部API `feed/search/list`+WAF cookie | ~$0 | ✅已接 |
| **Gate广场** | 有(TRON生态散户) | 中 | 🟡A | Firecrawl 渲染 `post/topic/TRON`+`/TRX` | 2 credits/轮 | ✅已接(2026-07-03) |
| **MEXC** 🧪 | 无 | 无 | 🔴C | /community=营销页,/post·/feed=空壳,无网页UGC | — | ❌无UGC广场 |
| **OKX** 🧪 | 无(zh feed) | 无 | 🔴C | 全 feed 路由硬404("未知区块星球") | — | ❌无可用中文Feed |
| **Bybit** 🧪 | 未确认 | 低 | 🟡A | /en/community 200/89KB(疑营销非UGC),需渲染确认 | 低 | ⏸低优先,UGC价值存疑 |
| **Bitget** 🧪 | — | 低 | 🔴C | /community 404,无独立UGC广场入口 | — | ❌ |
| **KuCoin** 🧪 | 未确认 | 低 | 🟡A | /community 200/14KB(疑壳),渲染价值低 | 低 | ⏸低优先 |
| **Coinbase** 🧪 | — | 低 | 🔴C | /tron 403,无中文/UGC社区 | — | ❌ |

### B. 加密媒体/资讯站

| 平台 | 孙/波内容 | 价值 | 可达 | 接入方式 | 成本 | 荐 |
|---|---|---|---|---|---|---|
| **Cointelegraph** 🧪 | 多(有TRON专tag) | 高 | 🟢S | **RSS `cointelegraph.com/rss/tag/tron`**(实测54次TRON命中,真新闻) | $0 | ⭐强荐接 |
| **CoinDesk** 🧪 | 有 | 高 | 🟢S | RSS `coindesk.com/arc/outboundfeeds/rss/` | $0 | ⭐荐接 |
| **Decrypt** 🧪 | 有 | 中 | 🟢S | RSS `decrypt.co/feed`(TRX命中10) | $0 | 荐接 |
| **Blockworks** 🧪 | 有 | 中 | 🟢S | RSS `blockworks.co/feed` | $0 | 可接 |
| **The Block** 🧪 | 少(本快照0) | 中 | 🟢S | RSS `theblock.co/rss.xml`(有效但内容偏付费) | $0 | 可接 |
| **PANews** 🧪 | 有 | 中 | 🔴/🟡 | `/rss`=HTML(SPA无RSS);仅 Serper+Firecrawl(已被web源覆盖) | 低 | 走现有web源 |
| **深潮TechFlow** 🧪 | 有 | 中 | 🔴/🟡 | `/rss`=HTML,无公开RSS;走web源 | 低 | 走现有web源 |
| **odaily星球日报** 🧪 | 有 | 中 | 🔴/🟡 | `/rss`=HTML,无公开RSS;走web源 | 低 | 走现有web源 |
| **金色财经** 🧪 | 有(中文最大) | 高 | ⚠️ | 本机所有路径 000(疑geo封非CN出口);**需从prod(日本)复测** | ? | 待prod复测 |
| **BlockBeats律动** 🧪 | 有 | 中 | 🔴/🟡 | `/rss` 404,无公开RSS;走web源 | 低 | 走现有web源 |
| **链捕手ChainCatcher** 🧪 | 有 | 中 | 🔴 | `/rss` 404 `/feed` 400;走web源 | 低 | 走现有web源 |
| **吴说** 🧪 | 有 | 中 | 🔴 | wublock123 000;走web源 | 低 | 走现有web源 |

### C. 社交/论坛

| 平台 | 孙/波内容 | 价值 | 可达 | 接入方式 | 成本 | 荐 |
|---|---|---|---|---|---|---|
| **X/Twitter (twitterapi.io)** 🔎 | 多(孙本人主场) | 高 | 🟠B | 第三方REST,`last_tweets?userName=justinsuntron`+`advanced_search`+webhook,无OAuth | **$0.15/1k读**,月约$5-20 | ⭐首选付费 |
| X (SocialData.tools) 🔎 | 多 | 高 | 🟠B | 同类REST,关键词监控 | $0.2/1k | 备用二供 |
| X (官方API v2) 🔎 | 多 | 中 | 🟠B | OAuth,pay-per-use | $0.005/读(贵33x) | ❌不划算 |
| **Telegram t.me/s/{channel}** 🔎 | 有(官方公告首发) | 高 | 🟢S | **直抓广播频道预览页**`t.me/s/TRONannouncements`,无API/登录 | ~$0 | ⭐强荐接 |
| Telegram Bot API 🔎 | — | 低 | 🔴C | 需为频道管理员,读不了他方频道 | — | ❌不适用 |
| Telegram MTProto 🔎 | 有 | 高 | 🟠B | 用户级客户端,可回溯历史,需账号 | 免费+封号风险 | 历史回溯备选 |
| **Reddit RSS** 🧪 | 有(r/Tronix散户) | 低-中 | 🟡A | `reddit.com/r/Tronix/.rss`(实测200/309命中);**2026限速~1/min,突发429** | $0 | ⏸低优先(信号弱) |
| Reddit .json 🧪🔎 | 有 | 中 | 🟡A | 换UA可访问但实测403(需精调UA/限速);ToS限非商用 | $0 | 合规灰区 |
| Reddit OAuth免费层 🔎 | 有 | 中 | 🟠B | 100 QPM,**但商用须企业合同≥$12k/年** | 商用$12k+/年 | ❌商用不可用 |
| **Discord** 🔎 | 无 | 低 | 🔴C | 无官方孙宇晨/TRON服;bot需入服+Message Content Intent | — | ❌无高价值源 |

### D. Web3 数据/资讯平台

| 平台 | 孙/波内容 | 价值 | 可达 | 接入方式 | 成本 | 荐 |
|---|---|---|---|---|---|---|
| **CoinMarketCap** 🔎 | 多 | 高 | 🟢S | **免费API**(Keyless或Basic key),`/content/*` News/Articles/Posts+社区端点 | 免费(10-15K credits/月) | ⭐强荐接 |
| **ChainGPT News RSS** 🔎 | 有 | 中 | 🟢S | 公共RSS无需key,TRX/孙宇晨关键词过滤 | $0 | 荐(免费兜底) |
| **Mirror.xyz** 🔎 | 需先找作者 | 低 | 🟢S | `{pub}.mirror.xyz/feed/atom` 原生RSS | $0 | 按需(先找TRON作者) |
| **Lookonchain** 🔎 | 有(孙大额动作被点名) | 中 | 🟢S* | 核心在 @lookonchain 的X feed(*走X抓取) | 免费 | 随X源接 |
| **DeBank** 🔎 | 有(孙EVM地址链上社交) | 中 | 🟡A | 渲染 `debank.com/profile/{孙地址}` Stream feed(无RSS) | 渲染/付费API | 选择性(链上信号) |
| **Arkham** 🔎 | 有(孙专属实体页) | 中 | 🟡A | 渲染 `intel.arkm.com/explorer/entity/justin-sun`(持仓/资金流) | 网页免费/API付费 | 选择性(链上快照) |
| **CryptoPanic** 🔎 | 多(聚合最广) | 高 | 🟠B | REST需token,`currencies=TRX`;**2026-04免费API停** | PRO $9/月 | 便宜可接 |
| **CoinGecko News** 🔎 | 中 | 中 | 🟠B | 新闻端点仅Analyst付费 | $129/月起 | ❌CMC免费更优 |
| Nansen / Phoenix / Followin 🔎 | 少-中 | 低 | 🔴/🟡 | 付费墙/无公开API/弱 | 付费/不明 | ⏸暂缓 |

### E. 中文Web3社区

| 平台 | 孙/波内容 | 价值 | 可达 | 接入方式 | 成本 | 荐 |
|---|---|---|---|---|---|---|
| **微博 加密KOL** 🔎 | 多(中文主场) | 高 | 🔴C | 硬登录墙+强反爬,自采禁区 | 高(法务) | 必走**供应商** |
| **知乎** 🔎 | 多(高质量长文) | 高 | 🔴C→🟠 | 反乱码/无头检测+登录墙,升级中 | 中高 | **供应商为主**/自采为辅 |
| **小红书** 🔎 | 中 | 中 | 🔴C | 强反爬+法律高压(2025拘留案例),禁区 | 高(法务) | 必走**供应商** |
| **抖音** 🔎 | 中(口播/直播) | 中 | 🔴C | 强反爬+需ASR/OCR,禁区 | 高 | 必走**供应商**(短视频专项) |
| **即刻 Web3研究所** 🔎 | 有(8万从业者) | 中 | 🟡A | `m.okjike.com` 游客视图+Jike Metro SDK,反爬温和 | 低(自建) | 中优先自采 |
| **雪球 加密板块** 🔎 | 少(多借COIN币股间接) | 低 | 🟠B | Cookie反爬+JS逆向,信噪比低 | 中 | ⏸低优先 |
| **巴比特/ChainNode** 🔎 | 少(衰落) | 低 | 🟡A | 论坛游客可见但站点不稳、活跃度大降 | 低 | ⏸可选低频 |
| **链闻ChainNews** 🔎 | — | 无 | 🔴 | 域名已死(2021关停) | — | ❌剔除 |
| **币乎/马特市** 🔎 | — | 无 | 🔴 | 已停运/域名待售 | — | ❌剔除 |

---

## 三、按推荐度排序:值得接入清单

### 🟢 S级 —— 零/极低成本,应尽快接(高性价比)
1. **Telegram `t.me/s/{频道}`** ⭐ — 直抓 `@TRONannouncements`/`@TronLink` 官方广播频道预览页,无API/登录,~$0。crypto 消息常 TG 首发,是**官方口径第一手实时源**。可做与币安广场平级的 SocialSource(内容在预览页HTML里,解析即得)。
2. **CoinMarketCap 免费API** ⭐ — 免费 key,罕见开放 News/Articles/Posts + 社区趋势端点,TRON 信号密集。`/content/*` 直接结构化拿新闻,零抓取成本。
3. **英文媒体 RSS**(Cointelegraph **TRON专属tag**/CoinDesk/Decrypt/Blockworks)⭐ — 免费 XML,直接拿标题+摘要,**零 Serper 调用、零 Firecrawl credit**,比现有 web 源更全更省。做一个 RSS SocialSource 统一拉取。
4. **ChainGPT 公共新闻 RSS** — 免费无 key,做英文新闻兜底补充。

### 🟡 A级 —— Firecrawl/轻量自建,看价值决定
5. **即刻 Web3研究所** — `m.okjike.com` 游客视图,8万中文从业者,反爬温和,中价值中文 UGC。
6. **DeBank / Arkham 孙宇晨实体页** — 渲染孙已知地址的链上社交(Stream)/持仓资金流,链上信号补充,非高频。
7. Gate广场(已接)、Bybit/KuCoin(UGC 价值存疑,低优先)。

### 🟠 B级 —— 付费/OAuth,单独评估 ROI
8. **twitterapi.io** ⭐(付费但便宜)— **孙宇晨本人主阵地**,$0.15/1k、月约$5-20 监控 `@justinsuntron`+TRON关键词+webhook 近实时。**X 是孙舆情最关键缺口,这是最优补法。**
9. **CryptoPanic PRO $9/月** — 聚合面最广、TRON 信号密,便宜。想要"一站聚合"可接。
10. Telegram MTProto(历史回溯)、SocialData.tools(X 二供)。

### 🔴 C级 —— 自建不可行,归供应商或剔除
- **供应商采买**(持牌舆情:智慧星光/数说故事/八爪鱼):**微博**(高价值中文主场)、**知乎**(高价值长文)、**小红书**、**抖音**(短视频专项)。
- **剔除**:链闻(死站)、币乎(停运)、马特市(域名待售)、Discord(无官方源)、MEXC/OKX/Bitget/Coinbase(无UGC广场)。
- **Reddit OAuth 商用**($12k/年)不接。

---

## 四、RSS 源专项清单(最省成本形态)🧪均实测

| RSS | 状态 | TRON内容 | 备注 |
|---|---|---|---|
| `cointelegraph.com/rss/tag/tron` | ✅RSS✓ | **专属tag,54命中** | ⭐最佳:TRON定向、真新闻(如 Tether T3 冻结$450M) |
| `coindesk.com/arc/outboundfeeds/rss/` | ✅RSS✓ | 2命中 | 主流权威 |
| `decrypt.co/feed` | ✅RSS✓ | 10命中 | 支持 `?tag=tron` |
| `blockworks.co/feed` | ✅RSS✓ | 4命中 | 可接 |
| `theblock.co/rss.xml` | ✅RSS✓ | 0(本快照) | 内容偏付费墙 |
| ChainGPT 新闻 RSS(无key) | ✅ | 有 | 免费兜底 |
| `{pub}.mirror.xyz/feed/atom` | ✅ | 需找作者 | 按需 |
| **金色财经** | ⚠️000 | — | 本机不可达(疑geo),**需 prod 日本IP复测** |
| PANews/TechFlow/odaily `/rss` | ❌=HTML | — | SPA 无 RSS,走 web 源 |
| BlockBeats/链捕手/吴说 | ❌404/000 | — | 无公开 RSS |

**结论**: **英文媒体 RSS 是继币安API、Telegram 之后第三理想的零成本源**——中文媒体基本无公开 RSS(SPA),继续靠现有 Serper web 源覆盖。建议做一个 **RSS SocialSource**:定时拉上述英文 feed 的 XML,`<item>` 里已有标题+摘要+链接,按 TRON/孙宇晨关键词过滤 → 直接进 pipeline(零 Serper/零 Firecrawl)。

---

## 五、Reddit 专项结论 🧪实测

- **能低成本接吗?** 技术上能,但**信号弱 + 2026 限速收紧 + 商用合规灰区**,优先级低。
- **实测**:`reddit.com/r/Tronix/.rss` → **200 / RSS✓ / 309 次 TRON 命中**(可用);但 `/new/.rss`、`r/CryptoCurrency/.rss`、`search.rss` 突发连打即 **429**;`.json` → **403**。→ **2026 未授权限速约 1 次/分钟**,突发被限。
- **内容质量**:r/Tronix 实测前几条是散户求助("need 14trx for gas"、"Trezor Tron Support"、"GasFree Wallet"),**多为零售支持问答,非孙宇晨舆情信号**。高信号的 r/CryptoCurrency 搜索又被限速。
- **合规**:免费 .json/OAuth 的 ToS 限**非商业**;商用 Reddit 要企业合同 ≥$12k/年。
- **建议**:**低优先**。若做全景可挂一个"每轮拉 1 个 `r/Tronix/.rss`、严格间隔"的轻量补充源(免费、无OAuth),但别期待高价值。**不值得为 Reddit 上 OAuth 或付费**。X(twitterapi.io)才是海外散户+本人舆情的正解。

---

## 六、最终建议:优先接哪几个(价值高 + 成本低 排序)

| 优先级 | 源 | 为什么 | 成本 | 动作 |
|---|---|---|---|---|
| **1** ⭐ | **Telegram t.me/s 官方频道** | 官方口径首发、🟢S零成本、实时 | ~$0 | 做 SocialSource(与币安平级) |
| **2** ⭐ | **英文媒体 RSS**(Cointelegraph TRON tag 等) | 零成本、比 Serper 更全更省、真新闻 | $0 | 做 RSS SocialSource |
| **3** ⭐ | **CoinMarketCap 免费内容API** | 免费 key + 聚合新闻/社区端点、TRON密 | $0 | 接 `/content/*` |
| **4** ⭐ | **twitterapi.io 监控 @justinsuntron** | 孙本人主场、X 是最大缺口、便宜 | ~$5-20/月 | 付费小额,ROI 最高的付费源 |
| 5 | 即刻 Web3研究所(m站) | 中文中价值 UGC、自采温和 | 低 | 🟡自建 |
| 6 | CryptoPanic PRO / DeBank·Arkham 孙实体页 | 聚合面 / 链上信号 | $9/月 / 渲染 | 按需 |
| 7 | 供应商采买(微博>知乎>抖音>小红书) | 高价值中文主场但禁区 | 采购 | 立项评估 |

**一句话**:**先接 3 个零成本 S 级源(Telegram官方频道 + 英文媒体RSS + CMC免费API),再花每月 ~$10-20 上 twitterapi.io 补 X(孙宇晨本人+海外舆情最大缺口)**;中文深水区(微博/知乎/抖音)走持牌供应商;Reddit/交易所其它广场/CoinGecko/Nansen 等低优先或不接。

---
*实测项(🧪)于 2026-07-03 亲测(curl RSS/Reddit/交易所 + Firecrawl 渲染);研究项(🔎)为 2026 现状 web 调研(定价/条款/可行性),接入前建议对目标源再做一次针对性 PoC(尤其金色财经从 prod 日本IP 复测、Telegram 频道选型、CMC 内容端点字段)。本次未接入任何新源(Gate 除外,已于同日单独接入)。*
