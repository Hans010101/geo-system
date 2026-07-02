# 部署流程(标准,2026-07-02 起)

> 背景:类型检查(`pnpm run check`)只能挡编译期问题,"部署成功但运行时出问题"需要运行时验证兜底。
> 核心原则:**smoke test 通过才算部署完成;非核心功能初始化失败应降级、不应崩溃。**

## 一键部署(推荐)

```bash
bash scripts/deploy.sh
```

自动执行: 类型检查 → 记录回滚目标 → Cloud Build → Cloud Run 部署 → 等 30s → smoke test → **失败自动回滚**到上一个健康 revision。

> 提交代码(`git add / commit / push`)仍手动做,在跑 deploy.sh 之前。

## 手动分步(等价流程)

```bash
pnpm run check
git add <files> && git commit -m "..." && git push

gcloud builds submit --tag gcr.io/gen-lang-client-0869327408/geo-system --project gen-lang-client-0869327408
gcloud run deploy geo-system --region asia-northeast1 \
  --image gcr.io/gen-lang-client-0869327408/geo-system --timeout=300 --project gen-lang-client-0869327408

sleep 30
bash scripts/post-deploy-smoke.sh    # 通过才算部署完成
```

### smoke 失败时回滚

```bash
gcloud run revisions list --service=geo-system --region=asia-northeast1 --project gen-lang-client-0869327408 --limit=5
gcloud run services update-traffic geo-system --region=asia-northeast1 \
  --project gen-lang-client-0869327408 --to-revisions=<上一健康revision>=100
curl -I https://geo-system-kwm3xu534q-an.a.run.app   # 必须回到 200
```

## smoke test 检查什么(scripts/post-deploy-smoke.sh)

| 层 | 挡什么 | 检查 |
|---|---|---|
| a. 健康 | 服务崩了 | `GET /` 200;`GET /api/health` 200 且 `ok:true`、`db:true`、`bootErrors:[]` |
| b. API | 活着但接口坏了 | `auth.me`(公开,须200) + listArticles/stats/dashboard.summary/sourcePenetration(受保护,401=预期;5xx/404=失败) |
| c. 启动异常 | cron/初始化启动崩 | gcloud 扫近 5 分钟 ERROR 日志(is not defined / Cannot read / BOOT-GUARD / Fatal / Uncaught) |

## 运行时防御(应用内建,server/_core/boot.ts)

- **initGuard(name, fn)**:所有模块顶层初始化(GEO 调度、监控调度、维护 cron)都经它执行 —— 初始化失败 = 该功能降级 + ERROR 日志 + 记入 bootErrors,**不崩溃**。
- **GET /api/health**:暴露 `{ok, db, bootErrors, uptimeSec}`,"部署了但降级"机器可检测(降级时返回 503)。
- **进程级兜底**(preload.ts,先于业务模块加载):unhandledRejection / uncaughtException → 记日志+bootErrors,不退出。
- **fail-fast**:startServer 本身失败 → `exit(1)`(让 Cloud Run 杀掉重试,不留不监听的僵尸进程)。
- 诚实边界:initGuard 保护的是**初始化执行**;模块语法/导入期错误仍会崩 —— 这类靠 `pnpm run check` + smoke test 的 a/c 层兜住。

## 基础设施现状(2026-07-02 定型)

- Cloud Run `geo-system` @ asia-northeast1:**1 vCPU / 1Gi / min-instances=1 / CPU always-allocated**(后台 cron 依赖常驻实例;≈$50-55/月)。
- 回退 min-instances:`gcloud run services update geo-system --region asia-northeast1 --min-instances=0`(代价:偶发冷启动 503 + cron 不保底)。
