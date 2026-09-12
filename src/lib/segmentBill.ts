/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/integrations/supabase/client";

export interface SegmentBillTotals {
  sub: number;
  gst: number;
  total: number;
  itemCount: number;
  /** True when the bill had no items left and was removed entirely. */
  billDeleted: boolean;
}

/**
 * Recalculate a segment bill header from its item lines.
 *
 * If every line has been removed (e.g. the last KOT punch on the bill was
 * deleted) the empty bill is deleted instead of being left behind as a ₹0
 * "open" bill — those shells clutter the invoice list, consume a bill number
 * and never auto-close. Any folio charges it had posted are cleared first and
 * the folio totals recomputed, so the guest bill stays correct.
 *
 * Settled/void bills are never deleted — only their header is refreshed.
 */
export async function recalcSegmentBillTotals(billId: string): Promise<SegmentBillTotals> {
  const { data: items, error } = await supabase
    .from("segment_bill_items" as any)
    .select("amount,gst_amount")
    .eq("segment_bill_id", billId);
  if (error) throw error;

  const rows = (items ?? []) as any[];
  const sub = Math.round(rows.reduce((s, i) => s + Number(i.amount || 0), 0) * 100) / 100;
  const gst = Math.round(rows.reduce((s, i) => s + Number(i.gst_amount || 0), 0) * 100) / 100;
  const total = Math.round((sub + gst) * 100) / 100;

  if (rows.length === 0) {
    const { data: bill, error: bErr } = await supabase
      .from("segment_bills" as any)
      .select("id,status,folio_id,paid_amount")
      .eq("id", billId)
      .maybeSingle();
    if (bErr) throw bErr;
    const status = String((bill as any)?.status ?? "");
    const paid = Number((bill as any)?.paid_amount ?? 0);
    const deletable = !!bill && status === "open" && paid <= 0;

    if (deletable) {
      const folioId = (bill as any)?.folio_id as string | null;
      // Drop any folio postings this bill made before removing it.
      const { error: fcErr } = await supabase
        .from("folio_charges" as any)
        .delete()
        .eq("source_table", "segment_bills")
        .eq("source_id", billId);
      if (fcErr) throw fcErr;

      const { error: dErr } = await supabase
        .from("segment_bills" as any)
        .delete()
        .eq("id", billId);
      if (dErr) throw dErr;

      if (folioId) {
        await supabase.rpc("recompute_folio_totals" as any, { _folio_id: folioId } as any);
      }
      return { sub: 0, gst: 0, total: 0, itemCount: 0, billDeleted: true };
    }
  }

  const { error: uErr } = await supabase
    .from("segment_bills" as any)
    .update({ total_amount: total, gst_amount: gst })
    .eq("id", billId);
  if (uErr) throw uErr;

  return { sub, gst, total, itemCount: rows.length, billDeleted: false };
}
