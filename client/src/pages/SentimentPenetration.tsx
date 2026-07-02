import { useMemo } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Network, ArrowLeft, ShieldAlert, AlertTriangle, Radar } from "lucide-react";
import { STANCE_META } from "@/lib/monitorLabels";
import { PLATFORM_LABELS, PLATFORM_COLORS } from "@shared/geo-types";

const platLabel = (p: string) => (PLATFORM_LABELS as Record<string, string>)[p] || p;
const platColor = (p: string) => (PLATFORM_COLORS as Record<string, string>)[p] || "#64748b";

const CAT_META: Record<string, { label: string; color: string }> = {
  amplified: { label: "已被 AI 放大", color: "#dc2626" },
  potential: { label: "潜在风险", color: "#f59e0b" },
  cited_neutral: { label: "已引用 · 中立", color: "#0ea5e9" },
  low: { label: "低", color: "#94a3b8" },
};

function PlatformChips({ list, max = 10 }: { list: string[]; max?: number }) {
  const shown = list.slice(0, max);
  const rest = list.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((p) => (
        <span
          key={p}
          className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] text-white"
          style={{ backgroundColor: platColor(p) }}
        >
          {platLabel(p)}
        </span>
      ))}
      {rest > 0 && <span className="text-[10px] text-muted-foreground self-center">+{rest}</span>}
    </div>
  );
}

function KpiCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <span style={{ color }}>{icon}</span>
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <div className="text-2xl font-bold" style={{ color }}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SentimentPenetration() {
  const { data, isLoading } = trpc.monitor.sourcePenetration.useQuery();
  const rows = useMemo(() => (data ?? []).slice().sort((a, b) => b.riskScore - a.riskScore), [data]);

  const amplified = rows.filter((r) => r.category === "amplified");
  const potential = rows.filter((r) => r.category === "potential");
  const penetrated = rows.filter((r) => r.aiPlatforms > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Network className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">信源穿透 · GEO 联动</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            上游舆情信源 × 下游 AI 引用双向关联 —— 哪些舆情源正在被 AI 平台引用、进而影响 AI 对我们的回答
          </p>
        </div>
        <Link
          href="/sentiment-monitor"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> 返回舆情监控
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-14" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard icon={<Network className="h-4 w-4" />} label="已穿透信源(舆情∩AI引用)" value={penetrated.length} color="#0ea5e9" />
            <KpiCard icon={<ShieldAlert className="h-4 w-4" />} label="已被 AI 放大(高危)" value={amplified.length} color="#dc2626" />
            <KpiCard icon={<AlertTriangle className="h-4 w-4" />} label="潜在风险(发负面·未引用)" value={potential.length} color="#f59e0b" />
            <KpiCard icon={<Radar className="h-4 w-4" />} label="监控信源总数" value={rows.length} color="#64748b" />
          </div>

          {/* 已被 AI 放大 */}
          <section>
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-600" /> 已被 AI 放大 —— 敌对/负面信源且已被 AI 引用
            </h2>
            {amplified.length === 0 ? (
              <Card>
                <CardContent className="p-4 text-sm text-muted-foreground">✅ 暂无被 AI 放大的敌对/负面信源</CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {amplified.map((r) => {
                  const stance = r.stance ? STANCE_META[r.stance] : null;
                  return (
                    <Card key={r.domain} className="border-red-200 dark:border-red-900">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="font-semibold text-sm">{r.domain}</span>
                          <div className="flex items-center gap-1">
                            {stance && (
                              <Badge className="text-[10px] text-white border-0" style={{ backgroundColor: stance.color }}>
                                {stance.label}
                                {r.authorityLevel ? ` · 权威${r.authorityLevel}` : ""}
                              </Badge>
                            )}
                            <Badge className="text-[10px] text-white border-0 bg-red-600">危 {r.riskScore}</Badge>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground mb-2">
                          舆情 {r.articles} 篇（负面 {r.negatives} · 高威胁 {r.highThreat}）
                          {" · "}被 <span className="font-semibold text-red-600">{r.aiPlatforms}</span> 个 AI 平台引用 {r.aiCitations} 次
                        </div>
                        <PlatformChips list={r.platformList} />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          {/* 潜在风险 */}
          {potential.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> 潜在风险 —— 正在发负面,但 AI 暂未引用(未来窗口)
              </h2>
              <div className="flex flex-wrap gap-2">
                {potential.map((r) => {
                  const stance = r.stance ? STANCE_META[r.stance] : null;
                  return (
                    <div key={r.domain} className="inline-flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900 px-3 py-1.5 text-xs">
                      <span className="font-medium">{r.domain}</span>
                      <span className="text-muted-foreground">负面 {r.negatives}</span>
                      {stance && (
                        <span className="text-white rounded px-1 py-0.5 text-[10px]" style={{ backgroundColor: stance.color }}>
                          {stance.label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 全量矩阵 */}
          <section>
            <h2 className="text-sm font-semibold mb-2">信源穿透矩阵</h2>
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left font-medium px-4 py-2.5">信源域名</th>
                      <th className="text-right font-medium px-3 py-2.5">舆情(负)</th>
                      <th className="text-right font-medium px-3 py-2.5">AI 平台</th>
                      <th className="text-right font-medium px-3 py-2.5">AI 引用</th>
                      <th className="text-left font-medium px-3 py-2.5">立场</th>
                      <th className="text-left font-medium px-4 py-2.5">风险</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const stance = r.stance ? STANCE_META[r.stance] : null;
                      const cat = CAT_META[r.category];
                      return (
                        <tr key={r.domain} className="border-b last:border-0 hover:bg-muted/40">
                          <td className="px-4 py-2 font-medium">{r.domain}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.articles}
                            {r.negatives > 0 ? <span className="text-red-600"> ({r.negatives})</span> : ""}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.aiPlatforms > 0 ? <span className="font-semibold">{r.aiPlatforms}</span> : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.aiCitations || "—"}</td>
                          <td className="px-3 py-2">
                            {stance ? (
                              <span className="text-white rounded px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: stance.color }}>
                                {stance.label}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <span className="inline-flex items-center gap-1 text-[11px]">
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cat.color }} />
                              {cat.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </section>

          <p className="text-[11px] text-muted-foreground">
            穿透 = 舆情信源域名与 AI 引用域名规范化后匹配(小写/去 www/去端口)。AI 引用数据来自 GEO citations,舆情数据来自监控文章。
          </p>
        </>
      )}
    </div>
  );
}
