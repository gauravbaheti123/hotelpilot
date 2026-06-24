import { supabase } from "@/integrations/supabase/client";

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

  const [{ data: folios }, { data: pays }] = await Promise.all([
    supabase.from("folios")
      .select("id,status,sub_total,gst_amount,total_amount,created_at,settled_at")
      .eq("property_id", propertyId)
      .gte("created_at", startIso)
      .lt("created_at", endIso),
    supabase.from("payments")
      .select("amount,mode,paid_at")
      .eq("property_id", propertyId)
      .gte("paid_at", startIso)
      .lt("paid_at", endIso),
  ]);

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
  };
  for (const f of folios ?? []) {
    summary.sub_total += Number((f as { sub_total: number }).sub_total ?? 0);
    summary.gst_amount += Number((f as { gst_amount: number }).gst_amount ?? 0);
    summary.total_amount += Number((f as { total_amount: number }).total_amount ?? 0);
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
      .select("id,booking_id,bookings!inner(property_id,check_in,check_out,status)")
      .eq("bookings.property_id", propertyId)
      .lte("bookings.check_in", date)
      .gt("bookings.check_out", date)
      .in("bookings.status", ["checked_in", "reserved", "confirmed"]),
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

export async function fetchGstInvoices(propertyId: string, from: string, to: string): Promise<GstInvoiceRow[]> {
  const start = new Date(`${from}T00:00:00`).toISOString();
  const endD = new Date(`${to}T00:00:00`);
  endD.setDate(endD.getDate() + 1);
  const end = endD.toISOString();
  const { data } = await supabase.from("folios")
    .select("invoice_number,created_at,guest_gstin,guest_company,sub_total,gst_amount,total_amount,gst_mode,status,bookings(guests(name))")
    .eq("property_id", propertyId)
    .eq("gst_mode", "gst")
    .neq("status", "void")
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at", { ascending: false });
  return (data ?? []).map((d) => {
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

export function todayIso(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}