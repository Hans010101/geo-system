#!/usr/bin/env bash
# =============================================================================
# audit.sh — 只读盘点 GCP + GitHub 的历史遗留计费资源
#
# READ-ONLY. 本脚本只调用 list / describe / get,绝不修改或删除任何资源。
# 在你已经登录的环境(Cloud Shell 或你本机)运行。删除请用同目录的 teardown.sh。
#
# 用法:
#   ./audit.sh
#
# 可选环境变量:
#   PROJECTS="a b c"        只盘点这些项目(默认:gcloud projects list 全部)
#   REGIONS="us-central1 …" 只扫这些区域找 VPC 连接器(默认:全部区域,较慢)
#   GITHUB_OWNERS="me org1" GitHub owner 列表(默认:gh 当前登录用户)
#   STALE_DAYS=365          仓库"陈旧"阈值(天)
#   OLD_IMAGE_DAYS=180      镜像"旧"阈值(天)
#   LIST_IMAGES=1           逐个列 Artifact Registry 镜像(慢,默认只看仓库总量)
#   OUTDIR=path             输出目录(默认 geo-cleanup-audit/<时间戳>)
#
# 依赖: gcloud(必需) gh(可选,缺了跳过 GitHub 部分) python3(分析,缺了仅产出原始 CSV)
# =============================================================================
set -uo pipefail

OUTDIR="${OUTDIR:-geo-cleanup-audit/$(date +%Y%m%d-%H%M%S)}"
STALE_DAYS="${STALE_DAYS:-365}"
OLD_IMAGE_DAYS="${OLD_IMAGE_DAYS:-180}"
REGIONS_OVERRIDE="${REGIONS:-}"
GITHUB_OWNERS="${GITHUB_OWNERS:-}"
PROJECTS_OVERRIDE="${PROJECTS:-}"
LIST_IMAGES="${LIST_IMAGES:-0}"

c_blue=$'\033[1;34m'; c_yellow=$'\033[1;33m'; c_green=$'\033[1;32m'; c_red=$'\033[1;31m'; c_off=$'\033[0m'
log()  { printf '%s[audit]%s %s\n' "$c_blue" "$c_off" "$*" >&2; }
warn() { printf '%s[warn]%s  %s\n' "$c_yellow" "$c_off" "$*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

# Run a gcloud read command, swallow errors (disabled APIs / no access), keep going.
g() { gcloud "$@" 2>/dev/null; }

# ---- preflight -------------------------------------------------------------
have gcloud || { printf '%s\n' "${c_red}缺少 gcloud。请先安装并 gcloud auth login。${c_off}" >&2; exit 1; }
if ! g auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  printf '%s\n' "${c_red}gcloud 未登录。请先 gcloud auth login(以及 gcloud auth application-default login)。${c_off}" >&2
  exit 1
fi
HAVE_GH=0; have gh && gh auth status >/dev/null 2>&1 && HAVE_GH=1
[ "$HAVE_GH" = 1 ] || warn "gh 不可用或未登录 → 跳过 GitHub 盘点(仓库清单、孤儿/陈旧分析将不完整)。"
HAVE_PY=0; have python3 && HAVE_PY=1
[ "$HAVE_PY" = 1 ] || warn "python3 不可用 → 只产出原始 CSV,跳过孤儿/陈旧/成本分析。"

mkdir -p "$OUTDIR" "$OUTDIR/triggers"
log "输出目录: $OUTDIR"

# ---- CSV headers -----------------------------------------------------------
echo "project,name,version,tier,disk_gb,availability,region,state"                 > "$OUTDIR/cloudsql.csv"
echo "project,service,region,min_instances,image,cpu,memory"                       > "$OUTDIR/cloudrun.csv"
echo "project,name,address,scope,status,type"                                      > "$OUTDIR/static-ips.csv"
echo "project,name,ip,scope,scheme,target,backend_service"                         > "$OUTDIR/forwarding-rules.csv"
echo "project,name,location,nodes,status,autopilot"                                > "$OUTDIR/gke.csv"
echo "project,region,name,network,state,min_instances,max_instances,machine_type"  > "$OUTDIR/vpc-connectors.csv"
echo "project,repo,format,location,size_bytes,create_time,update_time"             > "$OUTDIR/artifact-registry.csv"
echo "project,trigger,repo_owner,repo_name,repo_uri,deploy_service,deploy_region"  > "$OUTDIR/build-triggers.csv"

# ---- projects --------------------------------------------------------------
if [ -n "$PROJECTS_OVERRIDE" ]; then
  read -r -a PROJECTS <<< "$PROJECTS_OVERRIDE"
else
  mapfile -t PROJECTS < <(g projects list --format='value(projectId)')
fi
[ "${#PROJECTS[@]}" -gt 0 ] || { warn "没找到任何项目(可能权限不足)。"; }
log "共 ${#PROJECTS[@]} 个项目待盘点。"

# ---- per-project collection ------------------------------------------------
for p in "${PROJECTS[@]}"; do
  [ -n "$p" ] || continue
  log "项目 $p …"

  # Cloud SQL 实例(持续计费:实例算力 + 存储 + HA)
  g sql instances list --project="$p" \
    --format='csv[no-heading](name,databaseVersion,settings.tier,settings.dataDiskSizeGb,settings.availabilityType,region,state)' \
    | sed "s/^/$p,/" >> "$OUTDIR/cloudsql.csv"

  # Cloud Run 服务(列出全部,记录 min-instances;>=1 的会被标记为持续计费)
  while IFS=',' read -r svc reg; do
    [ -n "$svc" ] || continue
    desc=$(g run services describe "$svc" --region="$reg" --project="$p" --platform=managed \
      --format='csv[no-heading](spec.template.metadata.annotations["autoscaling.knative.dev/minScale"],spec.template.spec.containers[0].image,spec.template.spec.containers[0].resources.limits.cpu,spec.template.spec.containers[0].resources.limits.memory)')
    IFS=',' read -r minsc img cpu mem <<< "$desc"
    printf '%s,%s,%s,%s,%s,%s,%s\n' "$p" "$svc" "$reg" "${minsc:-0}" "$img" "$cpu" "$mem" >> "$OUTDIR/cloudrun.csv"
  done < <(g run services list --project="$p" --platform=managed \
            --format='csv[no-heading](metadata.name,metadata.labels["cloud.googleapis.com/location"])')

  # 静态 IP — 只要 RESERVED(已保留但未挂载,空转也计费);区域 + 全局
  g compute addresses list --project="$p" --filter='status=RESERVED' \
    --format='csv[no-heading](name,address,region.basename(),status,addressType)' \
    | sed "s/^/$p,/" >> "$OUTDIR/static-ips.csv"
  g compute addresses list --project="$p" --global --filter='status=RESERVED' \
    --format='csv[no-heading](name,address,status,addressType)' \
    | sed "s/^/$p,global,/" >> "$OUTDIR/static-ips.csv"

  # 负载均衡转发规则(区域 + 全局都会列出;region 空 = 全局)
  g compute forwarding-rules list --project="$p" \
    --format='csv[no-heading](name,IPAddress,region.basename(),loadBalancingScheme,target.basename(),backendService.basename())' \
    | awk -F',' -v p="$p" 'BEGIN{OFS=","}{scope=($3==""?"global":$3); print p,$1,$2,scope,$4,$5,$6}' \
    >> "$OUTDIR/forwarding-rules.csv"

  # GKE 集群
  g container clusters list --project="$p" \
    --format='csv[no-heading](name,location,currentNodeCount,status,autopilot.enabled)' \
    | sed "s/^/$p,/" >> "$OUTDIR/gke.csv"

  # Serverless VPC 连接器(按区域查;最小实例常驻计费)
  if [ -n "$REGIONS_OVERRIDE" ]; then
    read -r -a REGS <<< "$REGIONS_OVERRIDE"
  else
    mapfile -t REGS < <(g compute regions list --project="$p" --format='value(name)')
  fi
  for r in "${REGS[@]}"; do
    [ -n "$r" ] || continue
    g compute networks vpc-access connectors list --region="$r" --project="$p" \
      --format='csv[no-heading](name,network.basename(),state,minInstances,maxInstances,machineType)' \
      | sed "s/^/$p,$r,/" >> "$OUTDIR/vpc-connectors.csv"
  done

  # Artifact Registry 仓库(总量 + 时间;镜像明细需 LIST_IMAGES=1)
  while IFS=',' read -r repo fmt loc size ctime utime; do
    [ -n "$repo" ] || continue
    printf '%s,%s,%s,%s,%s,%s,%s\n' "$p" "$repo" "$fmt" "$loc" "${size:-0}" "$ctime" "$utime" >> "$OUTDIR/artifact-registry.csv"
    if [ "$LIST_IMAGES" = 1 ] && [ "$fmt" = "DOCKER" ]; then
      g artifacts docker images list "${loc}-docker.pkg.dev/${p}/${repo}" --include-tags --sort-by=~UPDATE_TIME \
        --format='csv[no-heading](package,version,createTime,updateTime,sizeBytes)' \
        | sed "s|^|$p,$repo,|" >> "$OUTDIR/artifact-images.csv"
    fi
  done < <(g artifacts repositories list --project="$p" \
            --format='csv[no-heading](name.basename(),format,location,sizeBytes,createTime,updateTime)')

  # Cloud Build 触发器(原始 JSON,后续用 python 关联 仓库↔Cloud Run)
  g builds triggers list --project="$p" --format=json > "$OUTDIR/triggers/${p}.json" 2>/dev/null || echo '[]' > "$OUTDIR/triggers/${p}.json"
done

# ---- GitHub repo 清单 ------------------------------------------------------
if [ "$HAVE_GH" = 1 ]; then
  if [ -z "$GITHUB_OWNERS" ]; then
    GITHUB_OWNERS=$(gh api user --jq .login 2>/dev/null)
  fi
  log "GitHub owners: ${GITHUB_OWNERS:-<none>}"
  : > "$OUTDIR/github-repos.ndjson"
  for o in $GITHUB_OWNERS; do
    gh repo list "$o" --limit 4000 \
      --json nameWithOwner,pushedAt,updatedAt,isArchived,diskUsage,visibility,url \
      --jq '.[] | {repo:.nameWithOwner, pushed_at:.pushedAt, archived:.isArchived, disk_kb:.diskUsage, visibility:.visibility, url:.url}' \
      >> "$OUTDIR/github-repos.ndjson" 2>/dev/null \
      || warn "gh repo list $o 失败(权限/owner 名?)"
  done
fi

# ---- 分析 + 报告(python)--------------------------------------------------
if [ "$HAVE_PY" = 1 ]; then
  python3 - "$OUTDIR" "$STALE_DAYS" <<'PYEOF'
import csv, json, glob, os, sys, re, datetime

outdir, stale_days = sys.argv[1], int(sys.argv[2])
now = datetime.datetime.now(datetime.timezone.utc)

# ---- 粗估月成本常量(USD,list price,us-central1;务必以实际账单为准)----
COST = dict(static_ip=7.2, fwd_rule=18.0, vpc_min_inst=9.0, cloudrun_min_inst=15.0, gke_mgmt=74.0)
def sql_cost(tier, disk_gb, ha):
    t=(tier or '').lower()
    base = (9 if 'f1-micro' in t else 27 if 'g1-small' in t else
            52 if re.search(r'custom-1-|standard-1\b|n1-standard-1', t) else
            100 if re.search(r'custom-2-|standard-2|n1-standard-2', t) else
            200 if re.search(r'custom-4-|standard-4|n1-standard-4', t) else 50)
    try: storage = float(disk_gb or 0)*0.17
    except: storage = 0.0
    mult = 2 if (ha or '').upper()=='REGIONAL' else 1
    return round(base*mult + storage, 1)
def ar_cost(size_bytes):
    try: gb=float(size_bytes or 0)/1e9
    except: gb=0.0
    return round(max(0.0, gb-0.5)*0.10, 2)

def rows(name):
    p=os.path.join(outdir,name)
    if not os.path.exists(p): return []
    with open(p, newline='') as f: return list(csv.DictReader(f))

sql, run, ips, fwd, gke, vpc, ar = (rows(x) for x in
  ['cloudsql.csv','cloudrun.csv','static-ips.csv','forwarding-rules.csv','gke.csv','vpc-connectors.csv','artifact-registry.csv'])

# ---- GitHub 仓库 ----
repos=[]
gh=os.path.join(outdir,'github-repos.ndjson')
if os.path.exists(gh):
    for line in open(gh):
        line=line.strip()
        if line:
            try: repos.append(json.loads(line))
            except: pass

# ---- Cloud Build 触发器 → 仓库↔服务 ----
def norm(s):
    s=(s or '').lower()
    s=re.sub(r'[^a-z0-9]','',s)
    for suf in ['prod','production','staging','stage','dev','development','svc','service','api','web','app','backend','frontend','server','master','main']:
        if s.endswith(suf) and len(s)>len(suf)+2: s=s[:-len(suf)]
    return s

trig_rows=[]            # build-triggers.csv
trig_repo_to_svc={}     # repo(normalized) -> set(services)
trig_repos=set()        # repos referenced by any trigger (owner/name lower)
trig_service_bound=set()# services that some trigger deploys
for tf in glob.glob(os.path.join(outdir,'triggers','*.json')):
    proj=os.path.splitext(os.path.basename(tf))[0]
    try: data=json.load(open(tf))
    except: data=[]
    for t in data or []:
        name=t.get('name','')
        owner=name_=uri=''
        gh_=t.get('github') or {}
        if gh_: owner=gh_.get('owner',''); name_=gh_.get('name','')
        rt=t.get('triggerTemplate') or {}
        if not name_ and rt.get('repoName'):
            rn=rt['repoName']; uri=rn
            m=re.match(r'(?:github[_-])?([^_/]+)[_/](.+)', rn)
            if m: owner,name_=m.group(1),m.group(2)
        stb=t.get('sourceToBuild') or {}
        if stb.get('uri'):
            uri=stb['uri']
            m=re.search(r'github\.com[:/]+([^/]+)/([^/.]+)', uri)
            if m: owner,name_=m.group(1),m.group(2)
        rec=t.get('repositoryEventConfig') or {}
        if rec.get('repository') and not name_:
            uri=rec['repository'];
            m=re.search(r'/([^/]+)/repositories/([^/]+)$', uri)
            if m: owner,name_=m.group(1),m.group(2)
        # deploy 目标推断: substitutions 或 build steps 里的 `run deploy`
        subs=t.get('substitutions') or {}
        svc=subs.get('_SERVICE_NAME') or subs.get('_SERVICE') or subs.get('_CLOUD_RUN_SERVICE') or ''
        region=subs.get('_DEPLOY_REGION') or subs.get('_REGION') or subs.get('_SERVICE_REGION') or ''
        build=t.get('build') or {}
        for st in build.get('steps',[]) or []:
            args=st.get('args',[]) or []
            joined=' '.join(args)
            if 'run' in args and 'deploy' in args:
                try:
                    i=args.index('deploy')
                    if i+1<len(args) and not args[i+1].startswith('-'): svc=svc or args[i+1]
                except: pass
            m=re.search(r'--region[ =]([\w-]+)', joined)
            if m: region=region or m.group(1)
        if not name_ and not svc:
            continue
        trig_rows.append([proj,name,owner,name_,uri,svc,region])
        if owner and name_: trig_repos.add(f"{owner}/{name_}".lower())
        if svc:
            trig_service_bound.add(norm(svc))
            if name_: trig_repo_to_svc.setdefault(norm(name_),set()).add(svc)

with open(os.path.join(outdir,'build-triggers.csv'),'w',newline='') as f:
    w=csv.writer(f); w.writerow(['project','trigger','repo_owner','repo_name','repo_uri','deploy_service','deploy_region'])
    w.writerows(trig_rows)

# ---- 孤儿 Cloud Run:已部署但找不到对应仓库 ----
repo_norms={norm(r['repo'].split('/')[-1]) for r in repos}
repo_full={r['repo'].lower() for r in repos}
def repo_matches_service(svc):
    n=norm(svc)
    if n in trig_service_bound: return True
    for rn in repo_norms:
        if rn and (rn==n or (len(rn)>=4 and (rn in n or n in rn))): return True
    return False

orphans=[]
for s in run:
    svc=s['service']
    bound = (norm(svc) in trig_service_bound) or repo_matches_service(svc)
    if not bound:
        reason='无 Cloud Build 触发器部署它,且没有同名 GitHub 仓库' if repos else '无触发器绑定(GitHub 数据缺失,无法核对仓库)'
        orphans.append([s['project'],svc,s['region'],s['min_instances'],s['image'],reason])
with open(os.path.join(outdir,'orphans.csv'),'w',newline='') as f:
    w=csv.writer(f); w.writerow(['project','service','region','min_instances','image','reason']); w.writerows(orphans)

# ---- 陈旧且无部署绑定的仓库:>STALE_DAYS 没 push、未归档、无触发器/无对应服务 ----
deployed_service_norms={norm(s['service']) for s in run}
stale=[]
for r in repos:
    if r.get('archived'): continue
    pa=r.get('pushed_at')
    if not pa: continue
    try: dt=datetime.datetime.fromisoformat(pa.replace('Z','+00:00'))
    except: continue
    age=(now-dt).days
    if age < stale_days: continue
    rn=norm(r['repo'].split('/')[-1])
    bound = (r['repo'].lower() in trig_repos) or (rn in trig_repo_to_svc) or (rn in deployed_service_norms)
    if not bound:
        stale.append([r['repo'], pa, age, round(float(r.get('disk_kb',0))/1024,1)])
stale.sort(key=lambda x:-x[2])
with open(os.path.join(outdir,'stale-repos.csv'),'w',newline='') as f:
    w=csv.writer(f); w.writerow(['repo','pushed_at','age_days','disk_mb']); w.writerows(stale)

# ---- 每项目成本粗估 ----
proj_cost={}; proj_break={}
def add(p,amt,label):
    proj_cost[p]=proj_cost.get(p,0)+amt
    proj_break.setdefault(p,{}); proj_break[p][label]=proj_break[p].get(label,0)+amt
for r in sql: add(r['project'], sql_cost(r['tier'],r['disk_gb'],r['availability']), 'CloudSQL')
for r in run:
    try: mi=int(float(r['min_instances'] or 0))
    except: mi=0
    if mi>=1: add(r['project'], COST['cloudrun_min_inst']*mi, 'CloudRun(min>=1)')
for r in ips: add(r['project'], COST['static_ip'], '闲置静态IP')
for r in fwd: add(r['project'], COST['fwd_rule'], '转发规则')
for r in gke: add(r['project'], COST['gke_mgmt'], 'GKE管理费')
for r in vpc:
    try: mi=int(float(r['min_instances'] or 2))
    except: mi=2
    add(r['project'], COST['vpc_min_inst']*max(mi,2), 'VPC连接器')
for r in ar:
    c=ar_cost(r['size_bytes'])
    if c>0: add(r['project'], c, 'ArtifactRegistry存储')
with open(os.path.join(outdir,'cost-estimate.csv'),'w',newline='') as f:
    w=csv.writer(f); w.writerow(['project','monthly_estimate_usd','breakdown'])
    for p in sorted(proj_cost, key=lambda x:-proj_cost[x]):
        br='; '.join(f"{k}=${v:.0f}" for k,v in sorted(proj_break[p].items(), key=lambda x:-x[1]))
        w.writerow([p, round(proj_cost[p],1), br])

# ---- SUMMARY.md ----
def md_table(headers, rows_):
    out=['| '+' | '.join(headers)+' |', '|'+'|'.join(['---']*len(headers))+'|']
    for r in rows_: out.append('| '+' | '.join(str(x) for x in r)+' |')
    return '\n'.join(out)

S=[]
S.append(f"# GCP / GitHub 历史遗留盘点 (只读)\n")
S.append(f"_生成时间: {now.isoformat(timespec='seconds')} · 陈旧阈值: {stale_days} 天_\n")
S.append("> ⚠️ 成本为**粗估**(list price / us-central1 / 闲置假设),仅用于排序优先级,**请以实际账单或 Billing 导出为准**。\n")

S.append("## 1) 每个项目大概在烧什么钱 (月 · 粗估)\n")
if proj_cost:
    S.append(md_table(['项目','月成本估算(USD)','构成'],
        [[p, f"${proj_cost[p]:.0f}", '; '.join(f'{k}=${v:.0f}' for k,v in sorted(proj_break[p].items(),key=lambda x:-x[1]))]
         for p in sorted(proj_cost,key=lambda x:-proj_cost[x])]))
else:
    S.append("_未发现计费资源,或权限不足。_")
S.append("")

S.append("## 2) 持续计费资源清单\n")
S.append(f"- Cloud SQL 实例: **{len(sql)}**")
runmin=[r for r in run if (r['min_instances'] or '0') not in ('0','') ]
S.append(f"- Cloud Run 服务: **{len(run)}**(其中 min-instances≥1 持续计费: **{len(runmin)}**)")
S.append(f"- 闲置静态 IP (RESERVED): **{len(ips)}**")
S.append(f"- 负载均衡转发规则: **{len(fwd)}**")
S.append(f"- GKE 集群: **{len(gke)}**")
S.append(f"- Serverless VPC 连接器: **{len(vpc)}**")
S.append(f"- Artifact Registry 仓库: **{len(ar)}**(总占用 {sum(float(r.get('size_bytes',0) or 0) for r in ar)/1e9:.2f} GB)")
S.append("\n详见同目录各 CSV。min-instances≥1 的 Cloud Run:")
if runmin:
    S.append(md_table(['项目','服务','区域','min','镜像'],
        [[r['project'],r['service'],r['region'],r['min_instances'],(r['image'] or '')[:50]] for r in runmin]))
S.append("")

S.append("## 3) 孤儿 Cloud Run 服务(找不到对应仓库)\n")
if orphans:
    S.append(md_table(['项目','服务','区域','min','原因'],
        [[o[0],o[1],o[2],o[3],o[5]] for o in orphans]))
else:
    S.append("_无,或 GitHub 数据缺失无法判定。_")
S.append("")

S.append(f"## 4) 一年以上没动且无部署绑定的仓库 (>{stale_days} 天)\n")
if stale:
    S.append(md_table(['仓库','最后 push','闲置天数','大小(MB)'], [[s[0],s[1][:10],s[2],s[3]] for s in stale]))
else:
    S.append("_无,或 GitHub 数据缺失。_")
S.append("")

S.append("## 下一步\n")
S.append("挑出你要处理的资源,逐个用 `teardown.sh` 预演(默认 dry-run,会先算影响和省多少),确认无误再加 `--apply` + 确认码执行。GitHub 仓库先 `github-archive` 再 `github-delete`。\n")

open(os.path.join(outdir,'SUMMARY.md'),'w').write('\n'.join(S))
print('\n'.join(S))
print(f"\n[analysis] 详细文件已写入: {outdir}", file=sys.stderr)
PYEOF
else
  log "已产出原始 CSV(未做分析): $OUTDIR"
fi

log "完成。把 $OUTDIR/SUMMARY.md(或各 CSV)贴回来,我可以帮你进一步交叉核对孤儿/陈旧清单与停哪些。"
