import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { Clock, Play, Settings, Loader2, Calendar, Zap } from "lucide-react";
import { toast } from "sonner";

const CRON_PRESETS = [
  { label: "每天 8:00", value: "0 8 * * *", desc: "每天早上8点执行" },
  { label: "每天 8:00 和 20:00", value: "0 8,20 * * *", desc: "每天早晚各一次" },
  { label: "每6小时", value: "0 */6 * * *", desc: "每6小时执行一次" },
  { label: "每12小时", value: "0 0,12 * * *", desc: "每12小时执行一次" },
  { label: "每周一 9:00", value: "0 9 * * 1", desc: "每周一早上9点" },
];

export default function ConfigScheduler() {
  const { data: config, isLoading, refetch } = trpc.scheduler.getConfig.useQuery();
  const updateMutation = trpc.scheduler.updateConfig.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("定时采集配置已更新");
    },
    onError: (err) => {
      toast.error(`更新失败: ${err.message}`);
    },
  });

  const [enabled, setEnabled] = useState(false);
  const [cronExpression, setCronExpression] = useState("0 8 * * *");
  const [concurrency, setConcurrency] = useState(5);

  useEffect(() => {
    if (config) {
      setEnabled(config.enabled);
      setCronExpression(config.cronExpression);
      setConcurrency(config.concurrency);
    }
  }, [config]);

  const handleSave = () => {
    updateMutation.mutate({ enabled, cronExpression, concurrency });
  };

  const handlePreset = (preset: string) => {
    setCronExpression(preset);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">定时采集</h1>
        <p className="text-muted-foreground mt-1">
          配置自动采集计划，系统将按照设定的时间自动执行全量采集任务
        </p>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              调度状态
            </CardTitle>
            <Badge variant={enabled ? "default" : "secondary"}>
              {enabled ? "已启用" : "已停用"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">Cron 表达式</div>
              <div className="font-mono text-sm font-medium">{config?.cronExpression || "—"}</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">上次执行</div>
              <div className="text-sm font-medium">
                {config?.lastRunAt
                  ? new Date(config.lastRunAt).toLocaleString("zh-CN")
                  : "尚未执行"}
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">并发数</div>
              <div className="text-sm font-medium">{config?.concurrency || 5} 个任务</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Configuration Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="h-4 w-4" />
            调度配置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable/Disable */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">启用定时采集</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                开启后系统将按照 Cron 表达式自动执行采集
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* Cron Expression */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Cron 表达式</Label>
            <Input
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              placeholder="0 8 * * *"
              className="font-mono"
            />
            <div className="flex flex-wrap gap-2">
              {CRON_PRESETS.map((preset) => (
                <Button
                  key={preset.value}
                  variant={cronExpression === preset.value ? "default" : "outline"}
                  size="sm"
                  className="text-xs"
                  onClick={() => handlePreset(preset.value)}
                >
                  <Calendar className="h-3 w-3 mr-1" />
                  {preset.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              格式: 分 时 日 月 周 (时区: Asia/Shanghai)
            </p>
          </div>

          {/* Concurrency */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">并发数</Label>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                max={20}
                value={concurrency}
                onChange={(e) => setConcurrency(Math.max(1, Math.min(20, parseInt(e.target.value) || 5)))}
                className="w-24"
              />
              <span className="text-xs text-muted-foreground">
                同时执行的采集任务数（1-20），建议 5-8
              </span>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-2">
            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              保存配置
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
              <Play className="h-4 w-4 text-blue-500" />
            </div>
            <div className="text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">工作原理</p>
              <p>定时采集将自动对所有<strong>启用状态</strong>的平台执行全量问题采集。</p>
              <p>采集使用并发池控制，避免 API 限流。每个采集任务包含：AI回答获取 → 引用源提取 → 情感分析 → 预警检查。</p>
              <p>采集结果可在「采集管理」页面查看，异常情况会自动触发预警。</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
