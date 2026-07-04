import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const { data: emailCfg } = trpc.notifications.getEmailAlertConfig.useQuery();
  const utils = trpc.useUtils();

  const upsertMutation = trpc.notifications.upsertConfig.useMutation({
    onSuccess: () => { utils.notifications.listConfigs.invalidate(); toast.success("已保存"); },
    onError: (e) => toast.error(e.message),
  });
  const saveEmailM = trpc.notifications.setEmailAlertConfig.useMutation({
    onSuccess: () => { utils.notifications.getEmailAlertConfig.invalidate(); toast.success("邮件配置已保存"); setResendKey(""); setShowKeyEdit(false); },
    onError: (e) => toast.error(e.message),
  });
  const testEmailM = trpc.notifications.testEmailAlert.useMutation({
    onSuccess: (d) => toast[d.success ? "success" : "error"](d.success ? "测试邮件已发送,请查收" : `发送失败: ${d.error}`),
    onError: (e) => toast.error(e.message),
  });

  const [recipient, setRecipient] = useState("");
  const [resendKey, setResendKey] = useState("");
  const [resendFrom, setResendFrom] = useState("");
  const [showKeyEdit, setShowKeyEdit] = useState(false);
  const [rules, setRules] = useState({ minSeverity: "medium", silentStart: "23:00", silentEnd: "08:00" });

  useEffect(() => {
    if (configs) for (const c of configs) if (c.channel === "telegram") setRules({ minSeverity: c.minSeverity || "medium", silentStart: c.silentStart || "23:00", silentEnd: c.silentEnd || "08:00" });
  }, [configs]);
  useEffect(() => { if (emailCfg) { setRecipient(emailCfg.recipient || ""); setResendFrom(emailCfg.from || ""); } }, [emailCfg?.recipient, emailCfg?.from]);

  const saveEmail = () => saveEmailM.mutate({ recipient: recipient.trim() || undefined, from: resendFrom.trim() || undefined, apiKey: resendKey.trim() || undefined });
  const saveRules = () => {
    if (configs?.find((c) => c.channel === "telegram")) upsertMutation.mutate({ channel: "telegram", minSeverity: rules.minSeverity as any, silentStart: rules.silentStart, silentEnd: rules.silentEnd });
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
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><Mail className="h-4 w-4" /> 邮件预警</CardTitle>
              {emailCfg?.configured
                ? <Badge className="text-[10px] text-white border-0 bg-emerald-600">Resend 已配置</Badge>
                : <Badge variant="outline" className="text-[10px]">未配置</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* 收件邮箱:锁死单一地址(防误发) */}
            <div className="space-y-1">
              <Label className="text-xs">接收预警的邮箱</Label>
              <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="you@example.com" className="h-8 text-xs" />
              <p className="text-[11px] text-muted-foreground">需与 Resend 注册邮箱一致。当前用 Resend 测试发件地址,只能投递到该邮箱;如需发给多人,需在 Resend 验证自有域名。</p>
            </div>
            {/* Resend key:开发者一次性配置(密码框,不回显) */}
            {(!emailCfg?.configured || showKeyEdit) ? (
              <div className="rounded-md border border-dashed p-2 space-y-2">
                <p className="text-[11px] text-muted-foreground">到 resend.com 拿 API key,粘贴保存(仅存服务端,不回显):</p>
                <Input type="password" value={resendKey} onChange={(e) => setResendKey(e.target.value)} placeholder="re_xxx Resend API key" className="h-8 text-xs font-mono" />
                <Input value={resendFrom} onChange={(e) => setResendFrom(e.target.value)} placeholder="发件地址(默认 onboarding@resend.dev)" className="h-8 text-xs" />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">发件: {emailCfg.from}</span>
                <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setShowKeyEdit(true)} title="更换 key/发件地址"><Settings2 className="h-3 w-3" /></Button>
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={saveEmail} disabled={saveEmailM.isPending || !recipient.trim()} title={!recipient.trim() ? "请先填写收件邮箱(停用邮件请用监控页的实时推送总开关)" : undefined}>{saveEmailM.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "保存"}</Button>
              <Button size="sm" variant="outline" onClick={() => testEmailM.mutate()} disabled={testEmailM.isPending || !emailCfg?.configured || !emailCfg?.recipient}
                title={!emailCfg?.configured ? "先保存 Resend key" : !emailCfg?.recipient ? "先保存收件邮箱" : "发送测试邮件"}>
                {testEmailM.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
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
