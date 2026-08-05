// Early check-in charge — slab master mirror + hours-early math.
// Server side of truth: public.early_checkin_slabs + public.get_early_checkin_charge().
import { supabase } from "@/integrations/supabase/client";
import { istToday } from "@/lib/date";

export interface EarlyCheckinSlab {
  property_id?: string;
  from_hours: number | string;
  to_hours: number | string | null;
  charge_amount: number | string;
  is_active?: boolean | null;
  effective_from?: string | null;
}

/** "HH:mm" → minutes since midnight. Returns null for unparseable input. */
export function minutesOfDay(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/**
 * How many hours before the property's standard check-in time the guest is
 * arriving. 0 when at/after the standard time. Rounded to 2 decimals.
 */
export function hoursEarly(
  standardCheckinTime: string | null | undefined,
  actualCheckinTime: string | null | undefined,
): number {
  const std = minutesOfDay(standardCheckinTime);
  const act = minutesOfDay(actualCheckinTime);
  if (std == null || act == null) return 0;
  const diff = std - act;
  if (diff <= 0) return 0;
  return Math.round((diff / 60) * 100) / 100;
}

/** Client mirror of public.get_early_checkin_charge(). Null = no slab matches. */
export function resolveEarlyCheckinCharge(
  slabs: EarlyCheckinSlab[] | null | undefined,
  hours: number,
): number | null {
  if (!slabs || slabs.length === 0) return null;
  const today = istToday();
  const h = Number(hours) || 0;
  const matches = slabs.filter((s) => {
    if (s.is_active === false) return false;
    if (s.effective_from && String(s.effective_from) > today) return false;
    const min = Number(s.from_hours) || 0;
    const maxRaw = s.to_hours == null ? null : Number(s.to_hours);
    const open = maxRaw == null || maxRaw === 0;
    if (h < min) return false;
    if (!open && h > (maxRaw as number)) return false;
    return true;
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => Number(b.from_hours) - Number(a.from_hours));
  return Number(matches[0].charge_amount) || 0;
}

export async function fetchEarlyCheckinSlabs(propertyId: string): Promise<EarlyCheckinSlab[]> {
  const { data, error } = await supabase
    .from("early_checkin_slabs" as never)
    .select("property_id,from_hours,to_hours,charge_amount,is_active,effective_from")
    .eq("property_id", propertyId);
  if (error) throw error;
  return ((data ?? []) as unknown) as EarlyCheckinSlab[];
}

export function earlyCheckinDescription(hours: number): string {
  const h = Number(hours) || 0;
  const label = Number.isInteger(h) ? String(h) : h.toFixed(1);
  return `Early Check-in (${label} hour${h === 1 ? "" : "s"} early)`;
}
