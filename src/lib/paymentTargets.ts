/**
 * Shared "which bill does this payment apply to?" logic.
 *
 * A booking can carry money in more than one place:
 *   - one or more live folios (room bill, and split portions)
 *   - open `segment_bills` (Food / Laundry) that have NOT been merged into a
 *     folio yet, so they carry no `folio_id` at all.
 *
 * `payments` rows can only reference a `folio_id`, so collecting against a
 * still-open segment bill means merging that bill into the folio first
 * (the same "Add to bill" step Check-out already offers). That merge is the
 * least disruptive option: it needs no schema change and reuses the existing
 * settlement path, so the money always lands on a real, printable bill.
 */
import { supabase } from "@/integrations/supabase/client";
import { payableFolios } from "@/lib/folioSelect";

export interface PaymentTarget {
  /** `folio:<id>` or `segment:<id>` — stable value for a <Select>. */
  value: string;
  kind: "folio" | "segment";
  id: string;
  label: string;
  balance: number;
  /** Present for segment targets. */
  segment?: string;
  billNumber?: string;
}

export interface LoadedPaymentTargets {
  targets: PaymentTarget[];
  pendingSegmentCount: number;
}

function folioLabel(f: any): string {
  const num = f?.invoice_number ? String(f.invoice_number) : "Provisional";
  const status = String(f?.status ?? "open");
  return `Room bill ${num} · ${status}`;
}

/**
 * All bills of a booking that can currently receive a payment.
 * `currentFolioId` (when given) is sorted first so the folio the user is
 * already looking at stays the default target.
 */
export async function loadPaymentTargets(
  bookingId: string,
  currentFolioId?: string | null,
): Promise<LoadedPaymentTargets> {
  const [{ data: folioRows }, { data: segRows }] = await Promise.all([
    supabase.from("folios").select("*").eq("booking_id", bookingId),
    supabase.rpc("has_pending_segment_bills", { _booking_id: bookingId }),
  ]);

  const folios = payableFolios(((folioRows ?? []) as any[]));
  const folioTargets: PaymentTarget[] = folios.map((f: any) => ({
    value: `folio:${f.id}`,
    kind: "folio" as const,
    id: String(f.id),
    label: folioLabel(f),
    balance: Number(f.balance_amount ?? 0),
  }));
  folioTargets.sort((a, b) => {
    if (currentFolioId) {
      if (a.id === currentFolioId) return -1;
      if (b.id === currentFolioId) return 1;
    }
    return b.balance - a.balance;
  });

  const segTargets: PaymentTarget[] = ((segRows ?? []) as any[]).map((s: any) => ({
    value: `segment:${s.id}`,
    kind: "segment" as const,
    id: String(s.id),
    label: `${String(s.segment ?? "food")} bill ${s.bill_number}`,
    balance: Number(s.balance ?? 0),
    segment: String(s.segment ?? "food"),
    billNumber: String(s.bill_number ?? ""),
  }));

  return {
    targets: [...folioTargets, ...segTargets],
    pendingSegmentCount: segTargets.length,
  };
}

/**
 * Merge an open segment bill's items into a folio as `folio_charges` and mark
 * the bill settled. Idempotent: a bill already copied onto a folio is only
 * re-pointed, never double-charged.
 */
export async function mergeSegmentBillToFolio(args: {
  billId: string;
  segment: string;
  billNumber: string;
  folioId: string;
  userId?: string | null;
}): Promise<void> {
  const { billId, segment, billNumber, folioId, userId } = args;

  const { data: existing, error: exErr } = await supabase
    .from("folio_charges")
    .select("id")
    .eq("source_table", "segment_bills")
    .eq("source_id", billId)
    .limit(1);
  if (exErr) throw exErr;

  if (!existing || existing.length === 0) {
    const { data: items, error: iErr } = await supabase
      .from("segment_bill_items" as any)
      .select("description,qty,rate,amount,gst_rate,gst_amount")
      .eq("segment_bill_id", billId);
    if (iErr) throw iErr;
    if (!items || items.length === 0) throw new Error("Segment bill has no items");

    const chargeType = segment === "food" ? "food" : "laundry";
    const rows = (items as any[]).map((it) => ({
      folio_id: folioId,
      charge_type: chargeType,
      description: `${it.description} (${billNumber})`,
      qty: Number(it.qty),
      rate: Number(it.rate),
      amount: Number(it.amount),
      gst_rate: Number(it.gst_rate),
      gst_amount: Number(it.gst_amount),
      source_table: "segment_bills",
      source_id: billId,
      segment_bill_ref: billNumber,
      created_by: userId ?? null,
    }));
    const { error: cErr } = await supabase.from("folio_charges").insert(rows as any);
    if (cErr) throw cErr;
  }

  const { error: uErr } = await supabase
    .from("segment_bills" as any)
    .update({
      status: "settled",
      settled_at: new Date().toISOString(),
      folio_id: folioId,
    } as any)
    .eq("id", billId);
  if (uErr) throw uErr;
}
