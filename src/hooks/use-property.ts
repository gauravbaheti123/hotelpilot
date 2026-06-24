import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export interface Property {
  id: string;
  name: string;
  city: string | null;
  is_active: boolean;
}

const LS_KEY = "hp.currentPropertyId";
const EVT = "hp:property-changed";

export function useProperties() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("properties")
      .select("id,name,city,is_active")
      .order("created_at", { ascending: true });
    setProperties((data ?? []) as Property[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { properties, loading, reload };
}

export function useCurrentProperty() {
  const { properties, loading, reload } = useProperties();
  const { roles, user } = useAuth();
  const isSuperadmin = roles.includes("superadmin");
  const canSwitch = isSuperadmin;
  const [currentId, setCurrentIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(LS_KEY);
  });

  useEffect(() => {
    const handler = () => setCurrentIdState(localStorage.getItem(LS_KEY));
    window.addEventListener(EVT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  // Auto-pick: non-superadmin users are locked to their linked property.
  // Superadmin keeps last-selected or falls back to first.
  useEffect(() => {
    if (loading) return;
    if (!user) return;
    if (!isSuperadmin && properties.length > 0) {
      // Non-superadmin: always force to first visible property (RLS limits to linked only)
      const linked = properties[0];
      if (linked && currentId !== linked.id) setCurrentId(linked.id);
      return;
    }
    if (currentId && properties.some((p) => p.id === currentId)) return;
    const first = properties.find((p) => p.is_active) ?? properties[0];
    if (first) setCurrentId(first.id);
  }, [properties, loading, currentId, isSuperadmin, user]);

  const setCurrentId = (id: string) => {
    localStorage.setItem(LS_KEY, id);
    setCurrentIdState(id);
    window.dispatchEvent(new Event(EVT));
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