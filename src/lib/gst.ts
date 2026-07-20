// Shared GST slab resolution — mirrors the server-side public.get_gst_rate() function
// so previews and non-server-driven charge inserts pick the same rate the DB will use.

export type GstCategory = "room" | "food" | "banquet" | "sundry";

export interface GstSlabRow {
  property_id?: string;
  charge_category: GstCategory | string;
  from_amount: number | string;
  to_amount: number | string | null;
  gst_rate: number | string;
  is_active?: boolean | null;
  effective_from?: string | null;
}

/** Resolve the GST% for a given property/category/amount by walking the master
 *  slab table exactly the same way as the DB `get_gst_rate` function.
 *  Returns null when no slab matches — callers MUST treat that as a
 *  configuration error (block the charge / surface the missing slab), not
 *  silently fall back to a hardcoded rate. */
export function resolveGstRate(
  slabs: GstSlabRow[] | null | undefined,
  category: GstCategory,
  amount: number,
): number | null {
  if (!slabs || slabs.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const amt = Number(amount) || 0;
  const candidates = slabs.filter((s) => {
    if ((s.charge_category as string) !== category) return false;
    if (s.is_active === false) return false;
    if (s.effective_from && String(s.effective_from) > today) return false;
    const min = Number(s.from_amount) || 0;
    const maxRaw = s.to_amount == null ? null : Number(s.to_amount);
    const maxIsOpen = maxRaw == null || maxRaw === 0; // 0 == "and above"
    if (amt < min) return false;
    if (!maxIsOpen && amt > (maxRaw as number)) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Number(b.from_amount) - Number(a.from_amount));
  return Number(candidates[0].gst_rate);
}

/** Inclusive-tariff variant: caller passes the gross (GST-included) per-unit
 *  amount; we back-solve so the slab is chosen on the taxable value.
 *  Same two-pass behaviour as the DB functions. */
export function resolveGstRateInclusive(
  slabs: GstSlabRow[] | null | undefined,
  category: GstCategory,
  gross: number,
): number | null {
  const first = resolveGstRate(slabs, category, gross);
  if (first == null) return null;
  const taxable = Number(gross) / (1 + first / 100);
  const second = resolveGstRate(slabs, category, taxable);
  return second ?? first;
}
