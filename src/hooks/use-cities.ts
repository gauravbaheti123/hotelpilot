// Phase 67 — City master list (shared seeds + per-property additions).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePropertyId } from "@/hooks/use-property";
import { titleCase } from "@/lib/indiaGeo";

export interface CityRow { id: string; name: string; state: string | null }

export function useCities() {
  const propertyId = usePropertyId();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["cities", propertyId],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CityRow[]> => {
      const { data, error } = await supabase
        .from("cities")
        .select("id,name,state")
        .order("name");
      if (error) throw error;
      const seen = new Set<string>();
      return (data ?? []).filter((c) => {
        const k = c.name.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    },
  });

  const addCity = useMutation({
    mutationFn: async (raw: string) => {
      const name = titleCase(raw);
      if (!name || !propertyId) return name;
      const exists = (list.data ?? []).some((c) => c.name.toLowerCase() === name.toLowerCase());
      if (!exists) {
        await supabase.from("cities").insert({ name, property_id: propertyId });
      }
      return name;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["cities", propertyId] }); },
  });

  return { cities: list.data ?? [], isLoading: list.isLoading, addCity };
}
