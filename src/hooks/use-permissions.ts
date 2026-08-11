import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";
import { useCurrentProperty } from "./use-property";
import {
  fetchPermissionsPayload,
  permissionsQueryKey,
  type PermMap as SharedPermMap,
  type PermissionsPayload,
} from "@/lib/permission-map";

// Standard CRUD actions rendered as columns in the permission grid.
export type PermStdAction = "view" | "create" | "edit" | "delete";
// Any action string is accepted — modules may define custom actions
// (e.g. billing/split_bill) in addition to the CRUD set.
export type PermAction = PermStdAction | (string & {});
export type PermMap = SharedPermMap;

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

// --- Shared realtime watcher (one channel per browser session) -------------
type RoleIdsRef = { current: string[] };

let watch: {
  key: string;
  refs: number;
  channel: ReturnType<typeof supabase.channel>;
  timer: ReturnType<typeof setTimeout> | null;
  roleRefs: Set<RoleIdsRef>;
} | null = null;

function acquirePermWatch(
  userId: string,
  propertyId: string | null,
  qc: ReturnType<typeof useQueryClient>,
  roleIdsRef: RoleIdsRef,
): () => void {
  const key = `${userId}::${propertyId ?? ""}`;

  if (watch && watch.key !== key) teardownPermWatch();

  if (!watch) {
    const state = {
      key,
      refs: 0,
      timer: null as ReturnType<typeof setTimeout> | null,
      roleRefs: new Set<RoleIdsRef>(),
      channel: supabase.channel(`perm-watch-${userId}-${Math.random().toString(36).slice(2)}`),
    };
    const bump = () => {
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: permissionsQueryKey(userId, propertyId) });
      }, 400);
    };
    state.channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "role_permissions" },
        (p) => {
          const rec = (p.new ?? p.old ?? {}) as { role_id?: string };
          // Only react to grants for roles some mounted hook actually uses.
          if (rec.role_id) {
            let used = false;
            for (const r of state.roleRefs) {
              if (r.current.includes(rec.role_id)) { used = true; break; }
            }
            if (!used) return;
          }
          bump();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles", filter: `user_id=eq.${userId}` },
        () => bump(),
      )
      .subscribe();
    watch = state;
  }

  const current = watch;
  current.refs += 1;
  current.roleRefs.add(roleIdsRef);

  return () => {
    if (watch !== current) return;
    current.roleRefs.delete(roleIdsRef);
    current.refs -= 1;
    if (current.refs <= 0) teardownPermWatch();
  };
}

function teardownPermWatch() {
  if (!watch) return;
  if (watch.timer) clearTimeout(watch.timer);
  supabase.removeChannel(watch.channel);
  watch = null;
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

  const { data: payload, isLoading: qLoading, refetch } = useQuery<PermissionsPayload>({
    queryKey: permissionsQueryKey(userId, propertyId),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const result = await fetchPermissionsPayload(userId!, propertyId);
      if (debugEnabled()) {
        console.log("[usePermissions:debug] built map", {
          userId,
          propertyId,
          roleIds: result.roleIds,
          map: result.map,
        });
      }
      return result;
    },
  });

  const map = payload?.map ?? {};
  const roleIds = payload?.roleIds ?? [];

  // --- Instant revocation -------------------------------------------------
  // usePermissions() mounts in many components at once. Every instance used to
  // call supabase.channel(`perm-watch-${userId}`) — supabase-js returns the
  // SAME channel object for a duplicate topic, and calling .on() on a channel
  // that has already been subscribed throws
  // "cannot add `postgres_changes` callbacks ... after `subscribe()`",
  // which crashed the whole app into the root error boundary.
  // The subscription is therefore a module-level singleton with refcounting.
  const roleIdsRef = useRef<string[]>(roleIds);
  roleIdsRef.current = roleIds;
  useEffect(() => {
    if (!enabled || !userId) return;
    return acquirePermWatch(userId, propertyId, qc, roleIdsRef);
  }, [enabled, userId, propertyId, qc]);

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
