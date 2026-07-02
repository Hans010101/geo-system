// Serper + Firecrawl API-key cards for the sentiment monitor. Keys are stored as globalApiKeys rows
// (name = 'Serper' | 'Firecrawl') — never in code/env. Rendered inside /config/platforms.
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useRole } from "@/hooks/useRole";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Globe2, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const PROVIDERS = [
  {
    name: "Serper",
    label: "Serper（搜索发现）",
    defaultBase: "https://google.serper.dev",
    icon: Search,
    hint: "舆情关键词搜索（news 垂直，带发布时间）",
  },
  {
    name: "Firecrawl",
    label: "Firecrawl（抓取兜底）",
    defaultBase: "https://api.firecrawl.dev",
    icon: Globe2,
    hint: "自建抓取失败时对硬站点（Reuters/Bloomberg 等）兜底",
  },
];

export default function MonitorSourceKeysCard() {
  const { canEdit } = useRole();
  const utils = trpc.useUtils();
  const { data: keys } = trpc.globalApiKeys.list.useQuery();
  const upsert = trpc.globalApiKeys.upsert.useMutation({
    onSuccess: () => {
      utils.globalApiKeys.list.invalidate();
      toast.success("数据源 API 已保存");
    },
    onError: (e) => toast.error(e.message),
  });
  const [drafts, setDrafts] = useState<Record<string, { apiKey: string; baseUrl: string }>>({});

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">舆情监控数据源 API</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Serper 负责搜索发现，Firecrawl 负责抓取兜底。Key 存于全局 API 配置，不进代码 / 环境变量。
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {PROVIDERS.map((p) => {
            const existing = keys?.find((k: any) => k.name === p.name) as any;
            const configured = !!existing?.apiKeyMasked;
            const draft = drafts[p.name] || { apiKey: "", baseUrl: existing?.baseUrl || p.defaultBase };
            const Icon = p.icon;
            return (
              <div key={p.name} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium flex-1">{p.label}</span>
                  {configured ? (
                    <Badge className="text-[10px] gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      已配置
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] text-orange-600">
                      未配置
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">{p.hint}</p>
                {configured && (
                  <p className="text-[11px] font-mono text-muted-foreground">当前: {existing.apiKeyMasked}</p>
                )}
                <Input
                  value={draft.apiKey}
                  disabled={!canEdit}
                  placeholder={configured ? "输入新 Key 以替换" : "输入 API Key"}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.name]: { ...draft, apiKey: e.target.value } }))}
                  className="h-8 text-xs"
                />
                <Input
                  value={draft.baseUrl}
                  disabled={!canEdit}
                  placeholder="Base URL"
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.name]: { ...draft, baseUrl: e.target.value } }))}
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  className="w-full h-8"
                  disabled={!canEdit || upsert.isPending || (!draft.apiKey && !configured)}
                  onClick={() =>
                    upsert.mutate({
                      id: existing?.id,
                      name: p.name,
                      apiKey: draft.apiKey || null,
                      baseUrl: draft.baseUrl || p.defaultBase,
                      isActive: true,
                    })
                  }
                >
                  {upsert.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "保存"}
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
