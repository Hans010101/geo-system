import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, CheckCircle, XCircle, MessageSquare, Mail, Bot } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

const SEVERITY_OPTIONS = [
  { value: "critical", label: "仅紧急" },
  { value: "high", label: "高及以上" },
  { value: "medium", label: "中及以上" },
  { value: "low", label: "全部等级" },
];

export default function NotificationSettings() {
  const { data: configs, isLoading } = trpc.notifications.listConfigs.useQuery();
  const { data: logs } = trpc.notifications.listLogs.useQuery({ limit: 10 });
  const utils = trpc.useUtils();

  const upsertMutation = trpc.notifications.upsertConfig.useMutation({
    onSuccess: () => { utils.notifications.listConfigs.invalidate(); toast.success("配置已保存"); },
    onError: (e) => toast.error(e.message),
  });

  const testMutation = trpc.notifications.testChannel.useMutation({
    onSuccess: (data) => {
      if (data.success) toast.success("测试消息发送成功");
      else toast.error(`发送失败: ${data.error}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // Local state for each channel
  const [feishu, setFeishu] = useState({ isEnabled: false, webhookUrl: "" });
  const [telegram, setTelegram] = useState({ isEnabled: false, botToken: "", chatId: "" });
  const [email, setEmail] = useState({ isEnabled: false, smtpHost: "", smtpPort: 465, smtpUser: "", smtpPass: "", emailFrom: "", emailTo: "" });
  const [rules, setRules] = useState({ minSeverity: "high", silentStart: "23:00", silentEnd: "08:00" });

  // Populate from server data
  useEffect(() => {
    if (!configs) return;
    for (const c of configs) {
      if (c.channel === "feishu") setFeishu({ isEnabled: c.isEnabled, webhookUrl: c.webhookUrl || "" });
      if (c.channel === "telegram") setTelegram({ isEnabled: c.isEnabled, botToken: c.botToken || "", chatId: c.chatId || "" });
      if (c.channel === "email") setEmail({
        isEnabled: c.isEnabled, smtpHost: c.smtpHost || "", smtpPort: c.smtpPort || 465,
        smtpUser: c.smtpUser || "", smtpPass: c.smtpPass || "", emailFrom: c.emailFrom || "",
        emailTo: Array.isArray(c.emailTo) ? (c.emailTo as string[]).join("\n") : "",
      });
      // Rules from any channel (they share the same global rules)
      setRules({ minSeverity: c.minSeverity || "high", silentStart: c.silentStart || "23:00", silentEnd: c.silentEnd || "08:00" });
    }
  }, [configs]);

  const saveChannel = (channel: "feishu" | "telegram" | "email") => {
    const base = { channel, minSeverity: rules.minSeverity as any, silentStart: rules.silentStart, silentEnd: rules.silentEnd };
    if (channel === "feishu") upsertMutation.mutate({ ...base, isEnabled: feishu.isEnabled, webhookUrl: feishu.webhookUrl || null });
    if (channel === "telegram") upsertMutation.mutate({ ...base, isEnabled: telegram.isEnabled, botToken: telegram.botToken || null, chatId: telegram.chatId || null });
    if (channel === "email") upsertMutation.mutate({
      ...base, isEnabled: email.isEnabled, smtpHost: email.smtpHost || null, smtpPort: email.smtpPort || null,
      smtpUser: email.smtpUser || null, smtpPass: email.smtpPass || null, emailFrom: email.emailFrom || null,
      emailTo: email.emailTo.split("\n").filter(Boolean) || null,
    });
  };

  const saveRules = () => {
    // Save rules to all existing channels
    const channels: ("feishu" | "telegram" | "email")[] = ["feishu", "telegram", "email"];
    for (const ch of channels) {
      const existing = configs?.find(c => c.channel === ch);
      if (existing) {
        upsertMutation.mutate({ channel: ch, minSeverity: rules.minSeverity as any, silentStart: rules.silentStart, silentEnd: rules.silentEnd });
      }
    }
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">通知推送设置</h2>
        <p className="text-sm text-muted-foreground">配置预警通知渠道，当检测到负面回答时自动推送</p>
      </div>

      {/* Three channel cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Feishu */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <MessageSquare className="h-4 w-4" /> 飞书
              </CardTitle>
              <Switch checked={feishu.isEnabled} onCheckedChange={(v) => setFeishu({ ...feishu, isEnabled: v })} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Webhook URL</Label>
              <Input placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." value={feishu.webhookUrl} onChange={(e) => setFeishu({ ...feishu, webhookUrl: e.target.value })} className="h-8 text-xs font-mono" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => saveChannel("feishu")} disabled={upsertMutation.isPending}>{upsertMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "保存"}</Button>
              <Button size="sm" variant="outline" onClick={() => testMutation.mutate({ channel: "feishu" })} disabled={testMutation.isPending || !feishu.webhookUrl}>
                {testMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Telegram */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Bot className="h-4 w-4" /> Telegram
              </CardTitle>
              <Switch checked={telegram.isEnabled} onCheckedChange={(v) => setTelegram({ ...telegram, isEnabled: v })} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Bot Token</Label>
              <Input type="password" placeholder="123456:ABC-DEF..." value={telegram.botToken} onChange={(e) => setTelegram({ ...telegram, botToken: e.target.value })} className="h-8 text-xs font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Chat ID</Label>
              <Input placeholder="-1001234567890" value={telegram.chatId} onChange={(e) => setTelegram({ ...telegram, chatId: e.target.value })} className="h-8 text-xs font-mono" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => saveChannel("telegram")} disabled={upsertMutation.isPending}>{upsertMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "保存"}</Button>
              <Button size="sm" variant="outline" onClick={() => testMutation.mutate({ channel: "telegram" })} disabled={testMutation.isPending || !telegram.botToken}>
                {testMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Email */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Mail className="h-4 w-4" /> 邮件
              </CardTitle>
              <Switch checked={email.isEnabled} onCheckedChange={(v) => setEmail({ ...email, isEnabled: v })} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-[10px]">SMTP Host</Label><Input value={email.smtpHost} onChange={(e) => setEmail({ ...email, smtpHost: e.target.value })} className="h-7 text-xs" placeholder="smtp.gmail.com" /></div>
              <div className="space-y-1"><Label className="text-[10px]">Port</Label><Input type="number" value={email.smtpPort} onChange={(e) => setEmail({ ...email, smtpPort: Number(e.target.value) })} className="h-7 text-xs" /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-[10px]">User</Label><Input value={email.smtpUser} onChange={(e) => setEmail({ ...email, smtpUser: e.target.value })} className="h-7 text-xs" /></div>
              <div className="space-y-1"><Label className="text-[10px]">Password</Label><Input type="password" value={email.smtpPass} onChange={(e) => setEmail({ ...email, smtpPass: e.target.value })} className="h-7 text-xs" /></div>
            </div>
            <div className="space-y-1"><Label className="text-[10px]">From</Label><Input value={email.emailFrom} onChange={(e) => setEmail({ ...email, emailFrom: e.target.value })} className="h-7 text-xs" placeholder="noreply@example.com" /></div>
            <div className="space-y-1"><Label className="text-[10px]">To (每行一个)</Label><textarea className="w-full rounded-md border px-2 py-1.5 text-xs h-14 resize-none" value={email.emailTo} onChange={(e) => setEmail({ ...email, emailTo: e.target.value })} placeholder="user1@example.com&#10;user2@example.com" /></div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => saveChannel("email")} disabled={upsertMutation.isPending}>{upsertMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "保存"}</Button>
              <Button size="sm" variant="outline" onClick={() => testMutation.mutate({ channel: "email" })} disabled={testMutation.isPending || !email.smtpHost}>
                {testMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Global rules */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">全局推送规则</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-6">
            <div className="space-y-1.5">
              <Label className="text-xs">最低推送等级</Label>
              <Select value={rules.minSeverity} onValueChange={(v) => setRules({ ...rules, minSeverity: v })}>
                <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERITY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">静默开始</Label>
              <Input type="time" value={rules.silentStart} onChange={(e) => setRules({ ...rules, silentStart: e.target.value })} className="w-[120px] h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">静默结束</Label>
              <Input type="time" value={rules.silentEnd} onChange={(e) => setRules({ ...rules, silentEnd: e.target.value })} className="w-[120px] h-8 text-xs" />
            </div>
            <Button size="sm" onClick={saveRules} disabled={upsertMutation.isPending}>
              {upsertMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
              保存规则
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">静默时间内的预警将被跳过（Asia/Shanghai 时区）</p>
        </CardContent>
      </Card>

      {/* Recent logs */}
      {logs && logs.data.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">最近推送记录</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {logs.data.map((log) => (
                <div key={log.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-border/50 last:border-0">
                  <Badge variant="outline" className="text-[9px] w-16 justify-center">{log.channel}</Badge>
                  {log.success ? <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" /> : <XCircle className="h-3 w-3 text-destructive shrink-0" />}
                  <span className="flex-1 truncate">{log.title}</span>
                  <span className="text-muted-foreground shrink-0">{new Date(log.createdAt).toLocaleString("zh-CN")}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
