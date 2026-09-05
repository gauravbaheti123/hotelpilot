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
 * the bill settled. Delegates to `post_segment_bill_to_folio`, which locks the
 * bill row and re-posts its current lines — so concurrent/repeat calls can
 * never leave duplicate charges behind.
 */
export async function mergeSegmentBillToFolio(args: {
  billId: string;
  segment: string;
  billNumber: string;
  folioId: string;
  userId?: string | null;
}): Promise<void> {
  const { billId, folioId, userId } = args;

  const { data, error } = await supabase.rpc("post_segment_bill_to_folio" as any, {
    _bill_id: billId,
    _folio_id: folioId,
    _actor: userId ?? null,
  } as any);
  if (error) throw error;
  const res = data as any;
  if (!res?.ok) {
    throw new Error(
      res?.reason === "no_items" ? "Segment bill has no items"
        : res?.reason === "not_found" ? "Segment bill not found"
        : "Could not add this bill to the room bill",
    );
  }
}

