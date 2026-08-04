import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { GstSlabRow } from "@/lib/gst";
import { guardQuery } from "@/lib/queryError";

/** Fetch every active GST slab for a property so pages can resolve rates
 *  locally without a round-trip per charge. Data is treated as master data
 *  (rarely changes), so a single fetch per mount is enough. */
export function useGstSlabs(propertyId: string | null | undefined) {
  const [slabs, setSlabs] = useState<GstSlabRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!propertyId) { setSlabs([]); return; }
    let cancelled = false;
    setLoading(true);
    supabase
      .from("gst_slabs" as any)
      .select("property_id,charge_category,from_amount,to_amount,gst_rate,is_active,effective_from")
      .eq("property_id", propertyId)
      .then(guardQuery("gst slabs")).then(({ data }) => {
        if (cancelled) return;
        setSlabs(((data as any[]) ?? []) as GstSlabRow[]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [propertyId]);

  return { slabs, loading };
}
