import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Activity,
  Link2,
  Target,
  Bell,
  BarChart3,
  Download,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import CollectionDetailSheet from "@/components/CollectionDetailSheet";
import {
  PLATFORM_LABELS,
  PLATFORM_COLORS,
  SEVERITY_LABELS,
  SEVERITY_COLORS,
  BRAND_LINE_LABELS,
  type Platform,
} from "@shared/geo-types";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type TimeRange = "week" | "month" | "quarter";

function getTimeRange(range: TimeRange) {
  const now = Date.now();
  switch (range) {
    case "week":
      return { startTime: now - 7 * 24 * 60 * 60 * 1000, endTime: now };
    case "month":
      return { startTime: now - 28 * 24 * 60 * 60 * 1000, endTime: now };
    case "quarter":
      return { startTime: now - 84 * 24 * 60 * 60 * 1000, endTime: now };
  }
}

const ALERTS_PAGE_SIZE = 5;

const DOMESTIC_PLATFORMS = ["deepseek", "tongyi", "zhipu", "kimi", "doubao", "minimax", "wenxin", "hunyuan"];
const INTERNATIONAL_PLATFORMS = ["chatgpt", "claude", "copilot", "perplexity", "grok", "gemini", "llama"];

export default function Home() {
  const [detailId, setDetailId] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("month");
  const [alertPage, setAlertPage] = useState(0);
  const range = useMemo(() => getTimeRange(timeRange), [timeRange]);

  const { data: summary, isLoading: summaryLoading } = trpc.dashboard.summary.useQuery(range, { staleTime: 30000 });
  const { data: heatmapData } = trpc.dashboard.heatmap.useQuery(range, { staleTime: 30000 });
  const { data: alertsResult } = trpc.alerts.list.useQuery(
    { limit: ALERTS_PAGE_SIZE, offset: alertPage * ALERTS_PAGE_SIZE },
    { staleTime: 10000, placeholderData: keepPreviousData }
  );
  const alertsList = alertsResult?.data;
  const alertsTotal = alertsResult?.total || 0;
  const alertsTotalPages = Math.ceil(alertsTotal / ALERTS_PAGE_SIZE);
  const { data: questionsList } = trpc.questions.list.useQuery({}, { staleTime: 60000 });

  // Collect platforms that actually have data
  const activePlatforms = useMemo(() => {
    if (!summary?.platformBreakdown) return Object.keys(PLATFORM_LABELS) as Platform[];
    return summary.platformBreakdown.map((p) => p.platform as Platform);
  }, [summary]);

  // Build heatmap grouped by brand line
  const heatmapByBrand = useMemo(() => {
    if (!heatmapData || !questionsList) return {};
    const grouped: Record<string, { questionId: string; text: string; scores: Record<string, number> }[]> = {};
    const questionScores: Record<string, Record<string, number>> = {};
    heatmapData.forEach((item) => {
      if (!questionScores[item.questionId]) questionScores[item.questionId] = {};
      questionScores[item.questionId][item.platform] = item.avgScore;
    });
    questionsList.forEach((q) => {
      const brand = q.brandLine;
      if (!grouped[brand]) grouped[brand] = [];
      grouped[brand].push({
        questionId: q.questionId,
        text: q.text.length > 20 ? q.text.slice(0, 20) + "..." : q.text,
        scores: questionScores[q.questionId] || {},
      });
    });
    return grouped;
  }, [heatmapData, questionsList]);

  // CSV export helper
  const exportCsv = useCallback((filename: string, headers: string[], rows: string[][]) => {
    const bom = "\uFEFF";
    const csv = bom + [headers.join(","), ...rows.map(r => r.map(c => `"${String(c || "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${filename}`);
  }, []);

  const handleExportHeatmap = useCallback(() => {
    const headers = ["品牌线", "问题", ...activePlatforms.map(p => PLATFORM_LABELS[p] || p)];
    const rows: string[][] = [];
    Object.entries(heatmapByBrand).forEach(([brand, items]) => {
      items.forEach(item => {
        rows.push([
          BRAND_LINE_LABELS[brand as keyof typeof BRAND_LINE_LABELS] || brand,
          item.text,
          ...activePlatforms.map(p => item.scores[p]?.toFixed(1) || ""),
        ]);
      });
    });
    exportCsv(`情感热力图_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  }, [heatmapByBrand, activePlatforms, exportCsv]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">TRON GEO 系统总览</h1>
          <p className="text-muted-foreground text-sm mt-1">TRON 生成式引擎优化监测系统</p>
        </div>
        <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">本周</SelectItem>
            <SelectItem value="month">最近4周</SelectItem>
            <SelectItem value="quarter">最近12周</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard title="情感均值" value={summary?.overallSentimentAvg?.toFixed(1) || "—"} icon={<Activity className="h-4 w-4" />} loading={summaryLoading} color="text-primary" />
        <KPICard title="友好来源率" value={summary ? `${summary.friendlySourceRate}%` : "—"} icon={<Link2 className="h-4 w-4" />} loading={summaryLoading} color="text-emerald-600" />
        <KPICard title="事实覆盖率" value={summary ? `${summary.targetFactsCoverage}%` : "—"} icon={<Target className="h-4 w-4" />} loading={summaryLoading} color="text-blue-600" />
        <KPICard title="引用命中率" value={summary ? `${summary.ourContentRate}%` : "—"} icon={<BarChart3 className="h-4 w-4" />} loading={summaryLoading} color="text-violet-600" />
        <KPICard title="未读预警" value={summary?.alertCount?.toString() || "0"} icon={<Bell className="h-4 w-4" />} loading={summaryLoading} color="text-orange-600" />
      </div>

      {/* Platform Breakdown — domestic / international split */}
      {summary?.platformBreakdown && summary.platformBreakdown.length > 0 && (() => {
        const breakdownMap = new Map(summary.platformBreakdown.map(p => [p.platform, p]));
        const renderRow = (platforms: string[]) => (
          <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
            {platforms.map((platform) => {
              const p = breakdownMap.get(platform);
              return (
                <div key={platform} className="rounded-lg border p-2.5 text-center space-y-1">
                  <p className="text-[11px] font-semibold text-foreground">
                    {PLATFORM_LABELS[platform as Platform] || platform}
                  </p>
                  <p className="text-2xl font-bold" style={{ color: p && p.sentimentAvg > 0 ? getSentimentColor(p.sentimentAvg) : "#d1d5db" }}>
                    {p && p.sentimentAvg > 0 ? p.sentimentAvg.toFixed(1) : "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{p?.collectionCount || 0} 条</p>
                </div>
              );
            })}
          </div>
        );
        return (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">各平台情感均值</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">国内平台</p>
                {renderRow(DOMESTIC_PLATFORMS)}
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">国际平台</p>
                {renderRow(INTERNATIONAL_PLATFORMS)}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Recent Alerts — paginated */}
      {alertsList && alertsList.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">最新预警</CardTitle>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={alertPage === 0} onClick={() => setAlertPage(p => p - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span>第 {alertPage + 1} / {alertsTotalPages || 1} 页</span>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={alertPage >= alertsTotalPages - 1} onClick={() => setAlertPage(p => p + 1)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {alertsList.map((alert) => {
                const clickable = !!alert.relatedCollectionId;
                return (
                  <div
                    key={alert.id}
                    className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${clickable ? "cursor-pointer hover:bg-muted/50" : ""}`}
                    onClick={clickable ? () => setDetailId(alert.relatedCollectionId) : undefined}
                  >
                    <div className="h-2 w-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: SEVERITY_COLORS[alert.severity] || "#6b7280" }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{alert.title}</p>
                        <Badge variant="outline" className="text-[10px] px-1.5" style={{ color: SEVERITY_COLORS[alert.severity], borderColor: SEVERITY_COLORS[alert.severity] }}>
                          {SEVERITY_LABELS[alert.severity]}
                        </Badge>
                      </div>
                      {alert.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{alert.description}</p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground shrink-0">{new Date(alert.createdAt).toLocaleDateString("zh-CN")}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Heatmap — collapsible by brand line */}
      {Object.keys(heatmapByBrand).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">平台 × 问题 情感热力图</CardTitle>
              <Button variant="outline" size="sm" onClick={handleExportHeatmap}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                导出 CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(heatmapByBrand).map(([brand, items]) => (
                <Collapsible key={brand} defaultOpen={false}>
                  <CollapsibleTrigger className="flex items-center justify-between w-full group rounded-lg hover:bg-muted/50 px-2 py-1.5 transition-colors">
                    <span className="text-sm font-medium text-muted-foreground">
                      {BRAND_LINE_LABELS[brand as keyof typeof BRAND_LINE_LABELS] || brand}
                      <span className="ml-1.5 text-xs font-normal">({items.length} 题)</span>
                    </span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="overflow-x-auto mt-1">
                      <table className="w-full text-xs">
                        <thead>
                          <tr>
                            <th className="text-left p-1.5 font-medium text-muted-foreground min-w-[160px]">问题</th>
                            {activePlatforms.map((p) => (
                              <th key={p} className="text-center p-1.5 font-medium text-muted-foreground min-w-[70px]">
                                {PLATFORM_LABELS[p] || p}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item) => (
                            <tr key={item.questionId} className="border-t border-border/50">
                              <td className="p-1.5 text-foreground">{item.text}</td>
                              {activePlatforms.map((p) => {
                                const score = item.scores[p];
                                return (
                                  <td key={p} className="text-center p-1.5">
                                    {score ? (
                                      <span className="inline-block rounded px-2 py-0.5 font-medium text-white" style={{ backgroundColor: getSentimentColor(score) }}>
                                        {score.toFixed(1)}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground/40">—</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!summaryLoading && summary?.totalCollections === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Activity className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium mb-2">暂无监测数据</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              请先在「采集管理」中触发一次采集，或等待定时采集任务执行。采集完成后，仪表盘将自动展示监测数据。
            </p>
          </CardContent>
        </Card>
      )}

      {/* Collection Detail Sheet */}
      <CollectionDetailSheet
        collectionId={detailId}
        open={detailId !== null}
        onOpenChange={(open) => { if (!open) setDetailId(null); }}
      />
    </div>
  );
}

function KPICard({ title, value, icon, loading, color }: { title: string; value: string; icon: React.ReactNode; loading: boolean; color: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-16" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className={color}>{icon}</span>
              <p className="text-xs font-medium text-muted-foreground">{title}</p>
            </div>
            <p className="text-2xl font-bold">{value}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function getSentimentColor(score: number): string {
  if (score <= 1.5) return "#ef4444";
  if (score <= 2.5) return "#f97316";
  if (score <= 3.5) return "#eab308";
  if (score <= 4.5) return "#22c55e";
  return "#10b981";
}
