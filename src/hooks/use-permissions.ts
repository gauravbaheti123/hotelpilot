import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";
import { useCurrentProperty } from "./use-property";

// Standard CRUD actions rendered as columns in the permission grid.
export type PermStdAction = "view" | "create" | "edit" | "delete";
// Any action string is accepted — modules may define custom actions
// (e.g. billing/split_bill, billing/mis_shift) in addition to the CRUD set.
export type PermAction = PermStdAction | (string & {});
export type PermMap = Record<string, Record<string, boolean>>;

const DEBUG_PERMISSION_MODULE = "dashboard";
const DEBUG_PERMISSION_ACTION = "view";

function debugEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("hp_debug") === "1";
  } catch {
    return false;
  }
}

/** Notify all mounted usePermissions() hooks to re-fetch. */
let _qcRef: ReturnType<typeof useQueryClient> | null = null;
export function _setPermissionsQueryClient(qc: ReturnType<typeof useQueryClient>) {
  _qcRef = qc;
}
export function invalidatePermissions() {
  if (_qcRef) _qcRef.invalidateQueries({ queryKey: ["permissions"] });
}

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
  refresh: () => void;
} {
  const { user, roles, loading: authLoading } = useAuth();
  const { currentId: propertyId } = useCurrentProperty();
  const isSuperadmin = roles.includes("superadmin");
  const isOwner = roles.includes("owner");
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  _setPermissionsQueryClient(qc);

  const bypass = isSuperadmin || isOwner;
  const enabled = !authLoading && !!userId && !bypass;

  const { data: map = {}, isLoading: qLoading, refetch } = useQuery<PermMap>({
    queryKey: ["permissions", userId, propertyId],
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data: assigns, error: assignsErr } = await supabase
        .from("user_roles")
        .select("role_id, property_id")
        .eq("user_id", userId!)
        .not("role_id", "is", null);
      if (assignsErr) throw assignsErr;
      const assignments = ((assigns ?? []) as Array<{ role_id: string | null; property_id: string | null }>)
        .filter((r) => !!r.role_id);
      const matching = propertyId
        ? assignments.filter((r) => !r.property_id || r.property_id === propertyId)
        : [];
      const effective = matching.length > 0 ? matching : assignments;
      const roleIds = Array.from(new Set(effective.map((r) => r.role_id as string)));
      if (roleIds.length === 0) return {};
      const { data: rps, error: rpsErr } = await supabase
        .from("role_permissions")
        .select("allowed, permissions!role_permissions_permission_id_fkey(module, action)")
        .in("role_id", roleIds)
        .eq("allowed", true);
      if (rpsErr) throw rpsErr;
      const out: PermMap = {};
      for (const row of (rps ?? []) as any[]) {
        const p = row.permissions;
        if (!p) continue;
        if (!out[p.module]) out[p.module] = { view: false, create: false, edit: false, delete: false };
        out[p.module][p.action as string] = true;
      }
      if (debugEnabled()) {
        console.log("[usePermissions:debug] built map", { userId, propertyId, roleIds, map: out });
      }
      return out;
    },
  });

  const state: PermState = bypass
    ? { loading: false, isSuperadmin: true, map: {} }
    : { loading: authLoading || (enabled && qLoading), isSuperadmin: false, map };
  const refresh = () => { refetch(); };

  const can = (module: string, action: PermAction = "view") => {
    if (state.isSuperadmin) return true;
    const allowed = !!state.map[module]?.[action];
    if (debugEnabled() && module === DEBUG_PERMISSION_MODULE && action === DEBUG_PERMISSION_ACTION) {
      console.log("[usePermissions:debug] can() evaluated", {
        module,
        action,
        allowed,
        loading: state.loading,
        isSuperadmin: state.isSuperadmin,
        map_entry: state.map[module],
        full_map: state.map,
      });
    }
    return allowed;
  };

  return { ...state, can, refresh };
}
