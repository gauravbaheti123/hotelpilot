import { supabase } from "@/integrations/supabase/client";
import { istDateISO } from "@/lib/date";
import { reportQueryError } from "@/lib/queryError";

export interface DayMetric {
  date: string;
  rooms_total: number;
  rooms_sold: number;
  occupancy_pct: number;
  room_revenue: number;
  adr: number;
  revpar: number;
}

export interface AnalyticsRange {
  from: string;
  to: string; // inclusive
  days: DayMetric[];
  totals: {
    rooms_available: number;
    rooms_sold: number;
    occupancy_pct: number;
    room_revenue: number;
    adr: number;
    revpar: number;
  };
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = istDateISO(new Date(d));
    out.push(iso);
  }
  return out;
}

export async function fetchAnalytics(propertyId: string, from: string, to: string): Promise<AnalyticsRange> {
  const dates = eachDay(from, to);
  const [{ count: roomsTotal, error: __qp1 }, { data: br, error: __qp2 }] = await Promise.all([
    supabase.from("rooms")
      .select("id", { count: "exact", head: true })
      .eq("property_id", propertyId)
      .eq("is_active", true),
    supabase.from("booking_rooms")
      .select("check_in,check_out,rate,bookings!booking_rooms_booking_id_fkey!inner(property_id,status)")
      .eq("bookings.property_id", propertyId)
      .in("bookings.status", ["reserved", "checked_in", "checked_out"])
      .lt("check_in", to)
      .gt("check_out", from),
  ]);
  if (__qp1) reportQueryError("rooms total", __qp1);
  if (__qp2) reportQueryError("occupancy data", __qp2);

  const total = roomsTotal ?? 0;
  const days: DayMetric[] = dates.map((d) => {
    let sold = 0;
    let rev = 0;
    for (const row of br ?? []) {
      const r = row as { check_in: string; check_out: string; rate: number };
      if (r.check_in <= d && d < r.check_out) {
        sold += 1;
        rev += Number(r.rate ?? 0);
      }
    }
    return {
      date: d,
      rooms_total: total,
      rooms_sold: sold,
      occupancy_pct: total > 0 ? Math.round((sold / total) * 1000) / 10 : 0,
      room_revenue: rev,
      adr: sold > 0 ? Math.round(rev / sold) : 0,
      revpar: total > 0 ? Math.round(rev / total) : 0,
    };
  });

  const sumSold = days.reduce((a, x) => a + x.rooms_sold, 0);
  const sumRev = days.reduce((a, x) => a + x.room_revenue, 0);
  const avail = total * days.length;
  return {
    from,
    to,
    days,
    totals: {
      rooms_available: avail,
      rooms_sold: sumSold,
      occupancy_pct: avail > 0 ? Math.round((sumSold / avail) * 1000) / 10 : 0,
      room_revenue: sumRev,
      adr: sumSold > 0 ? Math.round(sumRev / sumSold) : 0,
      revpar: avail > 0 ? Math.round(sumRev / avail) : 0,
    },
  };
}

export function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  d.setDate(d.getDate() - n);
  return istDateISO(d);
}