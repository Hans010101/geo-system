#!/usr/bin/env bash
# =============================================================================
# teardown.sh — 逐个关停/删除你点名的资源,带影响评估 + 省钱估算 + 双重确认
#
# 安全模型:
#   1) 默认 DRY-RUN:不加 --apply 时,只做只读检查、打印影响和将执行的命令,绝不改动。
#   2) 一次只动一个资源。
#   3) 真正执行需要同时:--apply 且 --confirm <token>,token 由资源身份算出(防误删)。
#   4) GitHub 仓库:必须先 github-archive,再 github-delete(未归档拒绝删除)。
#   5) 破坏性删除若检测到仍被其它服务引用,默认拒绝(需 --force 显式覆盖)。
#
# 用法:
#   ./teardown.sh <子命令> [参数...]              # dry-run,打印影响 + 确认码
#   ./teardown.sh <子命令> [参数...] --apply --confirm <token>
#
# 子命令:
#   cloudrun-scale-zero  PROJECT REGION SERVICE       把 min-instances 调 0(停空转计费,保留服务)
#   cloudrun-delete      PROJECT REGION SERVICE       删除 Cloud Run 服务
#   cloudsql-stop        PROJECT INSTANCE             停实例(activation-policy=NEVER,保留数据)
#   cloudsql-delete      PROJECT INSTANCE             删除实例(数据销毁!建议先导出)
#   static-ip-release    PROJECT SCOPE NAME           释放静态 IP(SCOPE=区域名 或 global)
#   forwarding-rule-del  PROJECT SCOPE NAME           删除转发规则(SCOPE=区域名 或 global)
#   vpc-connector-del    PROJECT REGION NAME          删除 VPC 连接器
#   gke-delete           PROJECT LOCFLAG LOC NAME     删除 GKE 集群(LOCFLAG=--region|--zone)
#   artifact-repo-del    PROJECT LOCATION REPO        删除 Artifact Registry 仓库
#   artifact-image-del   PROJECT IMAGE_URI            删除单个镜像(……pkg.dev/…@sha256:… 或 :tag)
#   github-archive       OWNER/REPO                   归档仓库(可逆)
#   github-delete        OWNER/REPO                   删除仓库(要求已归档)
# =============================================================================
set -uo pipefail

c_blue=$'\033[1;34m'; c_yellow=$'\033[1;33m'; c_green=$'\033[1;32m'; c_red=$'\033[1;31m'; c_off=$'\033[0m'
info()  { printf '%s[teardown]%s %s\n' "$c_blue" "$c_off" "$*"; }
warn()  { printf '%s[影响]%s %s\n' "$c_yellow" "$c_off" "$*"; }
good()  { printf '%s[ok]%s %s\n' "$c_green" "$c_off" "$*"; }
err()   { printf '%s[拒绝]%s %s\n' "$c_red" "$c_off" "$*" >&2; }
g()     { gcloud "$@" 2>/dev/null; }

# ---- parse flags -----------------------------------------------------------
APPLY=0; FORCE=0; CONFIRM=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --apply)   APPLY=1; shift;;
    --force)   FORCE=1; shift;;
    --confirm) CONFIRM="${2:-}"; shift 2;;
    *)         ARGS+=("$1"); shift;;
  esac
done
[ "${#ARGS[@]}" -ge 1 ] || { err "缺少子命令。见脚本头部用法。"; exit 1; }
SUB="${ARGS[0]}"; PARAMS=("${ARGS[@]:1}")

have() { command -v "$1" >/dev/null 2>&1; }
have gcloud || { err "缺少 gcloud"; exit 1; }

# token = 资源身份的指纹,防止把命令套到别的资源上
token() { printf '%s' "$SUB ${PARAMS[*]}" | sha256sum | cut -c1-8; }
TOKEN="$(token)"

# 省钱粗估常量(与 audit.sh 一致;list price,粗估)
declare -A SAVE=( [static_ip]=7 [fwd_rule]=18 [vpc_min]=9 [cloudrun_min]=15 [gke_mgmt]=74 )

# 执行闸门:dry-run 打印命令;apply 校验 token 后执行
# 用法: gate "<人类可读savings>" -- gcloud ...mutating cmd...
gate() {
  local savings="$1"; shift; [ "$1" = "--" ] && shift
  echo
  info "将执行: $*"
  [ -n "$savings" ] && good "预计每月省: $savings(粗估,以账单为准)"
  if [ "$APPLY" != 1 ]; then
    echo
    info "${c_yellow}DRY-RUN — 未改动任何东西。${c_off}"
    info "确认无误后执行:  $0 $SUB ${PARAMS[*]} --apply --confirm $TOKEN"
    return 0
  fi
  if [ "$CONFIRM" != "$TOKEN" ]; then
    err "确认码不匹配(需 --confirm $TOKEN)。已中止,未改动。"
    exit 2
  fi
  info "执行中…"
  if "$@"; then good "完成。$savings 已停止计费(若涉及存储,删除后才完全停止)。"
  else err "命令返回非 0,请检查上面输出。"; exit 3; fi
}

need() { [ "${#PARAMS[@]}" -ge "$1" ] || { err "$SUB 参数不足。见用法。"; exit 1; }; }

case "$SUB" in

  cloudrun-scale-zero)
    need 3; P="${PARAMS[0]}"; R="${PARAMS[1]}"; S="${PARAMS[2]}"
    info "资源: Cloud Run 服务 $S ($P/$R) — 调 min-instances=0"
    cur=$(g run services describe "$S" --region="$R" --project="$P" --platform=managed \
          --format='value(spec.template.metadata.annotations["autoscaling.knative.dev/minScale"])')
    warn "当前 min-instances=${cur:-0};调 0 后空闲不再计费,首次请求会有冷启动。服务/URL/流量保持不变。"
    sv=$(( ${cur:-0} * SAVE[cloudrun_min] )); [ "$sv" -lt 1 ] && sv=0
    gate "≈ \$${sv}" -- gcloud run services update "$S" --region="$R" --project="$P" --platform=managed --min-instances=0
    ;;

  cloudrun-delete)
    need 3; P="${PARAMS[0]}"; R="${PARAMS[1]}"; S="${PARAMS[2]}"
    info "资源: 删除 Cloud Run 服务 $S ($P/$R)"
    refs=$(g compute forwarding-rules list --project="$P" --format='value(name,target)' | grep -i "$S" || true)
    [ -n "$refs" ] && warn "有转发规则/LB 可能指向它,删除会让该入口 502:\n$refs" || warn "未发现转发规则直接引用(仍请确认没有 Serverless NEG / 域名映射指向它)。"
    dm=$(g run domain-mappings list --region="$R" --project="$P" --format='value(metadata.name,spec.routeName)' | grep -i "$S" || true)
    [ -n "$dm" ] && warn "存在域名映射: $dm"
    gate "停止该服务全部计费" -- gcloud run services delete "$S" --region="$R" --project="$P" --platform=managed --quiet
    ;;

  cloudsql-stop)
    need 2; P="${PARAMS[0]}"; I="${PARAMS[1]}"
    info "资源: 停止 Cloud SQL 实例 $I ($P)(保留数据,仅停算力)"
    warn "停止后所有连接它的服务(Cloud Run/GKE/App)会连不上数据库。存储仍计费,算力停止。"
    g sql databases list --instance="$I" --project="$P" --format='value(name)' | sed 's/^/   db: /' || true
    gate "实例算力费(存储仍计)" -- gcloud sql instances patch "$I" --project="$P" --activation-policy=NEVER --quiet
    ;;

  cloudsql-delete)
    need 2; P="${PARAMS[0]}"; I="${PARAMS[1]}"
    info "资源: 删除 Cloud SQL 实例 $I ($P) ${c_red}(数据将销毁)${c_off}"
    warn "这会永久删除数据库与自动备份。强烈建议先: gcloud sql export sql $I gs://<bucket>/$I.sql.gz --project=$P"
    rep=$(g sql instances list --project="$P" --filter="masterInstanceName:$I" --format='value(name)' || true)
    [ -n "$rep" ] && warn "存在只读副本,需先删副本: $rep"
    gate "实例算力 + 存储全部费用" -- gcloud sql instances delete "$I" --project="$P" --quiet
    ;;

  static-ip-release)
    need 3; P="${PARAMS[0]}"; SCOPE="${PARAMS[1]}"; N="${PARAMS[2]}"
    info "资源: 释放静态 IP $N ($P/$SCOPE)"
    if [ "$SCOPE" = global ]; then SCOPEFLAG=(--global); else SCOPEFLAG=(--region="$SCOPE"); fi
    users=$(g compute addresses describe "$N" --project="$P" "${SCOPEFLAG[@]}" --format='value(status,users)')
    case "$users" in
      IN_USE*) warn "该 IP 状态 IN_USE,仍被挂载!释放会断开它:$users"; [ "$FORCE" = 1 ] || { err "拒绝释放在用 IP(确需请加 --force)。"; exit 2; };;
      *) warn "状态 RESERVED(未挂载),释放安全。";;
    esac
    gate "≈ \$${SAVE[static_ip]}" -- gcloud compute addresses delete "$N" --project="$P" "${SCOPEFLAG[@]}" --quiet
    ;;

  forwarding-rule-del)
    need 3; P="${PARAMS[0]}"; SCOPE="${PARAMS[1]}"; N="${PARAMS[2]}"
    info "资源: 删除转发规则 $N ($P/$SCOPE)"
    if [ "$SCOPE" = global ]; then SCOPEFLAG=(--global); else SCOPEFLAG=(--region="$SCOPE"); fi
    tgt=$(g compute forwarding-rules describe "$N" --project="$P" "${SCOPEFLAG[@]}" --format='value(target,backendService,IPAddress)')
    warn "这是某个负载均衡的前端;删除后该 IP/域名入口失效。指向: $tgt"
    gate "≈ \$${SAVE[fwd_rule]}" -- gcloud compute forwarding-rules delete "$N" --project="$P" "${SCOPEFLAG[@]}" --quiet
    ;;

  vpc-connector-del)
    need 3; P="${PARAMS[0]}"; R="${PARAMS[1]}"; N="${PARAMS[2]}"
    info "资源: 删除 VPC 连接器 $N ($P/$R)"
    using=$(g run services list --project="$P" --platform=managed \
      --format='value(metadata.name,spec.template.metadata.annotations["run.googleapis.com/vpc-access-connector"])' | grep -i "$N" || true)
    fns=$(g functions list --project="$P" --format='value(name,vpcConnector)' | grep -i "$N" || true)
    if [ -n "$using$fns" ]; then
      warn "以下服务/函数仍在用该连接器,删除会让它们访问 VPC 失败:\n$using\n$fns"
      [ "$FORCE" = 1 ] || { err "拒绝删除在用连接器(确需请加 --force,并先把这些服务改用别的连接器)。"; exit 2; }
    else
      warn "未发现 Cloud Run/Functions 引用它,删除安全。"
    fi
    mi=$(g compute networks vpc-access connectors describe "$N" --region="$R" --project="$P" --format='value(minInstances)')
    sv=$(( ${mi:-2} * SAVE[vpc_min] ))
    gate "≈ \$${sv}" -- gcloud compute networks vpc-access connectors delete "$N" --region="$R" --project="$P" --quiet
    ;;

  gke-delete)
    need 4; P="${PARAMS[0]}"; LF="${PARAMS[1]}"; L="${PARAMS[2]}"; N="${PARAMS[3]}"
    info "资源: 删除 GKE 集群 $N ($P $LF $L)"
    nodes=$(g container clusters describe "$N" "$LF" "$L" --project="$P" --format='value(currentNodeCount)')
    warn "将删除集群及其 ${nodes:-?} 个节点和上面所有工作负载。无法恢复。"
    gate "≈ \$${SAVE[gke_mgmt]} 管理费 + 节点 VM 费" -- gcloud container clusters delete "$N" "$LF" "$L" --project="$P" --quiet
    ;;

  artifact-repo-del)
    need 3; P="${PARAMS[0]}"; L="${PARAMS[1]}"; REPO="${PARAMS[2]}"
    info "资源: 删除 Artifact Registry 仓库 $REPO ($P/$L)"
    path="${L}-docker.pkg.dev/${P}/${REPO}"
    inuse=$(g run services list --project="$P" --platform=managed \
      --format='value(metadata.name,spec.template.spec.containers[0].image)' | grep -i "$path" || true)
    if [ -n "$inuse" ]; then
      warn "以下 Cloud Run 服务的镜像来自该仓库,删除后这些服务无法再扩容/重部署:\n$inuse"
      [ "$FORCE" = 1 ] || { err "拒绝删除在用镜像仓库(确需请加 --force)。"; exit 2; }
    else
      warn "未发现 Cloud Run 服务引用该仓库的镜像,删除较安全。"
    fi
    gate "该仓库存储费" -- gcloud artifacts repositories delete "$REPO" --location="$L" --project="$P" --quiet
    ;;

  artifact-image-del)
    need 2; P="${PARAMS[0]}"; URI="${PARAMS[1]}"
    info "资源: 删除镜像 $URI ($P)"
    warn "删除指定镜像/digest。确保没有运行中的服务正引用此 digest。"
    gate "对应镜像存储费" -- gcloud artifacts docker images delete "$URI" --project="$P" --quiet
    ;;

  github-archive)
    need 1; RP="${PARAMS[0]}"
    have gh || { err "缺少 gh"; exit 1; }
    info "资源: 归档 GitHub 仓库 $RP(可逆,先归档再删是要求的流程)"
    warn "归档后仓库变只读,不影响现有部署/克隆;随时可取消归档。"
    gate "" -- gh repo archive "$RP" --yes
    ;;

  github-delete)
    need 1; RP="${PARAMS[0]}"
    have gh || { err "缺少 gh"; exit 1; }
    info "资源: 删除 GitHub 仓库 $RP ${c_red}(不可恢复)${c_off}"
    arch=$(gh repo view "$RP" --json isArchived --jq .isArchived 2>/dev/null)
    if [ "$arch" != "true" ]; then
      err "$RP 尚未归档。按流程请先: $0 github-archive $RP --apply --confirm <token>"
      exit 2
    fi
    warn "已确认处于归档状态。删除后无法恢复(包括 issues/PR/wiki)。"
    gate "" -- gh repo delete "$RP" --yes
    ;;

  *)
    err "未知子命令: $SUB"; exit 1;;
esac
