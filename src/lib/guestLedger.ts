import { supabase } from "@/integrations/supabase/client";

export type LedgerType = "Lodge" | "Food" | "Laundry" | "Banquet" | "Banquet Food" | "Other";

export interface LedgerRow {
  id: string;
  date: string;
  number: string;
  type: LedgerType;
  status: string;
  total: number;
  paid: number;
  due: number;
}

export interface GuestLedger {
  rows: LedgerRow[];
  totalBilled: number;
  totalPaid: number;
  totalDue: number;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

function segmentType(seg: string | null): LedgerType {
  const s = (seg ?? "").toLowerCase();
  if (s === "food") return "Food";
  if (s === "laundry") return "Laundry";
  if (s === "banquet") return "Banquet";
  return "Other";
}

/**
 * Consolidated billing ledger for one guest:
 * guests → bookings → folios, plus segment bills (room-linked or walk-in with
 * guest_id) and banquet bookings / banquet master bills.
 */
export async function fetchGuestLedger(guestId: string): Promise<GuestLedger> {
  const { data: bookingRows } = await supabase
    .from("bookings")
    .select("id")
    .eq("guest_id", guestId)
    .neq("source", "event_block");
  const bookingIds = (bookingRows ?? []).map((b) => b.id as string);

  const rows: LedgerRow[] = [];

  if (bookingIds.length) {
    const { data: folios } = await supabase
      .from("folios")
      .select("id,invoice_number,status,total_amount,paid_amount,balance_amount,created_at,is_deleted")
      .in("booking_id", bookingIds)
      .order("created_at", { ascending: false });
    for (const f of folios ?? []) {
      if ((f as { is_deleted?: boolean }).is_deleted) continue;
      if (f.status === "void") continue;
      rows.push({
        id: f.id as string,
        date: String(f.created_at ?? "").slice(0, 10),
        number: (f.invoice_number as string) ?? "—",
        type: "Lodge",
        status: (f.status as string) ?? "open",
        total: n(f.total_amount),
        paid: n(f.paid_amount),
        due: n(f.balance_amount),
      });
    }
  }

  // Segment bills: linked directly to the guest, or to one of their bookings.
  const segFilters = [`guest_id.eq.${guestId}`];
  if (bookingIds.length) segFilters.push(`booking_id.in.(${bookingIds.join(",")})`);
  const { data: segs } = await supabase
    .from("segment_bills")
    .select("id,bill_number,segment,status,total_amount,paid_amount,created_at")
    .or(segFilters.join(","))
    .order("created_at", { ascending: false });
  for (const s of segs ?? []) {
    const total = n(s.total_amount);
    const paid = n(s.paid_amount);
    rows.push({
      id: s.id as string,
      date: String(s.created_at ?? "").slice(0, 10),
      number: (s.bill_number as string) ?? "—",
      type: segmentType(s.segment as string | null),
      status: (s.status as string) ?? "open",
      total,
      paid,
      due: Math.max(0, total - paid),
    });
  }

  const { data: banquets } = await supabase
    .from("banquet_bookings")
    .select("id,banquet_number,status,total_amount,advance_amount,balance_amount,event_date")
    .eq("guest_id", guestId)
    .order("event_date", { ascending: false });
  const banquetIds = (banquets ?? []).map((b) => b.id as string);
  for (const b of banquets ?? []) {
    if (b.status === "cancelled") continue;
    rows.push({
      id: b.id as string,
      date: String(b.event_date ?? "").slice(0, 10),
      number: (b.banquet_number as string) ?? "—",
      type: "Banquet",
      status: (b.status as string) ?? "open",
      total: n(b.total_amount),
      paid: n(b.advance_amount),
      due: n(b.balance_amount),
    });
  }

  if (banquetIds.length) {
    const { data: masters } = await supabase
      .from("banquet_master_bills")
      .select("id,bill_number,status,total_amount,created_at")
      .in("banquet_booking_id", banquetIds)
      .order("created_at", { ascending: false });
    for (const m of masters ?? []) {
      const total = n(m.total_amount);
      const settled = (m.status as string) === "settled";
      rows.push({
        id: m.id as string,
        date: String(m.created_at ?? "").slice(0, 10),
        number: (m.bill_number as string) ?? "—",
        type: "Banquet Food",
        status: (m.status as string) ?? "open",
        total,
        paid: settled ? total : 0,
        due: settled ? 0 : total,
      });
    }
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return {
    rows,
    totalBilled: rows.reduce((s, r) => s + r.total, 0),
    totalPaid: rows.reduce((s, r) => s + r.paid, 0),
    totalDue: rows.reduce((s, r) => s + r.due, 0),
  };
}
