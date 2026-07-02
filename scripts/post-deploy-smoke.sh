#!/usr/bin/env bash
# 部署后 smoke test —— 挡住"部署成功但运行时出问题"这一类事故。
# 三层检查(按重要性):
#   a. 健康检查: / 和 /api/health 必须 200,且 /api/health 的 bootErrors 必须为空、db:true
#   b. 关键 API 探活: tRPC 只读接口不得返回 5xx/404(公开接口须 200;受保护接口 401 = 路由+中间件正常,即预期)
#   c. 启动异常扫描: 新 revision 5 分钟内不得有 ERROR 级启动异常(is not defined / Cannot read / BOOT-GUARD)
# 用法: scripts/post-deploy-smoke.sh [BASE_URL]   (默认生产地址)
# 退出码: 0=通过, 非0=失败(deploy.sh 据此决定是否回滚)
set -u

BASE_URL="${1:-https://geo-system-kwm3xu534q-an.a.run.app}"
PROJECT="gen-lang-client-0869327408"
REGION="asia-northeast1"
SERVICE="geo-system"
FAIL=0

say() { printf '%s\n' "$*"; }
ok() { say "  ✅ $*"; }
bad() { say "  ❌ $*"; FAIL=1; }

say "== Smoke test @ ${BASE_URL} =="

# ---------- a. 健康检查 ----------
say "[a] 健康检查"
CODE=$(curl -sS -o /dev/null -w "%{http_code}" -m 20 "${BASE_URL}/" || echo 000)
[ "$CODE" = "200" ] && ok "GET / → 200" || bad "GET / → ${CODE} (期望 200)"

HEALTH=$(curl -sS -m 20 "${BASE_URL}/api/health" || echo "")
HCODE=$(curl -sS -o /dev/null -w "%{http_code}" -m 20 "${BASE_URL}/api/health" || echo 000)
if [ "$HCODE" = "200" ] && printf '%s' "$HEALTH" | grep -q '"ok":true'; then
  ok "GET /api/health → 200 ok:true ($(printf '%s' "$HEALTH" | head -c 120))"
else
  bad "GET /api/health → ${HCODE} body=$(printf '%s' "$HEALTH" | head -c 300)"
fi
printf '%s' "$HEALTH" | grep -q '"bootErrors":\[\]' \
  && ok "bootErrors 为空(无启动降级)" \
  || bad "bootErrors 非空 → 有模块初始化失败: $(printf '%s' "$HEALTH" | head -c 300)"
printf '%s' "$HEALTH" | grep -q '"db":true' \
  && ok "db:true(数据库可达)" \
  || bad "db 检查失败"

# ---------- b. 关键 tRPC API 探活 ----------
say "[b] 关键 API 探活(5xx/404=失败; 受保护接口 401=预期)"
check_trpc() { # $1=procedure $2=期望(200|401)
  local url="${BASE_URL}/api/trpc/$1"
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" -m 20 "$url" || echo 000)
  if [ "$code" = "$2" ]; then
    ok "$1 → ${code}(预期)"
  elif [ "$code" -ge 500 ] 2>/dev/null || [ "$code" = "404" ] || [ "$code" = "000" ]; then
    bad "$1 → ${code}(接口坏了)"
  else
    ok "$1 → ${code}(非 5xx/404,可接受)"
  fi
}
check_trpc "auth.me" 200                                    # 公开: 全栈到 tRPC resolver
check_trpc "monitor.listArticles?input=%7B%7D" 401          # 舆情列表(受保护→401=路由正常)
check_trpc "monitor.stats" 401                              # monitor 统计
check_trpc "dashboard.summary" 401                          # GEO 仪表盘/热力图数据
check_trpc "monitor.sourcePenetration?input=%7B%7D" 401     # GEO 穿透

# ---------- c. 启动异常日志扫描(5 分钟窗口) ----------
say "[c] 启动异常扫描(近5分钟 ERROR 日志)"
if command -v gcloud >/dev/null 2>&1; then
  ERRS=$(gcloud logging read \
    "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE} AND severity>=ERROR AND (textPayload:\"is not defined\" OR textPayload:\"Cannot read\" OR textPayload:\"BOOT-GUARD\" OR textPayload:\"Fatal\" OR textPayload:\"Uncaught\")" \
    --project "$PROJECT" --freshness=5m --limit=5 --format="value(timestamp,textPayload)" 2>/dev/null)
  if [ -n "$ERRS" ]; then
    bad "5分钟内有启动类 ERROR 日志:"
    printf '%s\n' "$ERRS" | head -5
  else
    ok "无启动类 ERROR 日志"
  fi
else
  say "  ⚠️  gcloud 不可用,跳过日志扫描(本地/CI 环境可接受)"
fi

# ---------- 结果 ----------
if [ "$FAIL" = "0" ]; then
  say "== ✅ SMOKE PASS =="
  exit 0
else
  say "== ❌ SMOKE FAIL —— 部署不算完成,考虑回滚: =="
  say "   gcloud run services update-traffic ${SERVICE} --region=${REGION} --project=${PROJECT} --to-revisions=<上一健康revision>=100"
  exit 1
fi
