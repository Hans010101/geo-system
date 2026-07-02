# 交易所内容广场可抓取性 POC —— Gate / MEXC / OKX

**日期**: 2026-07-02 | **目标**: 评估三个交易所内容社区能否作为 SocialSource 接入 | **性质**: 纯探测,未改生产代码
**方法**: 复用币安广场 POC 三路径(内部 API / Firecrawl 渲染 / Playwright 浏览器)。当前网络出口在**日本(JP)**。

## 总结矩阵(先看这个)

| 平台 | 类型 | 游客可见 | 反爬 | 内部API可调 | Firecrawl | 孙宇晨/波场内容 | 舆情价值 | 结论 |
|---|---|---|---|---|---|---|---|---|
| **Gate 广场** | ✅ UGC 社区 | 是(需过 Akamai) | **Akamai**(headless 403) | ❌ 我方自动化被 Akamai 拦 | ✅ 能渲染(index+帖子) | ✅ 多、质量好 | **中-高** | **值得接,但走现成 Serper+Firecrawl,不做专用 cookie** |
| **OKX Feed** | △ UGC 但 en-us 为主 | 部分 | 无 WAF,但**地域限制** | ？zh feed 路由 404 | △ 只出地域切换提示,无正文 | 少(zh) | **低** | **暂不接**(en-us/地域/zh 内容稀) |
| **MEXC** | ❌ 无网页 UGC 广场 | — | — | 无内容API(只有行情) | — | 无 | **无** | **放弃**(社区=Telegram/X 外链;/post=404 跳 App) |

**与币安广场对比**:币安有**无签名内部 API + AWS WAF(headless 能过)= 免费结构化**。这三个**没有一个**能复刻:Gate 是 Akamai(headless 被拦)、OKX 有地域墙且无干净 zh API、MEXC 根本没 UGC 广场。**币安的 WAF-cookie 机制不通用**,不能直接搬。

---

## Gate 广场 —— ✅ UGC 社区,Firecrawl 可达(Akamai 拦自动化)

- **真实入口**: `https://www.gate.com/post`(Gate Square / Gate 广场),帖子 `https://www.gate.com/zh/post/status/{id}`。**是真 UGC 社区**(用户发帖+讨论),另有 `gate.com/zh/news/`(动态/News bot,半官方)与 `gate.com/learn|blog|bitwiki`(官方科普,非 UGC)。
- **路径1 内部 API**:❌ 我方自动化拿不到。裸 curl 与 **headless Playwright 都被 Akamai 拦**(`403 Access Denied`,`errors.edgesuite.net` = Akamai 边缘)。内部 API 一定存在,但从我们服务器/无头浏览器调用会被 Akamai 传感器识别。要直连需 stealth 浏览器(rebrowser/patchright)或住宅代理 —— 比币安 AWS WAF **难**。
- **路径2 Firecrawl**:✅ **能过 Akamai**。scrape `gate.com/post` 得 79KB 渲染内容(无 Access Denied);scrape 单帖得**全文 3929 字**。实测样例(真实 UGC 帖):
  > **爆了！TRON搞出0 Gas费的USD1，孙哥这波操作太狠了！🔥** — "TRON主网刚铸出第一个USD1稳定币…铸造手续费直接干到0…这波必须给孙哥和TRON点个赞…"(`gate.com/zh/post/status/11433622`)
- **路径3 浏览器**:headless 被 Akamai 拦(同路径1)。
- **孙宇晨/波场内容**:✅ 丰富且质量好(用户观点帖 + Gate 动态)。Google/Serper **已能索引** Gate 广场帖(本 POC 用 `site:gate.com` 就搜到多条 status 帖)。
- **舆情价值**:中-高(活跃中文 UGC,孙宇晨/波场讨论多)。

**推荐接入方式(重要)**:**不做带 cookie 的专用 SocialSource**(Akamai 直连太难)。改为**复用现有管线**:
- **发现**:现有 **Serper 源已能搜到 Gate 广场帖**(Google 已索引 `gate.com/zh/post/status/*`)——大概率**零新代码**就已在以 `web` 源流入(建议核对近期 monitor_articles 是否已有 gate.com,并把 `gate.com` 加进 `monitor_source_rules` 定 stance/authority)。
- **抓取**:现有 **L4 Firecrawl 引擎**已能抓 Gate 帖全文(过 Akamai)。self-scrape(L1)大概率被 Akamai 拦 → 自动降级到 Firecrawl(架构已支持)。
- **可选增强**:若要 Gate **自己的**搜索(比 Google 更全/更快),需 Firecrawl 渲染 Gate 搜索结果页(须先找到 Gate 广场搜索 URL),按查询付 Firecrawl credits。非免费,优先级低于"先靠 Serper+Firecrawl 自然覆盖"。

## OKX Feed —— △ 暂不接(en-us 为主 + 地域墙 + zh 内容稀)

- **真实入口**:OKX 有 **"OKX Feed"** UGC(帖子 `okx.com/{locale}/feed/post/{id}`),另有 `web3.okx.com/discover`(Web3 钱包发现,偏 DApp)、`okx.com/zh-hans/learn`(官方科普)、`okx.com/*/community`(社交外链页)。
- **路径1 API**:`okx.com/zh-hans/feed` 与 `/feed/hot` 在浏览器里 **404**(回落到 OKX 首页壳),抓到的 XHR 全是基础设施(`/v3/users/common/*`、`priapi/v1/assistant/*`、`featured-announcements` 官方公告、行情)——**没有 UGC feed 内容/搜索 API**浮现;`globalConfig/community/getAll` 返回的是 Telegram 等社交外链。
- **路径2 Firecrawl**:△ scrape 某 en-us feed 帖(zh-hans 版)只渲染出 **"Looks like you're in the United States, switch site" 地域切换提示 + OKX 导航,无帖子正文**(孙宇晨/波场=0)。Firecrawl 出口在美,触发地域墙。
- **反爬/可见**:无明显 WAF/Cloudflare(日本网络能开 OKX 首页),但 **Feed 偏 en-us + 地域切换**,zh-hans 的 Feed 路由不成立。
- **舆情价值**:低(zh 一手内容稀少、难枚举、地域受限)。
- **推荐**:**暂不接**。OKX 中文 Feed 生态不成熟;若日后 OKX 推出稳定的 zh Feed 再评估。个别 OKX 文章若被 Google 索引,现有 Serper 源会顺带覆盖。

## MEXC —— ❌ 放弃(没有网页 UGC 广场)

- **真实入口**:`mexc.com/community` = **"Join the MEXC Community" 帮助页**(列 Telegram/X 等外链,bodyLen 仅 2252,无帖子);`mexc.com/zh-CN/post` = **404 跳"扫码下载 App"**。
- **API**:抓到的全是**行情类**(`/api/platform/spot/market-v2/*` symbols/tickers/memecoins),**无任何内容/社区帖 API**。
- **结论**:MEXC **没有可抓取的网页 UGC 广场**,社区靠 Telegram/X。舆情价值=无(对自建)。**放弃**;若必须覆盖 MEXC 讨论 → 供应商或直接监控其 Telegram/X。

---

## 最终建议:优先级 & 成本

1. **Gate 广场 —— 值得接,低成本先做**:走**现有 Serper(发现)+ Firecrawl(抓取)**,大概率零/极少新代码就能让 Gate UGC 帖以 `web` 源流入。**动作**:①查近期 `monitor_articles` 是否已有 `gate.com` 帖(很可能已有);②把 `gate.com` 加进 `monitor_source_rules`(建议 stance=neutral, authority≈6);③抽查 Gate 帖的 relevance/抓取是否正常(Firecrawl 兜底)。**不需要** GitHub Actions cookie 基础设施(Firecrawl 已过 Akamai)。若要 Gate 原生搜索的更全覆盖,再评估 Firecrawl-搜索页方案(付费/优先级低)。
2. **OKX —— 暂缓**:zh Feed 不成熟 + 地域墙 + 无干净 API,接入成本高、价值低。观望。
3. **MEXC —— 放弃自建**:无网页 UGC 广场;有需要走供应商/Telegram 监控。

**关于 cookie 基础设施**:三家都**不需要**像币安那样挂 GitHub Actions 刷 WAF cookie ——
- Gate:靠 Firecrawl 过 Akamai,无需我们维护 cookie;真要直连 Akamai 才需 stealth/住宅代理(不建议,ROI 低)。
- OKX/MEXC:不接,无需。

**一句话**:三个里只有 **Gate 广场**有真 UGC 舆情价值,而且好消息是它**大概率已经/可以通过现有 Serper+Firecrawl 管线覆盖**,不用新建带 cookie 的 SocialSource;OKX/MEXC 这轮不值得投入。币安广场仍是唯一需要专用 API+cookie 的特例。

---
*实测:Gate/MEXC 裸请求 403、OKX 404(Next.js);headless Playwright 抓 API(Gate Akamai 403、OKX 仅基础设施 API、MEXC 仅行情 API);Firecrawl 渲染(Gate 79KB+单帖全文 √、OKX 地域提示、);Serper `site:gate.com` 确认 Gate UGC 孙宇晨/波场帖丰富。POC 脚本在会话 scratchpad `exchange-poc/`。未改生产代码。*
