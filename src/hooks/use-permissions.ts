import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";
import { usePropertyId } from "./use-property";

export type PermAction = "view" | "create" | "edit" | "delete";
export type PermMap = Record<string, Record<PermAction, boolean>>;

interface PermState {
  loading: boolean;
  isSuperadmin: boolean;
  map: PermMap;
}

/**
 * Fetches the effective permission map for the signed-in user within the
 * currently-selected property. Superadmins are treated as fully allowed.
 */
export function usePermissions(): PermState & {
  can: (module: string, action?: PermAction) => boolean;
} {
  const { user, roles, loading: authLoading } = useAuth();
  const propertyId = usePropertyId();
  const isSuperadmin = roles.includes("superadmin");
  const [state, setState] = useState<PermState>({
    loading: true,
    isSuperadmin,
    map: {},
  });

  useEffect(() => {
    let cancelled = false;
    if (authLoading) return;
    if (!user) {
      setState({ loading: false, isSuperadmin: false, map: {} });
      return;
    }
    if (isSuperadmin) {
      setState({ loading: false, isSuperadmin: true, map: {} });
      return;
    }

    (async () => {
      // Find role_id assignments for this user (scoped to current property or global)
      const q = supabase
        .from("user_roles")
        .select("role_id, property_id")
        .eq("user_id", user.id)
        .not("role_id", "is", null);
      const { data: assigns } = await q;
      const roleIds = (assigns ?? [])
        .filter((r: any) => !propertyId || !r.property_id || r.property_id === propertyId)
        .map((r: any) => r.role_id as string);
      if (roleIds.length === 0) {
        if (!cancelled) setState({ loading: false, isSuperadmin: false, map: {} });
        return;
      }
      const { data: rps } = await supabase
        .from("role_permissions")
        .select("allowed, permissions(module, action)")
        .in("role_id", roleIds)
        .eq("allowed", true);
      const map: PermMap = {};
      for (const row of (rps ?? []) as any[]) {
        const p = row.permissions;
        if (!p) continue;
        if (!map[p.module]) map[p.module] = { view: false, create: false, edit: false, delete: false };
        map[p.module][p.action as PermAction] = true;
      }
      if (!cancelled) setState({ loading: false, isSuperadmin: false, map });
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading, isSuperadmin, propertyId]);

  const can = (module: string, action: PermAction = "view") => {
    if (state.isSuperadmin) return true;
    return !!state.map[module]?.[action];
  };

  return { ...state, can };
}
