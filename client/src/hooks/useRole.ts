import { useAuth } from "@/_core/hooks/useAuth";

export function useRole() {
  const { user } = useAuth();
  const role = user?.role ?? "user";
  return {
    role,
    isDeveloper: role === "developer",
    isAdmin: role === "admin" || role === "developer",
    isUser: role === "user",
    canEdit: role === "admin" || role === "developer",
  };
}
