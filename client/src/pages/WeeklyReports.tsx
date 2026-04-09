import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo } from "react";
import { FileBarChart, Download, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PLATFORM_LABELS, SEVERITY_LABELS, SEVERITY_COLORS, type Platform } from "@shared/geo-types";

export default function WeeklyReports() {
  const [selectedWeek, setSelectedWeek] = useState<string>("");
  const { data: reportsList, isLoading } = trpc.weeklyReports.list.useQuery({ limit: 24 });
  const { data: reportDetail } = trpc.weeklyReports.get.useQuery(
    { reportWeek: selectedWeek },
    { enabled: !!selectedWeek }
  );

  const generateMutation = trpc.weeklyReports.generate.useMutation({
    onSuccess: () => {
      toast.success("周报生成成功");
    },
    onError: (err) => {
      toast.error("生成失败: " + err.message);
    },
  });

  const utils = trpc.useUtils();

  const handleGenerate = () => {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
    const weekNum = Math.ceil((days + startOfYear.getDay() + 1) / 7);
    const weekStr = `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;

    generateMutation.mutate(
      { reportWeek: weekStr },
      {
        onSuccess: () => {
          utils.weeklyReports.list.invalidate();
          setSelectedWeek(weekStr);
        },
      }
    );
  };

  const handleExportJSON = () => {
    if (!reportDetail) return;
    const blob = new Blob([JSON.stringify(reportDetail, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `geo-report-${selectedWeek}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    if (!reportDetail) return;
    const summary = reportDetail.summaryMetrics as any;
    const platforms = (reportDetail.platformBreakdown as any[]) || [];

    let csv = "指标,数值\n";
    if (summary) {
      csv += `情感均值,${summary.overallSentimentAvg}\n`;
      csv += `友好来源率,${summary.friendlySourceRate}%\n`;
      csv += `事实覆盖率,${summary.targetFactsCoverage}%\n`;
      csv += `引用命中率,${summary.ourContentRate}%\n`;
      csv += `预警数,${summary.alertCount}\n`;
      csv += "\n平台,情感均值,采集数,引用均值\n";
      platforms.forEach((p: any) => {
        csv += `${PLATFORM_LABELS[p.platform as Platform] || p.platform},${p.sentimentAvg},${p.collectionCount},${p.citationCountAvg}\n`;
      });
    }

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `geo-report-${selectedWeek}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">周报</h1>
          <p className="text-muted-foreground text-sm mt-1">GEO监测周度报告</p>
        </div>
        <Button onClick={handleGenerate} disabled={generateMutation.isPending}>
          {generateMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          生成本周报告
        </Button>
      </div>

      <div className="flex gap-3 items-center">
        <Select value={selectedWeek} onValueChange={setSelectedWeek}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="选择周次..." />
          </SelectTrigger>
          <SelectContent>
            {reportsList?.map((r) => (
              <SelectItem key={r.reportWeek} value={r.reportWeek}>
                {r.reportWeek} ({r.reportPeriod})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedWeek && reportDetail && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExportJSON}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              JSON
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportCSV}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              CSV
            </Button>
          </div>
        )}
      </div>

      {!selectedWeek && (
        <Card>
          <CardContent className="py-12 text-center">
            <FileBarChart className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {reportsList && reportsList.length > 0 ? "请选择一个周次查看报告" : "暂无周报数据"}
            </h3>
            <p className="text-sm text-muted-foreground">
              点击「生成本周报告」按钮创建新的周报
            </p>
          </CardContent>
        </Card>
      )}

      {selectedWeek && reportDetail && (
        <div className="space-y-4">
          {/* Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                {reportDetail.reportWeek} 周报总览
              </CardTitle>
              <p className="text-xs text-muted-foreground">{reportDetail.reportPeriod}</p>
            </CardHeader>
            <CardContent>
              {(() => {
                const summary = reportDetail.summaryMetrics as any;
                if (!summary) return <p className="text-sm text-muted-foreground">无数据</p>;
                return (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <MetricCard label="情感均值" value={summary.overallSentimentAvg?.toFixed(1) || "—"} />
                    <MetricCard label="友好来源率" value={`${summary.friendlySourceRate || 0}%`} />
                    <MetricCard label="事实覆盖率" value={`${summary.targetFactsCoverage || 0}%`} />
                    <MetricCard label="引用命中率" value={`${summary.ourContentRate || 0}%`} />
                    <MetricCard label="预警数" value={summary.alertCount?.toString() || "0"} />
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* Platform breakdown */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">各平台数据</CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const platforms = (reportDetail.platformBreakdown as any[]) || [];
                if (platforms.length === 0) return <p className="text-sm text-muted-foreground">无数据</p>;
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2 font-medium">平台</th>
                          <th className="text-center p-2 font-medium">情感均值</th>
                          <th className="text-center p-2 font-medium">采集数</th>
                          <th className="text-center p-2 font-medium">引用均值</th>
                          <th className="text-left p-2 font-medium">Top域名</th>
                        </tr>
                      </thead>
                      <tbody>
                        {platforms.map((p: any) => (
                          <tr key={p.platform} className="border-b border-border/50">
                            <td className="p-2 font-medium">
                              {PLATFORM_LABELS[p.platform as Platform] || p.platform}
                            </td>
                            <td className="p-2 text-center">{p.sentimentAvg?.toFixed(1) || "—"}</td>
                            <td className="p-2 text-center">{p.collectionCount}</td>
                            <td className="p-2 text-center">{p.citationCountAvg?.toFixed(1) || "—"}</td>
                            <td className="p-2 text-xs text-muted-foreground">
                              {p.topDomains?.map((d: any) => d.domain).join(", ") || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* Alerts summary */}
          {(() => {
            const alertsSummary = (reportDetail.alertsSummary as any[]) || [];
            if (alertsSummary.length === 0) return null;
            return (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">本周预警</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {alertsSummary.map((alert: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                        <div
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: SEVERITY_COLORS[alert.severity] || "#6b7280" }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{alert.title}</p>
                          {alert.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{alert.description}</p>
                          )}
                        </div>
                        <Badge
                          variant="outline"
                          style={{
                            color: SEVERITY_COLORS[alert.severity],
                            borderColor: SEVERITY_COLORS[alert.severity],
                          }}
                        >
                          {SEVERITY_LABELS[alert.severity]}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3 text-center">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
