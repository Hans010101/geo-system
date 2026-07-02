#!/usr/bin/env bash
# 标准部署脚本: check → build → deploy → 等就绪 → smoke → 失败自动回滚。
# smoke 通过才算部署完成。用法: scripts/deploy.sh
set -euo pipefail

PROJECT="gen-lang-client-0869327408"
REGION="asia-northeast1"
SERVICE="geo-system"
IMAGE="gcr.io/${PROJECT}/${SERVICE}"
URL="https://geo-system-kwm3xu534q-an.a.run.app"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$DIR"

echo "== 1/6 类型检查 =="
pnpm run check

echo "== 2/6 记录当前健康 revision(回滚目标) =="
PREV_REV=$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --format="value(status.latestReadyRevisionName)")
echo "   回滚目标: ${PREV_REV}"

echo "== 3/6 Cloud Build =="
gcloud builds submit --tag "$IMAGE" --project "$PROJECT" --quiet

echo "== 4/6 部署 =="
gcloud run deploy "$SERVICE" --region "$REGION" --image "$IMAGE" --timeout=300 --project "$PROJECT" --quiet
NEW_REV=$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --format="value(status.latestReadyRevisionName)")
echo "   新 revision: ${NEW_REV}"

echo "== 5/6 等 30 秒让 revision 就绪 =="
sleep 30

echo "== 6/6 Smoke test =="
if bash "$DIR/scripts/post-deploy-smoke.sh" "$URL"; then
  echo "== ✅ 部署完成: ${NEW_REV} =="
else
  echo "== ❌ SMOKE FAIL → 自动回滚到 ${PREV_REV} =="
  gcloud run services update-traffic "$SERVICE" --region "$REGION" --project "$PROJECT" \
    --to-revisions="${PREV_REV}=100"
  echo "   已回滚。再次探活:"
  curl -sS -o /dev/null -w "   %{http_code}\n" -m 20 "$URL/" || true
  exit 1
fi
