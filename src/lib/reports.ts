import { supabase } from "@/integrations/supabase/client";
import { resolveTaxType } from "@/lib/gst";
import { stateNameFromCode } from "@/lib/indiaGeo";
import { fetchBanquetScope, isBanquetRecord } from "@/lib/banquetScope";
import { istDateISO } from "@/lib/date";
import { reportQueryError } from "@/lib/queryError";

export interface DailySummary {
  date: string;
  folios_created: number;
  folios_settled: number;
  sub_total: number;
  gst_amount: number;
  total_amount: number;
  payment_count: number;
  payments_total: number;
  by_mode: Record<string, number>;
  gst_invoice_total: number;
  gst_invoice_count: number;
}

export const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  bank: "Bank",
  wallet: "Wallet",
  other: "Other",
};

function dayRange(date: string) {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export async function fetchDailySummary(propertyId: string, date: string): Promise<DailySummary> {
  const { startIso, endIso } = dayRange(date);

  const [{ data: folioRows }, { data: payRows }, scope] = await Promise.all([
    supabase.from("folios")
      .select("id,booking_id,status,sub_total,gst_amount,total_amount,created_at,settled_at,gst_mode,bill_type")
      .eq("property_id", propertyId)
      .gte("created_at", startIso)
      .lt("created_at", endIso),
    supabase.from("payments")
      .select("amount,mode,paid_at,booking_id,folio_id")
      .eq("property_id", propertyId)
      .gte("paid_at", startIso)
      .lt("paid_at", endIso),
    fetchBanquetScope(propertyId),
  ]);
  // Banquet-origin (event_block) folios/payments are excluded from operational totals.
  const folios = (folioRows ?? []).filter(
    (f) => !isBanquetRecord(scope, { booking_id: (f as { booking_id?: string | null }).booking_id, folio_id: (f as { id: string }).id }),
  );
  const pays = (payRows ?? []).filter(
    (p) => !isBanquetRecord(scope, p as { booking_id?: string | null; folio_id?: string | null }),
  );

  const summary: DailySummary = {
    date,
    folios_created: folios?.length ?? 0,
    folios_settled: (folios ?? []).filter((f: { status: string }) => f.status === "settled").length,
    sub_total: 0,
    gst_amount: 0,
    total_amount: 0,
    payment_count: pays?.length ?? 0,
    payments_total: 0,
    by_mode: {},
    gst_invoice_total: 0,
    gst_invoice_count: 0,
  };
  for (const f of folios ?? []) {
    const row = f as { sub_total: number; gst_amount: number; total_amount: number; gst_mode?: string; bill_type?: string | null };
    summary.sub_total += Number(row.sub_total ?? 0);
    summary.gst_amount += Number(row.gst_amount ?? 0);
    summary.total_amount += Number(row.total_amount ?? 0);
    // Every bill is a GST invoice; the legacy non-GST "cash bill" type is retired.
    summary.gst_invoice_total += Number(row.total_amount ?? 0);
    summary.gst_invoice_count += 1;
  }
  for (const p of pays ?? []) {
    const amt = Number((p as { amount: number }).amount ?? 0);
    const mode = (p as { mode: string }).mode ?? "other";
    summary.payments_total += amt;
    summary.by_mode[mode] = (summary.by_mode[mode] ?? 0) + amt;
  }
  return summary;
}

export interface OccupancySnapshot {
  date: string;
  rooms_total: number;
  rooms_occupied: number;
  occupancy_pct: number;
}

export async function fetchOccupancy(propertyId: string, date: string): Promise<OccupancySnapshot> {
  const [{ count: roomsTotal }, { data: br }] = await Promise.all([
    supabase.from("rooms")
      .select("id", { count: "exact", head: true })
      .eq("property_id", propertyId)
      .eq("is_active", true),
    supabase.from("booking_rooms")
      .select("id,booking_id,bookings!booking_rooms_booking_id_fkey!inner(property_id,check_in,check_out,status)")
      .eq("bookings.property_id", propertyId)
      .lte("bookings.check_in", date)
      .gt("bookings.check_out", date)
      .in("bookings.status", ["checked_in", "reserved"]),
  ]);
  const occupied = br?.length ?? 0;
  const total = roomsTotal ?? 0;
  return {
    date,
    rooms_total: total,
    rooms_occupied: occupied,
    occupancy_pct: total > 0 ? Math.round((occupied / total) * 1000) / 10 : 0,
  };
}

export interface GstInvoiceRow {
  invoice_number: string;
  created_at: string;
  guest_name: string | null;
  guest_gstin: string | null;
  guest_company: string | null;
  sub_total: number;
  gst_amount: number;
  total_amount: number;
}

export interface GstInvoiceSlabRow {
  invoice_number: string;
  created_at: string;
  guest_name: string | null;
  guest_gstin: string | null;
  guest_company: string | null;
  gst_rate: number;          // e.g. 5, 12, 18
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** Phase 57 — place of supply of this invoice. */
  tax_type: "cgst_sgst" | "igst";
  bill_to_state: string | null;
  gst_total: number;
  invoice_total: number;     // filled only on the first slab row of each invoice
  is_first_of_invoice: boolean;
}

function round2(n: number) { return Math.round(n * 100) / 100; }

export async function fetchGstInvoices(propertyId: string, from: string, to: string): Promise<GstInvoiceRow[]> {
  const start = new Date(`${from}T00:00:00`).toISOString();
  const endD = new Date(`${to}T00:00:00`);
  endD.setDate(endD.getDate() + 1);
  const end = endD.toISOString();
  const { data, error: __qe1 } = await supabase.from("folios")
    .select("id,booking_id,invoice_number,created_at,guest_gstin,guest_company,sub_total,gst_amount,total_amount,gst_mode,status,bookings(guests(name))")
    .eq("property_id", propertyId)
    .eq("gst_mode", "gst")
    .neq("status", "void")
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at", { ascending: false });
  if (__qe1) reportQueryError("folios", __qe1);
  const scope = await fetchBanquetScope(propertyId);
  const visible = (data ?? []).filter((d) => !isBanquetRecord(scope, d as { booking_id?: string | null }));
  return visible.map((d) => {
    const row = d as unknown as {
      invoice_number: string; created_at: string;
      guest_gstin: string | null; guest_company: string | null;
      sub_total: number; gst_amount: number; total_amount: number;
      bookings: { guests: { name: string } | null } | null;
    };
    return {
      invoice_number: row.invoice_number,
      created_at: row.created_at,
      guest_name: row.bookings?.guests?.name ?? null,
      guest_gstin: row.guest_gstin,
      guest_company: row.guest_company,
      sub_total: Number(row.sub_total ?? 0),
      gst_amount: Number(row.gst_amount ?? 0),
      total_amount: Number(row.total_amount ?? 0),
    };
  });
}

/**
 * GST report — one row per (invoice, gst_rate). Groups folio_charges by their
 * gst_rate so each row shows a clean slab (5/12/18…) instead of a blended
 * average. Bill-level discounts (which reduce the folio's stored gst_amount
 * below Σ line gst) are absorbed by scaling each slab's taxable + gst so the
 * per-slab totals reconcile with folio.gst_amount, and the effective rate
 * stays exactly at the slab's rate.
 */
export async function fetchGstInvoiceSlabs(
  propertyId: string, from: string, to: string,
): Promise<GstInvoiceSlabRow[]> {
  const start = new Date(`${from}T00:00:00`).toISOString();
  const endD = new Date(`${to}T00:00:00`);
  endD.setDate(endD.getDate() + 1);
  const end = endD.toISOString();
  const { data, error: __qe2 } = await supabase.from("folios")
    .select("id,booking_id,invoice_number,created_at,guest_gstin,guest_company,billing_company_id,sub_total,gst_amount,total_amount,gst_mode,status,bookings(guests(name,state,state_code,gst_number)),folio_charges(charge_type,amount,gst_rate,gst_amount,discount_amount)")
    .eq("property_id", propertyId)
    .eq("gst_mode", "gst")
    .neq("status", "void")
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at", { ascending: false });
  if (__qe2) reportQueryError("folios", __qe2);
  // Place of supply compares GST state codes (GSTIN → state_code → state name).
  const [{ data: propRow }, { data: coRows }, scope] = await Promise.all([
    supabase.from("properties").select("state,state_code,gstin").eq("id", propertyId).maybeSingle(),
    supabase.from("billing_companies").select("id,state,state_code,gstin").eq("property_id", propertyId),
    fetchBanquetScope(propertyId),
  ]);
  const propParty = (propRow ?? null) as
    { state?: string | null; state_code?: string | null; gstin?: string | null } | null;
  type CoRow = { id: string; state: string | null; state_code: string | null; gstin: string | null };
  const coParty = new Map<string, CoRow>(
    ((coRows ?? []) as CoRow[]).map((c) => [c.id, c]),
  );
  const out: GstInvoiceSlabRow[] = [];
  for (const raw of (data ?? []).filter((d) => !isBanquetRecord(scope, d as { booking_id?: string | null }))) {
    const f = raw as unknown as {
      invoice_number: string; created_at: string;
      guest_gstin: string | null; guest_company: string | null;
      billing_company_id: string | null;
      sub_total: number; gst_amount: number; total_amount: number;
      bookings: {
        guests: {
          name: string; state: string | null;
          state_code?: string | null; gst_number?: string | null;
        } | null;
      } | null;
      folio_charges: Array<{
        charge_type: string; amount: number | string;
        gst_rate: number | string | null;
        gst_amount: number | string | null;
        discount_amount: number | string | null;
      }> | null;
    };
    const co = f.billing_company_id ? coParty.get(f.billing_company_id) ?? null : null;
    const g = f.bookings?.guests ?? null;
    const billToParty = co
      ? { gstin: co.gstin, stateCode: co.state_code, state: co.state }
      : { gstin: f.guest_gstin ?? g?.gst_number ?? null, stateCode: g?.state_code ?? null, state: g?.state ?? null };
    const { taxType, billToStateCode } = resolveTaxType(billToParty, {
      gstin: propParty?.gstin, stateCode: propParty?.state_code, state: propParty?.state,
    });
    // Display name for the report column; falls back to the resolved code.
    const billToState = billToParty.state || stateNameFromCode(billToStateCode);
    const igstBill = taxType === "igst";
    const bySlab = new Map<number, { taxable: number; gst: number }>();
    let lineGstSum = 0;
    for (const c of f.folio_charges ?? []) {
      if (c.charge_type === "tax" || c.charge_type === "discount") continue;
      const amt = Math.abs(Number(c.amount ?? 0));
      if (amt <= 0) continue;
      const ld = Math.max(0, Math.min(Number(c.discount_amount ?? 0), amt));
      const net = amt - ld;
      const rate = Number(c.gst_rate ?? 0);
      const gFull = Number(c.gst_amount ?? 0);
      const gNet = amt > 0 ? gFull * (net / amt) : gFull;
      lineGstSum += gNet;
      const cur = bySlab.get(rate) ?? { taxable: 0, gst: 0 };
      cur.taxable += net;
      cur.gst += gNet;
      bySlab.set(rate, cur);
    }
    const folioGst = Number(f.gst_amount ?? 0);
    // Scale factor so per-slab GST reconciles with the folio's stored gst_amount
    // (handles bill-level discounts that shrink the folio total).
    const factor = lineGstSum > 0 ? folioGst / lineGstSum : 1;
    const rates = [...bySlab.keys()].sort((a, b) => a - b);
    let first = true;
    for (const rate of rates) {
      const s = bySlab.get(rate)!;
      // For 0%-rate lines, gst is 0 by definition — factor doesn't apply.
      const gstScaled = rate > 0 ? round2(s.gst * factor) : 0;
      const taxableScaled = rate > 0 ? round2(s.taxable * factor) : round2(s.taxable);
      const cgst = igstBill ? 0 : round2(gstScaled / 2);
      out.push({
        invoice_number: f.invoice_number,
        created_at: f.created_at,
        guest_name: f.bookings?.guests?.name ?? null,
        guest_gstin: f.guest_gstin,
        guest_company: f.guest_company,
        gst_rate: rate,
        taxable: taxableScaled,
        cgst,
        sgst: cgst,
        igst: igstBill ? gstScaled : 0,
        tax_type: taxType,
        bill_to_state: billToState,
        gst_total: gstScaled,
        invoice_total: first ? Number(f.total_amount ?? 0) : 0,
        is_first_of_invoice: first,
      });
      first = false;
    }
    // If the folio had no non-tax/discount charges at all, still emit one row
    // so the invoice appears in the report (rare, but avoids silent dropouts).
    if (bySlab.size === 0) {
      out.push({
        invoice_number: f.invoice_number,
        created_at: f.created_at,
        guest_name: f.bookings?.guests?.name ?? null,
        guest_gstin: f.guest_gstin,
        guest_company: f.guest_company,
        gst_rate: 0,
        taxable: Number(f.sub_total ?? 0),
        cgst: 0, sgst: 0, igst: 0, gst_total: 0,
        tax_type: taxType,
        bill_to_state: billToState,
        invoice_total: Number(f.total_amount ?? 0),
        is_first_of_invoice: true,
      });
    }
  }
  return out;
}

export function todayIso(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return istDateISO(d);
}