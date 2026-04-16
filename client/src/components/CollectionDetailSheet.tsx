import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useState } from "react";
import {
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import Markdown from "react-markdown";
import {
  PLATFORM_LABELS,
  PLATFORM_COLORS,
  SENTIMENT_LABELS,
  SENTIMENT_COLORS,
  SOURCE_TYPE_LABELS,
  SOURCE_TYPE_COLORS,
  TONE_LABELS,
  type Platform,
} from "@shared/geo-types";
import { useRole } from "@/hooks/useRole";

export default function CollectionDetailSheet({
  collectionId,
  open,
  onOpenChange,
}: {
  collectionId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { canEdit } = useRole();
  const utils = trpc.useUtils();
  const { data: detail, isLoading } = trpc.collections.get.useQuery(
    { id: collectionId! },
    { enabled: !!collectionId }
  );
  const [showFullText, setShowFullText] = useState(false);
  const reanalyzeMutation = trpc.collections.reanalyze.useMutation({
    onSuccess: () => {
      utils.collections.get.invalidate({ id: collectionId! });
      toast.success("重新分析完成");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="sr-only">
          <SheetTitle>采集详情</SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !detail ? (
          <div className="text-center py-12 text-muted-foreground">未找到数据</div>
        ) : (
          <div className="py-5 space-y-4">
            {/* Header */}
            <div className="px-6 pb-4 border-b space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold">{PLATFORM_LABELS[detail.platform as Platform] || detail.platform}</span>
                <Badge className="text-[10px] text-white border-0" style={{ backgroundColor: PLATFORM_COLORS[detail.platform as Platform] || "#6b7280" }}>
                  {detail.platform}
                </Badge>
                <Badge variant={detail.status === "success" ? "default" : "destructive"} className="text-[10px]">
                  {detail.status}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{new Date(detail.timestamp).toLocaleString("zh-CN")}</span>
                {detail.modelVersion && (
                  <>
                    <span>·</span>
                    <span className="font-mono bg-muted/60 px-1.5 py-0.5 rounded">{detail.modelVersion}</span>
                  </>
                )}
              </div>
              <p className="text-sm leading-relaxed mt-1">{detail.questionText}</p>
            </div>

            {/* Analysis */}
            {detail.analysis && (() => {
              const a = detail.analysis;
              const score = a.sentimentScore || 3;
              const negPoints = Array.isArray(a.negativePoints) ? a.negativePoints as string[] : [];
              const posPoints = Array.isArray(a.positivePoints) ? a.positivePoints as string[] : [];
              const inaccClaims = Array.isArray(a.inaccurateClaims) ? a.inaccurateClaims as string[] : [];
              const kFacts = Array.isArray(a.keyFacts) ? a.keyFacts as string[] : [];
              const tFactsCheck = (a.targetFactsCheck && typeof a.targetFactsCheck === 'object') ? a.targetFactsCheck as Record<string, boolean> : {};
              return (
              <div className="px-6 space-y-4">
                <div className="flex items-center gap-5">
                  <div className="h-16 w-16 rounded-full flex items-center justify-center text-white font-bold text-2xl shrink-0 shadow-sm" style={{ backgroundColor: SENTIMENT_COLORS[score] || "#6b7280" }}>
                    {score}
                  </div>
                  <div>
                    <p className="font-semibold text-base">{SENTIMENT_LABELS[score]}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">语气: {TONE_LABELS[a.overallTone || ""] || a.overallTone}</p>
                  </div>
                </div>
                {a.sentimentReasoning && (
                  <div className="bg-muted/40 rounded-lg px-4 py-3">
                    <p className="text-sm leading-[1.6]">{a.sentimentReasoning}</p>
                  </div>
                )}
                {negPoints.length > 0 && (
                  <div className="rounded-lg border-l-[3px] border-l-destructive bg-destructive/5 px-4 py-3 space-y-2">
                    <p className="text-sm font-medium text-destructive flex items-center gap-1.5"><ThumbsDown className="h-3.5 w-3.5" /> 负面表述 ({negPoints.length})</p>
                    <ul className="space-y-1">{negPoints.map((p, i) => (<li key={i} className="text-sm leading-[1.6] flex items-start gap-2"><span className="mt-1.5 shrink-0 h-1.5 w-1.5 rounded-full bg-destructive/50" /><span>{String(p)}</span></li>))}</ul>
                  </div>
                )}
                {posPoints.length > 0 && (
                  <div className="rounded-lg border-l-[3px] border-l-emerald-500 bg-emerald-500/5 px-4 py-3 space-y-2">
                    <p className="text-sm font-medium text-emerald-600 flex items-center gap-1.5"><ThumbsUp className="h-3.5 w-3.5" /> 正面表述 ({posPoints.length})</p>
                    <ul className="space-y-1">{posPoints.map((p, i) => (<li key={i} className="text-sm leading-[1.6] flex items-start gap-2"><span className="mt-1.5 shrink-0 h-1.5 w-1.5 rounded-full bg-emerald-500/50" /><span>{String(p)}</span></li>))}</ul>
                  </div>
                )}
                {inaccClaims.length > 0 && (
                  <div className="rounded-lg border-l-[3px] border-l-orange-500 bg-orange-500/5 px-4 py-3 space-y-2">
                    <p className="text-sm font-medium text-orange-600 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> 不准确声明 ({inaccClaims.length})</p>
                    <ul className="space-y-1">{inaccClaims.map((c, i) => (<li key={i} className="text-sm leading-[1.6] flex items-start gap-2"><span className="mt-1.5 shrink-0 h-1.5 w-1.5 rounded-full bg-orange-500/50" /><span>{String(c)}</span></li>))}</ul>
                  </div>
                )}
                {kFacts.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">提到的关键事实</p>
                    <div className="flex flex-wrap gap-1.5">{kFacts.map((f, i) => (<span key={i} className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs">{String(f)}</span>))}</div>
                  </div>
                )}
                {Object.keys(tFactsCheck).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">目标事实命中</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {Object.entries(tFactsCheck).map(([key, hit]) => (
                        <div key={key} className="flex items-center gap-1.5 text-xs py-0.5">
                          {hit ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-destructive/40 shrink-0" />}
                          <span className={hit ? "text-foreground" : "text-muted-foreground"}>{key}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );})()}

            {/* No analysis / Reanalyze */}
            {!detail.analysis && detail.status === "success" && (
              <div className="px-6">
                <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-4 text-center space-y-2">
                  <p className="text-sm text-muted-foreground">此采集尚无 AI 分析结果</p>
                  {canEdit && (
                    <Button size="sm" variant="outline" disabled={reanalyzeMutation.isPending} onClick={() => reanalyzeMutation.mutate({ id: detail.id })}>
                      {reanalyzeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                      重新分析
                    </Button>
                  )}
                </div>
              </div>
            )}
            {detail.analysis && canEdit && (
              <div className="px-6 flex justify-end">
                <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" disabled={reanalyzeMutation.isPending} onClick={() => reanalyzeMutation.mutate({ id: detail.id })}>
                  {reanalyzeMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                  重新分析
                </Button>
              </div>
            )}

            {/* Citations */}
            {detail.citations && detail.citations.length > 0 && (
              <div className="px-6 space-y-3">
                <p className="text-xs font-medium text-muted-foreground">引用源 ({detail.citations.length})</p>
                <div className="space-y-1.5">
                  {detail.citations.map((c: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs rounded-lg border px-3 py-2">
                      <span className="text-muted-foreground w-5 text-center shrink-0">#{c.position}</span>
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: SOURCE_TYPE_COLORS[c.sourceType] || "#9ca3af" }} />
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate flex-1">{c.title || c.domain || c.url}</a>
                      <Badge variant="outline" className="text-[9px] px-1 shrink-0">{SOURCE_TYPE_LABELS[c.sourceType] || c.sourceType}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Full response (collapsible) */}
            <div className="px-6">
              <button type="button" className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full py-2" onClick={() => setShowFullText(!showFullText)}>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showFullText ? "rotate-180" : ""}`} />
                完整回答原文 {detail.responseLength ? `(${detail.responseLength} 字)` : ""}
              </button>
              {showFullText && (
                <div className="rounded-lg bg-muted/30 border px-4 py-3 mt-1 max-h-[500px] overflow-y-auto">
                  <div className="prose prose-sm prose-neutral max-w-none dark:prose-invert leading-[1.6]">
                    <Markdown>{detail.responseText || "无回答内容"}</Markdown>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
