import { useEffect, useState } from "react";
import { fetchEarlyCheckinSlabs, type EarlyCheckinSlab } from "@/lib/earlyCheckin";

/** Master-data cache of the property's early check-in slabs. */
export function useEarlyCheckinSlabs(propertyId: string | null | undefined) {
  const [slabs, setSlabs] = useState<EarlyCheckinSlab[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!propertyId) { setSlabs([]); return; }
    let cancelled = false;
    setLoading(true);
    fetchEarlyCheckinSlabs(propertyId)
      .then((rows) => { if (!cancelled) setSlabs(rows); })
      .catch(() => { if (!cancelled) setSlabs([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [propertyId]);

  return { slabs, loading };
}
