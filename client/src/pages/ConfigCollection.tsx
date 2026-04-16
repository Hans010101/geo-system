import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Zap,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  AlertTriangle,
  ThumbsUp,
  ThumbsDown,
  Trash2,
  RefreshCw,
  Filter,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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

const log_warn = (...args: any[]) => console.warn("[ConfigCollection]", ...args);

type StatusFilter = "all" | "success" | "pending" | "failed";

const PAGE_SIZE = 50;

// Standalone polling engine — uses raw fetch to avoid tRPC mutation re-render issues
function useBatchPoller() {
  const [batchId, setBatchId] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const activeRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const start = useCallback((id: string, totalCount: number) => {
    stop();
    setBatchId(id);
    setTotal(totalCount);
    setDone(0);
    setFailed(0);
    activeRef.current = true;

    const poll = async () => {
      if (!activeRef.current) return;
      try {
        // Use raw fetch to call tRPC mutation — avoids React re-render dependency loop
        const res = await fetch("/api/trpc/collections.executeNextBatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ json: { batchId: id, concurrency: 5 } }),
        });
        const json = await res.json();
        const result = json?.result?.data?.json || json?.result?.data || {};
        console.log("[Poller]", id, result);

        if (result.completed != null) setDone((p) => p + result.completed);
        if (result.failed != null) setFailed((p) => p + result.failed);

        if (result.remaining === 0 || result.remaining == null) {
          activeRef.current = false;
          setBatchId(null);
          return;
        }
      } catch (err: any) {
        console.warn("[Poller] error:", err.message);
      }
      if (activeRef.current) {
        timerRef.current = setTimeout(poll, 2000);
      }
    };
    poll();
  }, [stop]);

  const isRunning = !!batchId;
  const pct = total > 0 ? Math.round(((done + failed) / total) * 100) : 0;

  // Cleanup on unmount
  useEffect(() => () => stop(), [stop]);

  return { batchId, total, done, failed, pct, isRunning, start, stop };
}

export default function ConfigCollection() {
  const { canEdit } = useRole();
  const [selectedQuestion, setSelectedQuestion] = useState<string>("");
  const [selectedQuestionAll, setSelectedQuestionAll] = useState<string>("");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("chatgpt");
  const [selectedPlatformAll, setSelectedPlatformAll] = useState<string>("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("trigger");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmAction, setConfirmAction] = useState<"delete" | "retry" | null>(null);
  const [page, setPage] = useState(0);

  // Auto-open detail from URL param (e.g. /config/collection?detail=123)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const detailParam = params.get("detail");
    if (detailParam) {
      setDetailId(Number(detailParam));
      setActiveTab("history");
      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Three independent polling channels
  const singleQ = useBatchPoller();
  const singleP = useBatchPoller();
  const batch = useBatchPoller();
  const anyRunning = singleQ.isRunning || singleP.isRunning || batch.isRunning;

  const utils = trpc.useUtils();

  const { data: questionsList } = trpc.questions.list.useQuery({ status: "active" });
  const listInput = useMemo(() => ({
    status: statusFilter === "all" ? undefined : statusFilter === "failed" ? "failed" : statusFilter,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [statusFilter, page]);
  const { data: collectionsList, isLoading: collectionsLoading, refetch: refetchCollections } = trpc.collections.list.useQuery(listInput);
  const { data: platformConfigs } = trpc.platformConfigs.list.useQuery();
  const { data: globalApiKeys } = trpc.globalApiKeys.list.useQuery();
  const hasAnyApiKey = (globalApiKeys && globalApiKeys.length > 0) ||
    platformConfigs?.some((p: any) => p.apiKeyEncrypted && p.apiBaseUrl);

  const totalPages = Math.ceil((collectionsList?.total || 0) / PAGE_SIZE);

  // Refresh list when any poller finishes
  const prevSingleQ = useRef(singleQ.isRunning);
  const prevSingleP = useRef(singleP.isRunning);
  const prevBatch = useRef(batch.isRunning);
  useEffect(() => {
    if (prevSingleQ.current && !singleQ.isRunning) {
      toast.success(`单题采集完成！成功 ${singleQ.done} 条，失败 ${singleQ.failed} 条`);
      utils.collections.list.invalidate();
    }
    prevSingleQ.current = singleQ.isRunning;
  }, [singleQ.isRunning]);
  useEffect(() => {
    if (prevSingleP.current && !singleP.isRunning) {
      toast.success(`单模型采集完成！成功 ${singleP.done} 条，失败 ${singleP.failed} 条`);
      utils.collections.list.invalidate();
    }
    prevSingleP.current = singleP.isRunning;
  }, [singleP.isRunning]);
  useEffect(() => {
    if (prevBatch.current && !batch.isRunning) {
      toast.success(`批量采集完成！成功 ${batch.done} 条，失败 ${batch.failed} 条`);
      utils.collections.list.invalidate();
    }
    prevBatch.current = batch.isRunning;
  }, [batch.isRunning]);

  const triggerMutation = trpc.collections.trigger.useMutation({
    onSuccess: (data) => {
      utils.collections.list.invalidate();
      if (data.success) {
        toast.success("采集完成");
      } else {
        toast.error("采集失败: " + (data.error || "未知错误"));
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const triggerAllPlatformsMutation = trpc.collections.triggerAllPlatforms.useMutation({
    onSuccess: (data) => {
      if (data.success && data.batchId) {
        singleQ.start(data.batchId, data.totalCreated || 0);
        toast.info(`已创建 ${data.totalCreated} 条采集任务，开始执行...`);
      } else {
        toast.error(data.message || "采集失败");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const triggerAllQuestionsMutation = trpc.collections.triggerAllQuestions.useMutation({
    onSuccess: (data) => {
      if (data.success && data.batchId) {
        singleP.start(data.batchId, data.totalCreated || 0);
        toast.info(`已创建 ${data.totalCreated} 条采集任务，开始执行...`);
      } else {
        toast.error(data.message || "采集失败");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const batchTriggerMutation = trpc.collections.batchTrigger.useMutation({
    onSuccess: (data) => {
      if (data.success && data.batchId) {
        batch.start(data.batchId, data.totalCreated || 0);
        toast.info(`已创建 ${data.totalCreated} 条采集任务，开始执行...`);
      } else {
        toast.error(data.message || "批量采集失败");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const reanalyzeAllMutation = trpc.collections.reanalyzeAll.useMutation({
    onSuccess: (data) => {
      utils.collections.list.invalidate();
      if (data.analyzed > 0) {
        toast.success(`已补充分析 ${data.analyzed} 条记录${data.total > data.analyzed ? `，剩余 ${data.total - data.analyzed} 条` : ""}`);
      } else {
        toast.info("所有成功记录已有分析结果");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const batchDeleteMutation = trpc.collections.batchDelete.useMutation({
    onSuccess: async (data) => {
      toast.success(`已删除 ${data.deleted} 条记录`);
      setSelectedIds(new Set());
      setConfirmAction(null);
      await refetchCollections();
    },
    onError: (err) => {
      toast.error(`删除失败: ${err.message}`);
      setConfirmAction(null);
    },
  });

  const batchRetryMutation = trpc.collections.batchRetry.useMutation({
    onSuccess: async (data: any) => {
      if (data.batchId) {
        batch.start(data.batchId, data.retried);
        toast.info(`已重置 ${data.retried} 条任务，开始执行...`);
      }
      setSelectedIds(new Set());
      setConfirmAction(null);
    },
    onError: (err) => {
      toast.error(`重新执行失败: ${err.message}`);
      setConfirmAction(null);
    },
  });

  const handleSingleTrigger = () => {
    if (!selectedQuestion) {
      toast.error("请选择一个问题");
      return;
    }
    triggerMutation.mutate({ questionId: selectedQuestion, platform: selectedPlatform });
  };

  const enabledPlatforms = useMemo(() => {
    return platformConfigs?.filter((p) => p.isEnabled).length || 0;
  }, [platformConfigs]);

  // Data comes pre-filtered from server via pagination
  const filteredCollections = collectionsList?.data || [];
  const totalRecords = collectionsList?.total || 0;

  // Select all toggle
  const allSelected = filteredCollections.length > 0 && filteredCollections.every((c) => selectedIds.has(c.id));
  const someSelected = selectedIds.size > 0;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCollections.map((c) => c.id)));
    }
  };

  const toggleSelectOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirmAction = () => {
    const ids = Array.from(selectedIds);
    // Do NOT close dialog here - let onSuccess/onError handlers close it
    // This ensures the dialog stays open (with loading) until the operation completes
    if (confirmAction === "delete") {
      batchDeleteMutation.mutate({ ids });
    } else if (confirmAction === "retry") {
      batchRetryMutation.mutate({ ids });
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />;
      case "failed":
      case "refused":
        return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case "pending":
        return <Loader2 className="h-3.5 w-3.5 text-yellow-500 animate-spin" />;
      case "timeout":
        return <Clock className="h-3.5 w-3.5 text-orange-500" />;
      default:
        return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case "success": return "成功";
      case "failed": return "失败";
      case "refused": return "拒绝";
      case "timeout": return "超时";
      case "pending": return "执行中";
      default: return status;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">采集管理</h1>
        <p className="text-muted-foreground text-sm mt-1">手动触发采集任务，查看采集记录和详情</p>
      </div>

      {!hasAnyApiKey && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-800 flex items-start gap-2">
          <span className="shrink-0 mt-0.5">&#9888;</span>
          <span>尚未配置 API Key，请先在「<a href="/config/platforms" className="underline font-medium">平台配置 → 全局 API 配置</a>」中添加至少一个 API Key 才能开始采集</span>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="trigger">触发采集</TabsTrigger>
          <TabsTrigger value="history">
            采集记录
            {anyRunning && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 animate-pulse">
                执行中
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trigger" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Single trigger */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Play className="h-4 w-4" />
                  单次采集
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">选择问题</label>
                  <Select value={selectedQuestion} onValueChange={setSelectedQuestion}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择问题..." />
                    </SelectTrigger>
                    <SelectContent>
                      {questionsList?.map((q) => (
                        <SelectItem key={q.questionId} value={q.questionId}>
                          [{q.questionId}] {q.text.slice(0, 40)}...
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">选择平台</label>
                  <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
                        <SelectItem key={p} value={p}>
                          {PLATFORM_LABELS[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  onClick={handleSingleTrigger}
                  disabled={triggerMutation.isPending || !selectedQuestion || !canEdit}
                >
                  {triggerMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  {triggerMutation.isPending ? "采集中..." : "开始采集"}
                </Button>
              </CardContent>
            </Card>

            {/* Single question → all platforms */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  单题全模型采集
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">选择问题</label>
                  <Select value={selectedQuestionAll} onValueChange={setSelectedQuestionAll}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择问题..." />
                    </SelectTrigger>
                    <SelectContent>
                      {questionsList?.map((q) => (
                        <SelectItem key={q.questionId} value={q.questionId}>
                          [{q.questionId}] {q.text.slice(0, 40)}...
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  将在 <strong>{enabledPlatforms}</strong> 个启用平台上同时采集此问题
                </p>

                {/* Single-Q progress bar */}
                {singleQ.isRunning && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> 采集中...</span>
                      <span className="font-bold text-primary">{singleQ.pct}%</span>
                    </div>
                    <Progress value={singleQ.pct} className="h-2" />
                    <div className="text-xs text-muted-foreground">
                      已完成 {singleQ.done + singleQ.failed}/{singleQ.total}
                      <span className="text-emerald-600 ml-2">成功 {singleQ.done}</span>
                      {singleQ.failed > 0 && <span className="text-destructive ml-2">失败 {singleQ.failed}</span>}
                    </div>
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={() => {
                    if (!selectedQuestionAll) { toast.error("请选择一个问题"); return; }
                    triggerAllPlatformsMutation.mutate({ questionId: selectedQuestionAll });
                  }}
                  disabled={triggerAllPlatformsMutation.isPending || singleQ.isRunning || !selectedQuestionAll || !canEdit}
                >
                  {triggerAllPlatformsMutation.isPending || singleQ.isRunning ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  {singleQ.isRunning ? "执行中..." : "开始采集"}
                </Button>
              </CardContent>
            </Card>

            {/* Single platform → all questions */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Play className="h-4 w-4" />
                  单模型全问题采集
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">选择平台</label>
                  <Select value={selectedPlatformAll} onValueChange={setSelectedPlatformAll}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择平台..." />
                    </SelectTrigger>
                    <SelectContent>
                      {platformConfigs?.filter((p: any) => p.isEnabled).map((p: any) => (
                        <SelectItem key={p.platform} value={p.platform}>
                          {PLATFORM_LABELS[p.platform as Platform] || p.platform}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  将采集全部 <strong>{questionsList?.length || 0}</strong> 个活跃问题
                </p>

                {singleP.isRunning && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> 采集中...</span>
                      <span className="font-bold text-primary">{singleP.pct}%</span>
                    </div>
                    <Progress value={singleP.pct} className="h-2" />
                    <div className="text-xs text-muted-foreground">
                      已完成 {singleP.done + singleP.failed}/{singleP.total}
                      <span className="text-emerald-600 ml-2">成功 {singleP.done}</span>
                      {singleP.failed > 0 && <span className="text-destructive ml-2">失败 {singleP.failed}</span>}
                    </div>
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={() => {
                    if (!selectedPlatformAll) { toast.error("请选择一个平台"); return; }
                    triggerAllQuestionsMutation.mutate({ platform: selectedPlatformAll });
                  }}
                  disabled={triggerAllQuestionsMutation.isPending || singleP.isRunning || !selectedPlatformAll || !canEdit}
                >
                  {triggerAllQuestionsMutation.isPending || singleP.isRunning ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  {singleP.isRunning ? "执行中..." : "开始采集"}
                </Button>
              </CardContent>
            </Card>

            {/* Batch trigger */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  批量采集
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">活跃问题数</span>
                    <span className="font-medium">{questionsList?.length || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">启用平台数</span>
                    <span className="font-medium">{enabledPlatforms}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="text-muted-foreground">预计采集数</span>
                    <span className="font-bold text-primary">
                      {(questionsList?.length || 0) * enabledPlatforms}
                    </span>
                  </div>
                </div>

                {/* Batch progress */}
                {batch.isRunning && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="text-sm font-medium">批量采集执行中...</span>
                      </div>
                      <span className="text-lg font-bold text-primary">{batch.pct}%</span>
                    </div>
                    <Progress value={batch.pct} className="h-2.5" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        已完成 {batch.done + batch.failed}/{batch.total}
                        {batch.total - batch.done - batch.failed > 0 && ` · 剩余 ${batch.total - batch.done - batch.failed}`}
                      </span>
                      <span>
                        <span className="text-emerald-600">成功 {batch.done}</span>
                        {batch.failed > 0 && (
                          <span className="text-destructive ml-2">失败 {batch.failed}</span>
                        )}
                      </span>
                    </div>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  将对所有活跃问题在所有启用的平台上执行一次采集，采集将在后台并发执行（默认并发数5）
                </p>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => batchTriggerMutation.mutate()}
                  disabled={batchTriggerMutation.isPending || batch.isRunning || !canEdit}
                >
                  {batchTriggerMutation.isPending || batch.isRunning ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  {batch.isRunning ? "执行中..." : "开始批量采集"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base font-semibold">采集记录</CardTitle>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      disabled={reanalyzeAllMutation.isPending}
                      onClick={() => reanalyzeAllMutation.mutate({ limit: 20 })}
                    >
                      {reanalyzeAllMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                      补充分析
                    </Button>
                  )}
                </div>
                {/* Status filter */}
                <div className="flex items-center gap-2">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                  <div className="flex rounded-lg border overflow-hidden text-xs">
                    {(["all", "success", "pending", "failed"] as StatusFilter[]).map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setStatusFilter(s);
                          setSelectedIds(new Set());
                          setPage(0);
                        }}
                        className={`px-3 py-1.5 transition-colors ${
                          statusFilter === s
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-accent"
                        }`}
                      >
                        {s === "all" ? "全部" : s === "success" ? "成功" : s === "pending" ? "执行中" : "失败"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Batch action bar - appears when items are selected */}
              {someSelected && (
                <div className="flex items-center gap-3 mt-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <span className="text-sm font-medium text-primary">
                    已选 {selectedIds.size} 条
                  </span>
                  <div className="flex gap-2 ml-auto">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => setConfirmAction("retry")}
                      disabled={batchRetryMutation.isPending || !canEdit}
                    >
                      <RefreshCw className="h-3 w-3" />
                      重新执行
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs gap-1"
                      onClick={() => setConfirmAction("delete")}
                      disabled={batchDeleteMutation.isPending || !canEdit}
                    >
                      <Trash2 className="h-3 w-3" />
                      批量删除
                    </Button>
                  </div>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {collectionsLoading ? (
                <div className="text-center py-8 text-muted-foreground">加载中...</div>
              ) : filteredCollections.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {statusFilter === "all" ? "暂无采集记录" : `暂无${statusFilter === "success" ? "成功" : statusFilter === "pending" ? "执行中" : "失败"}的记录`}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="p-2 w-8">
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={toggleSelectAll}
                          />
                        </th>
                        <th className="text-left p-2 font-medium">时间</th>
                        <th className="text-left p-2 font-medium">问题</th>
                        <th className="text-left p-2 font-medium">平台</th>
                        <th className="text-center p-2 font-medium">状态</th>
                        <th className="text-right p-2 font-medium">字数</th>
                        <th className="text-left p-2 font-medium">批次</th>
                        <th className="text-center p-2 font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCollections.map((c) => (
                        <tr
                          key={c.id}
                          className={`border-b border-border/50 hover:bg-accent/30 transition-colors ${
                            selectedIds.has(c.id) ? "bg-primary/5" : ""
                          }`}
                        >
                          <td className="p-2">
                            <Checkbox
                              checked={selectedIds.has(c.id)}
                              onCheckedChange={() => toggleSelectOne(c.id)}
                            />
                          </td>
                          <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(c.timestamp).toLocaleString("zh-CN")}
                          </td>
                          <td className="p-2 text-xs max-w-[200px] truncate" title={c.questionText || c.questionId}>
                            {c.questionText?.slice(0, 25) || c.questionId}
                          </td>
                          <td className="p-2">
                            <Badge
                              variant="outline"
                              className="text-[10px]"
                              style={{ color: PLATFORM_COLORS[c.platform as Platform] }}
                            >
                              {PLATFORM_LABELS[c.platform as Platform] || c.platform}
                            </Badge>
                          </td>
                          <td className="p-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {statusIcon(c.status)}
                              <span className="text-xs">{statusLabel(c.status)}</span>
                            </div>
                          </td>
                          <td className="p-2 text-right text-xs">
                            {c.responseLength || "—"}
                          </td>
                          <td className="p-2 text-xs text-muted-foreground font-mono">
                            {c.batchId?.slice(0, 12) || "—"}
                          </td>
                          <td className="p-2 text-center">
                            {c.status === "success" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setDetailId(c.id)}
                              >
                                <Eye className="h-3 w-3 mr-1" />
                                详情
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination controls */}
              {totalRecords > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
                  <span className="text-muted-foreground">
                    共 {totalRecords} 条记录，第 {page + 1}/{totalPages || 1} 页
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      下一页
                      <ChevronRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirm dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "delete" ? "确认批量删除" : "确认重新执行"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "delete"
                ? `确定要删除选中的 ${selectedIds.size} 条采集记录吗？此操作不可撤销，相关分析数据也将一并删除。`
                : `确定要重新执行选中的 ${selectedIds.size} 条采集任务吗？任务将在后台异步执行。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={batchDeleteMutation.isPending || batchRetryMutation.isPending}
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmAction}
              disabled={batchDeleteMutation.isPending || batchRetryMutation.isPending}
              className={confirmAction === "delete" ? "bg-destructive hover:bg-destructive/90" : ""}
            >
              {(batchDeleteMutation.isPending || batchRetryMutation.isPending) ? (
                <>
                  <span className="animate-spin mr-1.5 inline-block h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full" />
                  {confirmAction === "delete" ? "删除中..." : "执行中..."}
                </>
              ) : (
                confirmAction === "delete" ? "确认删除" : "确认执行"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Detail Sheet */}
      <CollectionDetailSheet
        collectionId={detailId}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}

function CollectionDetailSheet({
  collectionId,
  onClose,
}: {
  collectionId: number | null;
  onClose: () => void;
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
    <Sheet open={!!collectionId} onOpenChange={(open) => !open && onClose()}>
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
            {/* ===== Header ===== */}
            <div className="px-6 pb-4 border-b space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold">{PLATFORM_LABELS[detail.platform as Platform] || detail.platform}</span>
                <Badge
                  className="text-[10px] text-white border-0"
                  style={{ backgroundColor: PLATFORM_COLORS[detail.platform as Platform] || "#6b7280" }}
                >
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

            {/* ===== Analysis ===== */}
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
                {/* Sentiment score circle */}
                <div className="flex items-center gap-5">
                  <div
                    className="h-16 w-16 rounded-full flex items-center justify-center text-white font-bold text-2xl shrink-0 shadow-sm"
                    style={{ backgroundColor: SENTIMENT_COLORS[score] || "#6b7280" }}
                  >
                    {score}
                  </div>
                  <div>
                    <p className="font-semibold text-base">{SENTIMENT_LABELS[score]}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      语气: {TONE_LABELS[a.overallTone || ""] || a.overallTone}
                    </p>
                  </div>
                </div>

                {/* Reasoning */}
                {a.sentimentReasoning && (
                  <div className="bg-muted/40 rounded-lg px-4 py-3">
                    <p className="text-sm leading-[1.6]">{a.sentimentReasoning}</p>
                  </div>
                )}

                {/* Negative points */}
                {negPoints.length > 0 && (
                  <div className="rounded-lg border-l-[3px] border-l-destructive bg-destructive/5 px-4 py-3 space-y-2">
                    <p className="text-sm font-medium text-destructive flex items-center gap-1.5">
                      <ThumbsDown className="h-3.5 w-3.5" /> 负面表述 ({negPoints.length})
                    </p>
                    <ul className="space-y-1">
                      {negPoints.map((p, i) => (
                        <li key={i} className="text-sm leading-[1.6] flex items-start gap-2">
                          <span className="text-destructive/60 mt-1.5 shrink-0 h-1.5 w-1.5 rounded-full bg-destructive/50" />
                          <span>{String(p)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Positive points */}
                {posPoints.length > 0 && (
                  <div className="rounded-lg border-l-[3px] border-l-emerald-500 bg-emerald-500/5 px-4 py-3 space-y-2">
                    <p className="text-sm font-medium text-emerald-600 flex items-center gap-1.5">
                      <ThumbsUp className="h-3.5 w-3.5" /> 正面表述 ({posPoints.length})
                    </p>
                    <ul className="space-y-1">
                      {posPoints.map((p, i) => (
                        <li key={i} className="text-sm leading-[1.6] flex items-start gap-2">
                          <span className="mt-1.5 shrink-0 h-1.5 w-1.5 rounded-full bg-emerald-500/50" />
                          <span>{String(p)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Inaccurate claims */}
                {inaccClaims.length > 0 && (
                  <div className="rounded-lg border-l-[3px] border-l-orange-500 bg-orange-500/5 px-4 py-3 space-y-2">
                    <p className="text-sm font-medium text-orange-600 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" /> 不准确声明 ({inaccClaims.length})
                    </p>
                    <ul className="space-y-1">
                      {inaccClaims.map((c, i) => (
                        <li key={i} className="text-sm leading-[1.6] flex items-start gap-2">
                          <span className="mt-1.5 shrink-0 h-1.5 w-1.5 rounded-full bg-orange-500/50" />
                          <span>{String(c)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Key facts as pills */}
                {kFacts.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">提到的关键事实</p>
                    <div className="flex flex-wrap gap-1.5">
                      {kFacts.map((f, i) => (
                        <span key={i} className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs">
                          {String(f)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Target facts grid */}
                {Object.keys(tFactsCheck).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">目标事实命中</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {Object.entries(tFactsCheck).map(([key, hit]) => (
                        <div key={key} className="flex items-center gap-1.5 text-xs py-0.5">
                          {hit ? (
                            <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-destructive/40 shrink-0" />
                          )}
                          <span className={hit ? "text-foreground" : "text-muted-foreground"}>{key}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );})()}

            {/* ===== No analysis / Reanalyze ===== */}
            {!detail.analysis && detail.status === "success" && (
              <div className="px-6">
                <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-4 text-center space-y-2">
                  <p className="text-sm text-muted-foreground">此采集尚无 AI 分析结果</p>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reanalyzeMutation.isPending}
                      onClick={() => reanalyzeMutation.mutate({ id: detail.id })}
                    >
                      {reanalyzeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                      重新分析
                    </Button>
                  )}
                </div>
              </div>
            )}
            {detail.analysis && canEdit && (
              <div className="px-6 flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-muted-foreground"
                  disabled={reanalyzeMutation.isPending}
                  onClick={() => reanalyzeMutation.mutate({ id: detail.id })}
                >
                  {reanalyzeMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                  重新分析
                </Button>
              </div>
            )}

            {/* ===== Citations ===== */}
            {detail.citations && detail.citations.length > 0 && (
              <div className="px-6 space-y-3">
                <p className="text-xs font-medium text-muted-foreground">引用源 ({detail.citations.length})</p>
                <div className="space-y-1.5">
                  {detail.citations.map((c: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs rounded-lg border px-3 py-2">
                      <span className="text-muted-foreground w-5 text-center shrink-0">#{c.position}</span>
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: SOURCE_TYPE_COLORS[c.sourceType] || "#9ca3af" }}
                      />
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline truncate flex-1"
                      >
                        {c.title || c.domain || c.url}
                      </a>
                      <Badge variant="outline" className="text-[9px] px-1 shrink-0">
                        {SOURCE_TYPE_LABELS[c.sourceType] || c.sourceType}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ===== Full response (collapsible) ===== */}
            <div className="px-6">
              <button
                type="button"
                className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full py-2"
                onClick={() => setShowFullText(!showFullText)}
              >
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
