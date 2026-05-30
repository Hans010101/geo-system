# GCP / GitHub 历史遗留清理工具

两步走,**删除前一定先 dry-run 确认**。这套脚本要在**你已经登录的环境**里运行(Cloud Shell 或你本机),
因为 Claude 的云端会话碰不到你的 GCP 凭据、也只能看到 `geo-system` 一个仓库。

## 前置条件

```bash
gcloud auth login                       # 账号登录
gcloud auth application-default login   # ADC(部分命令需要)
gh auth login                           # GitHub(盘点全部仓库 + 归档/删除)
# python3 用于分析(Cloud Shell 自带);jq 不需要
```

## 第一步:只读盘点(`audit.sh`)

100% 只读,只跑 `list` / `describe` / `get`,**删不了任何东西**。

```bash
cd ops/cleanup
./audit.sh
```

它会遍历你所有 GCP 项目,盘点这些**持续计费**资源,并产出报表:

- Cloud SQL 实例
- Cloud Run 服务(标出 `min-instances ≥ 1` 的常驻计费项)
- 保留但未挂载的静态 IP(`RESERVED`)
- 负载均衡转发规则(区域 + 全局)
- GKE 集群
- Serverless VPC 连接器
- Artifact Registry 仓库(总占用;`LIST_IMAGES=1` 可逐镜像列旧的)
- GitHub 仓库清单(名称、最后 push、是否归档、大小)
- 用 Cloud Build 触发器把 **仓库 ↔ Cloud Run** 对应起来

输出在 `geo-cleanup-audit/<时间戳>/`:

| 文件 | 内容 |
|---|---|
| `SUMMARY.md` | 人看的汇总表(也会打印到屏幕) |
| `cost-estimate.csv` | 每个项目大概在烧多少钱(粗估) |
| `orphans.csv` | 孤儿 Cloud Run(找不到对应仓库) |
| `stale-repos.csv` | 一年以上没动、且无部署绑定的仓库 |
| `cloudsql.csv` … | 各类资源原始清单 |

**把 `SUMMARY.md` 贴回给 Claude**,可以帮你进一步交叉核对、决定停哪些。

### 可调参数(环境变量)

```bash
PROJECTS="proj-a proj-b" ./audit.sh        # 只看指定项目
REGIONS="us-central1 europe-west1" ./audit.sh   # 只扫这些区域找 VPC 连接器(更快)
STALE_DAYS=365 GITHUB_OWNERS="me my-org" LIST_IMAGES=1 ./audit.sh
```

> ⚠️ **成本是粗估**(list price / us-central1 / 闲置假设),只用来排优先级。
> 要精确数字,请用 [Billing 导出到 BigQuery](https://cloud.google.com/billing/docs/how-to/export-data-bigquery) 后按 service/project 查近 30 天实际花费。

## 第二步:按确认逐个关停(`teardown.sh`)

安全闸门:

1. **默认 dry-run** —— 不加 `--apply` 只打印「影响评估 + 省多少 + 将执行的命令 + 确认码」,不改动。
2. **一次只动一个资源**。
3. 真执行要**同时** `--apply` 和 `--confirm <token>`(token 由资源身份算出,防止误套到别的资源)。
4. **GitHub 先归档再删**:`github-delete` 检测到未归档会拒绝。
5. **仍被引用的资源默认拒删**(如在用的 VPC 连接器、在用的镜像仓库),需 `--force` 显式覆盖。

典型流程:

```bash
# 1) 先 dry-run,看影响和省多少,拿到确认码
./teardown.sh static-ip-release my-proj us-central1 old-lb-ip
#   → [影响] 状态 RESERVED(未挂载),释放安全
#   → [ok] 预计每月省: ≈ $7
#   → DRY-RUN — 未改动。确认执行:  ./teardown.sh static-ip-release my-proj us-central1 old-lb-ip --apply --confirm a1b2c3d4

# 2) 确认无误,带上确认码执行
./teardown.sh static-ip-release my-proj us-central1 old-lb-ip --apply --confirm a1b2c3d4
```

### 子命令速查

| 子命令 | 作用 | 可逆? |
|---|---|---|
| `cloudrun-scale-zero P R SERVICE` | min-instances 调 0(停空转,留服务) | ✅ |
| `cloudrun-delete P R SERVICE` | 删除 Cloud Run 服务 | ❌ |
| `cloudsql-stop P INSTANCE` | 停实例(留数据) | ✅ |
| `cloudsql-delete P INSTANCE` | 删实例(**销毁数据**,建议先 export) | ❌ |
| `static-ip-release P SCOPE NAME` | 释放静态 IP(SCOPE=区域 或 `global`) | ❌ |
| `forwarding-rule-del P SCOPE NAME` | 删转发规则(LB 前端) | ❌ |
| `vpc-connector-del P R NAME` | 删 VPC 连接器(在用则拒删) | ❌ |
| `gke-delete P --region\|--zone L NAME` | 删 GKE 集群 | ❌ |
| `artifact-repo-del P LOCATION REPO` | 删镜像仓库(在用则拒删) | ❌ |
| `artifact-image-del P IMAGE_URI` | 删单个镜像/digest | ❌ |
| `github-archive OWNER/REPO` | 归档仓库 | ✅(可取消归档) |
| `github-delete OWNER/REPO` | 删仓库(要求已归档) | ❌ |

> 「关停」优先用可逆动作(`cloudrun-scale-zero` / `cloudsql-stop`)观察几天再决定是否真删 —— 既省钱又留退路。

## 不在你确认前做任何删除

Claude 不会、也无法从云端会话执行删除。所有破坏性操作都由**你**在本地带 `--apply --confirm` 触发。
