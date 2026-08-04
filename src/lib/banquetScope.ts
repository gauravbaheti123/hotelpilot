import { supabase } from "@/integrations/supabase/client";
import { reportQueryError } from "@/lib/queryError";

/**
 * Banquet-origin scope — TIME-BASED visibility.
 *
 * Rooms blocked for a banquet event are checked in as ordinary `bookings`
 * rows carrying `source = 'event_block'`. These stay fully visible in every
 * operational screen/report for 48 hours after the event completes. Once the
 * window lapses they disappear from normal screens and remain readable only
 * in the Owner-only "Banquet Billing" report.
 *
 * The 48h clock is EVENT-level: it starts when the LAST room of an event has
 * checked out (`public.banquet_visibility` RPC), so all rooms + food bills +
 * master bill of one event expire together.
 *
 * `bookings.source = 'event_block'` is the single reliable discriminator.
 * Never match on the invoice-number prefix: `-B-` is shared with
 * `banquet_bookings.banquet_number`.
 */
export interface BanquetScope {
  /** bookings.id that are PAST the 48h window and must be hidden */
  bookingIds: Set<string>;
  /** folios.id whose booking is past the 48h window */
  folioIds: Set<string>;
}

export interface BanquetVisibilityRow {
  booking_id: string;
  event_id: string | null;
  last_checkout_at: string | null;
  expires_at: string | null;
  expired: boolean;
}

export const EMPTY_BANQUET_SCOPE: BanquetScope = {
  bookingIds: new Set<string>(),
  folioIds: new Set<string>(),
};

async function inChunks<T>(ids: string[], fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    out.push(...(await fn(ids.slice(i, i + 200))));
  }
  return out;
}

/** Raw visibility rows for every event-block booking (owner report). */
export async function fetchBanquetVisibility(
  propertyId: string | null,
): Promise<BanquetVisibilityRow[]> {
  const { data, error: __qe1 } = await supabase.rpc("banquet_visibility", {
    _property_id: propertyId ?? undefined,
  });
  if (__qe1) reportQueryError("banquet visibility", __qe1);
  return (data ?? []) as BanquetVisibilityRow[];
}

/**
 * Loads the bookings/folios that must be HIDDEN from normal screens, i.e.
 * event-block stays whose event finished more than 48 hours ago. Bookings
 * still in-house, upcoming, or within the 48h window are NOT included and
 * therefore continue to appear everywhere as ordinary stays.
 */
export async function fetchBanquetScope(propertyId: string | null): Promise<BanquetScope> {
  const rows = await fetchBanquetVisibility(propertyId);
  const bookingIds = new Set<string>(rows.filter((r) => r.expired).map((r) => r.booking_id));
  if (bookingIds.size === 0) return { bookingIds, folioIds: new Set<string>() };

  const folios = await inChunks<{ id: string }>(Array.from(bookingIds), async (chunk) => {
    const { data: f, error: __qe2 } = await supabase.from("folios").select("id").in("booking_id", chunk);
    if (__qe2) reportQueryError("folios", __qe2);
    return (f ?? []) as Array<{ id: string }>;
  });
  return { bookingIds, folioIds: new Set(folios.map((f) => f.id)) };
}

/** True when the record belongs to a banquet event block. */
export function isBanquetRecord(
  scope: BanquetScope,
  ref: { booking_id?: string | null; folio_id?: string | null; id?: string | null },
): boolean {
  if (ref.booking_id && scope.bookingIds.has(ref.booking_id)) return true;
  if (ref.folio_id && scope.folioIds.has(ref.folio_id)) return true;
  return false;
}
