import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { Plus, Pencil, Trash2, Target, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRole } from "@/hooks/useRole";

export default function ConfigTargetFacts() {
  const { canEdit } = useRole();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data: factsList, isLoading } = trpc.targetFacts.list.useQuery({});
  const utils = trpc.useUtils();

  const createMutation = trpc.targetFacts.create.useMutation({
    onSuccess: () => {
      utils.targetFacts.list.invalidate();
      setDialogOpen(false);
      toast.success("目标事实创建成功");
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.targetFacts.update.useMutation({
    onSuccess: () => {
      utils.targetFacts.list.invalidate();
      setDialogOpen(false);
      setEditing(null);
      toast.success("已更新");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.targetFacts.delete.useMutation({
    onSuccess: () => {
      utils.targetFacts.list.invalidate();
      toast.success("已删除");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      factKey: formData.get("factKey") as string,
      factDescription: formData.get("factDescription") as string,
      isActive: true,
    };

    if (editing) {
      updateMutation.mutate({ id: editing.id, ...data });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">目标事实配置</h1>
          <p className="text-muted-foreground text-sm mt-1">
            配置AI回答中应包含的目标事实，用于事实覆盖率检测
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          {canEdit && (
          <DialogTrigger asChild>
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              新增事实
            </Button>
          </DialogTrigger>
          )}
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "编辑目标事实" : "新增目标事实"}</DialogTitle>
              <DialogDescription>
                定义AI回答中应该提及的关键事实
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="factKey">事实标识</Label>
                <Input
                  id="factKey"
                  name="factKey"
                  placeholder="如 tron_tps_2000"
                  defaultValue={editing?.factKey || ""}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factDescription">事实描述</Label>
                <Textarea
                  id="factDescription"
                  name="factDescription"
                  placeholder="描述这个事实的内容，如：TRON网络TPS达到2000"
                  defaultValue={editing?.factDescription || ""}
                  rows={3}
                  required
                />
              </div>
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {editing ? "保存" : "创建"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">加载中...</div>
      ) : !factsList || factsList.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Target className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium mb-2">暂无目标事实</h3>
            <p className="text-sm text-muted-foreground">添加需要AI回答中覆盖的关键事实</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {factsList.map((fact) => (
            <Card key={fact.id}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-mono font-medium text-primary">{fact.factKey}</span>
                      <Badge variant={fact.isActive ? "default" : "secondary"} className="text-[10px]">
                        {fact.isActive ? "启用" : "停用"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{fact.factDescription}</p>
                  </div>
                  {canEdit && (
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setEditing(fact); setDialogOpen(true); }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm("确定删除此目标事实？")) {
                          deleteMutation.mutate({ id: fact.id });
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
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
