// City → pincode suggestions from the shared pincode_directory reference table.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Given a city name, returns distinct pincodes ordered by frequency
 * (most common first). Exact city match is tried first; falls back to a
 * contains-match so partial / variant spellings still suggest something.
 */
export function usePincodeSuggestions(city: string | null | undefined) {
  const q = (city ?? "").trim();
  return useQuery({
    queryKey: ["pincode-suggestions", q.toLowerCase()],
    enabled: q.length >= 2,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: async (): Promise<string[]> => {
      // Exact (case-insensitive) city match first.
      let { data, error } = await supabase
        .from("pincode_directory")
        .select("pincode")
        .ilike("city", q)
        .limit(2000);
      if (error) throw error;
      if (!data || data.length === 0) {
        const res = await supabase
          .from("pincode_directory")
          .select("pincode")
          .ilike("city", `%${q}%`)
          .limit(2000);
        if (res.error) throw res.error;
        data = res.data;
      }
      const freq = new Map<string, number>();
      for (const row of data ?? []) {
        const p = String(row.pincode ?? "").trim();
        if (!p) continue;
        freq.set(p, (freq.get(p) ?? 0) + 1);
      }
      return [...freq.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([p]) => p)
        .slice(0, 20);
    },
  });
}
