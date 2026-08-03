import { supabase } from "@/integrations/supabase/client";

/**
 * Banquet-origin scope.
 *
 * Rooms blocked for a banquet event are checked in as ordinary `bookings`
 * rows carrying `source = 'event_block'`. Their folios, payments, KOTs and
 * food bills must NOT appear in operational reports — banquet revenue lives
 * in `banquet_bookings` / `banquet_master_bills` and in the Owner-only
 * "Banquet Billing" report.
 *
 * `bookings.source = 'event_block'` is the single reliable discriminator.
 * Never match on the invoice-number prefix: `-B-` is shared with
 * `banquet_bookings.banquet_number`.
 */
export interface BanquetScope {
  /** bookings.id where source = 'event_block' */
  bookingIds: Set<string>;
  /** folios.id whose booking is an event block */
  folioIds: Set<string>;
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

/** Loads every event-block booking id + folio id. Pass null for all properties. */
export async function fetchBanquetScope(propertyId: string | null): Promise<BanquetScope> {
  let q = supabase.from("bookings").select("id").eq("source", "event_block");
  if (propertyId) q = q.eq("property_id", propertyId);
  const { data } = await q;
  const bookingIds = new Set<string>(((data ?? []) as Array<{ id: string }>).map((b) => b.id));
  if (bookingIds.size === 0) return { bookingIds, folioIds: new Set<string>() };

  const folios = await inChunks<{ id: string }>(Array.from(bookingIds), async (chunk) => {
    const { data: f } = await supabase.from("folios").select("id").in("booking_id", chunk);
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
