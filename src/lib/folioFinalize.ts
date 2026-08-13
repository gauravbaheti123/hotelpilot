import { supabase } from "@/integrations/supabase/client";
import { payableFolios } from "@/lib/folioSelect";

/**
 * Explicitly finalize a folio at checkout time.
 *
 * Runs through the `settle_folio_at_checkout` SECURITY DEFINER RPC. A plain
 * client-side UPDATE is silently rejected by RLS for any role without
 * `invoices/edit` (receptionists), which used to leave the folio open and
 * un-numbered while checkout reported success.
 *
 * Guards the "reopened + already-zero-balance" hole: `recompute_folio_totals`
 * only runs from charge/payment writes, and the folios BEFORE-write trigger
 * pins any `is_reopened` folio back to `status = 'open'`. When a re-opened
 * folio is checked out with nothing left to collect, no payment row is
 * inserted, so nothing ever settles it and the bill disappears from the
 * invoice list.
 *
 * The RPC no-ops for folios that are already settled/due/refunded. Anything
 * else that goes wrong THROWS — checkout must never claim success while the
 * bill stays unsettled.
 */
export async function finalizeFolioSettlement(
  folioId: string,
  settledAt?: string | null,
): Promise<void> {
  if (!folioId) return;
  const { error } = await supabase.rpc("settle_folio_at_checkout" as any, {
    _folio_id: folioId,
    _settled_at: settledAt ?? null,
  } as any);
  if (error) throw error;
}

/**
 * Finalize EVERY live (payable) folio of a booking — a split bill has one
 * child folio per portion and all of them must be settled at checkout, not
 * just the one the checkout dialog happens to hold.
 *
 * Folios that still carry a balance are skipped (the caller decides between
 * "collect payment" and "mark as due"); the folio the caller passes is always
 * attempted so its failure surfaces.
 */
export async function finalizeBookingSettlement(
  bookingId: string,
  primaryFolioId?: string,
): Promise<void> {
  const ids = new Set<string>();
  if (primaryFolioId) ids.add(primaryFolioId);
  if (bookingId) {
    const { data, error } = await supabase
      .from("folios")
      .select("id,parent_folio_id,status,is_deleted,balance_amount")
      .eq("booking_id", bookingId);
    if (error) throw error;
    for (const f of payableFolios((data ?? []) as any[])) {
      if (Number((f as any).balance_amount ?? 0) <= 0.01) ids.add(String(f.id));
    }
  }
  for (const id of ids) await finalizeFolioSettlement(id);
}
