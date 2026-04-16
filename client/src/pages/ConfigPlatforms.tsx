import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState, useMemo } from "react";
import {
  Settings, Loader2, Eye, EyeOff, Key, Globe2, Plus, Trash2, ChevronRight, Check, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import {
  PLATFORMS, PLATFORM_LABELS, PLATFORM_COLORS, PLATFORM_OPENROUTER_MODELS, PLATFORM_RECOMMENDED_PROVIDER, type Platform,
} from "@shared/geo-types";
import { useRole } from "@/hooks/useRole";

// All known platforms for coverage selector
const ALL_PLATFORMS_LIST = PLATFORMS as unknown as Platform[];

export default function ConfigPlatforms() {
  const { canEdit } = useRole();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState<any>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [tab, setTab] = useState("all");
  const [globalKeySheetOpen, setGlobalKeySheetOpen] = useState(false);
  const [addPlatformDialogOpen, setAddPlatformDialogOpen] = useState(false);
  const [deleteConfirmPlatform, setDeleteConfirmPlatform] = useState<string | null>(null);

  const { data: platformList, isLoading } = trpc.platformConfigs.list.useQuery();
  const { data: globalKeysList } = trpc.globalApiKeys.list.useQuery();
  const utils = trpc.useUtils();

  const upsertMutation = trpc.platformConfigs.upsert.useMutation({
    onSuccess: () => {
      utils.platformConfigs.list.invalidate();
      setEditDialogOpen(false);
      setAddPlatformDialogOpen(false);
      toast.success("平台配置已更新");
    },
    onError: (err) => toast.error(err.message),
  });

  const deletePlatformMutation = trpc.platformConfigs.delete.useMutation({
    onSuccess: () => {
      utils.platformConfigs.list.invalidate();
      setDeleteConfirmPlatform(null);
      toast.success("平台已删除");
    },
    onError: (err) => toast.error(err.message),
  });

  const getConfig = (platform: string) => platformList?.find((p) => p.platform === platform);

  const handleToggle = (platform: string, currentEnabled: boolean) => {
    const config = getConfig(platform);
    upsertMutation.mutate({
      platform,
      displayName: config?.displayName || PLATFORM_LABELS[platform as Platform] || platform,
      isEnabled: !currentEnabled,
      modelVersion: config?.modelVersion || undefined,
      collectFrequency: config?.collectFrequency || "weekly",
    });
  };

  const handleEdit = (platform: string) => {
    const config = getConfig(platform);
    setEditingPlatform({
      platform,
      displayName: config?.displayName || PLATFORM_LABELS[platform as Platform] || platform,
      modelVersion: config?.modelVersion || PLATFORM_OPENROUTER_MODELS[platform as Platform] || "",
      collectFrequency: config?.collectFrequency || "weekly",
      isEnabled: config?.isEnabled ?? true,
      apiKeyEncrypted: config?.apiKeyEncrypted || "",
      apiBaseUrl: config?.apiBaseUrl || "",
    });
    setShowApiKey(false);
    setEditDialogOpen(true);
  };

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    upsertMutation.mutate({
      platform: editingPlatform.platform,
      displayName: formData.get("displayName") as string,
      modelVersion: (formData.get("modelVersion") as string) || undefined,
      collectFrequency: (formData.get("collectFrequency") as string) || "weekly",
      isEnabled: editingPlatform.isEnabled,
      apiKeyEncrypted: (formData.get("apiKeyEncrypted") as string) || null,
      apiBaseUrl: (formData.get("apiBaseUrl") as string) || null,
    });
  };

  // Platforms that are configured in DB
  const configuredPlatforms = useMemo(() => {
    return platformList?.map((p) => p.platform) || [];
  }, [platformList]);

  // Platforms to show per tab
  const cnPlatforms = ["wenxin", "doubao", "kimi", "deepseek", "minimax", "tongyi", "zhipu", "baichuan", "hunyuan", "tiangong"];
  const intlPlatforms = ["chatgpt", "perplexity", "gemini", "claude", "copilot", "mistral", "grok", "llama"];

  const enabledCount = platformList?.filter((p) => p.isEnabled).length || 0;
  const globalKeyCount = globalKeysList?.filter((k) => k.isActive).length || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">平台配置</h1>
        <p className="text-muted-foreground text-sm mt-1">
          管理AI平台的启用状态、API密钥和采集参数。共 {configuredPlatforms.length} 个平台，已启用 {enabledCount} 个。
        </p>
      </div>

      {/* Global API Config Card - clickable */}
      <Card
        className="cursor-pointer hover:shadow-md transition-shadow border-primary/20 hover:border-primary/40"
        onClick={() => setGlobalKeySheetOpen(true)}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Key className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold">全局 API 配置</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                支持 OpenRouter / 阿里百炼 等聚合平台，通过一个 API Key 调用所有模型
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant={globalKeyCount > 0 ? "default" : "secondary"}>
                {globalKeyCount > 0 ? `已配置 ${globalKeyCount} 个全局Key` : "未配置全局Key"}
              </Badge>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
          {globalKeysList && globalKeysList.length > 0 && (
            <div className="mt-3 pl-[52px] flex flex-wrap gap-2">
              {globalKeysList.map((k) => (
                <Badge key={k.id} variant={k.isActive ? "outline" : "secondary"} className="text-xs gap-1">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: k.isActive ? "#22c55e" : "#9ca3af" }}
                  />
                  {k.name}
                  {Array.isArray(k.coveredPlatforms) && (k.coveredPlatforms as string[]).length > 0 && (
                    <span className="text-muted-foreground">
                      · {`${(k.coveredPlatforms as string[]).length}`} 个平台
                    </span>
                  )}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Platform tabs + Add button */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="all">全部 ({configuredPlatforms.length})</TabsTrigger>
            <TabsTrigger value="cn">国内 ({configuredPlatforms.filter(p => cnPlatforms.includes(p)).length})</TabsTrigger>
            <TabsTrigger value="intl">国际 ({configuredPlatforms.filter(p => intlPlatforms.includes(p)).length})</TabsTrigger>
          </TabsList>
          <Button size="sm" onClick={() => setAddPlatformDialogOpen(true)} className="gap-1.5" disabled={!canEdit}>
            <Plus className="h-4 w-4" />
            添加平台
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <TabsContent value="all" className="space-y-4 mt-4">
              <PlatformGroupCollapsible
                title="国内平台"
                platforms={configuredPlatforms.filter(p => cnPlatforms.includes(p))}
                platformList={platformList}
                getConfig={getConfig}
                canEdit={canEdit}
                upsertMutation={upsertMutation}
                handleToggle={handleToggle}
                handleEdit={handleEdit}
                setDeleteConfirmPlatform={setDeleteConfirmPlatform}
              />
              <PlatformGroupCollapsible
                title="国际平台"
                platforms={configuredPlatforms.filter(p => intlPlatforms.includes(p))}
                platformList={platformList}
                getConfig={getConfig}
                canEdit={canEdit}
                upsertMutation={upsertMutation}
                handleToggle={handleToggle}
                handleEdit={handleEdit}
                setDeleteConfirmPlatform={setDeleteConfirmPlatform}
              />
            </TabsContent>

            <TabsContent value="cn" className="mt-4">
              <PlatformGrid
                platforms={configuredPlatforms.filter(p => cnPlatforms.includes(p))}
                getConfig={getConfig}
                canEdit={canEdit}
                upsertMutation={upsertMutation}
                handleToggle={handleToggle}
                handleEdit={handleEdit}
                setDeleteConfirmPlatform={setDeleteConfirmPlatform}
              />
            </TabsContent>

            <TabsContent value="intl" className="mt-4">
              <PlatformGrid
                platforms={configuredPlatforms.filter(p => intlPlatforms.includes(p))}
                getConfig={getConfig}
                canEdit={canEdit}
                upsertMutation={upsertMutation}
                handleToggle={handleToggle}
                handleEdit={handleEdit}
                setDeleteConfirmPlatform={setDeleteConfirmPlatform}
              />
            </TabsContent>

          </>
        )}
      </Tabs>

      {/* ========== Global API Keys Sheet ========== */}
      <GlobalApiKeysSheet
        open={globalKeySheetOpen}
        onClose={() => setGlobalKeySheetOpen(false)}
        globalKeysList={globalKeysList || []}
        allPlatforms={configuredPlatforms}
      />

      {/* ========== Edit Platform Dialog ========== */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingPlatform && (
                <div
                  className="h-6 w-6 rounded flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: PLATFORM_COLORS[editingPlatform.platform as Platform] || "#6b7280" }}
                >
                  {(editingPlatform.displayName || editingPlatform.platform).charAt(0)}
                </div>
              )}
              配置 {editingPlatform?.displayName}
            </DialogTitle>
          </DialogHeader>
          {editingPlatform && (
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">基本设置</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">显示名称</Label>
                    <Input name="displayName" defaultValue={editingPlatform.displayName} required className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">采集频率</Label>
                    <select
                      name="collectFrequency"
                      defaultValue={editingPlatform.collectFrequency}
                      className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    >
                      <option value="daily">每日</option>
                      <option value="weekly">每周</option>
                      <option value="biweekly">每两周</option>
                      <option value="monthly">每月</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">模型版本 / Model ID</Label>
                  <Input
                    name="modelVersion"
                    placeholder={PLATFORM_OPENROUTER_MODELS[editingPlatform.platform as Platform] || "如 openai/gpt-4o"}
                    defaultValue={editingPlatform.modelVersion}
                    className="h-8 text-sm font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    OpenRouter 格式: provider/model-name，百炼格式: qwen-plus，留空使用默认
                  </p>
                </div>
              </div>

              <div className="space-y-3 border-t pt-4">
                <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Globe2 className="h-3.5 w-3.5" />
                  独立 API 配置（可选，覆盖全局设置）
                </h4>
                <div className="space-y-1.5">
                  <Label className="text-xs">API Base URL</Label>
                  <Input
                    name="apiBaseUrl"
                    placeholder="https://openrouter.ai/api/v1"
                    defaultValue={editingPlatform.apiBaseUrl}
                    className="h-8 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">API Key</Label>
                  <div className="relative">
                    <Input
                      name="apiKeyEncrypted"
                      type={showApiKey ? "text" : "password"}
                      placeholder="sk-... 留空则使用全局 API Key"
                      defaultValue={editingPlatform.apiKeyEncrypted}
                      className="h-8 text-sm font-mono pr-9"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowApiKey(!showApiKey)}
                    >
                      {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>取消</Button>
                <Button type="submit" disabled={upsertMutation.isPending}>
                  {upsertMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  保存
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ========== Add Platform Dialog ========== */}
      <AddPlatformDialog
        open={addPlatformDialogOpen}
        onClose={() => setAddPlatformDialogOpen(false)}
        existingPlatforms={configuredPlatforms}
        onAdd={(data) => upsertMutation.mutate(data)}
        isPending={upsertMutation.isPending}
      />

      {/* ========== Delete Confirm ========== */}
      <AlertDialog open={!!deleteConfirmPlatform} onOpenChange={(o) => !o && setDeleteConfirmPlatform(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除平台配置</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除平台 <strong>{deleteConfirmPlatform}</strong> 的配置吗？
              已有的采集记录不会被删除，但该平台将不再出现在配置列表中。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteConfirmPlatform && deletePlatformMutation.mutate({ platform: deleteConfirmPlatform })}
            >
              {deletePlatformMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ==================== Platform Grid & Collapsible ==================== */

function PlatformCard({
  platform, getConfig, canEdit, upsertMutation, handleToggle, handleEdit, setDeleteConfirmPlatform,
}: {
  platform: string;
  getConfig: (p: string) => any;
  canEdit: boolean;
  upsertMutation: { isPending: boolean };
  handleToggle: (p: string, enabled: boolean) => void;
  handleEdit: (p: string) => void;
  setDeleteConfirmPlatform: (p: string | null) => void;
}) {
  const config = getConfig(platform);
  const isEnabled = config?.isEnabled ?? false;
  const hasCustomApi = !!(config?.apiKeyEncrypted || config?.apiBaseUrl);
  const label = config?.displayName || PLATFORM_LABELS[platform as Platform] || platform;
  const color = PLATFORM_COLORS[platform as Platform] || "#6b7280";

  return (
    <Card className={!isEnabled ? "opacity-60" : ""}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div
              className="h-9 w-9 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0"
              style={{ backgroundColor: color }}
            >
              {label.charAt(0)}
            </div>
            <div>
              <h3 className="font-semibold text-sm">{label}</h3>
              <p className="text-[10px] text-muted-foreground">{platform}</p>
            </div>
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={() => handleToggle(platform, isEnabled)}
            disabled={upsertMutation.isPending || !canEdit}
          />
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">模型</span>
            <span className="truncate max-w-[140px]">
              {config?.modelVersion || PLATFORM_OPENROUTER_MODELS[platform as Platform] || "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">频率</span>
            <span>{config?.collectFrequency || "weekly"}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">API</span>
            {hasCustomApi ? (
              <Badge variant="outline" className="text-[10px] px-1.5 text-emerald-600 border-emerald-600">
                <Key className="h-2.5 w-2.5 mr-0.5" />
                独立配置
              </Badge>
            ) : (
              <span className="text-muted-foreground">使用全局</span>
            )}
          </div>
          {PLATFORM_RECOMMENDED_PROVIDER[platform as Platform] && !hasCustomApi && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">推荐</span>
              <span className="text-[10px] text-orange-600">推荐{PLATFORM_RECOMMENDED_PROVIDER[platform as Platform]}</span>
            </div>
          )}
        </div>

        <div className={`flex gap-2 mt-3${!canEdit ? " invisible" : ""}`}>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => handleEdit(platform)}
          >
            <Settings className="h-3.5 w-3.5 mr-1.5" />
            配置
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
            onClick={() => setDeleteConfirmPlatform(platform)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type PlatformGridProps = {
  platforms: string[];
  getConfig: (p: string) => any;
  canEdit: boolean;
  upsertMutation: { isPending: boolean };
  handleToggle: (p: string, enabled: boolean) => void;
  handleEdit: (p: string) => void;
  setDeleteConfirmPlatform: (p: string | null) => void;
};

function PlatformGrid(props: PlatformGridProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {props.platforms.map((platform) => (
        <PlatformCard key={platform} platform={platform} {...props} />
      ))}
    </div>
  );
}

function PlatformGroupCollapsible({
  title, platforms, platformList, ...gridProps
}: PlatformGridProps & { title: string; platformList: any[] | undefined }) {
  const enabledCount = platforms.filter(p => platformList?.find(c => c.platform === p)?.isEnabled).length;

  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="flex items-center gap-2 w-full group">
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
        <span className="text-sm font-medium">{title}</span>
        <Badge variant="secondary" className="text-[10px]">{enabledCount}/{platforms.length} 启用</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3">
        <PlatformGrid platforms={platforms} {...gridProps} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ==================== Global API Keys Sheet ==================== */
function GlobalApiKeysSheet({
  open, onClose, globalKeysList, allPlatforms,
}: {
  open: boolean;
  onClose: () => void;
  globalKeysList: any[];
  allPlatforms: string[];
}) {
  const { canEdit } = useRole();
  const utils = trpc.useUtils();
  const [editingKey, setEditingKey] = useState<any>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);

  const upsertMutation = trpc.globalApiKeys.upsert.useMutation({
    onSuccess: () => {
      utils.globalApiKeys.list.invalidate();
      setEditingKey(null);
      toast.success("全局API配置已保存");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.globalApiKeys.delete.useMutation({
    onSuccess: () => {
      utils.globalApiKeys.list.invalidate();
      toast.success("已删除");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleEdit = (key: any) => {
    setEditingKey({ ...key, newApiKey: "" });
    setSelectedPlatforms(Array.isArray(key.coveredPlatforms) ? key.coveredPlatforms as string[] : []);
    setShowApiKey(false);
  };

  const handleNew = () => {
    setEditingKey({ id: undefined, name: "", newApiKey: "", baseUrl: "", isActive: true });
    setSelectedPlatforms([]);
    setShowApiKey(false);
  };

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingKey?.name?.trim()) { toast.error("请输入名称"); return; }
    if (!editingKey?.id && !editingKey?.baseUrl?.trim()) { toast.error("请输入 API Base URL"); return; }
    if (!editingKey?.id && !editingKey?.newApiKey?.trim()) { toast.error("请输入 API Key"); return; }
    upsertMutation.mutate({
      id: editingKey?.id,
      name: editingKey.name.trim(),
      apiKey: editingKey.newApiKey?.trim() || null,
      baseUrl: editingKey.baseUrl?.trim() || null,
      coveredPlatforms: selectedPlatforms,
      isActive: editingKey?.isActive ?? true,
      sortOrder: editingKey?.sortOrder ?? globalKeysList.length,
    });
  };

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]
    );
  };

  const selectAll = () => setSelectedPlatforms([...allPlatforms]);
  const clearAll = () => setSelectedPlatforms([]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            全局 API 配置
          </SheetTitle>
          <SheetDescription>
            配置聚合平台（OpenRouter、阿里百炼等），最多支持 4 个。每个全局Key可指定覆盖哪些模型。
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Existing keys list */}
          {globalKeysList.length === 0 && !editingKey && (
            <div className="text-center py-8 text-muted-foreground">
              <Key className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">尚未配置全局API Key</p>
              <p className="text-xs mt-1">添加后可通过一个Key调用多个AI平台</p>
            </div>
          )}

          {globalKeysList.map((key) => (
            <Card key={key.id} className={!key.isActive ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: key.isActive ? "#22c55e" : "#9ca3af" }} />
                    <h4 className="font-semibold text-sm">{key.name}</h4>
                  </div>
                  <div className={`flex items-center gap-1${!canEdit ? " invisible" : ""}`}>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleEdit(key)}>
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate({ id: key.id })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="text-xs space-y-1">
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-16 shrink-0">Base URL</span>
                    <span className="font-mono truncate">{key.baseUrl || "—"}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-16 shrink-0">API Key</span>
                    <span className="font-mono">{key.apiKey ? "••••••••" + key.apiKey.slice(-4) : "—"}</span>
                  </div>
                  <div className="flex gap-2 items-start">
                    <span className="text-muted-foreground w-16 shrink-0 mt-0.5">覆盖平台</span>
                    <div className="flex flex-wrap gap-1">
                      {Array.isArray(key.coveredPlatforms) && (key.coveredPlatforms as string[]).length > 0 ? (
                        (key.coveredPlatforms as string[]).map((p) => (
                          <Badge key={p} variant="secondary" className="text-[10px] px-1.5">
                            {PLATFORM_LABELS[p as Platform] || p}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-muted-foreground">未指定（不自动覆盖）</span>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Add new key button */}
          {globalKeysList.length < 4 && !editingKey && (
            <Button variant="outline" className="w-full gap-2" onClick={handleNew} disabled={!canEdit}>
              <Plus className="h-4 w-4" />
              添加全局 API Key（{globalKeysList.length}/4）
            </Button>
          )}

          {/* Edit/Create form */}
          {editingKey && (
            <Card className="border-primary/30">
              <CardContent className="p-4">
                <h4 className="text-sm font-semibold mb-4">
                  {editingKey.id ? "编辑" : "新增"} 全局 API Key
                </h4>
                <form onSubmit={handleSave} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">名称（如：阿里百炼、OpenRouter）</Label>
                    <Input
                      placeholder="阿里百炼"
                      value={editingKey.name || ""}
                      onChange={(e) => setEditingKey({ ...editingKey, name: e.target.value })}
                      required
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">API Base URL</Label>
                    <Input
                      placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                      value={editingKey.baseUrl || ""}
                      onChange={(e) => setEditingKey({ ...editingKey, baseUrl: e.target.value })}
                      className="h-8 text-sm font-mono"
                      required={!editingKey.id}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      百炼: https://dashscope.aliyuncs.com/compatible-mode/v1<br />
                      OpenRouter: https://openrouter.ai/api/v1
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">API Key {editingKey.id ? "(留空保持不变)" : ""}</Label>
                    <div className="relative">
                      <Input
                        type={showApiKey ? "text" : "password"}
                        placeholder={editingKey.id ? "留空保持当前 Key 不变" : "sk-..."}
                        value={editingKey.newApiKey || ""}
                        onChange={(e) => setEditingKey({ ...editingKey, newApiKey: e.target.value })}
                        className="h-8 text-sm font-mono pr-9"
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowApiKey(!showApiKey)}
                      >
                        {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Platform coverage selector */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">覆盖的平台（此Key将用于这些平台的采集）</Label>
                      <div className="flex gap-1">
                        <button type="button" className="text-[10px] text-primary hover:underline" onClick={selectAll}>全选</button>
                        <span className="text-[10px] text-muted-foreground">·</span>
                        <button type="button" className="text-[10px] text-muted-foreground hover:underline" onClick={clearAll}>清空</button>
                      </div>
                    </div>
                    <ScrollArea className="h-[160px] rounded-md border p-2">
                      <div className="grid grid-cols-2 gap-1.5">
                        {allPlatforms.map((p) => (
                          <label key={p} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-2 py-1">
                            <Checkbox
                              checked={selectedPlatforms.includes(p)}
                              onCheckedChange={() => togglePlatform(p)}
                              className="h-3.5 w-3.5"
                            />
                            <span className="text-xs">{PLATFORM_LABELS[p as Platform] || p}</span>
                          </label>
                        ))}
                      </div>
                    </ScrollArea>
                    <p className="text-[10px] text-muted-foreground">
                      已选 {selectedPlatforms.length} 个平台。若不选择，此Key不会自动覆盖任何平台（需在平台配置中手动指定）。
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={editingKey.isActive}
                      onCheckedChange={(v) => setEditingKey({ ...editingKey, isActive: v })}
                    />
                    <Label className="text-xs">启用此Key</Label>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => setEditingKey(null)}>
                      取消
                    </Button>
                    <Button type="submit" size="sm" className="flex-1" disabled={upsertMutation.isPending || !canEdit}>
                      {upsertMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                        <><Check className="h-4 w-4 mr-1" />保存</>
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ==================== Add Platform Dialog ==================== */
function AddPlatformDialog({
  open, onClose, existingPlatforms, onAdd, isPending,
}: {
  open: boolean;
  onClose: () => void;
  existingPlatforms: string[];
  onAdd: (data: any) => void;
  isPending: boolean;
}) {
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [customPlatform, setCustomPlatform] = useState("");
  const [customName, setCustomName] = useState("");
  const [customModel, setCustomModel] = useState("");

  const presetOptions = ALL_PLATFORMS_LIST.filter((p) => !existingPlatforms.includes(p));

  const handleAddPreset = (platform: Platform) => {
    onAdd({
      platform,
      displayName: PLATFORM_LABELS[platform],
      isEnabled: true,
      modelVersion: PLATFORM_OPENROUTER_MODELS[platform] || undefined,
      collectFrequency: "weekly",
    });
  };

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPlatform.trim() || !customName.trim()) return;
    onAdd({
      platform: customPlatform.trim().toLowerCase().replace(/\s+/g, "_"),
      displayName: customName.trim(),
      isEnabled: true,
      modelVersion: customModel.trim() || undefined,
      collectFrequency: "weekly",
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>添加平台</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          <Button
            variant={mode === "preset" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("preset")}
          >
            从预设选择
          </Button>
          <Button
            variant={mode === "custom" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("custom")}
          >
            自定义平台
          </Button>
        </div>

        {mode === "preset" ? (
          <div>
            {presetOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">所有预设平台已添加</p>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="grid grid-cols-2 gap-2">
                  {presetOptions.map((platform) => (
                    <button
                      key={platform}
                      className="flex items-center gap-2 rounded-lg border p-3 text-left hover:bg-muted/50 transition-colors"
                      onClick={() => handleAddPreset(platform)}
                      disabled={isPending}
                    >
                      <div
                        className="h-8 w-8 rounded flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: PLATFORM_COLORS[platform] || "#6b7280" }}
                      >
                        {PLATFORM_LABELS[platform].charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{PLATFORM_LABELS[platform]}</p>
                        <p className="text-[10px] text-muted-foreground">{platform}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        ) : (
          <form onSubmit={handleAddCustom} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">平台标识（英文，如 my_ai）</Label>
              <Input
                value={customPlatform}
                onChange={(e) => setCustomPlatform(e.target.value)}
                placeholder="my_ai_platform"
                className="h-8 text-sm font-mono"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">显示名称</Label>
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="我的AI平台"
                className="h-8 text-sm"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">默认模型ID（可选）</Label>
              <Input
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="openai/gpt-4o 或 qwen-plus"
                className="h-8 text-sm font-mono"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>取消</Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "添加"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
