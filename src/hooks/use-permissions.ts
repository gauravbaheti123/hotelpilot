import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";
import { useCurrentProperty } from "./use-property";

// Standard CRUD actions rendered as columns in the permission grid.
export type PermStdAction = "view" | "create" | "edit" | "delete";
// Any action string is accepted — modules may define custom actions
// (e.g. billing/split_bill, billing/mis_shift) in addition to the CRUD set.
export type PermAction = PermStdAction | (string & {});
export type PermMap = Record<string, Record<string, boolean>>;

const PERMS_EVENT = "hp:permissions-changed";

/** Notify all mounted usePermissions() hooks to re-fetch. */
export function invalidatePermissions() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PERMS_EVENT));
  }
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
  // Owners have full access to every module — bypass the permission map.
  const isOwner = roles.includes("owner");
  const [state, setState] = useState<PermState>({
    loading: true,
    isSuperadmin,
    map: {},
  });
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);

  useEffect(() => {
    const onChange = () => setTick((n) => n + 1);
    window.addEventListener(PERMS_EVENT, onChange);
    return () => window.removeEventListener(PERMS_EVENT, onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (authLoading) return;
    if (!user) {
      setState({ loading: false, isSuperadmin: false, map: {} });
      return;
    }
    if (isSuperadmin || isOwner) {
      setState({ loading: false, isSuperadmin: isSuperadmin || isOwner, map: {} });
      return;
    }

    (async () => {
      if (!cancelled) {
        setState((prev) => ({ ...prev, loading: true, isSuperadmin: false }));
      }
      // Find role_id assignments for this user (scoped to current property or global)
      const q = supabase
        .from("user_roles")
        .select("role_id, property_id")
        .eq("user_id", user.id)
        .not("role_id", "is", null);
      const { data: assigns, error: assignsErr } = await q;
      if (assignsErr) {
        // Do NOT flip loading→false with an empty map on transient errors —
        // that would trigger downstream "Access denied" guards. Keep the
        // hook in the loading state so the UI shows a spinner/skeleton
        // instead of a definitive denial.
        console.error("[usePermissions] user_roles read failed", assignsErr);
        return;
      }
      const assignments = ((assigns ?? []) as Array<{ role_id: string | null; property_id: string | null }>)
        .filter((r) => !!r.role_id);

      const matchingAssignments = propertyId
        ? assignments.filter((r) => !r.property_id || r.property_id === propertyId)
        : [];

      // A stale selected property can survive from a previous login in localStorage.
      // If it does not match any role assignment for the current user, fall back to
      // the user's actual assignments instead of denying every permission.
      const effectiveAssignments = matchingAssignments.length > 0 ? matchingAssignments : assignments;
      const roleIds = Array.from(new Set(effectiveAssignments.map((r) => r.role_id as string)));
      if (roleIds.length === 0) {
        if (!cancelled) setState({ loading: false, isSuperadmin: false, map: {} });
        return;
      }
      const { data: rps, error: rpsErr } = await supabase
        .from("role_permissions")
        .select("allowed, permissions!role_permissions_permission_id_fkey(module, action)")
        .in("role_id", roleIds)
        .eq("allowed", true);
      if (rpsErr) {
        console.error("[usePermissions] role_permissions read failed", rpsErr);
        return;
      }
      const map: PermMap = {};
      for (const row of (rps ?? []) as any[]) {
        const p = row.permissions;
        if (!p) continue;
        if (!map[p.module]) map[p.module] = { view: false, create: false, edit: false, delete: false };
        map[p.module][p.action as string] = true;
      }
      if (!cancelled) setState({ loading: false, isSuperadmin: false, map });
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading, isSuperadmin, isOwner, propertyId, tick]);

  const can = (module: string, action: PermAction = "view") => {
    if (state.isSuperadmin) return true;
    return !!state.map[module]?.[action];
  };

  return { ...state, can, refresh };
}
