import { supabase } from "@/integrations/supabase/client";

/**
 * Explicitly finalize a folio at checkout time.
 *
 * Guards the "reopened + already-zero-balance" hole: `recompute_folio_totals`
 * only runs from charge/payment writes, and the folios BEFORE-write trigger
 * pins any `is_reopened` folio back to `status = 'open'`. When a re-opened
 * folio is checked out with nothing left to collect, no payment row is
 * inserted, so nothing ever settles it and the bill disappears from the
 * invoice list.
 *
 * Safe to call unconditionally: it no-ops for folios that are already
 * settled/due/void/refunded, or that still carry a balance.
 */
export async function finalizeFolioSettlement(folioId: string): Promise<void> {
  if (!folioId) return;
  const { data, error } = await supabase
    .from("folios")
    .select("id,status,balance_amount,settled_at")
    .eq("id", folioId)
    .single();
  if (error || !data) return;
  const status = String((data as any).status ?? "");
  if (["settled", "due", "void", "refunded"].includes(status)) return;
  if (Number((data as any).balance_amount ?? 0) > 0.01) return;
  await supabase
    .from("folios")
    .update({
      is_reopened: false,
      status: "settled",
      settled_at: (data as any).settled_at ?? new Date().toISOString(),
    } as any)
    .eq("id", folioId);
}
