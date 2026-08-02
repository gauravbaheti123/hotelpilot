// Shared GST slab resolution — mirrors the server-side public.get_gst_rate() function
// so previews and non-server-driven charge inserts pick the same rate the DB will use.

export type GstCategory = "room" | "food" | "banquet" | "sundry";

import { stateCodeFromGstin } from "@/lib/gstin";
import { stateCodeFromName } from "@/lib/indiaGeo";

export interface GstSlabRow {
  property_id?: string;
  charge_category: GstCategory | string;
  from_amount: number | string;
  to_amount: number | string | null;
  gst_rate: number | string;
  is_active?: boolean | null;
  effective_from?: string | null;
}

/** Resolve the GST% for a given property/category/amount by walking the master
 *  slab table exactly the same way as the DB `get_gst_rate` function.
 *  Returns null when no slab matches — callers MUST treat that as a
 *  configuration error (block the charge / surface the missing slab), not
 *  silently fall back to a hardcoded rate. */
export function resolveGstRate(
  slabs: GstSlabRow[] | null | undefined,
  category: GstCategory,
  amount: number,
): number | null {
  if (!slabs || slabs.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const amt = Number(amount) || 0;
  const candidates = slabs.filter((s) => {
    if ((s.charge_category as string) !== category) return false;
    if (s.is_active === false) return false;
    if (s.effective_from && String(s.effective_from) > today) return false;
    const min = Number(s.from_amount) || 0;
    const maxRaw = s.to_amount == null ? null : Number(s.to_amount);
    const maxIsOpen = maxRaw == null || maxRaw === 0; // 0 == "and above"
    if (amt < min) return false;
    if (!maxIsOpen && amt > (maxRaw as number)) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Number(b.from_amount) - Number(a.from_amount));
  return Number(candidates[0].gst_rate);
}

/** Inclusive-tariff variant: caller passes the gross (GST-included) per-unit
 *  amount; we back-solve so the slab is chosen on the taxable value.
 *  Same two-pass behaviour as the DB functions. */
export function resolveGstRateInclusive(
  slabs: GstSlabRow[] | null | undefined,
  category: GstCategory,
  gross: number,
): number | null {
  const first = resolveGstRate(slabs, category, gross);
  if (first == null) return null;
  const taxable = Number(gross) / (1 + first / 100);
  const second = resolveGstRate(slabs, category, taxable);
  return second ?? first;
}

/* ------------------------------------------------------------------ */
/* Phase 57 — Place of supply: CGST+SGST (intra-state) vs IGST (inter) */
/* ------------------------------------------------------------------ */

export type TaxType = "cgst_sgst" | "igst";

export interface TaxParty {
  /** Pre-resolved 2-digit GST state code, when the record already stores one. */
  stateCode?: string | null;
  /** GSTIN — its first 2 digits are the authoritative state code. */
  gstin?: string | null;
  /** Free-text address state, used only when the two above are unusable. */
  state?: string | null;
}

/**
 * Resolve a party's GST state code, in priority order:
 *   1. GSTIN state code   2. stored state_code   3. address state name
 * Returns null when none of them yield a real state code.
 */
export function resolveStateCode(party: TaxParty | null | undefined): string | null {
  if (!party) return null;
  const fromGstin = stateCodeFromGstin(party.gstin);
  if (fromGstin) return fromGstin;
  const stored = String(party.stateCode ?? "").trim();
  if (/^\d{1,2}$/.test(stored)) return stored.padStart(2, "0");
  return stateCodeFromName(party.state);
}

/**
 * Decide the tax split for a bill.
 * Compares 2-digit state codes (not names), so spelling variants can never
 * produce a false IGST bill.
 * - Bill-To state unresolvable → silently inherits the property's own state,
 *   i.e. intra-state CGST+SGST. No warning is surfaced.
 * - Different state → IGST (single combined-rate line).
 */
export function resolveTaxType(
  billTo: TaxParty | string | null | undefined,
  property: TaxParty | string | null | undefined,
): { taxType: TaxType; billToStateCode: string | null; propertyStateCode: string | null } {
  const asParty = (v: TaxParty | string | null | undefined): TaxParty | null =>
    typeof v === "string" ? { state: v } : (v ?? null);

  const propertyStateCode = resolveStateCode(asParty(property));
  // Unknown bill-to → treat as the property's home state (intra-state).
  const billToStateCode = resolveStateCode(asParty(billTo)) ?? propertyStateCode;

  const taxType: TaxType =
    billToStateCode && propertyStateCode && billToStateCode !== propertyStateCode
      ? "igst"
      : "cgst_sgst";
  return { taxType, billToStateCode, propertyStateCode };
}

export function isInterState(
  billTo: TaxParty | string | null | undefined,
  property: TaxParty | string | null | undefined,
): boolean {
  return resolveTaxType(billTo, property).taxType === "igst";
}

/** Split a GST amount into the lines that should print for this tax type. */
export function splitGst(gstAmount: number, taxType: TaxType) {
  const g = Number(gstAmount) || 0;
  if (taxType === "igst") return { cgst: 0, sgst: 0, igst: g };
  return { cgst: g / 2, sgst: g / 2, igst: 0 };
}
