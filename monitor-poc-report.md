# 舆情监控数据获取方案 POC 报告

**日期**: 2026-07-02 | **监控对象**: 孙宇晨 / 波场 TRON | **性质**: 纯验证,未写生产代码
**实测账号**: Firecrawl 免费档(1000 credits/月,月刷新)、Serper 免费档(2500 次,一次性)、DeepSeek via 生产 OpenRouter key

---

## TL;DR — 推荐【混合方案】

**Serper 做搜索发现(news 垂直为主)→ 自建 fetch+readability 优先抓全文 → Firecrawl 只兜底硬站点(Reuters/Bloomberg 等)→ DeepSeek 做分析**。
稳态成本 ≈ **$9/月**(前 4 个月两家免费额度内 ≈ $0.6/月),覆盖与时效均达标。纯 A(Firecrawl 全量 $16/月)抓不到新浪正文且无带日期的 news 垂直;纯 B(Serper+自建)抓不到 Reuters/Bloomberg。互补性是实测出来的,不是推测。

---

## 1. 搜索层对比:Firecrawl Search vs Serper

同 4 个查询、limit=10 实测:

| 查询 | Firecrawl web | Serper web | Serper news(独有) |
|---|---|---|---|
| 孙宇晨 | 10 条,**10/10 中文**;百科/社媒为主,BBC中文、知乎专栏各1 | 9 条,构成几乎相同(同为 Google SERP) | 10 条**全新闻**:新浪(3天前)、**财新**(HTX被英制裁!)、cn.WSJ、CoinDesk中文、世界日报 |
| 孙宇晨 SEC | 10 条,10/10 中文,新闻密集:**财新✓ cn.WSJ✓ 华尔街见闻✓** | 10 条,财新✓ 华尔街见闻✓ | 10 条:cn.WSJ、大纪元、凤凰、CoinDesk中文、星洲/南洋(马来西亚中文媒体) |
| 波场 TRON | 10 条,8/10 中文,但官方站/钱包/百科为主(品牌导航型) | 10 条,同样导航型 | 10 条:**PANews(13h)**、cryptorank(11h)、bitget(21h)、新浪(3天) — 加密垂直媒体全命中 |
| Justin Sun TRON | 10 条全英文档案页(Wiki/Forbes/Instagram) | 8 条,构成相同 | 10 条:stocktwits(1天)、**Reuters、NBC、ABC、WSJ** — 国际主流媒体带日期 |

**关键差异**:
- **Serper news 垂直是决定性优势**:每条自带发布时间字段(Firecrawl 无日期字段,只能靠描述文本猜),且新闻纯度远高于 web 搜索(web 搜"孙宇晨"一半是百科和个人主页)。
- 两家 web 搜索结果几乎同构(都是 Google SERP 包装),中文能力都不错——中文查询能出财新/华尔街见闻/知乎。
- Serper 支持 `gl=cn&hl=zh-cn` 变体,会多出 bilibili/币安中文/知乎专栏并**附日期**。
- 计费:Firecrawl 2 credits/次;Serper 1 credit/次(web 和 news 同价)。
- 微博内容:两家均未出现(仅 x.com 上的孙宇晨账号帖);知乎在两家 web 搜索都有命中(专栏/回答摘要可见,但正文抓取被登录墙挡,见 §2)。

## 2. 抓取层对比:Firecrawl Scrape vs 自建(fetch+readability+jsdom)

同 7 个 URL 实测(HTTP 层 Firecrawl 全部 200,下表按**正文实质**判定):

| 信源 | Firecrawl(1 credit/页) | 自建($0) | 结论 |
|---|---|---|---|
| Reuters(SEC和解文) | ✅ **全文 2959 字** | ❌ 401 要求JS | **FC 独占** |
| Bloomberg(SEC结案文) | △ 标题+首两段(付费墙前导语,够做预警初判) | ❌ 403 robot 拦截 | **FC 独占**(部分) |
| CoinDesk | ✅ 全文 3678 字 | ✅ 全文 3562 字 | 打平 |
| 新浪财经 | ❌ **只有标题 40 字**(复测 onlyMainContent=false 仍无正文——渲染路径拿到的是壳) | ✅ **全文 1342 字**(服务端直出 HTML) | **自建独占** ⚠️反直觉 |
| 界面新闻 | ✅ 快讯全文(470字,原文即短) | ✅ 快讯全文 | 打平 |
| 知乎 | ❌ 登录墙("请您登录") | ❌ 403 反爬 | 双输 |
| 微博 | ❌ passport 登录跳转 | ❌ JS 空壳 0 字 | 双输(边界确认) |

**可用率**:Firecrawl 4/7(含1个部分),自建 3/7,**并集 5/7** —— 只有知乎/微博是共同盲区。
**付费墙表现**:Bloomberg 能拿到墙前导语;财新未入抓取列表但其搜索结果标题可见(全文需订阅,任何抓取器都一样)。
**速度**:自建 0.5~2s/页;Firecrawl 3.6~15s/页(新浪最慢 15s)。

## 3. 时效性(舆情预警生命线:48h 内可发现)

| 测试 | 结果 |
|---|---|
| Firecrawl `tbs=qdr:d`(孙宇晨) | 10 条,含 **"10/12/14 分钟前"** 的视频/社媒条目、163/新浪财经当日文;但混入 BBC 4月旧文和 SEO 垃圾帖 |
| Firecrawl `tbs=qdr:d2 / qdr:w` | 均正常工作,构成类似 |
| Serper news `tbs=qdr:d`(孙宇晨) | 1 条(10h 前,bitcoin.com 中文) |
| Serper news `tbs=qdr:d`(Justin Sun TRON) | 5 条,**3h~18h 前**,全部带精确日期 |
| Serper web `tbs=qdr:d`(孙宇晨) | 0 条(web+日过滤过严,应使用 news 端点) |

**结论:通过**。两条路线索引延迟均为**小时级**,远优于 48h 红线;当日新文完全可发现。注意:① 英文关键词必须带 "TRON" 限定(裸 "Justin Sun"+时间过滤会命中大量无关 Justin);② 时间过滤结果需要相关性清洗,DeepSeek 分析层天然兜底。

## 4. 分析层:DeepSeek(via OpenRouter)质量验证

用生产 `analyzeCollection` 同构 prompt 扩展(相关性+情感+威胁分级+建议动作),3 篇实测,JSON 全部一次解析成功:

| 文章 | relevance | sentiment | threat | tone | action | 单篇成本 |
|---|---|---|---|---|---|---|
| 新浪:孙宇晨指控WLFI冻结资产 | 90 | 2(偏负) | **medium** | critical | **respond** | $0.00059 |
| 界面:SEC驳回指控快讯 | 100 | 3 | low | neutral | monitor | $0.00035 |
| CoinDesk:SEC和解+$10M罚款 | 95 | 3 | medium | neutral | monitor | $0.00060 |

判定合理性抽查:WLFI 争议文被标 medium+respond(确实是需响应的负面事件)、SEC 撤诉被标 low(利好)——**分级方向正确,说理通顺,质量可用**。完整输出见附录 A。

## 5. 成本推演(月度,按 10 关键词 × 2次/天 × 10条 + 40 篇/天全文)

月量:600 次搜索 + 1200 篇抓取 + 1200 次分析。

| 方案 | 搜索 | 抓取 | 分析 | **月成本** | 缺口 |
|---|---|---|---|---|---|
| **纯 A**(Firecrawl 全量) | 600×2=1200 cr | 1200×1=1200 cr | DeepSeek $0.6 | 2400 cr > 免费1000 → **Hobby $16/月** | 新浪类正文缺失、无 news 日期字段 |
| **纯 B**(Serper+自建) | 600 次 | $0(自建) | $0.6 | 前4个月免费(2500次一次性),之后 Serper 最低档约 **$50/50k/6个月 ≈ $8.4/月**† + $0.6 ≈ **$9/月** | Reuters/Bloomberg 全丢 |
| **混合(推荐)** | Serper 600 次 | 自建优先 $0;硬站点回退 Firecrawl ~360 cr(30%)**在免费 1000/月内** | $0.6 | **≈$9/月**(稳态);**前 4 个月 ≈$0.6/月** | 仅知乎/微博盲区(所有方案共有) |

† Serper 付费价目登录后可见,$50/50k 为公开资料口径,**建议你在刚注册的 dashboard 里确认一下**。
本次 POC 实际消耗:Firecrawl **26 credits**(余 999/1000),Serper **12 次**(余 2488/2500),OpenRouter **$0.0015**。

## 6. 微博/微信边界(确认不行,符合预期)

- 微博:搜索层两家都只能看到 x.com 帖;抓取层 s.weibo.com 两条路线均被登录墙挡死。
- 知乎:搜索层可发现问题/专栏标题(可作为信号),正文两条路线均 403/登录墙。
- 微信公众号:无公开 URL 可入,未测(结构性不可达)。
- 若必须覆盖 → 需要 cookie 池/第三方数据商(新榜、清博类),属于另一个采购决策,不在本 POC 范围。

## 7. 推荐落地架构(混合)

```
[发现] Serper news(主,带日期) + Serper web(周扫)     ~600次/月
   ↓ URL 去重(现有 collections 表思路可复用)
[抓取] 自建 fetch+readability(第一跳,$0)
   ↓ 失败/正文<500字 → Firecrawl 回退(1 cr/页,免费额度内)
[分析] DeepSeek via OpenRouter(生产已有 key/invokeLLM 通路)
   ↓ relevance≥60 才入库;threat≥high → 走现有 alerts 体系
```

**开发量估计**:Serper client(~50行)+ 自建抓取器(POC 已有 ~100行,加重试/UA池)+ Firecrawl 回退分支(~30行)+ 分析 prompt(POC 已验证)。比纯 A 多两个小模块,换来新浪类正文 + $7/月差价 + 双通道容错。

**风险提示**:① 自建抓取器对反爬升级敏感,Firecrawl 回退就是保险;② Serper 免费额度是一次性的,4 个月后开始计费;③ Google 索引 ≠ 全量,财新付费墙内容只能拿到标题级信号。

---

## 附录 A:DeepSeek 三篇完整输出

### A1. 新浪财经 — 孙宇晨指控WLFI冻结资产(2026-04-14)
```json
{
  "relevance_score": 90, "sentiment_score": 2,
  "sentiment_reasoning": "文章主要报道孙宇晨与World Liberty的争议,立场偏负面。",
  "threat_level": "medium",
  "threat_reasoning": "涉及孙宇晨与知名公司的争议,可能影响品牌声誉。",
  "key_facts_mentioned": ["孙宇晨指控World Liberty嵌入'后门黑名单功能'","World Liberty回应称有合同和证据","孙宇晨曾投资World Liberty并成为顾问","孙宇晨与SEC达成和解,支付1000万美元","孙宇晨声称其代币被错误列入黑名单"],
  "negative_points_mentioned": ["孙宇晨指控World Liberty单方面冻结代币","孙宇晨与SEC的和解涉及欺诈指控","孙宇晨的代币被冻结","World Liberty有权冻结代币","孙宇晨成为'第一个也是最大的受害者'"],
  "positive_points_mentioned": ["孙宇晨投资World Liberty是对特朗普家族'卓越项目'的信任投票","孙宇晨未承认任何不当行为"],
  "overall_tone": "critical", "suggested_action": "respond"
}
```

### A2. 界面新闻 — SEC驳回指控快讯(2026-03)
```json
{
  "relevance_score": 100, "sentiment_score": 3,
  "sentiment_reasoning": "文章提到SEC驳回指控,但未明确表示支持或反对孙宇晨及波场。",
  "threat_level": "low", "threat_reasoning": "SEC驳回指控,对品牌声誉威胁较低。",
  "key_facts_mentioned": ["孙宇晨确认SEC驳回所有指控","SEC曾起诉孙宇晨及其公司","指控包括出售未注册的代币和操纵市场"],
  "negative_points_mentioned": ["SEC曾起诉孙宇晨及其公司","指控出售未注册的代币","指控操纵市场"],
  "positive_points_mentioned": ["SEC驳回所有指控","孙宇晨期待与SEC合作"],
  "overall_tone": "neutral", "suggested_action": "monitor"
}
```

### A3. CoinDesk — SEC和解、Rainberry付$10M(2026-03-05)
```json
{
  "relevance_score": 95, "sentiment_score": 3,
  "sentiment_reasoning": "文章主要报道了孙宇晨及波场TRON与SEC的和解,既有负面指控也有正面表态,整体中性。",
  "threat_level": "medium",
  "threat_reasoning": "虽然和解达成,但SEC的指控和罚款可能对品牌声誉造成一定影响。",
  "key_facts_mentioned": ["SEC与孙宇晨及波场TRON达成和解","Rainberry Inc.支付1000万美元罚款","SEC指控孙宇晨及波场TRON违反证券法","孙宇晨购买World Liberty Financial tokens","孙宇晨表示将继续推动创新"],
  "negative_points_mentioned": ["SEC指控孙宇晨及波场TRON违反证券法","Rainberry Inc.支付1000万美元罚款","SEC指控孙宇晨及波场TRON操纵TRX市场"],
  "positive_points_mentioned": ["和解达成,SEC不再追究类似案件","孙宇晨表示将继续推动创新"],
  "overall_tone": "neutral", "suggested_action": "monitor"
}
```

## 附录 B:原始数据文件

POC 全部脚本与原始输出在会话 scratchpad `firecrawl-poc/`:`out/search-results.json`(Firecrawl 4查询)、`out/scrape-results.json` + `scrape-*.md`(Firecrawl 7抓取)、`out/selfscrape-results.json` + `self-*.txt`(自建)、`out/freshness-results.json`(tbs时效)、`out/serper-results.json`(Serper 12调用)、`out/deepseek-*.json`(3分析)。测试脚本:`search-test.mjs / scrape-test.mjs / selfscrape.mjs / freshness-test.mjs / serper-test.mjs / deepseek-test.mjs`。
