import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Users, MoreHorizontal, ShieldCheck, Shield, Ban, Trash2, UserX } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

const ROLE_CONFIG = {
  developer: { label: "开发者", color: "bg-primary/15 text-primary border-primary/30" },
  admin: { label: "管理员", color: "bg-orange-500/15 text-orange-600 border-orange-500/30" },
  user: { label: "成员", color: "bg-muted text-muted-foreground border-border" },
} as const;

export default function ConfigUsers() {
  const { data: usersList, isLoading } = trpc.users.list.useQuery(undefined, { staleTime: 10000 });
  const { data: me } = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();

  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    action: () => void;
    destructive?: boolean;
  }>({ open: false, title: "", description: "", action: () => {} });

  const updateRoleMutation = trpc.users.updateRole.useMutation({
    onSuccess: () => { utils.users.list.invalidate(); toast.success("角色已更新"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.users.delete.useMutation({
    onSuccess: () => { utils.users.list.invalidate(); toast.success("用户已删除"); },
    onError: (e) => toast.error(e.message),
  });

  const banMutation = trpc.users.ban.useMutation({
    onSuccess: () => { utils.users.list.invalidate(); toast.success("用户已拉黑"); },
    onError: (e) => toast.error(e.message),
  });

  const unbanMutation = trpc.users.unban.useMutation({
    onSuccess: () => { utils.users.list.invalidate(); toast.success("已解除拉黑"); },
    onError: (e) => toast.error(e.message),
  });

  const openConfirm = (title: string, description: string, action: () => void, destructive = true) => {
    setConfirmDialog({ open: true, title, description, action, destructive });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">用户管理</h1>
          <p className="text-muted-foreground text-sm mt-1">
            管理系统用户和角色权限，共 {usersList?.length || 0} 个用户
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4" />
          <span>{usersList?.length || 0} 用户</span>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left p-3 font-medium">ID</th>
                  <th className="text-left p-3 font-medium">用户名</th>
                  <th className="text-left p-3 font-medium">邮箱</th>
                  <th className="text-left p-3 font-medium">角色</th>
                  <th className="text-left p-3 font-medium">登录方式</th>
                  <th className="text-left p-3 font-medium">注册时间</th>
                  <th className="text-left p-3 font-medium">最后登录</th>
                  <th className="text-center p-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">加载中...</td></tr>
                ) : usersList?.map((u) => {
                  const rc = ROLE_CONFIG[u.role as keyof typeof ROLE_CONFIG] || ROLE_CONFIG.user;
                  const isSelf = u.id === me?.id;
                  const isDev = u.role === "developer";
                  const isBanned = (u as any).isBanned;
                  return (
                    <tr key={u.id} className={`border-b last:border-0 hover:bg-muted/20 ${isBanned ? "bg-muted/40 opacity-70" : ""}`}>
                      <td className="p-3 text-muted-foreground whitespace-nowrap">{u.id}</td>
                      <td className="p-3 font-medium">{u.name || "-"}</td>
                      <td className="p-3 text-muted-foreground">{u.email || "-"}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className={`text-[10px] ${rc.color}`}>
                            {rc.label}
                          </Badge>
                          {isBanned && (
                            <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">
                              已禁用
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground text-xs whitespace-nowrap">
                        {u.loginMethod || "-"}
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString("zh-CN") : "-"}
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">
                        {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString("zh-CN") : "-"}
                      </td>
                      <td className="p-3 text-center">
                        {!isDev && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              {u.role === "user" && (
                                <DropdownMenuItem onClick={() => updateRoleMutation.mutate({ id: u.id, role: "admin" })}>
                                  <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                                  设为管理员
                                </DropdownMenuItem>
                              )}
                              {u.role === "admin" && (
                                <DropdownMenuItem onClick={() => updateRoleMutation.mutate({ id: u.id, role: "user" })}>
                                  <Shield className="mr-2 h-3.5 w-3.5" />
                                  设为普通用户
                                </DropdownMenuItem>
                              )}
                              {!isBanned ? (
                                <DropdownMenuItem
                                  className="text-orange-600 focus:text-orange-600"
                                  onClick={() => openConfirm(
                                    "确认拉黑",
                                    `确定要拉黑用户 ${u.name || u.email}？拉黑后该用户将无法登录系统。`,
                                    () => banMutation.mutate({ id: u.id }),
                                  )}
                                >
                                  <Ban className="mr-2 h-3.5 w-3.5" />
                                  拉黑
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => unbanMutation.mutate({ id: u.id })}>
                                  <UserX className="mr-2 h-3.5 w-3.5" />
                                  解除拉黑
                                </DropdownMenuItem>
                              )}
                              {!isSelf && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => openConfirm(
                                      "确认删除",
                                      `确定要删除用户 ${u.name || u.email}？此操作不可恢复。`,
                                      () => deleteMutation.mutate({ id: u.id }),
                                    )}
                                  >
                                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                                    删除用户
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className={confirmDialog.destructive ? "bg-destructive hover:bg-destructive/90" : ""}
              onClick={() => { confirmDialog.action(); setConfirmDialog((prev) => ({ ...prev, open: false })); }}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
