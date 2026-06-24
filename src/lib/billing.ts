export const PAYMENT_MODES = ["cash", "card", "upi", "bank", "wallet", "other"] as const;
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
}

/**
 * Recompute folio totals from charges.
 * GST mode "cash" → ignore GST, total = sub - discount.
 * GST mode "gst"  → total = sub - discount + GST.
 */
export function recomputeFolio(charges: ChargeLike[], gstMode: "cash" | "gst") {
  let sub = 0;
  let discount = 0;
  let gst = 0;
  for (const c of charges) {
    const amt = Number(c.amount ?? 0);
    if (c.charge_type === "discount") discount += Math.abs(amt);
    else if (c.charge_type === "tax") gst += amt;
    else sub += amt;
    if (gstMode === "gst" && c.charge_type !== "discount" && c.charge_type !== "tax") {
      gst += Number(c.gst_amount ?? 0);
    }
  }
  const total =
    gstMode === "gst"
      ? Math.max(0, sub - discount + gst)
      : Math.max(0, sub - discount);
  return {
    sub_total: round2(sub),
    discount_amount: round2(discount),
    gst_amount: round2(gstMode === "gst" ? gst : 0),
    total_amount: round2(total),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function inr(n: number | string | null | undefined) {
  return `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}