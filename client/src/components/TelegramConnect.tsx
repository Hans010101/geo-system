import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { trpc } from "@/lib/trpc";
import { useRole } from "@/hooks/useRole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Send, Loader2, Check, Unlink, Settings2 } from "lucide-react";

// Self-service Telegram binding: click 连接 → open t.me link / scan QR → press Start → auto-bound.
export default function TelegramConnect() {
  const { isAdmin } = useRole();
  const utils = trpc.useUtils();
  const [bindCode, setBindCode] = useState<string | null>(null);
  const [link, setLink] = useState<string>("");
  const [qr, setQr] = useState<string>("");
  const [showSetup, setShowSetup] = useState(false);
  const [token, setToken] = useState("");

  // While waiting for the user to press Start, poll status until it flips to bound.
  const { data: st } = trpc.monitor.telegramStatus.useQuery(undefined, {
    refetchInterval: bindCode ? 3000 : false,
  });

  useEffect(() => {
    if (bindCode && st?.bound) {
      setBindCode(null); setLink(""); setQr("");
      toast.success("Telegram 已连接 ✓");
    }
  }, [st?.bound, bindCode]);

  const createCode = trpc.monitor.telegramCreateBindCode.useMutation({
    onSuccess: async (r) => {
      if (!r.ok || !r.link) { toast.error(r.error || "生成失败"); return; }
      setBindCode(r.code!); setLink(r.link);
      try { setQr(await QRCode.toDataURL(r.link, { width: 176, margin: 1 })); } catch {}
    },
    onError: (e) => toast.error(e.message),
  });
  const setTokenM = trpc.monitor.telegramSetBotToken.useMutation({
    onSuccess: (r) => {
      if (!r.ok) { toast.error(r.error || "配置失败"); return; }
      setToken(""); setShowSetup(false); utils.monitor.telegramStatus.invalidate();
      if (r.rebindNeeded) toast.warning(`已切换到 @${r.username}。换 bot 后旧 chat 全部失效,请所有人重新「连接 Telegram」。`);
      else toast.success(`机器人 @${r.username} 已配置${r.webhookOk ? " + Webhook 已注册" : "(⚠ Webhook 注册失败,请重试)"}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const setupHook = trpc.monitor.telegramSetupWebhook.useMutation({
    onSuccess: (r) => toast[r.ok ? "success" : "error"](r.ok ? "Webhook 已注册" : r.error || "失败"),
    onError: (e) => toast.error(e.message),
  });
  const sendTest = trpc.monitor.telegramSendTest.useMutation({
    onSuccess: (r) => toast[r.ok ? "success" : "error"](r.ok ? "测试消息已发送" : r.error || "发送失败"),
    onError: (e) => toast.error(e.message),
  });
  const unbind = trpc.monitor.telegramUnbind.useMutation({
    onSuccess: () => { toast.success("已断开 Telegram"); utils.monitor.telegramStatus.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  if (!st) return null;

  // ---- Bot not configured yet ----
  if (!st.botConfigured) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-dashed px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Telegram 预警</span>
          <Badge variant="secondary" className="text-[10px]">机器人未配置</Badge>
        </div>
        {isAdmin ? (
          <>
            <p className="text-[11px] text-muted-foreground">
              开发者一次性配置:@BotFather 建 bot(建议 /revoke 旧 token 后)拿 token 粘贴 →「配置」→「注册 Webhook」。用户无需碰 token。
            </p>
            <div className="flex items-center gap-2">
              <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456:ABC-DEF... bot token" className="h-8 text-xs" type="password" />
              <Button size="sm" className="h-8" disabled={setTokenM.isPending || token.length < 20} onClick={() => setTokenM.mutate({ token })}>
                {setTokenM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "配置"}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">机器人尚未配置,请联系管理员。</p>
        )}
      </div>
    );
  }

  // ---- Bound ----
  if (st.bound) {
    return (
      <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs flex-wrap">
        <Badge className="text-[10px] text-white border-0 bg-emerald-600"><Check className="h-3 w-3 mr-0.5" />Telegram 已连接</Badge>
        <span className="text-muted-foreground">
          {st.bound.chatTitle || st.bound.chatId}{st.bound.chatType ? `（${st.bound.chatType === "private" ? "私聊" : "群组"}）` : ""}
        </span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={sendTest.isPending} onClick={() => sendTest.mutate()}>
          {sendTest.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Send className="h-3 w-3 mr-1" />发送测试</>}
        </Button>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-orange-600" disabled={unbind.isPending} onClick={() => unbind.mutate()}>
          <Unlink className="h-3 w-3 mr-1" />断开
        </Button>
        {isAdmin && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-muted-foreground" onClick={() => setupHook.mutate({})} title="重新注册 webhook">
            {setupHook.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Settings2 className="h-3 w-3" />}
          </Button>
        )}
      </div>
    );
  }

  // ---- Configured, not bound: connect ----
  return (
    <div className="rounded-lg border px-3 py-2 text-xs">
      {!bindCode ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-muted-foreground">Telegram 预警</span>
          <Button size="sm" className="h-8" disabled={createCode.isPending} onClick={() => createCode.mutate({})}>
            {createCode.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}连接 Telegram 接收预警
          </Button>
          {isAdmin && (
            <Button size="sm" variant="ghost" className="h-8 px-2 text-[11px] text-muted-foreground" onClick={() => setupHook.mutate({})} title="注册/更新 webhook">
              {setupHook.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "注册Webhook"}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-4">
          {qr && <img src={qr} alt="扫码连接 Telegram" className="w-[120px] h-[120px] rounded border" />}
          <div className="flex-1 min-w-0 space-y-1.5">
            <p className="font-medium">点链接或扫码,在 Telegram 中点「开始 / Start」即完成连接:</p>
            <a href={link} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all block">{link}</a>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> 等待你在 Telegram 点「开始」…（绑定码 15 分钟内有效）
            </p>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => { setBindCode(null); setLink(""); setQr(""); }}>取消</Button>
          </div>
        </div>
      )}
    </div>
  );
}
