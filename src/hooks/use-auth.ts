import type { Session, User } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { reportQueryError } from "@/lib/queryError";

export type AppRole =
  | "superadmin"
  | "owner"
  | "manager"
  | "receptionist"
  | "housekeeping"
  | "kitchen";

export interface AuthState {
  loading: boolean;
  user: User | null;
  session: Session | null;
  roles: AppRole[];
}

export const AUTH_QUERY_KEY = ["auth", "session"] as const;

async function fetchAuthState(): Promise<Omit<AuthState, "loading">> {
  const { data } = await supabase.auth.getSession();
  const session = data.session ?? null;
  const user = session?.user ?? null;
  if (!user) return { user: null, session: null, roles: [] };
  const { data: rows, error: __qe1 } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  if (__qe1) reportQueryError("user roles", __qe1);
  const roles = ((rows ?? []) as { role: string }[]).map((r) => r.role as AppRole);
  return { user, session, roles };
}

export function useAuth(): AuthState {
  const { data, isLoading } = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: fetchAuthState,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return {
    loading: isLoading,
    user: data?.user ?? null,
    session: data?.session ?? null,
    roles: data?.roles ?? [],
  };
}

export function hasRole(roles: AppRole[], role: AppRole) {
  return roles.includes(role);
}