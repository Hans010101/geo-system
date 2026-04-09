import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Plus, Pencil, Trash2, Link2, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { CONTENT_TYPE_LABELS } from "@shared/geo-types";
import { useRole } from "@/hooks/useRole";

export default function ConfigOurContent() {
  const { canEdit } = useRole();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: contentList, isLoading } = trpc.ourContent.list.useQuery({
    contentType: typeFilter === "all" ? undefined : typeFilter,
  });
  const utils = trpc.useUtils();

  const createMutation = trpc.ourContent.create.useMutation({
    onSuccess: () => {
      utils.ourContent.list.invalidate();
      setDialogOpen(false);
      toast.success("URL添加成功");
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.ourContent.update.useMutation({
    onSuccess: () => {
      utils.ourContent.list.invalidate();
      setDialogOpen(false);
      setEditing(null);
      toast.success("已更新");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.ourContent.delete.useMutation({
    onSuccess: () => {
      utils.ourContent.list.invalidate();
      toast.success("已删除");
    },
    onError: (err) => toast.error(err.message),
  });

  const batchCreateMutation = trpc.ourContent.batchCreate.useMutation({
    onSuccess: (data) => {
      utils.ourContent.list.invalidate();
      setBatchDialogOpen(false);
      toast.success(`批量导入成功，共 ${data.count} 条`);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      url: formData.get("url") as string,
      title: (formData.get("title") as string) || undefined,
      publishPlatform: (formData.get("publishPlatform") as string) || undefined,
      contentType: (formData.get("contentType") as any) || undefined,
      isActive: true,
    };

    if (editing) {
      updateMutation.mutate({ id: editing.id, ...data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleBatchImport = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const text = formData.get("batchText") as string;
    const lines = text.split("\n").filter((l) => l.trim());
    const items = lines.map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      return {
        url: parts[0],
        title: parts[1] || undefined,
        publishPlatform: parts[2] || undefined,
        contentType: (parts[3] as any) || undefined,
      };
    }).filter((item) => item.url);

    if (items.length === 0) {
      toast.error("没有有效的URL");
      return;
    }
    batchCreateMutation.mutate({ items });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">己方URL库</h1>
          <p className="text-muted-foreground text-sm mt-1">
            管理己方已布局的内容URL，共 {contentList?.length || 0} 条
          </p>
        </div>
        <div className="flex gap-2">
          {canEdit && (
          <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Upload className="h-4 w-4 mr-2" />
                批量导入
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>批量导入URL</DialogTitle>
                <DialogDescription>
                  每行一条，格式: URL,标题,发布平台,内容类型（逗号分隔，后三项可选）
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleBatchImport} className="space-y-4">
                <Textarea
                  name="batchText"
                  placeholder={`https://example.com/article1,文章标题,知乎,seo_article\nhttps://example.com/article2,另一篇文章`}
                  rows={8}
                  required
                />
                <DialogFooter>
                  <Button type="submit" disabled={batchCreateMutation.isPending}>
                    {batchCreateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    导入
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          )}

          {canEdit && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
                <Plus className="h-4 w-4 mr-2" />
                添加URL
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? "编辑URL" : "添加URL"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>URL</Label>
                  <Input name="url" placeholder="https://..." defaultValue={editing?.url || ""} required />
                </div>
                <div className="space-y-2">
                  <Label>标题</Label>
                  <Input name="title" placeholder="内容标题" defaultValue={editing?.title || ""} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>发布平台</Label>
                    <Input name="publishPlatform" placeholder="如：知乎、百科" defaultValue={editing?.publishPlatform || ""} />
                  </div>
                  <div className="space-y-2">
                    <Label>内容类型</Label>
                    <select
                      name="contentType"
                      defaultValue={editing?.contentType || "seo_article"}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    >
                      {Object.entries(CONTENT_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                    {(createMutation.isPending || updateMutation.isPending) && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    {editing ? "保存" : "添加"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
        >
          <option value="all">全部类型</option>
          {Object.entries(CONTENT_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">加载中...</div>
      ) : !contentList || contentList.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Link2 className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium mb-2">暂无己方URL</h3>
            <p className="text-sm text-muted-foreground">添加已布局的内容URL，用于引用命中率分析</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {contentList.map((item) => (
            <Card key={item.id}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Link2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.title || item.url}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.url}</p>
                    <div className="flex gap-2 mt-1.5">
                      {item.contentType && (
                        <Badge variant="outline" className="text-[10px]">
                          {CONTENT_TYPE_LABELS[item.contentType] || item.contentType}
                        </Badge>
                      )}
                      {item.publishPlatform && (
                        <Badge variant="secondary" className="text-[10px]">
                          {item.publishPlatform}
                        </Badge>
                      )}
                      <Badge variant={item.isActive ? "default" : "secondary"} className="text-[10px]">
                        {item.isActive ? "启用" : "停用"}
                      </Badge>
                    </div>
                  </div>
                  {canEdit && (
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(item); setDialogOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm("确定删除？")) deleteMutation.mutate({ id: item.id });
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
