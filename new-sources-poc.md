# 新信源接入可行性 POC

**日期**: 2026-07-02 | **范围**: Reddit / 币安广场 / X(付费调研) / 小红书·抖音(直接结论) | **性质**: 纯探测,未改生产代码

## 总结矩阵(先看这个)

| 信源 | 接入方式 | 成本 | 舆情价值 | 结论 |
|---|---|---|---|---|
| **币安广场** | 自建(内部 API + 无头浏览器兜 WAF cookie) | 近乎免费(+Chromium 部署成本) | ⭐⭐⭐ 高(核心中文一手场) | **自建接,优先** |
| **X (Twitter)** | 付费第三方 API(twitterapi.io) | **~$5-20/月**(官方要 $150-500/月) | ⭐⭐⭐ 高(孙宇晨本人主阵地) | **付费接(第三方),高性价比** |
| **Reddit** | OAuth API(免费档 100 QPM) | 免费*(商用需审批,见下) | ⭐⭐ 中(英文散户情绪,部分已被 Serper 覆盖) | **可自建,但优先级低于前两个** |
| **小红书** | 供应商 | 采购 | ⭐ 低-中(加密话题少) | **外包(智慧星光类),自建禁区** |
| **抖音** | 供应商 | 采购 | ⭐ 低(加密内容少+视频) | **外包,自建禁区** |

---

## 1. Reddit —— ⚠️ 免费 .json 已死,需 OAuth;价值中等

**实测**:Reddit 的免费 `.json` 接口 **全部 403**(本机实测三种变体均被拦):
- `www.reddit.com/search.json`(描述性 UA)→ 403
- `www.reddit.com/search.json`(Chrome UA)→ 403
- `old.reddit.com/search.json` → 403
- `r/CryptoCurrency/search.json` → 403

这是 Reddit 2023 年 API 收紧后的既定策略:**未授权访问一律封**(连 Anthropic 的搜索爬虫也被 reddit.com 屏蔽,本次无法用任何免费方式取样)。

**接入方式**:必须走 **OAuth API**(注册 app + client-credentials 流程)。
- 免费档:**OAuth 100 QPM**(无 OAuth 仅 10 QPM),对我们的量(每轮几次搜索)绰绰有余。
- ⚠️ **商用限制(诚实提示)**:免费档官方限定"非商用/个人/学术";品牌舆情监控属商用,Reddit 条款要求**事先审批,可能收费**(超免费额度 $0.24/1000 次;商用 Standard 档 ~$12,000/年起)。低量内部使用实践上能跑免费档,但有 ToS 风险。

**舆情价值**:中等。r/CryptoCurrency、r/Tronix、r/CryptoMarkets 有 Justin Sun/TRON 讨论,但以**英文散户情绪**为主,量不算大;且 **reddit.com 的帖子现有 Serper 源已能部分抓到**(之前诊断里出现过 reddit.com)。专用 API 的增量价值 = 拿到评论区/子版过滤/完整线程。
**取样**:因免费路径全封,本次**未能取到实样**(诚实说明);要实测内容质量必须先注册 OAuth app(需你操作,涉及账号)。

**建议**:可自建(OAuth),但**优先级低于币安广场和 X** —— 增量价值有限 + 商用 ToS 需澄清。

## 2. 币安广场 —— ✅ 自建可行(复用上一轮 POC)

详见 `binance-square-poc.md`。要点复述:
- 站点走 **AWS WAF**(非 Cloudflare),裸 fetch 拿不到(202 挑战页)。
- **内部 API 已验证**:`POST /bapi/composite/v2/friendly/pgc/feed/search/list`,body `{"searchContent":"孙宇晨","pageIndex":1,"pageSize":20,"type":3}`,**无签名**,返回结构化帖子(作者/正文/时间/回复数),当日新鲜,单页 19 条真实结果。
- **服务端直调可行**,前提是有一枚 `aws-waf-token` cookie —— 用 **Node 无头 Playwright**(headless-shell 已裸过 WAF,无需 stealth)每几小时解一次拿 cookie,再直调 API。
- Firecrawl 能渲染广场但**驱动不了搜索框**,定向搜不可用。
- **推荐**:自建"内部 API + 浏览器兜 cookie"混合;部署主要成本 = Cloud Run 容器内跑 Chromium(+300MB 镜像、512MB-1G 内存)。

## 3. X (Twitter) —— 付费调研(未实测抓取)

X 自建抓取被重度封锁,只评估付费路径。**结论:走第三方 API(twitterapi.io),月成本约 $5-20,远优于官方。**

### 官方 X API(2026,新开发者)
- 默认 **pay-per-use**:**读取 $0.005/条,月上限 200 万条**;发帖 $0.015/条。免费档已取消。
- legacy **Basic $200/月**:读取仅 **1.5 万条/月**(太少,基本没用);**Pro $5,000/月**:100 万读取。**新开发者已无法订阅 Basic/Pro**,只能 pay-per-use 或 Enterprise(~$42,000/月)。

### 第三方(twitterapi.io 等)
- **$0.15 / 1,000 条读取**($0.00015/条),**约为官方的 1/33**;无月费、无上限、按量付费,新号送 $1 试用(~6000 次)。$0.18/1000 profiles。

### 成本推演(监控 @justinsuntron + 关键词提及)
| 场景 | 月读取量估算 | 官方 pay-per-use | 第三方 twitterapi.io |
|---|---|---|---|
| 孙宇晨本人时间线 + "Justin Sun/TRON/孙宇晨"提及,每天 ~500-1000 条 | ~15k-30k/月 | ~$75-150/月 | **~$2-5/月** |
| 加大覆盖(更多关键词/更高频)~100k/月 | ~$500/月(且有 2M 上限) | **~$15/月** |

**价值评估**:⭐⭐⭐ **高**。孙宇晨(@justinsuntron)本人在 X 极活跃,很多舆情/新闻**源头就是他的推文**;监控他的时间线 + 关键词提及,是"最快拿到一手信号"的渠道。**性价比极高(第三方 <$20/月)**,建议接入,走 twitterapi.io 类第三方。
*(第三方合规性:走的是非官方数据,存在 ToS/稳定性风险,属可接受的监控用途;下单前建议小额试跑验证覆盖与稳定性。)*

## 4. 小红书 / 抖音 —— 直接结论:外包,自建禁区

- **小红书**:硬登录墙 + 业界最强反爬之一(设备指纹/滑块/风控),自建**禁区**。且加密/孙宇晨话题在小红书量少。→ **建议供应商(智慧星光类)覆盖,自建不做。**
- **抖音**:视频内容为主 + 无开放 API + 强反爬,自建**禁区**。加密舆情价值低。→ **建议供应商覆盖,自建不做。**

## 5. 总结:自建 / 付费 / 外包 三分

- **自建(直连,近乎免费)**:币安广场(内部 API+浏览器 cookie)【高价值中文】、Reddit(OAuth,优先级低)、现有 Serper 新闻/网页。
- **付费 API(便宜)**:X → 第三方 twitterapi.io(~$5-20/月),高价值一手信号。
- **外包(供应商)**:小红书、抖音,以及其他强反爬社媒(微博/微信亦属此类,之前已列盲区)。

**落地优先级**:①币安广场(中文一手、免费、已验证)→ ②X 第三方 API(源头信号、极便宜)→ ③Reddit OAuth(英文补充,ToS 待澄清)→ ④供应商采购(小红书/抖音/微博)。

## 6. 架构建议:统一"社媒信源适配器"抽象(顺带解决 L2/L3)

这三个新源(币安广场 API / Reddit OAuth / X 第三方 API)**都是 API 化的"发现+内容"源**,和现有 Serper 平级 —— 都返回结构化列表(标题/正文/作者/时间),内容一步到位,**不走 L1-L4 抓取 router**。建议抽象一个统一接口:

```
interface SocialSource {
  name: string;                 // 'serper' | 'binance-square' | 'reddit' | 'x-twitterapi'
  search(keyword, opts): Promise<Post[]>;   // 统一返回 {url,title,content,author,publishedAt,...}
}
```
各源实现该接口,pipeline 遍历所有启用的 source → 归一 → 去重 → DeepSeek 分析 → 入库(和现在一样)。加新源 = 实现一个 SocialSource,不动 pipeline。

**关于 L2/L3 / 浏览器渲染**:目前**只有币安广场需要浏览器**,而且只用于"定期解 WAF 拿 cookie",不是每条渲染。因此:
- **引入 Node 无头浏览器能力(`playwright` / `rebrowser-playwright`)** 作为一个基础设施件,首个用途 = 币安广场 cookie-bootstrap;将来若某源升级反爬需要真渲染,同一能力可复用。
- **不需要 Scrapling(Python 微服务)**:headless-shell 已裸过 AWS WAF,无需 stealth;技术栈统一 Node,省一个进程/语言。
- 所以"社媒引擎"抽象 = 上面的 `SocialSource`(API 层)+ 一个可选的"浏览器兜底能力"(目前仅币安用)。X/Reddit 都是纯 API,不碰浏览器。

---
*实测:Reddit .json 403(三变体)、X 定价来自公开资料(见下方来源)、币安广场复用上轮 POC。X/Reddit 未实际下单/注册,成本为按公开单价的推演,下单前建议小额验证。POC 脚本在 scratchpad `newsrc-poc/`。*
