import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useRole } from "@/hooks/useRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { ClipboardList, Loader2, ArrowLeft, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { toast } from "sonner";
import { STANCE_META, SOURCE_PLATFORM_META } from "@/lib/monitorLabels";

const SENT_COLORS = { positive: "#16a34a", neutral: "#eab308", negative: "#dc2626", unanalyzed: "#94a3b8" };
const THREAT_COLORS: Record<string, string> = { high: "#dc2626", medium: "#f59e0b", low: "#eab308", none: "#94a3b8", unanalyzed: "#cbd5e1" };

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (cur === prev) return <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="h-3 w-3" />持平</span>;
  const up = cur > prev;
  // For negatives/threats "up" is bad → red; callers only use this for那类指标
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${up ? "text-red-600" : "text-emerald-600"}`}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? "+" : "-"}{Math.abs(cur - prev)}
    </span>
  );
}

export default function MonitorReports() {
  const { isAdmin } = useRole();
  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: reports, isLoading } = trpc.monitor.listReports.useQuery({ limit: 60 });
  const activeId = selectedId ?? reports?.[0]?.id ?? null;
  const { data: report, isLoading: detailLoading } = trpc.monitor.getReport.useQuery(
    { id: activeId! },
    { enabled: activeId != null }
  );
  const { data: pushCfg } = trpc.monitor.getReportPushConfig.useQuery();

  const generate = trpc.monitor.generateReport.useMutation({
    onSuccess: (r) => {
      toast.success(`已生成 ${r.reportPeriod} (${r.periodLabel})`);
      utils.monitor.listReports.invalidate();
      utils.monitor.getReport.invalidate();
    },
    onError: (e) => toast.error(`生成失败: ${e.message}`),
  });
  const setPush = trpc.monitor.setReportPushConfig.useMutation({
    onSuccess: () => utils.monitor.getReportPushConfig.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const d = (report?.reportData ?? null) as any;
  const sentimentPie = d
    ? [
        { name: "正面", value: d.overview.sentiment.positive, color: SENT_COLORS.positive },
        { name: "中性", value: d.overview.sentiment.neutral, color: SENT_COLORS.neutral },
        { name: "负面", value: d.overview.sentiment.negative, color: SENT_COLORS.negative },
        { name: "未析", value: d.overview.sentiment.unanalyzed, color: SENT_COLORS.unanalyzed },
      ].filter((x) => x.value > 0)
    : [];
  const domainBars = d ? d.sources.topDomains.map((t: any) => ({ domain: t.domain, 篇数: t.articles, 负面: t.negatives })) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">舆情报告</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            舆情监控周报/月报：文章、信源、威胁、GEO 穿透与成本汇总（与「周报」页的 AI 平台情感周报相互独立）
          </p>
          <Link href="/sentiment-monitor" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mt-1.5">
            <ArrowLeft className="h-4 w-4" /> 返回舆情监控
          </Link>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
              <span className="text-xs text-muted-foreground">生成后推送</span>
              <Switch
                checked={pushCfg?.enabled ?? false}
                disabled={setPush.isPending}
                onCheckedChange={(v) => setPush.mutate({ enabled: v })}
              />
            </div>
            <Button size="sm" variant="outline" disabled={generate.isPending} onClick={() => generate.mutate({ reportType: "weekly" })}>
              {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              生成本周周报
            </Button>
            <Button size="sm" variant="outline" disabled={generate.isPending} onClick={() => generate.mutate({ reportType: "monthly" })}>
              {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              生成本月月报
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        {/* Report list */}
        <Card className="h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">报告列表</CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            {isLoading ? (
              <div className="space-y-2 p-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
            ) : !reports || reports.length === 0 ? (
              <p className="text-sm text-muted-foreground p-3">暂无报告{isAdmin ? ",点右上角生成" : ""}</p>
            ) : (
              <div className="space-y-1">
                {reports.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={`w-full text-left rounded-md px-3 py-2 text-sm hover:bg-muted/60 ${r.id === activeId ? "bg-muted font-medium" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span>{r.reportPeriod}</span>
                      <Badge variant={r.reportType === "weekly" ? "secondary" : "outline"} className="text-[10px]">
                        {r.reportType === "weekly" ? "周报" : "月报"}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {r.generatedAt ? `生成于 ${new Date(r.generatedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detail */}
        <div className="space-y-4 min-w-0">
          {detailLoading || !report ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">{activeId == null ? "暂无报告" : <Loader2 className="h-5 w-5 animate-spin inline" />}</CardContent></Card>
          ) : !d ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">报告数据为空</CardContent></Card>
          ) : (
            <>
              {/* 总览 KPI */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {report.reportType === "weekly" ? "舆情周报" : "舆情月报"} {report.reportPeriod}
                    <span className="text-sm font-normal text-muted-foreground ml-2">{d.periodLabel}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">新增文章</p>
                      <p className="text-2xl font-bold">{d.overview.total}</p>
                      <Delta cur={d.threats.compare.total} prev={d.threats.compare.prevTotal} />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">有效舆情(高+中)</p>
                      <p className="text-2xl font-bold">{d.overview.effective}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">负面</p>
                      <p className="text-2xl font-bold text-red-600">{d.overview.sentiment.negative}</p>
                      <Delta cur={d.threats.compare.negatives} prev={d.threats.compare.prevNegatives} />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">高威胁</p>
                      <p className="text-2xl font-bold text-red-600">{d.threats.compare.highThreat}</p>
                      <Delta cur={d.threats.compare.highThreat} prev={d.threats.compare.prevHighThreat} />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">本期成本</p>
                      <p className="text-2xl font-bold">${d.costs.totalUsd.toFixed(4)}</p>
                      <p className="text-[10px] text-muted-foreground">分析 ${d.costs.analysisUsd.toFixed(4)} · 抓取 ${d.costs.fetchUsd.toFixed(4)}</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-3">
                    环比上期({d.threats.compare.prevPeriodLabel}): 总量 {d.threats.compare.prevTotal} · 负面 {d.threats.compare.prevNegatives} · 高威胁 {d.threats.compare.prevHighThreat}
                    {" · "}来源: {Object.entries(d.overview.bySource).map(([k, v]) => `${(SOURCE_PLATFORM_META as any)[k]?.label || k} ${v}`).join(" / ")}
                  </p>
                </CardContent>
              </Card>

              {/* 情绪饼图 + 信源排行 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">情绪分布（有效舆情 {d.overview.effective} 篇）</CardTitle></CardHeader>
                  <CardContent>
                    {sentimentPie.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">暂无数据</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={260}>
                        <PieChart>
                          <Pie data={sentimentPie} cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2} dataKey="value"
                            label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}>
                            {sentimentPie.map((e, i) => <Cell key={i} fill={e.color} />)}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Top 活跃信源</CardTitle></CardHeader>
                  <CardContent>
                    {domainBars.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">暂无数据</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={domainBars} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                          <YAxis type="category" dataKey="domain" width={130} tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Bar dataKey="篇数" fill="var(--primary)" radius={[0, 4, 4, 0]} />
                          <Bar dataKey="负面" fill="#dc2626" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* 敌对信源 + 新信源 + 穿透 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">敌对信源动态</CardTitle></CardHeader>
                  <CardContent>
                    {d.sources.hostileActivity.length === 0 ? (
                      <p className="text-sm text-muted-foreground">✅ 本期敌对信源无动态</p>
                    ) : (
                      <div className="space-y-1.5">
                        {d.sources.hostileActivity.map((h: any) => (
                          <div key={h.domain} className="flex items-center justify-between text-sm">
                            <span className="font-medium">{h.domain}</span>
                            <span className="text-xs text-muted-foreground">{h.articles} 篇{h.negatives > 0 ? <span className="text-red-600"> · 负面 {h.negatives}</span> : ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {d.sources.newDomains.length > 0 && (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-xs text-muted-foreground mb-1.5">本期新出现信源 ({d.sources.newDomains.length})</p>
                        <div className="flex flex-wrap gap-1">
                          {d.sources.newDomains.slice(0, 15).map((nd: string) => (
                            <span key={nd} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{nd}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">GEO 穿透（本期活跃信源 × AI 引用）</CardTitle></CardHeader>
                  <CardContent>
                    <p className="text-sm mb-2">本期活跃信源中 <span className="font-bold">{d.penetration.citedDomainsCount}</span> 个已被 AI 平台引用</p>
                    {d.penetration.amplified.length > 0 && (
                      <div className="space-y-1.5">
                        {d.penetration.amplified.slice(0, 6).map((a: any) => (
                          <div key={a.domain} className="flex items-center justify-between text-sm">
                            <span className="font-medium">{a.domain}
                              {a.stance === "hostile" && <Badge className="ml-1.5 text-[9px] text-white border-0" style={{ backgroundColor: STANCE_META.hostile.color }}>敌对</Badge>}
                            </span>
                            <span className="text-xs text-muted-foreground">{a.aiPlatforms} 平台/{a.aiCitations} 次{a.negatives > 0 ? <span className="text-red-600"> · 负 {a.negatives}</span> : ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {d.penetration.newlyAmplifiedHostile.length > 0 ? (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-xs text-red-600 font-medium mb-1.5">⚠️ 本期新进入 AI 引用的风险信源</p>
                        {d.penetration.newlyAmplifiedHostile.map((x: any) => (
                          <div key={x.domain} className="text-sm">{x.domain} <span className="text-xs text-muted-foreground">({x.aiPlatforms} 平台)</span></div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground mt-3">本期无新进入 AI 引用的风险信源</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* 威胁/负面清单 */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">需关注清单（高威胁 {d.threats.highThreatList.length} · 负面 Top {d.threats.topNegatives.length}）</CardTitle></CardHeader>
                <CardContent>
                  {d.threats.highThreatList.length === 0 && d.threats.topNegatives.length === 0 ? (
                    <p className="text-sm text-muted-foreground">✅ 本期无高威胁/负面文章</p>
                  ) : (
                    <div className="space-y-1.5">
                      {d.threats.highThreatList.map((t: any, i: number) => (
                        <div key={`h${i}`} className="text-sm flex items-start gap-2">
                          <Badge className="text-[9px] text-white border-0 bg-red-600 shrink-0 mt-0.5">高威胁</Badge>
                          <a className="hover:underline truncate" href={t.url} target="_blank" rel="noreferrer">{t.title || t.url}</a>
                          <span className="text-xs text-muted-foreground shrink-0">{t.domain}</span>
                        </div>
                      ))}
                      {d.threats.topNegatives.map((t: any, i: number) => (
                        <div key={`n${i}`} className="text-sm flex items-start gap-2">
                          <Badge className="text-[9px] text-white border-0 bg-orange-500 shrink-0 mt-0.5">负面 {t.sentimentScore ?? ""}</Badge>
                          <a className="hover:underline truncate" href={t.url} target="_blank" rel="noreferrer">{t.title || t.url}</a>
                          <span className="text-xs text-muted-foreground shrink-0">{t.domain}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 成本 byEngine */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">采集成本明细</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {Object.entries(d.costs.byEngine).map(([engine, v]: [string, any]) => (
                      <div key={engine} className="rounded-lg border px-3 py-2">
                        <p className="text-xs text-muted-foreground">{engine}</p>
                        <p className="text-sm font-semibold">{v.articles} 篇 · ${v.fetchUsd.toFixed(4)}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    DeepSeek 分析 ${d.costs.analysisUsd.toFixed(4)} + 抓取 ${d.costs.fetchUsd.toFixed(4)} = 合计 ${d.costs.totalUsd.toFixed(4)}
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
