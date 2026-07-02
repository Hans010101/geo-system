import { useMemo, useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import MonitorArticleDetailSheet from "@/components/MonitorArticleDetailSheet";
import { THREAT_META, STANCE_META, RELEVANCE_LABELS, FETCH_METHOD_LABELS } from "@/lib/monitorLabels";

const PAGE_SIZE = 50;

export default function SentimentMonitor() {
  const { isAdmin } = useRole();
  const utils = trpc.useUtils();
  const [page, setPage] = useState(0);
  const [threat, setThreat] = useState<string>("all");
  const [stance, setStance] = useState<string>("all");
  const [relevance, setRelevance] = useState<string>("all");
  const [range, setRange] = useState<string>("all");
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
      relevance: relevance === "all" ? undefined : (relevance as any),
      startTime,
    };
  }, [page, threat, stance, relevance, range]);

  const { data: stats, isLoading: statsLoading } = trpc.monitor.stats.useQuery();
  const { data: resp, isLoading } = trpc.monitor.listArticles.useQuery(listInput);
  const { data: schedule } = trpc.monitor.getSchedule.useQuery(undefined, {
    refetchInterval: (q) => (q.state.data?.running ? 4000 : false),
  });

  const trigger = trpc.monitor.triggerCycle.useMutation({
    onSuccess: (r) => {
      if (r.running) toast.info(r.message || "已有一轮监控正在运行");
      else if (r.result)
        toast.success(
          `本轮完成：新入库 ${r.result.inserted} 篇（self ${r.result.fetchMethods.self} / firecrawl ${r.result.fetchMethods.firecrawl} / snippet ${r.result.fetchMethods.snippet_only}），成本 $${r.result.costUsd.toFixed(4)}`
        );
      utils.monitor.stats.invalidate();
      utils.monitor.listArticles.invalidate();
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

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterSelect value={threat} onChange={(v) => { setThreat(v); resetPage(); }} placeholder="威胁等级"
          options={[["all", "全部威胁"], ["high", "高威胁"], ["medium", "中威胁"], ["low", "低威胁"], ["none", "无威胁"]]} />
        <FilterSelect value={stance} onChange={(v) => { setStance(v); resetPage(); }} placeholder="信源立场"
          options={[["all", "全部立场"], ["hostile", "敌对"], ["neutral", "中立"], ["friendly", "友好"]]} />
        <FilterSelect value={relevance} onChange={(v) => { setRelevance(v); resetPage(); }} placeholder="相关性"
          options={[["all", "全部相关性"], ["high", "高相关"], ["medium", "中相关"], ["low", "低相关"], ["irrelevant", "无关"]]} />
        <FilterSelect value={range} onChange={(v) => { setRange(v); resetPage(); }} placeholder="时间范围"
          options={[["all", "全部时间"], ["24h", "近 24 小时"], ["7d", "近 7 天"]]} />
      </div>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2.5 text-left font-medium">标题</th>
                <th className="p-2.5 text-left font-medium">信源</th>
                <th className="p-2.5 text-center font-medium">发布</th>
                <th className="p-2.5 text-center font-medium">情感</th>
                <th className="p-2.5 text-center font-medium">威胁</th>
                <th className="p-2.5 text-center font-medium">抓取</th>
                <th className="p-2.5 text-center font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline" /></td></tr>
              ) : articles.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">暂无文章。点击「立即运行一轮」开始监控。</td></tr>
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
                        {FETCH_METHOD_LABELS[a.fetchMethod || ""] || "—"}
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
