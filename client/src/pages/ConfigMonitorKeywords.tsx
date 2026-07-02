import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useRole } from "@/hooks/useRole";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Draft = {
  id?: number;
  keyword: string;
  keywordGroup: string;
  searchFreq: "hourly" | "daily";
  priority: number;
  isActive: boolean;
};

const EMPTY: Draft = { keyword: "", keywordGroup: "syc", searchFreq: "daily", priority: 5, isActive: true };

export default function ConfigMonitorKeywords() {
  const { isAdmin } = useRole();
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const { data: keywords, isLoading } = trpc.monitor.listKeywords.useQuery(undefined, { enabled: isAdmin });
  const upsert = trpc.monitor.upsertKeyword.useMutation({
    onSuccess: () => {
      utils.monitor.listKeywords.invalidate();
      setDialogOpen(false);
      toast.success("关键词已保存");
    },
    onError: (e) => toast.error(e.message),
  });
  const toggle = trpc.monitor.toggleKeyword.useMutation({
    onSuccess: () => utils.monitor.listKeywords.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.monitor.deleteKeyword.useMutation({
    onSuccess: () => {
      utils.monitor.listKeywords.invalidate();
      toast.success("关键词已删除");
    },
    onError: (e) => toast.error(e.message),
  });

  if (!isAdmin) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <p>监控关键词管理需要管理员权限。</p>
      </div>
    );
  }

  const openAdd = () => { setDraft(EMPTY); setDialogOpen(true); };
  const openEdit = (k: any) => {
    setDraft({ id: k.id, keyword: k.keyword, keywordGroup: k.keywordGroup || "", searchFreq: k.searchFreq, priority: k.priority, isActive: k.isActive });
    setDialogOpen(true);
  };
  const save = () => {
    if (!draft.keyword.trim()) { toast.error("关键词不能为空"); return; }
    upsert.mutate({
      id: draft.id,
      keyword: draft.keyword,
      keywordGroup: draft.keywordGroup || null,
      searchFreq: draft.searchFreq,
      priority: draft.priority,
      isActive: draft.isActive,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">监控关键词</h1>
          <p className="text-muted-foreground text-sm mt-1">
            舆情监控每轮会对所有启用的关键词做 Serper 搜索。共 {keywords?.length ?? 0} 个关键词。
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openAdd} className="gap-1.5"><Plus className="h-4 w-4" />新增关键词</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{draft.id ? "编辑关键词" : "新增关键词"}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label>关键词</Label>
                <Input value={draft.keyword} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} placeholder="如：孙宇晨 SEC" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>分组</Label>
                  <Select value={draft.keywordGroup} onValueChange={(v) => setDraft({ ...draft, keywordGroup: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="syc">syc（孙宇晨核心）</SelectItem>
                      <SelectItem value="tron">tron（波场项目）</SelectItem>
                      <SelectItem value="syc-rel">syc-rel（关联实体/事件）</SelectItem>
                      <SelectItem value="intl">intl（英文舆情）</SelectItem>
                      <SelectItem value="competitor">competitor（竞品）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>频率</Label>
                  <Select value={draft.searchFreq} onValueChange={(v) => setDraft({ ...draft, searchFreq: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">每日</SelectItem>
                      <SelectItem value="hourly">每小时</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 items-end">
                <div className="space-y-1.5">
                  <Label>优先级 (0-10)</Label>
                  <Input type="number" min={0} max={10} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Switch checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} />
                  <Label>启用</Label>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button onClick={save} disabled={upsert.isPending}>
                {upsert.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2.5 text-left font-medium">关键词</th>
                <th className="p-2.5 text-left font-medium">分组</th>
                <th className="p-2.5 text-center font-medium">频率</th>
                <th className="p-2.5 text-center font-medium">优先级</th>
                <th className="p-2.5 text-center font-medium">启用</th>
                <th className="p-2.5 text-center font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" /></td></tr>
              ) : (keywords ?? []).length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">暂无关键词</td></tr>
              ) : (
                keywords!.map((k: any) => (
                  <tr key={k.id} className="border-t">
                    <td className="p-2.5 font-medium">{k.keyword}</td>
                    <td className="p-2.5"><Badge variant="outline" className="text-[10px]">{k.keywordGroup || "—"}</Badge></td>
                    <td className="p-2.5 text-center text-xs text-muted-foreground">{k.searchFreq === "hourly" ? "每小时" : "每日"}</td>
                    <td className="p-2.5 text-center">{k.priority}</td>
                    <td className="p-2.5 text-center">
                      <Switch checked={k.isActive} onCheckedChange={(v) => toggle.mutate({ id: k.id, isActive: v })} />
                    </td>
                    <td className="p-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(k)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => del.mutate({ id: k.id })}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
