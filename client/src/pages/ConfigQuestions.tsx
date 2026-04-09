import { useRole } from "@/hooks/useRole";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Plus, Pencil, Trash2, Database, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  BRAND_LINE_LABELS,
  DIMENSION_LABELS,
  type BrandLine,
  type Dimension,
} from "@shared/geo-types";

export default function ConfigQuestions() {
  const { canEdit } = useRole();
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [dimFilter, setDimFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<any>(null);

  const { data: questionsList, isLoading } = trpc.questions.list.useQuery({
    brandLine: brandFilter === "all" ? undefined : brandFilter,
    dimension: dimFilter === "all" ? undefined : dimFilter,
  });

  const utils = trpc.useUtils();

  const createMutation = trpc.questions.create.useMutation({
    onSuccess: () => {
      utils.questions.list.invalidate();
      setDialogOpen(false);
      toast.success("问题创建成功");
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.questions.update.useMutation({
    onSuccess: () => {
      utils.questions.list.invalidate();
      setDialogOpen(false);
      setEditingQuestion(null);
      toast.success("问题更新成功");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.questions.delete.useMutation({
    onSuccess: () => {
      utils.questions.list.invalidate();
      toast.success("问题已删除");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      questionId: formData.get("questionId") as string,
      text: formData.get("text") as string,
      brandLine: formData.get("brandLine") as any,
      dimension: formData.get("dimension") as any,
      language: formData.get("language") as any,
      status: formData.get("status") as any,
    };

    if (editingQuestion) {
      updateMutation.mutate({ ...data, questionId: editingQuestion.questionId });
    } else {
      createMutation.mutate(data);
    }
  };

  const openEdit = (q: any) => {
    setEditingQuestion(q);
    setDialogOpen(true);
  };

  const openCreate = () => {
    setEditingQuestion(null);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">问题库管理</h1>
          <p className="text-muted-foreground text-sm mt-1">
            管理GEO监测的问题集，共 {questionsList?.length || 0} 个问题
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} disabled={!canEdit}>
              <Plus className="h-4 w-4 mr-2" />
              新增问题
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingQuestion ? "编辑问题" : "新增问题"}</DialogTitle>
              <DialogDescription>
                {editingQuestion ? "修改问题信息" : "添加新的监测问题到问题库"}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="questionId">问题ID</Label>
                <Input
                  id="questionId"
                  name="questionId"
                  placeholder="如 SYC-CN-01"
                  defaultValue={editingQuestion?.questionId || ""}
                  disabled={!!editingQuestion}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="text">问题文本</Label>
                <Textarea
                  id="text"
                  name="text"
                  placeholder="输入完整的问题文本..."
                  defaultValue={editingQuestion?.text || ""}
                  rows={3}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>品牌线</Label>
                  <select
                    name="brandLine"
                    defaultValue={editingQuestion?.brandLine || "sun_yuchen"}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    required
                  >
                    {Object.entries(BRAND_LINE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>维度</Label>
                  <select
                    name="dimension"
                    defaultValue={editingQuestion?.dimension || "awareness"}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    required
                  >
                    {Object.entries(DIMENSION_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>语言</Label>
                  <select
                    name="language"
                    defaultValue={editingQuestion?.language || "zh-CN"}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    required
                  >
                    <option value="zh-CN">中文</option>
                    <option value="en-US">英文</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>状态</Label>
                  <select
                    name="status"
                    defaultValue={editingQuestion?.status || "active"}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    required
                  >
                    <option value="active">启用</option>
                    <option value="paused">暂停</option>
                    <option value="dynamic">动态</option>
                  </select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {editingQuestion ? "保存" : "创建"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-3">
        <Select value={brandFilter} onValueChange={setBrandFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="品牌线" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部品牌线</SelectItem>
            {Object.entries(BRAND_LINE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={dimFilter} onValueChange={setDimFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="维度" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部维度</SelectItem>
            {Object.entries(DIMENSION_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">加载中...</div>
      ) : !questionsList || questionsList.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Database className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium mb-2">暂无问题</h3>
            <p className="text-sm text-muted-foreground">点击「新增问题」按钮添加监测问题</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {questionsList.map((q) => (
            <Card key={q.questionId}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-xs font-mono text-muted-foreground">{q.questionId}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {BRAND_LINE_LABELS[q.brandLine as BrandLine]}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {DIMENSION_LABELS[q.dimension as Dimension]}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {q.language}
                      </Badge>
                      <Badge
                        variant={q.status === "active" ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {q.status === "active" ? "启用" : q.status === "paused" ? "暂停" : "动态"}
                      </Badge>
                    </div>
                    <p className="text-sm">{q.text}</p>
                  </div>
                  <div className={`flex gap-1 shrink-0${!canEdit ? " invisible" : ""}`}>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(q)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm("确定删除此问题？")) {
                          deleteMutation.mutate({ questionId: q.questionId });
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
