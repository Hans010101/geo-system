import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Trash2, Shield, ShieldCheck, Code2 } from "lucide-react";
import { toast } from "sonner";

const ROLE_CONFIG = {
  developer: { label: "开发者", color: "bg-primary/15 text-primary border-primary/30", icon: Code2 },
  admin: { label: "管理员", color: "bg-orange-500/15 text-orange-600 border-orange-500/30", icon: ShieldCheck },
  user: { label: "成员", color: "bg-muted text-muted-foreground border-border", icon: Shield },
} as const;

export default function ConfigUsers() {
  const { data: usersList, isLoading } = trpc.users.list.useQuery(undefined, { staleTime: 10000 });
  const { data: me } = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();

  const updateRoleMutation = trpc.users.updateRole.useMutation({
    onSuccess: () => { utils.users.list.invalidate(); toast.success("角色已更新"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.users.delete.useMutation({
    onSuccess: () => { utils.users.list.invalidate(); toast.success("用户已删除"); },
    onError: (e) => toast.error(e.message),
  });

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
                  <th className="text-right p-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">加载中...</td></tr>
                ) : usersList?.map((u) => {
                  const rc = ROLE_CONFIG[u.role as keyof typeof ROLE_CONFIG] || ROLE_CONFIG.user;
                  const isSelf = u.id === me?.id;
                  const isDev = u.role === "developer";
                  return (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="p-3 text-muted-foreground">{u.id}</td>
                      <td className="p-3 font-medium">{u.name || "-"}</td>
                      <td className="p-3 text-muted-foreground">{u.email || "-"}</td>
                      <td className="p-3">
                        {isDev ? (
                          <Badge variant="outline" className={rc.color}>
                            {rc.label}
                          </Badge>
                        ) : (
                          <Select
                            value={u.role}
                            onValueChange={(val) => {
                              updateRoleMutation.mutate({ id: u.id, role: val as "user" | "admin" });
                            }}
                          >
                            <SelectTrigger className="h-7 w-24 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">管理员</SelectItem>
                              <SelectItem value="user">成员</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">
                        {u.loginMethod || "-"}
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString("zh-CN") : "-"}
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">
                        {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString("zh-CN") : "-"}
                      </td>
                      <td className="p-3 text-right">
                        {!isSelf && !isDev && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive h-7"
                            onClick={() => {
                              if (confirm(`确定删除用户 ${u.name || u.email}？此操作不可恢复。`)) {
                                deleteMutation.mutate({ id: u.id });
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
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
    </div>
  );
}
