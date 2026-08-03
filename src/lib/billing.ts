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
  const totalRaw =
    gstMode === "gst"
      ? Math.max(0, sub - billDiscAmt - legacyDiscount + gst)
      : Math.max(0, sub - billDiscAmt - legacyDiscount);
  const totalRounded = roundHalfUp(totalRaw);
  const roundOff = round2(totalRounded - totalRaw);
  return {
    sub_total: round2(sub),
    discount_amount: round2(discount),
    gst_amount: round2(gstMode === "gst" ? gst : 0),
    total_amount: totalRounded,
    round_off_amount: roundOff,
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

/** Standard round-half-up to nearest integer (rupees). 0.50→+1, -0.50→0. */
export function roundHalfUp(n: number): number {
  return Math.sign(n) >= 0
    ? Math.floor(n + 0.5)
    : -Math.floor(-n + 0.5);
}

/** Compute rounded total + round-off delta from a raw total. */
export function computeRoundOff(rawTotal: number): { total: number; round_off: number } {
  const total = roundHalfUp(rawTotal);
  return { total, round_off: round2(total - rawTotal) };
}

/** Currency string with no decimals — for the final rounded amount. */
export function inrRound(n: number | string | null | undefined) {
  const v = roundHalfUp(Number(n ?? 0));
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function inr(n: number | string | null | undefined) {
  return `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Distribute `total` (rupees) across `weights` such that the sum of the
 * returned shares equals `total` exactly at the paise level. Each share is
 * rounded to 2 decimals; the remainder from rounding is absorbed by the LAST
 * entry so downstream folio math reconciles.
 *
 * Example:
 *   distributeWithRemainder(4000, [1,1,1]) → [1333.33, 1333.33, 1333.34]
 *   distributeWithRemainder(1000, [40,60])  → [400.00, 600.00]
 */
export function distributeWithRemainder(total: number, weights: number[]): number[] {
  const totalPaise = Math.round(Number(total) * 100);
  const wSum = weights.reduce((s, w) => s + Math.max(0, Number(w) || 0), 0);
  if (wSum <= 0 || weights.length === 0) return weights.map(() => 0);
  const shares = weights.map((w) =>
    Math.floor((totalPaise * Math.max(0, Number(w) || 0)) / wSum),
  );
  const remainder = totalPaise - shares.reduce((s, x) => s + x, 0);
  shares[shares.length - 1] += remainder;
  return shares.map((p) => Math.round(p) / 100);
}

/**
 * Weighted average GST% across a set of charges. Uses each charge's net
 * (amount − line discount) as the weight. Returns 0 for empty / zero-net
 * inputs.
 */
export function weightedGstRate(charges: ChargeLike[]): number {
  let net = 0;
  let gst = 0;
  for (const c of charges) {
    if (c.charge_type === "discount" || c.charge_type === "tax") continue;
    const amt = Math.abs(Number(c.amount ?? 0));
    const ld = Math.max(0, Math.min(Number(c.discount_amount ?? 0), amt));
    const n = amt - ld;
    net += n;
    const gAmt = Number(c.gst_amount ?? 0);
    // Scale GST proportionally with the line's net
    gst += amt > 0 ? gAmt * (n / amt) : gAmt;
  }
  if (net <= 0) return 0;
  return round2((gst / net) * 100);
}

/** Net (pre-GST, after per-line discounts) subtotal for a set of charges. */
export function netSubtotalOf(charges: ChargeLike[]): number {
  let s = 0;
  for (const c of charges) {
    if (c.charge_type === "discount" || c.charge_type === "tax") continue;
    const amt = Math.abs(Number(c.amount ?? 0));
    const ld = Math.max(0, Math.min(Number(c.discount_amount ?? 0), amt));
    s += amt - ld;
  }
  return round2(s);
}

/* ------------------------------------------------------------------ *
 * Phase 1.5 / 52 — segment bill consolidation (DISPLAY ONLY)
 * ------------------------------------------------------------------ */

export interface DisplayCharge {
  id?: string;
  charge_type: string;
  description: string;
  qty: number | string;
  rate: number | string;
  amount: number | string;
  gst_rate?: number | string | null;
  gst_amount?: number | string | null;
  discount_amount?: number | string | null;
  discount_type?: string | null;
  discount_value?: number | string | null;
  hsn_code?: string | null;
  segment_bill_ref?: string | null;
  charged_on?: string | null;
  /** true when the row represents several folio_charges rolled into one */
  is_consolidated?: boolean;
  /** true when the row is one derived night of a multi-night room charge */
  is_night_split?: boolean;
  /** ids of the underlying folio_charges rows (consolidated rows only) */
  source_charge_ids?: string[];
}

const SEGMENT_LABEL: Record<string, string> = {
  food: "Food Bill",
  laundry: "Laundry Bill",
};

/**
 * Collapse Food / Laundry charges that came from a segment bill into ONE line
 * per distinct segment_bill_ref — e.g. "Food Bill (Ref: BRIJ-F-0013)" with the
 * summed amount — instead of one row per punched item.
 *
 * Room charges and any charge without a segment_bill_ref pass through
 * untouched, and the original order is preserved (a consolidated line sits at
 * the position of the bill's first item). Amounts/GST are summed, so folio
 * totals and the GST breakup (which read the raw charges) are unaffected.
 */
export function consolidateSegmentCharges<T extends DisplayCharge>(
  charges: T[],
): DisplayCharge[] {
  const out: DisplayCharge[] = [];
  const index = new Map<string, number>();

  for (const c of charges) {
    const ref = (c.segment_bill_ref ?? "").trim();
    const label = SEGMENT_LABEL[c.charge_type];
    if (!ref || !label) {
      out.push(c);
      continue;
    }
    const key = `${c.charge_type}::${ref}`;
    const amt = Number(c.amount ?? 0);
    const gst = Number(c.gst_amount ?? 0);
    const disc = Number(c.discount_amount ?? 0);
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, out.length);
      out.push({
        id: `seg:${key}`,
        charge_type: c.charge_type,
        description: `${label} (Ref: ${ref})`,
        qty: 1,
        rate: round2(amt),
        amount: round2(amt),
        gst_rate: Number(c.gst_rate ?? 0),
        gst_amount: round2(gst),
        discount_amount: round2(disc),
        hsn_code: c.hsn_code ?? null,
        segment_bill_ref: ref,
        is_consolidated: true,
        source_charge_ids: c.id ? [c.id] : [],
      });
      continue;
    }
    const row = out[at]!;
    const nextAmount = round2(Number(row.amount) + amt);
    row.amount = nextAmount;
    row.rate = nextAmount;
    row.gst_amount = round2(Number(row.gst_amount ?? 0) + gst);
    row.discount_amount = round2(Number(row.discount_amount ?? 0) + disc);
    // Mixed GST rates within one bill → show the effective blended rate.
    const netForGst = nextAmount - Number(row.discount_amount ?? 0);
    if (Number(row.gst_rate ?? 0) !== Number(c.gst_rate ?? 0)) {
      row.gst_rate = netForGst > 0
        ? round2((Number(row.gst_amount ?? 0) / netForGst) * 100)
        : 0;
    }
    if (c.id) row.source_charge_ids?.push(c.id);
  }

  return out;
}
/* ------------------------------------------------------------------ *
 * Per-night room charge expansion (DISPLAY ONLY)
 * ------------------------------------------------------------------ */

function addDays(iso: string, days: number): string {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso ?? "").slice(0, 10);
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Split a combined multi-night room charge (qty = nights) into one display row
 * per night — Date | Description | HSN | Qty 1 | Rate | Amount.
 *
 * Nightly rows are DERIVED (there is no per-night postings table): each
 * folio_charges room row corresponds to one booking_rooms segment, so a
 * mid-stay room/rate change (which closes one segment and opens another)
 * already yields separate rows and therefore correct per-night rates.
 *
 * Amounts, GST and line discounts are distributed with remainder so the nights
 * sum EXACTLY to the stored values — totals, GST breakup and the grand total
 * are byte-identical to before. Night-audit rows (qty = 1) pass through.
 */
export function expandRoomNights<T extends DisplayCharge>(
  rows: T[],
): DisplayCharge[] {
  const out: DisplayCharge[] = [];
  for (const c of rows) {
    const nights = Math.round(Number(c.qty ?? 0));
    if (c.charge_type !== "room" || c.is_consolidated || nights <= 1) {
      out.push(c);
      continue;
    }
    const weights = Array.from({ length: nights }, () => 1);
    const amounts = distributeWithRemainder(Number(c.amount ?? 0), weights);
    const gsts = distributeWithRemainder(Number(c.gst_amount ?? 0), weights);
    const discs = distributeWithRemainder(Number(c.discount_amount ?? 0), weights);
    const start = String(c.charged_on ?? "").slice(0, 10);
    const label = String(c.description ?? "").replace(/\s*·\s*\d+\s*night\(s\)\s*$/i, "");
    for (let i = 0; i < nights; i++) {
      out.push({
        ...c,
        id: `${c.id ?? "room"}:n${i}`,
        description: label,
        qty: 1,
        rate: Number(c.rate ?? 0),
        amount: amounts[i] ?? 0,
        gst_amount: gsts[i] ?? 0,
        discount_amount: discs[i] ?? 0,
        discount_value:
          c.discount_type === "percent" ? c.discount_value : (discs[i] ?? 0),
        charged_on: start ? addDays(start, i) : null,
        is_night_split: true,
        source_charge_ids: c.id ? [String(c.id)] : [],
      });
    }
  }
  return out;
}
