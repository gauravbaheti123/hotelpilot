import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export interface Property {
  id: string;
  name: string;
  city: string | null;
  is_active: boolean;
  status: "active" | "paused";
}

const LS_KEY = "hp.currentPropertyId";
const EVT = "hp:property-changed";

function debugEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("hp_debug") === "1";
  } catch {
    return false;
  }
}

export function useProperties() {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["properties"],
    queryFn: async () => {
      const { data } = await supabase
        .from("properties")
        .select("id,name,city,is_active,status")
        .order("created_at", { ascending: true });
      return (data ?? []) as Property[];
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
  const reload = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["properties"] });
    await refetch();
  }, [qc, refetch]);
  return { properties: data ?? [], loading: isLoading, reload };
}

export function useCurrentProperty() {
  const { properties, loading, reload } = useProperties();
  const { roles, user } = useAuth();
  const isSuperadmin = roles.includes("superadmin");
  const canSwitch = isSuperadmin;
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const [currentId, setCurrentIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(LS_KEY);
  });
  // Read-only ref so effects can consult the latest currentId without
  // listing it as a dependency — that dependency was retriggering the
  // sync effect every time setCurrentId ran, producing the infinite
  // user_roles refetch loop.
  const currentIdRef = useRef(currentId);
  useEffect(() => {
    currentIdRef.current = currentId;
  }, [currentId]);

  useEffect(() => {
    const handler = () => setCurrentIdState(localStorage.getItem(LS_KEY));
    window.addEventListener(EVT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const { data: assignedPropertyIds } = useQuery({
    queryKey: ["user-assigned-properties", userId],
    enabled: !!userId && !isSuperadmin,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("property_id")
        .eq("user_id", userId!)
        .not("property_id", "is", null);
      return Array.from(
        new Set((data ?? []).map((row) => row.property_id).filter(Boolean) as string[]),
      );
    },
  });
  useEffect(() => {
    if (!userId || isSuperadmin) return;
    if (!assignedPropertyIds || assignedPropertyIds.length === 0) return;
    const latestId = currentIdRef.current;
    if (!assignedPropertyIds.includes(latestId ?? "") && assignedPropertyIds[0] !== latestId) {
      setCurrentId(assignedPropertyIds[0]);
    }
  }, [userId, isSuperadmin, assignedPropertyIds]);

  // Auto-pick: non-superadmin users are locked to their linked property.
  // Superadmin keeps last-selected or falls back to first.
  useEffect(() => {
    if (loading) return;
    if (!userId) return;
    if (!isSuperadmin && properties.length > 0) {
      // Non-superadmin: always force to first visible property (RLS limits to linked only)
      const linked = properties[0];
      if (debugEnabled()) {
        console.log("[useCurrentProperty:debug] visible properties sync", {
          user_id: userId,
          current_property_id_before_sync: currentId,
          visible_property_ids: properties.map((p) => p.id),
          selected_visible_property_id: linked?.id ?? null,
        });
      }
      if (linked && currentId !== linked.id) setCurrentId(linked.id);
      return;
    }
    if (currentId && properties.some((p) => p.id === currentId)) return;
    const first = properties.find((p) => p.is_active) ?? properties[0];
    if (first) setCurrentId(first.id);
  }, [properties, loading, currentId, isSuperadmin, userId]);

  const setCurrentId = (id: string) => {
    if (id === currentIdRef.current) return;
    localStorage.setItem(LS_KEY, id);
    setCurrentIdState(id);
    window.dispatchEvent(new Event(EVT));
    // Permissions are property-scoped; invalidate so consumers refetch.
    qc.invalidateQueries({ queryKey: ["permissions"] });
  };

  const current = properties.find((p) => p.id === currentId) ?? null;

  return { properties, loading, current, currentId, setCurrentId, reload, canSwitch };
}

/**
 * Single source of truth for "which property am I scoped to right now".
 * Returns null while loading or before assignment. Use in every list query:
 *   const propertyId = usePropertyId();
 *   if (!propertyId) return;
 *   supabase.from('x').select('*').eq('property_id', propertyId)
 */
export function usePropertyId(): string | null {
  const { currentId } = useCurrentProperty();
  return currentId;
}