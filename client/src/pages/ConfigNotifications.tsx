import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, CheckCircle, XCircle, Mail, Bot, Settings2 } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import TelegramConnect from "@/components/TelegramConnect";

const SEVERITY_OPTIONS = [
  { value: "critical", label: "仅紧急" },
  { value: "high", label: "高及以上" },
  { value: "medium", label: "中及以上(推荐)" },
  { value: "low", label: "全部等级" },
];

export default function NotificationSettings() {
  const { data: configs, isLoading } = trpc.notifications.listConfigs.useQuery();
  const { data: logs } = trpc.notifications.listLogs.useQuery({ limit: 10 });
  const { data: resend } = trpc.notifications.getResendConfig.useQuery();
  const utils = trpc.useUtils();

  const upsertMutation = trpc.notifications.upsertConfig.useMutation({
    onSuccess: () => { utils.notifications.listConfigs.invalidate(); toast.success("已保存"); },
    onError: (e) => toast.error(e.message),
  });
  const testMutation = trpc.notifications.testChannel.useMutation({
    onSuccess: (d) => toast[d.success ? "success" : "error"](d.success ? "测试消息已发送" : `发送失败: ${d.error}`),
    onError: (e) => toast.error(e.message),
  });
  const saveResend = trpc.notifications.setResendConfig.useMutation({
    onSuccess: () => { utils.notifications.getResendConfig.invalidate(); toast.success("Resend 配置已保存"); setResendKey(""); setShowResendSetup(false); },
    onError: (e) => toast.error(e.message),
  });

  const [email, setEmail] = useState({ isEnabled: false, emailTo: "" });
  const [rules, setRules] = useState({ minSeverity: "medium", silentStart: "23:00", silentEnd: "08:00" });
  const [resendKey, setResendKey] = useState("");
  const [resendFrom, setResendFrom] = useState("");
  const [showResendSetup, setShowResendSetup] = useState(false);

  useEffect(() => {
    if (!configs) return;
    for (const c of configs) {
      if (c.channel === "email") setEmail({ isEnabled: c.isEnabled, emailTo: Array.isArray(c.emailTo) ? (c.emailTo as string[]).join("\n") : "" });
      setRules({ minSeverity: c.minSeverity || "medium", silentStart: c.silentStart || "23:00", silentEnd: c.silentEnd || "08:00" });
    }
  }, [configs]);
  useEffect(() => { if (resend?.from) setResendFrom(resend.from); }, [resend?.from]);

  const saveEmail = () => upsertMutation.mutate({
    channel: "email", isEnabled: email.isEnabled,
    emailTo: email.emailTo.split("\n").map((s) => s.trim()).filter(Boolean),
    minSeverity: rules.minSeverity as any, silentStart: rules.silentStart, silentEnd: rules.silentEnd,
  });
  const saveRules = () => {
    for (const ch of ["telegram", "email"] as const) {
      if (configs?.find((c) => c.channel === ch)) upsertMutation.mutate({ channel: ch, minSeverity: rules.minSeverity as any, silentStart: rules.silentStart, silentEnd: rules.silentEnd });
    }
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">通知推送设置</h2>
        <p className="text-sm text-muted-foreground">两个渠道:邮件(Resend)与 Telegram(自助绑定)。检测到负面舆情时按下方规则推送。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 邮件 (Resend) */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><Mail className="h-4 w-4" /> 邮件</CardTitle>
              <Switch checked={email.isEnabled} onCheckedChange={(v) => setEmail({ ...email, isEnabled: v })} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* 系统级 Resend 配置(开发者一次性) */}
            {!resend?.configured ? (
              <div className="rounded-md border border-dashed p-2 space-y-2">
                <p className="text-[11px] text-muted-foreground">⚠️ 管理员未配置 Resend 发件服务。到 resend.com 拿 API key(用户有账户),粘贴保存:</p>
                <Input type="password" value={resendKey} onChange={(e) => setResendKey(e.target.value)} placeholder="re_xxx Resend API key" className="h-8 text-xs font-mono" />
                <Input value={resendFrom} onChange={(e) => setResendFrom(e.target.value)} placeholder="发件地址(已验证域名;未验证用 onboarding@resend.dev)" className="h-8 text-xs" />
                <Button size="sm" className="h-8 w-full" disabled={saveResend.isPending || resendKey.length < 10} onClick={() => saveResend.mutate({ apiKey: resendKey, from: resendFrom })}>
                  {saveResend.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "保存 Resend 配置"}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Badge className="text-[10px] text-white border-0 bg-emerald-600">Resend 已配置</Badge>
                <span className="truncate">发件: {resend.from}</span>
                <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setShowResendSetup((s) => !s)} title="更换 key/发件地址"><Settings2 className="h-3 w-3" /></Button>
              </div>
            )}
            {resend?.configured && showResendSetup && (
              <div className="rounded-md border border-dashed p-2 space-y-2">
                <Input type="password" value={resendKey} onChange={(e) => setResendKey(e.target.value)} placeholder="新 Resend API key(留空则只改发件地址)" className="h-8 text-xs font-mono" />
                <Input value={resendFrom} onChange={(e) => setResendFrom(e.target.value)} placeholder="发件地址" className="h-8 text-xs" />
                <Button size="sm" className="h-8 w-full" disabled={saveResend.isPending} onClick={() => saveResend.mutate({ apiKey: resendKey || undefined, from: resendFrom })}>更新</Button>
              </div>
            )}
            {/* 用户级:只填收件邮箱 */}
            <div className="space-y-1">
              <Label className="text-xs">接收预警的邮箱(每行一个)</Label>
              <textarea className="w-full rounded-md border px-2 py-1.5 text-xs h-16 resize-none" value={email.emailTo}
                onChange={(e) => setEmail({ ...email, emailTo: e.target.value })} placeholder={"you@example.com\nteam@example.com"} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={saveEmail} disabled={upsertMutation.isPending}>{upsertMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "保存"}</Button>
              <Button size="sm" variant="outline" onClick={() => testMutation.mutate({ channel: "email" })} disabled={testMutation.isPending || !email.emailTo.trim() || !resend?.configured} title={!resend?.configured ? "先配置 Resend" : "发送测试邮件"}>
                {testMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Telegram (自助绑定) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Bot className="h-4 w-4" /> Telegram</CardTitle>
          </CardHeader>
          <CardContent>
            <TelegramConnect />
            <p className="text-[11px] text-muted-foreground mt-2">点「连接」→ 扫码/点链接 → 在 Telegram 点开始,即自动完成绑定(无需填 token/chat id)。</p>
          </CardContent>
        </Card>
      </div>

      {/* 全局推送规则 */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">全局推送规则</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-6">
            <div className="space-y-1.5">
              <Label className="text-xs">最低推送等级</Label>
              <Select value={rules.minSeverity} onValueChange={(v) => setRules({ ...rules, minSeverity: v })}>
                <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{SEVERITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">静默开始</Label><Input type="time" value={rules.silentStart} onChange={(e) => setRules({ ...rules, silentStart: e.target.value })} className="w-[120px] h-8 text-xs" /></div>
            <div className="space-y-1.5"><Label className="text-xs">静默结束</Label><Input type="time" value={rules.silentEnd} onChange={(e) => setRules({ ...rules, silentEnd: e.target.value })} className="w-[120px] h-8 text-xs" /></div>
            <Button size="sm" onClick={saveRules} disabled={upsertMutation.isPending}>{upsertMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}保存规则</Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">静默时间内的预警将被跳过(Asia/Shanghai)。简报/实时预警的总开关在「舆情监控」页。</p>
        </CardContent>
      </Card>

      {/* 最近推送记录 */}
      {logs && logs.data.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">最近推送记录</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {logs.data.map((l) => (
                <div key={l.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-border/50 last:border-0">
                  <Badge variant="outline" className="text-[9px] w-16 justify-center">{l.channel}</Badge>
                  {l.success ? <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" /> : <XCircle className="h-3 w-3 text-destructive shrink-0" />}
                  <span className="flex-1 truncate">{l.title}</span>
                  <span className="text-muted-foreground shrink-0">{new Date(l.createdAt).toLocaleString("zh-CN")}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
