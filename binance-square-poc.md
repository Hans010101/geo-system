# 币安广场 (Binance Square) 可抓取性 POC

**日期**: 2026-07-02 | **目标**: 评估币安广场能否纳入舆情监控信源 | **性质**: 纯探测,未改生产代码
**探测对象**: `https://www.binance.com/zh-CN/square/search?q=孙宇晨`

## TL;DR — ✅ 可接入,推荐【内部 API + 浏览器兜 WAF Cookie】混合方案

币安广场**能拿到高质量、当日新鲜、强相关的中文舆情**,不是盲区。三条路径里 **Path 1(内部 API)最优且已验证可服务端调用**,但需要一个由无头浏览器定期获取的 AWS WAF cookie。

---

## 三条路径结果

### Path 1:内部 API —— ✅ **通(推荐)**
- 站点被 **AWS WAF** JS 挑战保护(不是 Cloudflare):裸 curl 返回 `HTTP 202` + `challenge.js`,拿不到内容。
- 但 **bapi 网关可达**,且用无头浏览器解开 WAF 后,抓到了真正的搜索 API:
  ```
  POST https://www.binance.com/bapi/composite/v2/friendly/pgc/feed/search/list
  Body: {"scene":"web","pageIndex":1,"pageSize":20,"searchContent":"孙宇晨","type":3}
  ```
  - **无签名**:`csrftoken` 就是 `md5("")=d41d8cd9...`(占位),没有 HMAC/设备签名;只要普通头(`bnc-uuid`/`lang`/`content-type`)。
  - `type:3` = 内容搜索;`pageIndex/pageSize` 分页;返回 `{code:"000000", data:{vos:[...]}, success:true}`。
  - 单页 19 条 `孙宇晨` 结果,结构化字段:`id / authorName / authorRole / authorVerificationType / replyCount / jumpLink / aiSummary / data(正文+时间)`。
- **关键验证:服务端直连成功。** 用无头浏览器解 WAF 后拿到的 `aws-waf-token` cookie,拼上 body + 头,用纯 `fetch`(无浏览器)重放该 POST → **HTTP 200,vos 有数据**。
  → 说明:**只要有一枚有效的 `aws-waf-token` cookie,就能像调普通 JSON API 一样批量搜任意关键词**,无需每次渲染。

### Path 2:Firecrawl 渲染 —— ⚠️ **部分通(不适合定向搜索)**
- Firecrawl(现成 L4)**能过 AWS WAF 并渲染**:主 feed 页拿到 30k 字符真实帖子内容。
- **但驱动不了搜索**:直接加载 `?q=孙宇晨`,SPA 不消费该 query 参数 → 页面显示 `""的搜索结果 / 暂无数据`,只渲染出推荐帖(Morpho/BTC),`孙宇晨` 命中 0。
- Firecrawl scrape 只能"加载 URL",不能像浏览器那样往搜索框输入并触发 XHR。→ **不能用于按关键词定向搜索**(除非用 Firecrawl `actions` 模拟输入,脆弱、且仍不如直接调 API)。

### Path 3:无头浏览器 (Playwright) —— ✅ **通(作为 WAF 引导器)**
- `playwright` + chromium-headless-shell(临时装在 scratchpad,未进项目),headless 打开搜索页 → **自动解开 AWS WAF**(title 正常、无 challenge),**无需 stealth 插件**。
- 往搜索框输入"孙宇晨"+回车 → 页面出现 **24 处"孙宇晨"**,真实高相关帖子。
- 同时它是发现 Path 1 API + 获取 WAF cookie 的手段。
- 结论:**浏览器渲染每条搜索太重**;它的正确用途是**定期解 WAF 拿 cookie**,把真正的数据抓取交给 Path 1 的 API。

---

## 推荐方案:混合(API 为主 + 浏览器兜 cookie)

```
[定期, 每几小时] 无头 Playwright 打开币安广场一次 → 解 AWS WAF → 取 aws-waf-token cookie(+bnc-uuid)存起来
       ↓ (cookie 复用直到过期)
[每轮监控] 对每个关键词 POST /bapi/.../feed/search/list {searchContent, pageIndex, pageSize, type:3}
       → 直接拿结构化帖子 JSON(含正文/作者/时间/回复数)
       ↓
[接入现有管线] 帖子正文已在 API 响应里 → 跳过抓取(fetchEngine='binance-api', fetchCost 0)→ 直接进 DeepSeek 相关性/情感分析 → 入库
```

**在现有可插拔架构里的位置**:币安广场是一个**新的"发现+内容"信源适配器**(与 Serper 平级,而不是 L1-L4 抓取引擎)——因为它按关键词搜索并直接返回带正文的结构化列表,发现和内容一步到位,无需再走 fetch router。

## 是否需要引入 L2/L3?→ 需要一个"无头浏览器"能力,但**用 Node 方案,不用 Scrapling/Python**

| 维度 | 结论 |
|---|---|
| 要不要浏览器 | **要**,但仅用于"每几小时解一次 WAF 拿 cookie",不是每条搜索都渲染 |
| Node vs Python | **Node(`playwright` 或 `rebrowser-playwright`)**。理由:headless-shell **已裸过 AWS WAF,没用 stealth**;技术栈同为 Node,无需额外 Python 微服务/进程通信 |
| 需不需要 stealth | 目前**不需要**。若币安日后升级检测,再上 `rebrowser-playwright`(反指纹)即可,接口不变 |
| 复杂度 | **中等**:加 `playwright` 依赖 + 一个 cookie 管理器(定时刷新/过期重取)+ binance-square 信源适配器 |
| 成本 | API 调用近乎免费(纯 JSON POST);浏览器仅 ~每几小时跑一次 |
| ⚠️ 部署注意 | 在 **Cloud Run 容器里跑 Chromium** 需:镜像内置 chromium(约 +300MB)、内存 ≥512MB-1GB、`--no-sandbox`。或把 cookie-bootstrap 拆成独立小服务/定时任务。这是接入前要评估的主要基础设施成本 |

## 内容样例(证明能拿到,且新鲜、相关)
搜索"孙宇晨"单页 19 条,全部为 **2026-07-01**(POC 当天前一日)发布:
1. **军武菌** @ 2026-07-01 07:58 — "特朗普加密产业超越地产年入12亿美元 海湖庄园创收千万暴涨50%"
2. **ME News** @ 2026-07-01 06:41 — "特朗普25年财务报告:家族靠加密年入超10亿美元,散户还在 \$TRUMP 上亏钱"
3. 广场长帖(渲染视图抓到) — "亿万富豪孙宇晨斥资7500万美元购入治理代币,又花费2亿美元认购特朗普纪念迷因币…联邦诉讼…以缴纳1000万美元罚款达成和解"
4. "买家里…是中国出生的亿万富翁孙宇晨(Justin Sun)…据美联社,他在世界自由金融的治理代币 WLFI 上花了7500万美元…"

## 时效性 & 覆盖质量结论
- **时效性:优。** 单页结果全是发布 <24h 的帖子;API 有分页,可按关键词深翻。远优于 48h 预警红线。
- **中文覆盖:优。** 这正是当前监控最缺的中文一手舆情场(现有 Serper 中文命中很少)。孙宇晨/波场讨论量大、含 KOL(带 `authorVerificationType`/`authorRole`)、有回复数等热度信号。
- **相关性:强。** 直接按关键词搜,主体明确;配合已上线的严格 relevance 判定,质量可控。
- **注意:** 部分卡片是非帖子类型(`cardType` = AI 提问/交易组件),接入时按 `cardType` 过滤只留真实帖子。

## 结论
币安广场**可接入,且是高价值中文信源**。落地顺序建议:先做 Node 无头浏览器 cookie-bootstrap + 直调 `feed/search/list` API 的信源适配器(POC 已证明服务端可行);把 Cloud Run 里跑 Chromium 的部署成本作为主要评估项。**不需要 Scrapling/Python;当前不需要 stealth。**

---
*POC 脚本与原始数据在会话 scratchpad `binance-poc/`(pw-probe/pw-capture/pw-samples.mjs、vos.json、fc-*.json)。Playwright chromium 装在 `~/Library/Caches/ms-playwright`(用户缓存,未进项目;如不用可 `npx playwright uninstall` 清理)。*
