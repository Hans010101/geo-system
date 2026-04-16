import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { Bell, CheckCheck, Eye } from "lucide-react";
import { toast } from "sonner";
import { SEVERITY_LABELS, SEVERITY_COLORS, PLATFORM_LABELS, type Platform } from "@shared/geo-types";

export default function AlertCenter() {
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [readFilter, setReadFilter] = useState<string>("unread");

  const { data: alertsResult, isLoading } = trpc.alerts.list.useQuery({
    severity: severityFilter === "all" ? undefined : severityFilter,
    isRead: readFilter === "all" ? undefined : readFilter === "read",
    limit: 100,
  });
  const alertsList = alertsResult?.data;

  const utils = trpc.useUtils();

  const markReadMutation = trpc.alerts.markRead.useMutation({
    onMutate: async ({ id }) => {
      await utils.alerts.list.cancel();
      const prev = utils.alerts.list.getData();
      utils.alerts.list.setData(undefined, (old: any) =>
        old ? { ...old, data: old.data?.map((a: any) => (a.id === id ? { ...a, isRead: true } : a)) } : old
      );
      return { prev };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.prev) utils.alerts.list.setData(undefined, ctx.prev);
    },
    onSettled: () => {
      utils.alerts.list.invalidate();
    },
  });

  const markAllReadMutation = trpc.alerts.markAllRead.useMutation({
    onSuccess: () => {
      utils.alerts.list.invalidate();
      toast.success("已全部标记为已读");
    },
  });

  const unreadCount = alertsList?.filter((a) => !a.isRead).length || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">预警中心</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {unreadCount > 0 ? `${unreadCount} 条未读预警` : "暂无未读预警"}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
          >
            <CheckCheck className="h-4 w-4 mr-2" />
            全部已读
          </Button>
        )}
      </div>

      <div className="flex gap-3">
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="严重程度" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部级别</SelectItem>
            <SelectItem value="critical">紧急</SelectItem>
            <SelectItem value="high">高</SelectItem>
            <SelectItem value="medium">中</SelectItem>
            <SelectItem value="low">低</SelectItem>
          </SelectContent>
        </Select>
        <Select value={readFilter} onValueChange={setReadFilter}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="阅读状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="unread">未读</SelectItem>
            <SelectItem value="read">已读</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!alertsList || alertsList.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Bell className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium mb-2">暂无预警</h3>
            <p className="text-sm text-muted-foreground">当检测到异常情况时，预警将显示在这里</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {alertsList.map((alert) => (
            <Card
              key={alert.id}
              className={`transition-colors ${!alert.isRead ? "border-l-2" : "opacity-70"}`}
              style={{
                borderLeftColor: !alert.isRead ? SEVERITY_COLORS[alert.severity] : undefined,
              }}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div
                    className="h-2.5 w-2.5 rounded-full mt-1.5 shrink-0"
                    style={{ backgroundColor: SEVERITY_COLORS[alert.severity] || "#6b7280" }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold">{alert.title}</h3>
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5"
                        style={{
                          color: SEVERITY_COLORS[alert.severity],
                          borderColor: SEVERITY_COLORS[alert.severity],
                        }}
                      >
                        {SEVERITY_LABELS[alert.severity]}
                      </Badge>
                      {alert.relatedPlatform && (
                        <Badge variant="secondary" className="text-[10px] px-1.5">
                          {PLATFORM_LABELS[alert.relatedPlatform as Platform] || alert.relatedPlatform}
                        </Badge>
                      )}
                      {alert.relatedQuestionId && (
                        <Badge variant="secondary" className="text-[10px] px-1.5">
                          {alert.relatedQuestionId}
                        </Badge>
                      )}
                    </div>
                    {alert.description && (
                      <p className="text-sm text-muted-foreground mt-1.5">{alert.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground/60 mt-2">
                      {new Date(alert.createdAt).toLocaleString("zh-CN")}
                    </p>
                  </div>
                  {!alert.isRead && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markReadMutation.mutate({ id: alert.id })}
                      disabled={markReadMutation.isPending}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
