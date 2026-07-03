export const PAYMENT_MODES = ["cash", "card", "upi", "bank_transfer", "complimentary", "wallet", "other"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const FOLIO_STATUS_TONE: Record<string, string> = {
  open: "bg-amber-100 text-amber-800 border-amber-300",
  settled: "bg-emerald-100 text-emerald-800 border-emerald-300",
  void: "bg-rose-100 text-rose-800 border-rose-300",
};

export interface ChargeLike {
  charge_type: string;
  amount: number | string;
  gst_rate?: number | string | null;
  gst_amount?: number | string | null;
  /** Optional per-line discount amount (rupees, positive number) */
  discount_amount?: number | string | null;
}

export interface BillDiscount {
  type: "percent" | "amount";
  value: number;
}

/**
 * Recompute folio totals from charges.
 * GST mode "cash" → ignore GST, total = sub - discount.
 * GST mode "gst"  → total = sub - discount + GST.
 *
 * Per-line discount (charge.discount_amount) reduces that line's taxable
 * amount and its GST proportionally. Bill-level discount (optional 3rd arg)
 * is applied on the net subtotal.
 */
export function recomputeFolio(
  charges: ChargeLike[],
  gstMode: "cash" | "gst",
  billDiscount?: BillDiscount | null,
) {
  let sub = 0;
  let lineDiscTotal = 0;
  let legacyDiscount = 0;
  let gst = 0;
  for (const c of charges) {
    const amt = Number(c.amount ?? 0);
    if (c.charge_type === "discount") {
      // legacy in-line discount charge (kept for backward compat)
      legacyDiscount += Math.abs(amt);
      continue;
    }
    if (c.charge_type === "tax") {
      gst += amt;
      continue;
    }
    const lineDisc = Math.max(0, Math.min(Number(c.discount_amount ?? 0), Math.abs(amt)));
    const net = amt - lineDisc;
    lineDiscTotal += lineDisc;
    sub += net;
    if (gstMode === "gst") {
      const gstFull = Number(c.gst_amount ?? 0);
      const gstNet = amt > 0 ? gstFull * (net / amt) : gstFull;
      gst += gstNet;
    }
  }
  // Bill-level discount (on net subtotal, after line discounts)
  let billDiscAmt = 0;
  if (billDiscount && billDiscount.value > 0) {
    if (billDiscount.type === "percent") {
      billDiscAmt = Math.max(0, Math.min(100, billDiscount.value)) * sub / 100;
    } else {
      billDiscAmt = Math.min(billDiscount.value, sub);
    }
    // Reduce GST proportionally when in GST mode
    if (gstMode === "gst" && sub > 0) {
      const factor = Math.max(0, (sub - billDiscAmt) / sub);
      gst = gst * factor;
    }
  }
  const discount = legacyDiscount + billDiscAmt;
  const total =
    gstMode === "gst"
      ? Math.max(0, sub - billDiscAmt - legacyDiscount + gst)
      : Math.max(0, sub - billDiscAmt - legacyDiscount);
  return {
    sub_total: round2(sub),
    discount_amount: round2(discount),
    gst_amount: round2(gstMode === "gst" ? gst : 0),
    total_amount: round2(total),
  };
}

/** Sum of line-item discount_amount across charges (rupees). */
export function sumLineDiscounts(charges: ChargeLike[]): number {
  let s = 0;
  for (const c of charges) {
    if (c.charge_type === "discount" || c.charge_type === "tax") continue;
    const amt = Math.abs(Number(c.amount ?? 0));
    s += Math.max(0, Math.min(Number(c.discount_amount ?? 0), amt));
  }
  return round2(s);
}

/** Compute bill-level discount amount given subtotal (after line discounts). */
export function computeBillDiscountAmount(
  netSubtotal: number,
  billDiscount?: BillDiscount | null,
): number {
  if (!billDiscount || !billDiscount.value || billDiscount.value <= 0) return 0;
  if (billDiscount.type === "percent") {
    return round2(Math.max(0, Math.min(100, billDiscount.value)) * netSubtotal / 100);
  }
  return round2(Math.min(billDiscount.value, netSubtotal));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function inr(n: number | string | null | undefined) {
  return `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}