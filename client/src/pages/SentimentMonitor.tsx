import { useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useRole } from "@/hooks/useRole";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Radar,
  AlertTriangle,
  FileText,
  DollarSign,
  Play,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Network,
} from "lucide-react";
import { toast } from "sonner";
import MonitorArticleDetailSheet from "@/components/MonitorArticleDetailSheet";
import { THREAT_META, STANCE_META, RELEVANCE_LABELS, FETCH_ENGINE_LABELS, SOURCE_PLATFORM_META } from "@/lib/monitorLabels";

const PAGE_SIZE = 50;

export default function SentimentMonitor() {
  const { isAdmin } = useRole();
  const utils = trpc.useUtils();
  const [page, setPage] = useState(0);
  const [threat, setThreat] = useState<string>("all");
  const [stance, setStance] = useState<string>("all");
  const [relevance, setRelevance] = useState<string>("focus"); // default: 高+中 only
  const [range, setRange] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [detailId, setDetailId] = useState<number | null>(null);

  const listInput = useMemo(() => {
    const now = Date.now();
    const startTime =
      range === "24h" ? now - 86_400_000 : range === "7d" ? now - 7 * 86_400_000 : undefined;
    return {
      page,
      pageSize: PAGE_SIZE,
      threatLevel: threat === "all" ? undefined : (threat as any),
      stance: stance === "all" ? undefined : (stance as any),
      ...(relevance === "focus" ? { focus: true } : relevance === "all" ? {} : { relevance: relevance as any }),
      ...(source === "all" ? {} : { sourcePlatform: source }),
      startTime,
    };
  }, [page, threat, stance, relevance, range, source]);

  const { data: stats, isLoading: statsLoading } = trpc.monitor.stats.useQuery();
  const { data: resp, isLoading } = trpc.monitor.listArticles.useQuery(listInput);
  const { data: schedule } = trpc.monitor.getSchedule.useQuery(undefined, {
    refetchInterval: (q) => (q.state.data?.running ? 4000 : false),
  });
  const { data: budget } = trpc.monitor.getBudgetStatus.useQuery();

  const trigger = trpc.monitor.triggerCycle.useMutation({
    onSuccess: (r) => {
      if (r.running) toast.info(r.message || "已有一轮监控正在运行");
      else if (r.result) {
        const ed = r.result.engineDist || {};
        toast.success(
          `本轮完成：新入库 ${r.result.inserted} 篇（自建 ${ed.self || 0} / Firecrawl ${ed.firecrawl || 0} / 摘要 ${ed.snippet || 0}），成本 $${(r.result.fetchCostUsd + r.result.analysisCostUsd).toFixed(4)}${r.result.serperBudgetHit ? "（Serper 护栏触发）" : ""}`
        );
      }
      utils.monitor.stats.invalidate();
      utils.monitor.listArticles.invalidate();
      utils.monitor.getBudgetStatus.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const setSchedule = trpc.monitor.setSchedule.useMutation({
    onSuccess: (r) => {
      utils.monitor.getSchedule.invalidate();
      toast.success(r.enabled ? "定时监控已开启" : "定时监控已关闭");
    },
    onError: (e) => toast.error(e.message),
  });
  const { data: push } = trpc.monitor.getPushConfig.useQuery();
  const savePush = trpc.monitor.setPushConfig.useMutation({
    onSuccess: () => { utils.monitor.getPushConfig.invalidate(); toast.success("推送设置已更新"); },
    onError: (e) => toast.error(e.message),
  });
  const { data: bnCookie } = trpc.monitor.binanceCookieStatus.useQuery();
  const refreshCookie = trpc.monitor.refreshBinanceCookie.useMutation({
    onSuccess: (r) => {
      utils.monitor.binanceCookieStatus.invalidate();
      if (r.ok) toast.success("币安 WAF cookie 已刷新");
      else toast.error("刷新失败(需 Chromium 环境,或用外部脚本刷新): " + (r.error || ""));
    },
    onError: (e) => toast.error(e.message),
  });

  const articles = resp?.data ?? [];
  const total = resp?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const resetPage = () => setPage(0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">舆情监控</h1>
          <p className="text-muted-foreground text-sm mt-1">
            自动发现、抓取、分析涉及孙宇晨 / 波场的新文章（Serper 发现 → 自建/Firecrawl 抓取 → DeepSeek 分析）。
          </p>
          <Link
            href="/sentiment-monitor/penetration"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-1.5"
          >
            <Network className="h-4 w-4" /> 信源穿透 · GEO 引用联动 →
          </Link>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
              <span className="text-xs text-muted-foreground">定时监控</span>
              <Switch
                checked={schedule?.enabled ?? false}
                disabled={setSchedule.isPending}
                onCheckedChange={(v) => setSchedule.mutate({ enabled: v })}
              />
              <span className="text-[11px] text-muted-foreground">{schedule?.cronExpression || "0 9,21 * * *"}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
              <span className="text-xs text-muted-foreground">币安 cookie</span>
              <Badge variant={bnCookie?.valid ? "default" : "secondary"} className={`text-[10px] ${bnCookie?.valid ? "" : "text-orange-600"}`}>
                {bnCookie?.valid ? "有效" : "无效/过期"}
              </Badge>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={refreshCookie.isPending} onClick={() => refreshCookie.mutate()}>
                {refreshCookie.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "刷新"}
              </Button>
            </div>
            <Button
              onClick={() => trigger.mutate()}
              disabled={trigger.isPending || schedule?.running}
              className="gap-1.5"
            >
              {trigger.isPending || schedule?.running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  运行中…
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  立即运行一轮
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="今日新增" value={stats?.todayNew} icon={<FileText className="h-4 w-4" />} color="text-primary" loading={statsLoading} />
        <KPICard title="高威胁文章" value={stats?.highThreat} icon={<AlertTriangle className="h-4 w-4" />} color="text-red-600" loading={statsLoading} />
        <KPICard title="本周文章总数" value={stats?.weekTotal} icon={<Radar className="h-4 w-4" />} color="text-blue-600" loading={statsLoading} />
        <KPICard
          title="本月监控成本"
          value={stats ? `$${stats.monthCostUsd.toFixed(4)}` : undefined}
          icon={<DollarSign className="h-4 w-4" />}
          color="text-emerald-600"
          loading={statsLoading}
        />
      </div>

      {/* Source + engine distribution + cost guardrails */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground mb-3">信源分布(累计)</p>
            {(() => {
              const sd = stats?.sourceDistribution || {};
              const tot = Object.values(sd).reduce((a, b) => a + b, 0) || 1;
              const keys = Object.keys(sd).sort((a, b) => sd[b] - sd[a]);
              if (keys.length === 0) return <p className="text-xs text-muted-foreground">暂无数据</p>;
              return (
                <div className="space-y-2">
                  {keys.map((k) => {
                    const meta = SOURCE_PLATFORM_META[k] || { label: k, color: "#9ca3af" };
                    const n = sd[k];
                    const pct = Math.round((n / tot) * 100);
                    return (
                      <div key={k}>
                        <div className="flex justify-between text-xs mb-0.5"><span>{meta.label}</span><span className="text-muted-foreground">{n} · {pct}%</span></div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: meta.color }} /></div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground mb-3">抓取引擎分布(累计)</p>
            {(() => {
              const ed = stats?.engineDistribution || {};
              const tot = Object.values(ed).reduce((a, b) => a + b, 0) || 1;
              const rows: [string, string, string][] = [
                ["self", "自建 L1(免费)", "#16a34a"],
                ["firecrawl", "Firecrawl L4(付费)", "#ea580c"],
                ["snippet", "仅摘要(抓取失败)", "#9ca3af"],
              ];
              return (
                <div className="space-y-2">
                  {rows.map(([k, label, color]) => {
                    const n = ed[k] || 0;
                    const pct = Math.round((n / tot) * 100);
                    return (
                      <div key={k}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span>{label}</span>
                          <span className="text-muted-foreground">{n} · {pct}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-[11px] text-muted-foreground pt-1">L1 占比越高成本越低;「仅摘要」高 = 反爬站点多,是 L2/L3 引擎候选。</p>
                </div>
              );
            })()}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground mb-3">成本护栏(本月)</p>
            <div className="space-y-2.5">
              <BudgetBar label="Firecrawl credits" used={budget?.firecrawl.used} limit={budget?.firecrawl.limit} />
              <BudgetBar label="Serper 查询" used={budget?.serper.used} limit={budget?.serper.limit} />
              <div className="flex justify-between text-xs pt-2 border-t">
                <span className="text-muted-foreground">本月成本细分</span>
                <span>抓取 ${(stats?.monthFetchCostUsd ?? 0).toFixed(4)} + 分析 ${(stats?.monthAnalysisCostUsd ?? 0).toFixed(4)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Push settings (admin) — channels + silent hours are in 通知设置 (/config/notifications) */}
      {isAdmin && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            <span className="text-sm font-medium">推送设置</span>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={push?.briefingEnabled ?? false} onCheckedChange={(v) => savePush.mutate({ briefingEnabled: v })} />
              定时简报
            </label>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">简报模式</span>
              <Select value={push?.briefingMode || "every"} onValueChange={(v) => savePush.mutate({ briefingMode: v as any })}>
                <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="every">每轮推送</SelectItem>
                  <SelectItem value="negative_only">仅有负面时</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={push?.realtimeEnabled ?? false} onCheckedChange={(v) => savePush.mutate({ realtimeEnabled: v })} />
              高威胁实时预警
            </label>
            <span className="text-[11px] text-muted-foreground ml-auto">推送渠道 &amp; 静默时段在「通知设置」配置</span>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterSelect value={threat} onChange={(v) => { setThreat(v); resetPage(); }} placeholder="威胁等级"
          options={[["all", "全部威胁"], ["high", "高威胁"], ["medium", "中威胁"], ["low", "低威胁"], ["none", "无威胁"]]} />
        <FilterSelect value={stance} onChange={(v) => { setStance(v); resetPage(); }} placeholder="信源立场"
          options={[["all", "全部立场"], ["hostile", "敌对"], ["neutral", "中立"], ["friendly", "友好"]]} />
        <FilterSelect value={relevance} onChange={(v) => { setRelevance(v); resetPage(); }} placeholder="相关性"
          options={[["focus", "重点(高+中)"], ["all", "全部相关性"], ["high", "高相关"], ["medium", "中相关"], ["low", "低相关"], ["irrelevant", "无关"]]} />
        <FilterSelect value={range} onChange={(v) => { setRange(v); resetPage(); }} placeholder="时间范围"
          options={[["all", "全部时间"], ["24h", "近 24 小时"], ["7d", "近 7 天"]]} />
        <FilterSelect value={source} onChange={(v) => { setSource(v); resetPage(); }} placeholder="来源平台"
          options={[["all", "全部来源"], ["web", "Web/新闻"], ["binance_square", "币安广场"]]} />
      </div>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2.5 text-left font-medium">标题</th>
                <th className="p-2.5 text-left font-medium">信源</th>
                <th className="p-2.5 text-center font-medium">来源</th>
                <th className="p-2.5 text-center font-medium">发布</th>
                <th className="p-2.5 text-center font-medium">情感</th>
                <th className="p-2.5 text-center font-medium">威胁</th>
                <th className="p-2.5 text-center font-medium">抓取</th>
                <th className="p-2.5 text-center font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline" /></td></tr>
              ) : articles.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">暂无文章。点击「立即运行一轮」开始监控。</td></tr>
              ) : (
                articles.map((a: any) => {
                  const threatMeta = THREAT_META[a.threatLevel || "none"];
                  const stanceMeta = a.stance ? STANCE_META[a.stance] : null;
                  return (
                    <tr key={a.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setDetailId(a.id)}>
                      <td className="p-2.5 max-w-[340px]">
                        <p className="truncate">{a.title || "(无标题)"}</p>
                        {a.relevance && <span className="text-[10px] text-muted-foreground">{RELEVANCE_LABELS[a.relevance]}</span>}
                      </td>
                      <td className="p-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground truncate max-w-[120px]">{a.domain || "—"}</span>
                          {stanceMeta && (
                            <Badge className="text-[9px] text-white border-0 px-1" style={{ backgroundColor: stanceMeta.color }}>
                              {stanceMeta.label}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-2.5 text-center">
                        {(() => {
                          const m = SOURCE_PLATFORM_META[a.sourcePlatform] || { label: a.sourcePlatform || "—", color: "#9ca3af" };
                          return <Badge className="text-[9px] text-white border-0" style={{ backgroundColor: m.color }}>{m.label}</Badge>;
                        })()}
                      </td>
                      <td className="p-2.5 text-center text-xs text-muted-foreground whitespace-nowrap">
                        {a.publishedAt ? new Date(a.publishedAt).toLocaleDateString("zh-CN") : "—"}
                      </td>
                      <td className="p-2.5 text-center">{a.sentimentScore ?? "—"}</td>
                      <td className="p-2.5 text-center">
                        <Badge className="text-[10px] text-white border-0" style={{ backgroundColor: threatMeta.color }}>
                          {threatMeta.label}
                        </Badge>
                      </td>
                      <td className="p-2.5 text-center text-[11px] text-muted-foreground whitespace-nowrap">
                        {FETCH_ENGINE_LABELS[a.fetchEngine || ""] || "—"}
                      </td>
                      <td className="p-2.5 text-center">
                        <Eye className="h-3.5 w-3.5 text-muted-foreground inline" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
            <span className="text-muted-foreground">共 {total} 篇，第 {page + 1}/{totalPages || 1} 页</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />上一页
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                下一页<ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <MonitorArticleDetailSheet
        articleId={detailId}
        open={detailId !== null}
        onOpenChange={(o) => { if (!o) setDetailId(null); }}
      />
    </div>
  );
}

function KPICard({ title, value, icon, color, loading }: { title: string; value: number | string | undefined; icon: React.ReactNode; color: string; loading: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        {loading ? (
          <div className="space-y-2"><Skeleton className="h-4 w-20" /><Skeleton className="h-8 w-16" /></div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className={color}>{icon}</span>
              <p className="text-xs font-medium text-muted-foreground">{title}</p>
            </div>
            <p className="text-2xl font-bold">{value ?? "—"}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BudgetBar({ label, used, limit }: { label: string; used?: number; limit?: number }) {
  const u = used ?? 0;
  const l = limit ?? 1;
  const pct = Math.min(100, Math.round((u / l) * 100));
  const danger = pct >= 80;
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span>{label}</span>
        <span className={danger ? "text-red-600 font-medium" : "text-muted-foreground"}>{u} / {l}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: danger ? "#dc2626" : "#3b82f6" }} />
      </div>
    </div>
  );
}

function FilterSelect({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: [string, string][] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[140px] h-9 text-xs"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => <SelectItem key={v} value={v} className="text-xs">{label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
