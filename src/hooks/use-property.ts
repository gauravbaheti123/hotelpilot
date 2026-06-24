import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

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

  // Auto-pick first active property if none selected
  useEffect(() => {
    if (loading) return;
    if (currentId && properties.some((p) => p.id === currentId)) return;
    const first = properties.find((p) => p.is_active) ?? properties[0];
    if (first) setCurrentId(first.id);
  }, [properties, loading, currentId]);

  const setCurrentId = (id: string) => {
    localStorage.setItem(LS_KEY, id);
    setCurrentIdState(id);
    window.dispatchEvent(new Event(EVT));
  };

  const current = properties.find((p) => p.id === currentId) ?? null;

  return { properties, loading, current, currentId, setCurrentId, reload };
}