import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { useState, useMemo, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  PLATFORM_LABELS, PLATFORM_COLORS, BRAND_LINE_LABELS, DIMENSION_LABELS,
  SENTIMENT_LABELS, SENTIMENT_COLORS, SOURCE_TYPE_LABELS, SOURCE_TYPE_COLORS,
  TONE_LABELS, type Platform,
} from "@shared/geo-types";
import {
  ThumbsDown, ThumbsUp, AlertTriangle, ExternalLink, CheckCircle, XCircle, Eye, Loader2,
} from "lucide-react";

export default function QuestionDetail() {
  const [, params] = useRoute("/questions/:questionId");
  const [, navigate] = useLocation();
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>(params?.questionId || "");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [detailCollectionId, setDetailCollectionId] = useState<number | null>(null);

  // Sync URL param to state
  useEffect(() => {
    if (params?.questionId && params.questionId !== selectedQuestionId) {
      setSelectedQuestionId(params.questionId);
    }
  }, [params?.questionId]);

  // Sync state to URL
  const handleSelectQuestion = (qId: string) => {
    setSelectedQuestionId(qId);
    if (qId) {
      navigate(`/questions/${qId}`, { replace: true });
    } else {
      navigate("/questions", { replace: true });
    }
  };

  const { data: questionsList } = trpc.questions.list.useQuery({});

  const filteredQuestions = useMemo(() => {
    if (!questionsList) return [];
    if (brandFilter === "all") return questionsList;
    return questionsList.filter((q) => q.brandLine === brandFilter);
  }, [questionsList, brandFilter]);

  const selectedQuestion = questionsList?.find((q) => q.questionId === selectedQuestionId);

  const { data: collectionsData } = trpc.collections.list.useQuery(
    { questionId: selectedQuestionId, limit: 50 },
    { enabled: !!selectedQuestionId }
  );

  const { data: trendData } = trpc.dashboard.sentimentTrend.useQuery(
    { questionId: selectedQuestionId },
    { enabled: !!selectedQuestionId }
  );

  const latestByPlatform = useMemo(() => {
    if (!collectionsData?.data) return {};
    const grouped: Record<string, (typeof collectionsData.data)[0]> = {};
    collectionsData.data.forEach((c) => {
      if (!grouped[c.platform] || c.timestamp > grouped[c.platform].timestamp) {
        grouped[c.platform] = c;
      }
    });
    return grouped;
  }, [collectionsData]);

  const activePlatforms = useMemo(() => {
    return Object.keys(latestByPlatform) as Platform[];
  }, [latestByPlatform]);

  const chartData = useMemo(() => {
    if (!trendData || trendData.length === 0) return [];
    const byTs: Record<number, Record<string, number>> = {};
    trendData.forEach((t) => {
      if (!byTs[t.timestamp]) byTs[t.timestamp] = {};
      if (t.sentimentScore) byTs[t.timestamp][t.platform] = t.sentimentScore;
    });
    return Object.entries(byTs)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([ts, scores]) => ({
        date: new Date(Number(ts)).toLocaleDateString("zh-CN", { month: "short", day: "numeric" }),
        ...scores,
      }));
  }, [trendData]);

  const chartPlatforms = useMemo(() => {
    if (!trendData) return [];
    const set = new Set<string>();
    trendData.forEach((t) => set.add(t.platform));
    return Array.from(set) as Platform[];
  }, [trendData]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">问题详情</h1>
        <p className="text-muted-foreground text-sm mt-1">查看各AI平台对每个问题的回答对比，点击卡片查看完整内容与分析</p>
      </div>

      <div className="flex gap-3 items-center">
        <Select value={brandFilter} onValueChange={setBrandFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="品牌线" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部品牌线</SelectItem>
            <SelectItem value="sun_yuchen">孙宇晨IP线</SelectItem>
            <SelectItem value="tron">波场TRON线</SelectItem>
            <SelectItem value="competitor">竞品对标</SelectItem>
          </SelectContent>
        </Select>

        <Select value={selectedQuestionId} onValueChange={handleSelectQuestion}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="选择问题..." />
          </SelectTrigger>
          <SelectContent>
            {filteredQuestions.map((q) => (
              <SelectItem key={q.questionId} value={q.questionId}>
                {q.text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedQuestionId && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">请从上方选择一个问题查看详情</p>
          </CardContent>
        </Card>
      )}

      {selectedQuestionId && selectedQuestion && (
        <>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">
                  {BRAND_LINE_LABELS[selectedQuestion.brandLine as keyof typeof BRAND_LINE_LABELS]}
                </Badge>
                <Badge variant="outline">
                  {DIMENSION_LABELS[selectedQuestion.dimension as keyof typeof DIMENSION_LABELS]}
                </Badge>
                <Badge variant="outline">{selectedQuestion.language}</Badge>
                <Badge variant={selectedQuestion.status === "active" ? "default" : "secondary"}>
                  {selectedQuestion.status}
                </Badge>
              </div>
              <p className="text-lg font-medium mt-3">{selectedQuestion.text}</p>
            </CardContent>
          </Card>

          {chartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">情感评分历史趋势</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    {chartPlatforms.map((p) => (
                      <Line
                        key={p}
                        type="monotone"
                        dataKey={p}
                        name={PLATFORM_LABELS[p] || p}
                        stroke={PLATFORM_COLORS[p] || "#888"}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {(activePlatforms.length > 0 ? activePlatforms : (Object.keys(PLATFORM_LABELS) as Platform[])).map((platform) => {
              const collection = latestByPlatform[platform];
              return (
                <PlatformResponseCard
                  key={platform}
                  platform={platform}
                  collection={collection}
                  onViewDetail={(id) => setDetailCollectionId(id)}
                />
              );
            })}
          </div>
        </>
      )}

      <CollectionDetailSheet
        collectionId={detailCollectionId}
        onClose={() => setDetailCollectionId(null)}
      />
    </div>
  );
}

/* ==================== Platform Response Card ==================== */
function PlatformResponseCard({
  platform, collection, onViewDetail,
}: {
  platform: Platform;
  collection?: any;
  onViewDetail: (id: number) => void;
}) {
  const { data: detail } = trpc.collections.get.useQuery(
    { id: collection?.id },
    { enabled: !!collection?.id }
  );

  const negPoints = useMemo(() => {
    if (!detail?.analysis) return [];
    return Array.isArray(detail.analysis.negativePoints) ? detail.analysis.negativePoints as string[] : [];
  }, [detail]);

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold" style={{ color: PLATFORM_COLORS[platform] || "#888" }}>
            {PLATFORM_LABELS[platform] || platform}
          </CardTitle>
          {detail?.analysis?.sentimentScore && (
            <Badge
              style={{
                backgroundColor: SENTIMENT_COLORS[detail.analysis.sentimentScore] || "#6b7280",
                color: "white",
              }}
            >
              {detail.analysis.sentimentScore}/5 {SENTIMENT_LABELS[detail.analysis.sentimentScore]}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!collection ? (
          <p className="text-sm text-muted-foreground">暂无采集数据</p>
        ) : collection.status !== "success" ? (
          <p className="text-sm text-muted-foreground">采集状态: {collection.status}</p>
        ) : (
          <div className="space-y-3">
            <ScrollArea className="h-[140px] rounded-md border p-3">
              <p className="text-xs leading-relaxed whitespace-pre-wrap">
                {collection.responseText?.slice(0, 500) || "无回答内容"}
                {collection.responseText && collection.responseText.length > 500 && "..."}
              </p>
            </ScrollArea>

            {/* Negative points preview - highlighted */}
            {negPoints.length > 0 && (
              <div className="rounded border border-destructive/30 bg-destructive/5 p-2">
                <p className="text-xs font-medium text-destructive mb-1 flex items-center gap-1">
                  <ThumbsDown className="h-3 w-3" /> 负面表述 ({negPoints.length})
                </p>
                {negPoints.slice(0, 2).map((p, i) => (
                  <p key={i} className="text-xs text-destructive/80 truncate">• {String(p)}</p>
                ))}
                {negPoints.length > 2 && (
                  <p className="text-[10px] text-destructive/60">还有 {negPoints.length - 2} 条...</p>
                )}
              </div>
            )}

            {detail?.analysis && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">语气:</span>{" "}
                {TONE_LABELS[detail.analysis.overallTone || ""] || detail.analysis.overallTone}
              </p>
            )}

            {detail?.citations && detail.citations.length > 0 && (
              <p className="text-xs text-muted-foreground">
                引用源: {detail.citations.length} 个
              </p>
            )}

            <div className="flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground/60">
                {new Date(collection.timestamp).toLocaleString("zh-CN")}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => onViewDetail(collection.id)}
              >
                <Eye className="h-3 w-3" /> 查看详情
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ==================== Collection Detail Sheet ==================== */
function CollectionDetailSheet({
  collectionId, onClose,
}: {
  collectionId: number | null;
  onClose: () => void;
}) {
  const { data: detail, isLoading } = trpc.collections.get.useQuery(
    { id: collectionId! },
    { enabled: !!collectionId }
  );

  const negPoints = useMemo(() => {
    if (!detail?.analysis) return [];
    return Array.isArray(detail.analysis.negativePoints) ? detail.analysis.negativePoints as string[] : [];
  }, [detail]);
  const posPoints = useMemo(() => {
    if (!detail?.analysis) return [];
    return Array.isArray(detail.analysis.positivePoints) ? detail.analysis.positivePoints as string[] : [];
  }, [detail]);
  const inaccClaims = useMemo(() => {
    if (!detail?.analysis) return [];
    return Array.isArray(detail.analysis.inaccurateClaims) ? detail.analysis.inaccurateClaims as string[] : [];
  }, [detail]);
  const kFacts = useMemo(() => {
    if (!detail?.analysis) return [];
    return Array.isArray(detail.analysis.keyFacts) ? detail.analysis.keyFacts as string[] : [];
  }, [detail]);
  const tFactsCheck = useMemo(() => {
    if (!detail?.analysis?.targetFactsCheck || typeof detail.analysis.targetFactsCheck !== 'object') return {};
    return detail.analysis.targetFactsCheck as Record<string, boolean>;
  }, [detail]);

  return (
    <Sheet open={!!collectionId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base">采集内容详情</SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !detail ? (
          <div className="text-center py-12 text-muted-foreground">未找到数据</div>
        ) : (
          <div className="space-y-5 mt-4">
            {/* Meta */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground text-xs">平台</span>
                <p className="font-medium" style={{ color: PLATFORM_COLORS[detail.platform as Platform] || "#888" }}>
                  {PLATFORM_LABELS[detail.platform as Platform] || detail.platform}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">采集时间</span>
                <p className="font-mono text-xs">{new Date(detail.timestamp).toLocaleString("zh-CN")}</p>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground text-xs">问题</span>
                <p className="font-medium">{detail.questionText}</p>
              </div>
              {detail.modelVersion && (
                <div className="col-span-2">
                  <span className="text-muted-foreground text-xs">模型版本</span>
                  <p className="font-mono text-xs">{detail.modelVersion}</p>
                </div>
              )}
            </div>

            {/* Full response text */}
            <div>
              <h4 className="text-sm font-semibold border-b pb-1 mb-2">完整回答内容</h4>
              <ScrollArea className="max-h-[300px] rounded-lg border p-4">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {detail.responseText || "无回答内容"}
                </p>
              </ScrollArea>
              <p className="text-xs text-muted-foreground mt-1">
                字数: {detail.responseText?.length || 0}
              </p>
            </div>

            {/* AI Analysis */}
            {detail.analysis && (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold border-b pb-1">AI 分析结果</h4>
                <div className="flex items-center gap-3">
                  <div
                    className="h-12 w-12 rounded-lg flex items-center justify-center text-white font-bold text-lg"
                    style={{ backgroundColor: SENTIMENT_COLORS[detail.analysis.sentimentScore || 3] || "#6b7280" }}
                  >
                    {detail.analysis.sentimentScore}
                  </div>
                  <div>
                    <p className="font-medium">
                      {SENTIMENT_LABELS[detail.analysis.sentimentScore || 3]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      语气: {TONE_LABELS[detail.analysis.overallTone || ""] || detail.analysis.overallTone}
                    </p>
                  </div>
                </div>
                {detail.analysis.sentimentReasoning && (
                  <p className="text-sm bg-muted/50 rounded-lg p-3">{detail.analysis.sentimentReasoning}</p>
                )}

                {/* Negative points - highlighted */}
                {negPoints.length > 0 && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                      <ThumbsDown className="h-4 w-4" />
                      负面表述 ({negPoints.length})
                    </div>
                    <ul className="space-y-1">
                      {negPoints.map((point, i) => (
                        <li key={i} className="text-sm flex items-start gap-2">
                          <span className="text-destructive mt-1">•</span>
                          <span>{String(point)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Positive points */}
                {posPoints.length > 0 && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                      <ThumbsUp className="h-4 w-4" />
                      正面表述 ({posPoints.length})
                    </div>
                    <ul className="space-y-1">
                      {posPoints.map((point, i) => (
                        <li key={i} className="text-sm flex items-start gap-2">
                          <span className="text-emerald-600 mt-1">•</span>
                          <span>{String(point)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Inaccurate claims */}
                {inaccClaims.length > 0 && (
                  <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-orange-600">
                      <AlertTriangle className="h-4 w-4" />
                      不准确声明 ({inaccClaims.length})
                    </div>
                    <ul className="space-y-1">
                      {inaccClaims.map((claim, i) => (
                        <li key={i} className="text-sm flex items-start gap-2">
                          <span className="text-orange-600 mt-1">•</span>
                          <span>{String(claim)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Key facts */}
                {kFacts.length > 0 && (
                  <div>
                    <h5 className="text-xs font-medium text-muted-foreground mb-1.5">提到的关键事实</h5>
                    <div className="flex flex-wrap gap-1.5">
                      {kFacts.map((fact, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {String(fact)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Target facts check */}
                {Object.keys(tFactsCheck).length > 0 && (
                  <div>
                    <h5 className="text-xs font-medium text-muted-foreground mb-1.5">目标事实命中</h5>
                    <div className="grid grid-cols-2 gap-1.5">
                      {Object.entries(tFactsCheck).map(([key, hit]) => (
                        <div key={key} className="flex items-center gap-1.5 text-xs">
                          {hit ? (
                            <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-muted-foreground/50" />
                          )}
                          <span className={hit ? "text-foreground" : "text-muted-foreground"}>{key}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Citations */}
            {detail.citations && detail.citations.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold border-b pb-1">引用源 ({detail.citations.length})</h4>
                <div className="space-y-1.5">
                  {detail.citations.map((c: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground w-5 text-right shrink-0">#{c.position}</span>
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: SOURCE_TYPE_COLORS[c.sourceType] || "#9ca3af" }}
                      />
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline truncate flex items-center gap-1"
                      >
                        {c.domain || c.url}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      <Badge variant="outline" className="text-[9px] px-1 shrink-0">
                        {SOURCE_TYPE_LABELS[c.sourceType] || c.sourceType}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
