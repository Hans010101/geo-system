import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { SOURCE_TYPE_LABELS, SOURCE_TYPE_COLORS, CONTENT_TYPE_LABELS } from "@shared/geo-types";
import { Link2, ExternalLink, AlertCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type TimeRange = "week" | "month" | "quarter" | "all";

function getTimeRange(range: TimeRange) {
  const now = Date.now();
  switch (range) {
    case "week":
      return { startTime: now - 7 * 24 * 60 * 60 * 1000, endTime: now };
    case "month":
      return { startTime: now - 28 * 24 * 60 * 60 * 1000, endTime: now };
    case "quarter":
      return { startTime: now - 84 * 24 * 60 * 60 * 1000, endTime: now };
    case "all":
      return {};
  }
}

export default function CitationAnalysis() {
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const range = useMemo(() => getTimeRange(timeRange), [timeRange]);

  const { data: topCited } = trpc.citations.top.useQuery({ limit: 20, ...range }, { staleTime: 30000 });
  const { data: domainDist } = trpc.citations.domainDistribution.useQuery(range, { staleTime: 30000 });
  const { data: uncited } = trpc.citations.uncitedContent.useQuery(range, { staleTime: 30000 });

  // CSV export helper
  const exportCsv = (filename: string, headers: string[], rows: string[][]) => {
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
  };

  const handleExportTopCited = () => {
    if (!topCited || topCited.length === 0) return;
    exportCsv(
      `引用源排行_${new Date().toISOString().slice(0, 10)}.csv`,
      ["排名", "URL", "域名", "来源类型", "引用次数", "标题"],
      topCited.map((item, i) => [
        String(i + 1),
        item.url || "",
        item.domain || "",
        SOURCE_TYPE_LABELS[item.sourceType] || item.sourceType || "",
        String(item.citationCount),
        item.title || "",
      ])
    );
  };

  const handleExportDomainDist = () => {
    if (!domainDist || domainDist.length === 0) return;
    exportCsv(
      `域名分布_${new Date().toISOString().slice(0, 10)}.csv`,
      ["域名", "来源类型", "引用次数"],
      domainDist.map((d) => [d.domain || "", SOURCE_TYPE_LABELS[d.sourceType] || d.sourceType, String(d.count)])
    );
  };

  // Aggregate domain distribution by sourceType for pie chart
  const pieData = useMemo(() => {
    if (!domainDist) return [];
    const byType: Record<string, number> = {};
    domainDist.forEach((d) => {
      byType[d.sourceType] = (byType[d.sourceType] || 0) + d.count;
    });
    return Object.entries(byType).map(([type, count]) => ({
      name: SOURCE_TYPE_LABELS[type] || type,
      value: count,
      color: SOURCE_TYPE_COLORS[type] || "#9ca3af",
    }));
  }, [domainDist]);

  // Top domains for bar chart
  const topDomains = useMemo(() => {
    if (!domainDist) return [];
    const byDomain: Record<string, number> = {};
    domainDist.forEach((d) => {
      if (d.domain) byDomain[d.domain] = (byDomain[d.domain] || 0) + d.count;
    });
    return Object.entries(byDomain)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([domain, count]) => ({ domain, count }));
  }, [domainDist]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">引用源分析</h1>
          <p className="text-muted-foreground text-sm mt-1">AI回答中引用来源的统计分析</p>
        </div>
        <div className="flex items-center gap-2">
        <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">本周</SelectItem>
            <SelectItem value="month">最近4周</SelectItem>
            <SelectItem value="quarter">最近12周</SelectItem>
            <SelectItem value="all">全部</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleExportTopCited} disabled={!topCited || topCited.length === 0}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          导出 CSV
        </Button>
        </div>
      </div>

      <Tabs defaultValue="top" className="space-y-4">
        <TabsList>
          <TabsTrigger value="top">引用排行</TabsTrigger>
          <TabsTrigger value="distribution">域名分布</TabsTrigger>
          <TabsTrigger value="uncited">未被引用</TabsTrigger>
        </TabsList>

        <TabsContent value="top" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">被引用最多的来源 Top 20</CardTitle>
            </CardHeader>
            <CardContent>
              {!topCited || topCited.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">暂无引用数据</p>
              ) : (
                <div className="space-y-2">
                  {topCited.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
                    >
                      <span className="text-sm font-bold text-muted-foreground w-6 text-right shrink-0">
                        {i + 1}
                      </span>
                      <div
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: SOURCE_TYPE_COLORS[item.sourceType] || "#9ca3af" }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.title || item.url}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.domain}</p>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {SOURCE_TYPE_LABELS[item.sourceType] || item.sourceType}
                      </Badge>
                      <span className="text-sm font-semibold text-primary shrink-0">
                        {item.citationCount}次
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="distribution" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Source type pie chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">引用源类型分布</CardTitle>
              </CardHeader>
              <CardContent>
                {pieData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">暂无数据</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Domain bar chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">域名引用频次 Top 15</CardTitle>
              </CardHeader>
              <CardContent>
                {topDomains.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">暂无数据</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={topDomains} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis
                        type="category"
                        dataKey="domain"
                        width={120}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip />
                      <Bar dataKey="count" fill="var(--primary)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="uncited" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-orange-500" />
                <CardTitle className="text-base font-semibold">未被AI引用的己方内容</CardTitle>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                这些是已布局但从未被AI平台引用的内容，建议优化其SEO或GEO策略
              </p>
            </CardHeader>
            <CardContent>
              {!uncited || uncited.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  所有己方内容均已被引用，或尚未配置己方URL库
                </p>
              ) : (
                <div className="space-y-2">
                  {uncited.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 rounded-lg border p-3">
                      <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.title || item.url}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.url}</p>
                      </div>
                      {item.contentType && (
                        <Badge variant="outline" className="text-xs shrink-0">
                          {CONTENT_TYPE_LABELS[item.contentType] || item.contentType}
                        </Badge>
                      )}
                      {item.publishPlatform && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {item.publishPlatform}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
