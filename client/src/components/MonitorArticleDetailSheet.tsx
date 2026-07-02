import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { Loader2, ChevronDown, ExternalLink } from "lucide-react";
import Markdown from "react-markdown";
import {
  THREAT_META,
  STANCE_META,
  RELEVANCE_LABELS,
  FETCH_ENGINE_LABELS,
  SENTIMENT_MONITOR_COLORS,
} from "@/lib/monitorLabels";
import { PLATFORM_LABELS, PLATFORM_COLORS } from "@shared/geo-types";

const platLabel = (p: string) => (PLATFORM_LABELS as Record<string, string>)[p] || p;
const platColor = (p: string) => (PLATFORM_COLORS as Record<string, string>)[p] || "#64748b";

export default function MonitorArticleDetailSheet({
  articleId,
  open,
  onOpenChange,
}: {
  articleId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: detail, isLoading } = trpc.monitor.getArticle.useQuery(
    { id: articleId! },
    { enabled: !!articleId }
  );
  // Phase 3 GEO 穿透: is this article's source already cited by AI platforms?
  const { data: pen } = trpc.monitor.articlePenetration.useQuery(
    { id: articleId! },
    { enabled: !!articleId && open }
  );
  const [showFullText, setShowFullText] = useState(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="sr-only">
          <SheetTitle>文章详情</SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !detail ? (
          <div className="text-center py-12 text-muted-foreground">未找到数据</div>
        ) : (
          (() => {
            const threat = THREAT_META[detail.threatLevel || "none"];
            const stance = detail.stance ? STANCE_META[detail.stance] : null;
            const score = detail.sentimentScore || 3;
            const matched = Array.isArray(detail.matchedKeywords) ? (detail.matchedKeywords as string[]) : [];
            return (
              <div className="py-5 space-y-4">
                {/* Header */}
                <div className="px-6 pb-4 border-b space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {detail.domain && (
                      <Badge variant="outline" className="text-[10px]">
                        {detail.domain}
                      </Badge>
                    )}
                    {stance && (
                      <Badge className="text-[10px] text-white border-0" style={{ backgroundColor: stance.color }}>
                        {stance.label}
                        {detail.authorityLevel ? ` · 权威${detail.authorityLevel}` : ""}
                      </Badge>
                    )}
                    <Badge className="text-[10px] text-white border-0" style={{ backgroundColor: threat.color }}>
                      {threat.label}
                    </Badge>
                    {detail.relevance && (
                      <Badge variant="secondary" className="text-[10px]">
                        {RELEVANCE_LABELS[detail.relevance]}
                      </Badge>
                    )}
                  </div>
                  <p className="text-base font-semibold leading-relaxed">{detail.title || "(无标题)"}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    {detail.publishedAt && <span>发布 {new Date(detail.publishedAt).toLocaleString("zh-CN")}</span>}
                    {detail.firstSeenAt && <span>· 发现 {new Date(detail.firstSeenAt).toLocaleString("zh-CN")}</span>}
                    <span>· 抓取: {FETCH_ENGINE_LABELS[detail.fetchEngine || ""] || detail.fetchEngine || "—"}</span>
                  </div>
                  <a
                    href={detail.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    原文链接
                  </a>
                </div>

                {/* Analysis */}
                <div className="px-6 space-y-4">
                  <div className="flex items-center gap-5">
                    <div
                      className="h-16 w-16 rounded-full flex items-center justify-center text-white font-bold text-2xl shrink-0 shadow-sm"
                      style={{ backgroundColor: SENTIMENT_MONITOR_COLORS[score] || "#6b7280" }}
                    >
                      {detail.sentimentScore ?? "—"}
                    </div>
                    <div>
                      <p className="font-semibold text-base">情感评分 {detail.sentimentScore ?? "未分析"}/5</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        威胁等级: {threat.label}
                        {detail.relevance ? ` · 相关性: ${RELEVANCE_LABELS[detail.relevance]}` : ""}
                      </p>
                    </div>
                  </div>
                  {detail.relevanceReason && (
                    <div className="rounded-lg border-l-[3px] border-l-primary/40 bg-primary/5 px-4 py-2">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">相关性判定：</span>
                        {detail.relevanceReason}
                      </p>
                    </div>
                  )}
                  {detail.analysisSummary && (
                    <div className="bg-muted/40 rounded-lg px-4 py-3">
                      <p className="text-sm leading-[1.6] whitespace-pre-wrap">{detail.analysisSummary}</p>
                    </div>
                  )}

                  {/* Phase 3: GEO 穿透联动 —— 此信源是否已被 AI 平台引用 */}
                  {pen && (
                    <div
                      className={`rounded-lg border px-4 py-3 ${
                        pen.cited
                          ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/20"
                          : "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-sm font-semibold">GEO 关联 · AI 引用穿透</span>
                        {pen.propagationRisk === "high" && (
                          <Badge className="text-[10px] text-white border-0 bg-red-600">传播风险高</Badge>
                        )}
                        {pen.propagationRisk === "medium" && (
                          <Badge className="text-[10px] text-white border-0 bg-orange-500">传播风险中</Badge>
                        )}
                      </div>
                      {pen.cited ? (
                        <>
                          <p className="text-sm text-red-700 dark:text-red-300">
                            ⚠️ 此信源(<span className="font-medium">{pen.domain}</span>)已被{" "}
                            <span className="font-bold">{pen.aiPlatforms}</span> 个 AI 平台引用,累计 {pen.citationCount} 次
                            {pen.sameDomainArticles > 1 ? ` · 本域舆情 ${pen.sameDomainArticles} 篇` : ""}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {pen.platformList.map((p) => (
                              <span
                                key={p}
                                className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] text-white"
                                style={{ backgroundColor: platColor(p) }}
                              >
                                {platLabel(p)}
                              </span>
                            ))}
                          </div>
                          {pen.questions.length > 0 && (
                            <div className="mt-2.5">
                              <p className="text-[11px] text-muted-foreground mb-1">被引用于以下 AI 回答问题:</p>
                              <ul className="space-y-0.5">
                                {pen.questions.slice(0, 5).map((q, i) => (
                                  <li key={i} className="text-xs text-foreground/80 leading-snug">
                                    · [{platLabel(q.platform)}] {q.questionText}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-emerald-700 dark:text-emerald-300">
                          ✅ 此信源({pen.domain || "—"})暂未被任何 AI 平台引用
                          {pen.domain ? "" : "(无有效域名)"}
                        </p>
                      )}
                    </div>
                  )}
                  {matched.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">命中关键词</p>
                      <div className="flex flex-wrap gap-1.5">
                        {matched.map((k, i) => (
                          <span key={i} className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs">
                            {k}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {detail.costUsd != null && (
                    <p className="text-[11px] text-muted-foreground">
                      分析成本 ${Number(detail.costUsd).toFixed(6)}
                      {detail.promptTokens != null ? ` · ${detail.promptTokens}+${detail.completionTokens} tokens` : ""}
                    </p>
                  )}
                </div>

                {/* 35天保鲜: 正文已被清理的归档文章 */}
                {(detail as any).archived && !detail.contentMd && (
                  <div className="px-6">
                    <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                      📦 正文已归档清理（超 35 天数据保鲜策略）。标题、情感、威胁等分析元数据仍完整保留。
                      {detail.url && (
                        <>
                          {" "}可访问 <a className="text-primary hover:underline" href={detail.url} target="_blank" rel="noreferrer">原文链接</a>。
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Full content (collapsible) */}
                {detail.contentMd && (
                  <div className="px-6">
                    <button
                      type="button"
                      className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full py-2"
                      onClick={() => setShowFullText(!showFullText)}
                    >
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showFullText ? "rotate-180" : ""}`} />
                      抓取正文 ({detail.contentMd.length} 字)
                    </button>
                    {showFullText && (
                      <div className="rounded-lg bg-muted/30 border px-4 py-3 mt-1 max-h-[500px] overflow-y-auto">
                        <div className="prose prose-sm prose-neutral max-w-none dark:prose-invert leading-[1.6]">
                          <Markdown>{detail.contentMd}</Markdown>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()
        )}
      </SheetContent>
    </Sheet>
  );
}
