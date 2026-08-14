/**
 * Daily Morning Report — shared data layer.
 *
 * Five sections (rooms, food/KOT, direct restaurant, banquet, payment summary)
 * fetched live for a date range. Used by the combined multi-page report and by
 * each standalone section report, so both always agree.
 *
 * "Bill On Hold" is never counted as collected money (see @/lib/billing).
 */
import { supabase } from "@/integrations/supabase/client";
import { isHoldPayment, HOLD_PAYMENT_MODE } from "@/lib/billing";
import { istAddDays } from "@/lib/date";
import { resolveTaxType } from "@/lib/gst";
import { reportQueryError } from "@/lib/queryError";
import type { ReportColumn } from "@/lib/reportExports";
import { fmtDate, fmtDateTime, fmtINR } from "@/lib/reportExports";

export type SectionKey = "rooms" | "food" | "restaurant" | "banquet" | "payments";

export const SECTION_TITLES: Record<SectionKey, string> = {
  rooms: "Room-wise Report",
  food: "Food Bill (KOT-wise)",
  restaurant: "Direct Restaurant Report",
  banquet: "Banquet / Event Report",
  payments: "Cash / Payment Mode Summary",
};

export interface RoomRow {
  _id: string;
  room_no: string; category: string; guest: string;
  check_in: string | null; check_out: string | null;
  nights: number; rate: number;
  charge: number; discount: number;
  gst_rate: number; cgst: number; sgst: number; igst: number;
  total: number;
  pay_modes: string; status: string; source: string; invoice_no: string;
}

export interface FoodRow {
  _id: string;
  kot_no: string; room_no: string; guest: string; items: string; item_count: number;
  amount: number; gst: number; total: number; status: string; ordered_at: string;
}

export interface RestaurantRow {
  _id: string;
  at: string; outlet: string; bill_no: string; guest: string; amount: number; status: string;
}

export interface BanquetRow {
  _id: string;
  event: string; ref: string; hall: string; pax: number;
  food_subtotal: number; gst: number; total: number; status: string; bills: string;
}

export interface PaymentModeRow {
  _id: string;
  mode: string; count: number; amount: number; is_hold: boolean;
}

export interface DailyReportData {
  from: string; to: string;
  rooms: RoomRow[];
  food: FoodRow[];
  restaurant: RestaurantRow[];
  banquet: BanquetRow[];
  payments: PaymentModeRow[];
  occupancy: { occupied: number; sellable: number; pct: number };
  duesAdded: number;
  realCollected: number;
  holdTotal: number;
}

const num = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

function sourceLabel(source: string | null, otaPartner: string | null): string {
  const s = (source ?? "").toLowerCase();
  if (s === "ota") return otaPartner ? `OTA — ${otaPartner}` : "OTA";
  if (s === "other") return otaPartner ? otaPartner : "Other";
  if (s === "walk_in") return "Walk-in";
  if (s === "phone") return "Phone";
  if (s === "corporate") return "Corporate";
  if (s === "event_block" || s === "banquet") return "Banquet";
  return source ? source.replace(/_/g, " ") : "Direct";
}

function folioStatusLabel(f: { status?: string | null; is_reopened?: boolean | null }): string {
  if (f.is_reopened) return "Reopened";
  const s = (f.status ?? "").toLowerCase();
  if (s === "settled") return "Settled";
  if (s === "due") return "Due";
  if (s === "void") return "Void";
  if (s === "open") return "Open";
  return s || "—";
}

/** Load every section for [from, to] (inclusive business dates, IST). */
export async function loadDailyReport(
  propertyId: string, from: string, to: string,
): Promise<DailyReportData> {
  // IST-anchored window. Naive strings are read as UTC by Postgres, which
  // shifts an IST business day by 5h30m and drops late-evening rows.
  const startIso = `${from}T00:00:00+05:30`;
  const endIso = `${istAddDays(to, 1)}T00:00:00+05:30`; // exclusive upper bound

  const [prop, brRes, kotRes, rdcRes, bqRes, payRes, roomsRes] = await Promise.all([
    supabase.from("properties").select("state,state_code,gstin").eq("id", propertyId).maybeSingle(),
    supabase.from("booking_rooms").select(`
      id,rate,check_in,check_out,actual_check_in,actual_check_out,check_in_time,status,booking_id,
      rooms:room_id(room_number),room_categories:category_id(name),
      bookings!booking_rooms_booking_id_fkey(id,source,ota_partner_name,checked_in_at,guests(name))
    `).eq("property_id", propertyId).lte("check_in", to).gt("check_out", from),
    // Food bills live in segment_bills (+ segment_bill_items) — the same source
    // the Invoices → Food tab reads. kot_orders is unused by the current flow.
    supabase.from("segment_bills").select(`
      id,bill_number,status,payment_mode,total_amount,gst_amount,paid_amount,
      guest_name,is_walkin,booking_id,folio_id,created_at,is_complimentary,complimentary_reason,
      rooms:room_id(room_number),
      bookings:booking_id(guests(name)),
      segment_bill_items(description,qty,rate,amount)
    `).eq("property_id", propertyId).eq("segment", "food").neq("status", "void")
      .gte("created_at", startIso).lt("created_at", endIso)
      .order("created_at", { ascending: true }),
    supabase.from("restaurant_direct_charges").select(`
      id,charge_date,amount,description,bill_no,is_settled,created_at,
      restaurant_outlets:outlet_id(name),guests:guest_id(name)
    `).eq("property_id", propertyId).gte("charge_date", from).lte("charge_date", to)
      .order("charge_date", { ascending: true }),
    supabase.from("bookings").select(`
      id,booking_number,banquet_number,event_name,function_type,pax,event_date,hall_id,
      total_amount,fb_charge,event_status,halls:hall_id(name)
    `).eq("property_id", propertyId).eq("booking_type", "banquet")
      .gte("event_date", from).lte("event_date", to),
    supabase.from("payments").select("id,amount,mode,paid_at,folio_id")
      .eq("property_id", propertyId).gte("paid_at", startIso).lt("paid_at", endIso),
    supabase.from("rooms").select("id").eq("property_id", propertyId).eq("is_active", true),
  ]);

  for (const [label, res] of [
    ["property", prop], ["booking rooms", brRes], ["food bills", kotRes],
    ["direct restaurant charges", rdcRes], ["banquet bookings", bqRes],
    ["payments", payRes], ["rooms", roomsRes],
  ] as const) {
    if ((res as { error?: unknown }).error) reportQueryError(label, (res as { error: unknown }).error as never);
  }

  const propertyState = (prop.data as { state?: string | null; state_code?: string | null } | null) ?? null;

  /* ---------------- Rooms ---------------- */
  const brs = ((brRes.data ?? []) as Record<string, any>[]).filter((br) => br.status !== "shifted");
  const bookingIds = Array.from(new Set(brs.map((b) => b.booking_id).filter(Boolean)));

  let folios: Record<string, any>[] = [];
  let charges: Record<string, any>[] = [];
  let folioPayments: Record<string, any>[] = [];
  if (bookingIds.length) {
    const { data: fData, error: fErr } = await supabase.from("folios")
      .select("id,booking_id,invoice_number,status,is_reopened,sub_total,discount_amount,gst_amount,total_amount,paid_amount,balance_amount,guest_gstin")
      .in("booking_id", bookingIds).neq("status", "void");
    if (fErr) reportQueryError("folios", fErr);
    folios = (fData ?? []) as Record<string, any>[];
    const folioIds = folios.map((f) => f.id);
    if (folioIds.length) {
      const [cRes, pRes] = await Promise.all([
        supabase.from("folio_charges")
          .select("folio_id,charge_type,amount,gst_rate,gst_amount,discount_amount,source_table,source_id")
          .in("folio_id", folioIds).eq("charge_type", "room"),
        supabase.from("payments").select("folio_id,amount,mode").in("folio_id", folioIds),
      ]);
      if (cRes.error) reportQueryError("folio charges", cRes.error);
      if (pRes.error) reportQueryError("folio payments", pRes.error);
      charges = (cRes.data ?? []) as Record<string, any>[];
      folioPayments = (pRes.data ?? []) as Record<string, any>[];
    }
  }
  const folioByBooking = new Map<string, Record<string, any>>();
  for (const f of folios) if (!folioByBooking.has(f.booking_id)) folioByBooking.set(f.booking_id, f);
  const payModesByFolio = new Map<string, string[]>();
  for (const p of folioPayments) {
    const list = payModesByFolio.get(p.folio_id) ?? [];
    const label = isHoldPayment(p.mode) ? `${HOLD_PAYMENT_MODE} (not collected)` : String(p.mode ?? "");
    if (label && !list.includes(label)) list.push(label);
    payModesByFolio.set(p.folio_id, list);
  }

  const rooms: RoomRow[] = brs.map((br) => {
    const bk = br.bookings ?? {};
    const folio = folioByBooking.get(br.booking_id) ?? null;
    const nights = Math.max(
      1,
      Math.round((+new Date(br.check_out) - +new Date(br.check_in)) / 86400000),
    );
    const own = charges.filter((c) => c.source_id === br.id);
    const charge = own.length
      ? r2(own.reduce((s, c) => s + num(c.amount), 0))
      : r2(nights * num(br.rate));
    const discount = r2(own.reduce((s, c) => s + num(c.discount_amount), 0));
    const gstRate = own.length ? num(own[0].gst_rate) : 0;
    const gstAmt = own.length
      ? r2(own.reduce((s, c) => s + num(c.gst_amount), 0))
      : r2((charge * gstRate) / 100);
    const { taxType } = resolveTaxType(folio?.guest_gstin ?? null, propertyState);
    const igst = taxType === "igst" ? gstAmt : 0;
    const half = taxType === "igst" ? 0 : r2(gstAmt / 2);
    const ci = br.actual_check_in ?? (br.check_in_time ? `${br.check_in}T${br.check_in_time}` : null) ?? bk.checked_in_at ?? null;
    return {
      _id: br.id,
      room_no: br.rooms?.room_number ?? "—",
      category: br.room_categories?.name ?? "—",
      guest: bk.guests?.name ?? "—",
      check_in: ci,
      check_out: br.actual_check_out ?? null,
      nights,
      rate: num(br.rate),
      charge, discount, gst_rate: gstRate,
      cgst: half, sgst: half, igst,
      total: r2(charge - discount + gstAmt),
      pay_modes: (payModesByFolio.get(folio?.id ?? "") ?? []).join(", ") || "—",
      status: folio ? folioStatusLabel(folio) : "No bill",
      source: sourceLabel(bk.source ?? null, bk.ota_partner_name ?? null),
      invoice_no: folio?.invoice_number ?? "—",
    };
  }).sort((a, b) => a.room_no.localeCompare(b.room_no, undefined, { numeric: true }));

  /* ---------------- Food bills ---------------- */
  const food: FoodRow[] = ((kotRes.data ?? []) as Record<string, any>[]).map((b) => {
    const items = (b.segment_bill_items ?? []) as Record<string, any>[];
    let status: string;
    if (b.is_complimentary) status = `Complimentary — ${b.complimentary_reason ?? "no reason"}`;
    else if (isHoldPayment(b.payment_mode)) status = `${HOLD_PAYMENT_MODE} (not collected)`;
    else if (b.status === "settled") status = "Settled";
    else if (b.folio_id) status = "Billed to folio";
    else status = "Open";
    const guest = (b.guest_name || b.bookings?.guests?.name || "").trim();
    return {
      _id: b.id,
      kot_no: b.bill_number ?? "—",
      room_no: b.rooms?.room_number ?? (b.is_walkin ? "Restaurant / Walk-in" : "—"),
      guest: guest || (b.is_walkin ? "Walk-in" : "—"),
      items: items.map((i) => `${i.description} ×${num(i.qty)}`).join(", "),
      item_count: items.length,
      amount: r2(num(b.total_amount) - num(b.gst_amount)),
      gst: num(b.gst_amount),
      total: num(b.total_amount),
      status,
      ordered_at: b.created_at,
    };
  });

  /* ---------------- Direct restaurant ---------------- */
  const restaurant: RestaurantRow[] = ((rdcRes.data ?? []) as Record<string, any>[]).map((c) => ({
    _id: c.id,
    at: c.created_at ?? c.charge_date,
    outlet: c.restaurant_outlets?.name ?? "Restaurant",
    bill_no: c.bill_no ?? "—",
    guest: c.guests?.name ?? "Walk-in",
    amount: num(c.amount),
    status: c.is_settled ? "Settled" : "Due",
  }));

  /* ---------------- Banquet ---------------- */
  const bqBookings = (bqRes.data ?? []) as Record<string, any>[];
  let masterBills: Record<string, any>[] = [];
  if (bqBookings.length) {
    const { data: mb, error: mbErr } = await supabase.from("banquet_master_bills")
      .select("booking_id,bill_number,food_subtotal,gst_amount,total_amount,status")
      .in("booking_id", bqBookings.map((b) => b.id));
    if (mbErr) reportQueryError("banquet master bills", mbErr);
    masterBills = (mb ?? []) as Record<string, any>[];
  }
  const banquet: BanquetRow[] = bqBookings.map((b) => {
    const bills = masterBills.filter((m) => m.booking_id === b.id);
    const foodSub = r2(bills.reduce((s, m) => s + num(m.food_subtotal), 0));
    const gst = r2(bills.reduce((s, m) => s + num(m.gst_amount), 0));
    const billTotal = r2(bills.reduce((s, m) => s + num(m.total_amount), 0));
    return {
      _id: b.id,
      event: b.event_name || b.function_type || "Event",
      ref: b.banquet_number || b.booking_number || "—",
      hall: b.halls?.name ?? "—",
      pax: Number(b.pax ?? 0),
      food_subtotal: foodSub || num(b.fb_charge),
      gst,
      total: billTotal || num(b.total_amount),
      status: bills.length
        ? (bills.every((m) => m.status === "settled") ? "Settled" : "Due")
        : (b.event_status ?? "—"),
      bills: [b.banquet_number, ...bills.map((m) => m.bill_number)].filter(Boolean).join(", ") || "—",
    };
  });

  /* ---------------- Payment summary ---------------- */
  const pays = (payRes.data ?? []) as Record<string, any>[];
  const byMode = new Map<string, { count: number; amount: number; hold: boolean }>();
  for (const p of pays) {
    const hold = isHoldPayment(p.mode);
    const key = hold ? HOLD_PAYMENT_MODE : String(p.mode ?? "other");
    const cur = byMode.get(key) ?? { count: 0, amount: 0, hold };
    cur.count += 1; cur.amount = r2(cur.amount + num(p.amount));
    byMode.set(key, cur);
  }
  const payments: PaymentModeRow[] = Array.from(byMode.entries())
    .map(([mode, v]) => ({ _id: mode, mode: v.hold ? `${mode} (NOT collected)` : mode, count: v.count, amount: v.amount, is_hold: v.hold }))
    .sort((a, b) => Number(a.is_hold) - Number(b.is_hold) || b.amount - a.amount);

  const realCollected = r2(pays.filter((p) => !isHoldPayment(p.mode)).reduce((s, p) => s + num(p.amount), 0));
  const holdTotal = r2(pays.filter((p) => isHoldPayment(p.mode)).reduce((s, p) => s + num(p.amount), 0));

  // Dues added: bills raised in the window still carrying a balance.
  const { data: dueData, error: dueErr } = await supabase.from("folios")
    .select("balance_amount")
    .eq("property_id", propertyId).neq("status", "void")
    .gte("created_at", startIso).lt("created_at", endIso).gt("balance_amount", 0);
  if (dueErr) reportQueryError("dues", dueErr);
  const duesAdded = r2(((dueData ?? []) as Record<string, any>[]).reduce((s, f) => s + num(f.balance_amount), 0));

  const sellable = ((roomsRes.data ?? []) as unknown[]).length;
  const occupiedRoomNos = new Set(rooms.map((r) => r.room_no));
  const occupied = occupiedRoomNos.size;

  return {
    from, to, rooms, food, restaurant, banquet, payments,
    occupancy: { occupied, sellable, pct: sellable ? Math.round((occupied / sellable) * 1000) / 10 : 0 },
    duesAdded, realCollected, holdTotal,
  };
}

/* ------------------------------------------------------------------ *
 * Column definitions (shared by screen, Excel and PDF)
 * ------------------------------------------------------------------ */

export const roomColumns: ReportColumn<RoomRow>[] = [
  { key: "room", header: "Room", get: (r) => r.room_no, type: "enum" },
  { key: "cat", header: "Category", get: (r) => r.category, type: "enum" },
  { key: "guest", header: "Guest", get: (r) => r.guest },
  { key: "ci", header: "Check-in", get: (r) => (r.check_in ? fmtDateTime(r.check_in) : "—"), type: "date", sortValue: (r) => r.check_in ?? "", dateValue: (r) => r.check_in ?? "" },
  { key: "co", header: "Check-out", get: (r) => (r.check_out ? fmtDateTime(r.check_out) : "In-house"), type: "date", sortValue: (r) => r.check_out ?? "", dateValue: (r) => r.check_out ?? "" },
  { key: "n", header: "Nights", get: (r) => r.nights, numeric: true },
  { key: "rate", header: "Rate/Night", get: (r) => r.rate, currency: true },
  { key: "charge", header: "Room Charge", get: (r) => r.charge, currency: true },
  { key: "disc", header: "Discount", get: (r) => r.discount, currency: true },
  { key: "gstr", header: "GST %", get: (r) => r.gst_rate, numeric: true },
  { key: "cgst", header: "CGST", get: (r) => r.cgst, currency: true },
  { key: "sgst", header: "SGST", get: (r) => r.sgst, currency: true },
  { key: "igst", header: "IGST", get: (r) => r.igst, currency: true },
  { key: "total", header: "Total", get: (r) => r.total, currency: true },
  { key: "modes", header: "Payment Mode(s)", get: (r) => r.pay_modes },
  { key: "status", header: "Payment Status", get: (r) => r.status, type: "enum" },
  { key: "src", header: "Booking Source", get: (r) => r.source, type: "enum" },
  { key: "inv", header: "Invoice No", get: (r) => r.invoice_no },
];

export const foodColumns: ReportColumn<FoodRow>[] = [
  { key: "kot", header: "Food Bill No", get: (r) => r.kot_no },
  { key: "room", header: "Room", get: (r) => r.room_no, type: "enum" },
  { key: "guest", header: "Guest / Customer", get: (r) => r.guest },
  { key: "items", header: "Items", get: (r) => r.items },
  { key: "n", header: "Items #", get: (r) => r.item_count, numeric: true },
  { key: "amt", header: "Amount", get: (r) => r.amount, currency: true },
  { key: "gst", header: "GST", get: (r) => r.gst, currency: true },
  { key: "total", header: "Total", get: (r) => r.total, currency: true },
  { key: "status", header: "Payment Status", get: (r) => r.status, type: "enum" },
  { key: "at", header: "Time", get: (r) => fmtDateTime(r.ordered_at), type: "date", sortValue: (r) => r.ordered_at, dateValue: (r) => r.ordered_at },
];

export const restaurantColumns: ReportColumn<RestaurantRow>[] = [
  { key: "at", header: "Date / Time", get: (r) => fmtDateTime(r.at), type: "date", sortValue: (r) => r.at, dateValue: (r) => r.at },
  { key: "outlet", header: "Outlet", get: (r) => r.outlet, type: "enum" },
  { key: "bill", header: "Bill No", get: (r) => r.bill_no },
  { key: "guest", header: "Guest / Customer", get: (r) => r.guest },
  { key: "amt", header: "Amount", get: (r) => r.amount, currency: true },
  { key: "status", header: "Payment Status", get: (r) => r.status, type: "enum" },
];

export const banquetColumns: ReportColumn<BanquetRow>[] = [
  { key: "event", header: "Event", get: (r) => r.event },
  { key: "ref", header: "Booking Ref", get: (r) => r.ref },
  { key: "hall", header: "Hall / Room", get: (r) => r.hall, type: "enum" },
  { key: "pax", header: "Guests", get: (r) => r.pax, numeric: true },
  { key: "food", header: "Food Subtotal", get: (r) => r.food_subtotal, currency: true },
  { key: "gst", header: "GST", get: (r) => r.gst, currency: true },
  { key: "total", header: "Total", get: (r) => r.total, currency: true },
  { key: "status", header: "Payment Status", get: (r) => r.status, type: "enum" },
  { key: "bills", header: "Bill Number(s)", get: (r) => r.bills },
];

export const paymentColumns: ReportColumn<PaymentModeRow>[] = [
  { key: "mode", header: "Payment Mode", get: (r) => r.mode, type: "enum" },
  { key: "count", header: "Entries", get: (r) => r.count, numeric: true },
  { key: "amt", header: "Amount", get: (r) => r.amount, currency: true },
];

const sum = <T,>(rows: T[], f: (r: T) => number) => r2(rows.reduce((s, r) => s + f(r), 0));

/** Summary block ([label, value] pairs) for one section. */
export function sectionSummary(key: SectionKey, d: DailyReportData): Array<[string, string]> {
  if (key === "rooms") {
    return [
      ["Total rooms occupied", String(d.occupancy.occupied)],
      ["Total sellable rooms", String(d.occupancy.sellable)],
      ["Occupancy %", `${d.occupancy.pct}%`],
      ["Total room revenue (pre-tax)", fmtINR(sum(d.rooms, (r) => r.charge - r.discount))],
      ["Total GST collected", fmtINR(sum(d.rooms, (r) => r.cgst + r.sgst + r.igst))],
      ["Total (incl. GST)", fmtINR(sum(d.rooms, (r) => r.total))],
    ];
  }
  if (key === "food") {
    const hold = d.food.filter((f) => f.status.startsWith(HOLD_PAYMENT_MODE));
    // Complimentary bills are given away, never collected — they must not
    // inflate revenue, but the total given is tracked separately.
    const comp = d.food.filter((f) => f.status.startsWith("Complimentary"));
    const real = d.food.filter((f) => !f.status.startsWith("Complimentary"));
    return [
      ["Total food bills", String(d.food.length)],
      ["Total food revenue (pre-tax)", fmtINR(sum(real, (r) => r.amount))],
      ["Total GST", fmtINR(sum(real, (r) => r.gst))],
      ["Total (incl. GST)", fmtINR(sum(real, (r) => r.total))],
      ["Of which Bill On Hold (not collected)", fmtINR(sum(hold, (r) => r.total))],
      ["Complimentary given (excluded from revenue)", fmtINR(sum(comp, (r) => r.total))],
    ];
  }
  if (key === "restaurant") {
    const byOutlet = new Map<string, number>();
    for (const r of d.restaurant) byOutlet.set(r.outlet, r2((byOutlet.get(r.outlet) ?? 0) + r.amount));
    return [
      ["Total direct restaurant revenue", fmtINR(sum(d.restaurant, (r) => r.amount))],
      ...Array.from(byOutlet.entries()).map(([o, v]) => [`  ${o}`, fmtINR(v)] as [string, string]),
    ];
  }
  if (key === "banquet") {
    return [
      ["Events", String(d.banquet.length)],
      ["Food subtotal", fmtINR(sum(d.banquet, (r) => r.food_subtotal))],
      ["GST", fmtINR(sum(d.banquet, (r) => r.gst))],
      ["Total", fmtINR(sum(d.banquet, (r) => r.total))],
    ];
  }
  const roomRev = sum(d.rooms, (r) => r.total);
  // Complimentary food bills are excluded from revenue and reported separately.
  const compFood = d.food.filter((r) => r.status.startsWith("Complimentary"));
  const realFood = d.food.filter((r) => !r.status.startsWith("Complimentary"));
  const foodRev = sum(realFood, (r) => r.total);
  const restRev = sum(d.restaurant, (r) => r.amount);
  const bqRev = sum(d.banquet, (r) => r.total);
  return [
    ["Real money collected", fmtINR(d.realCollected)],
    [`${HOLD_PAYMENT_MODE} markers (NOT collected)`, fmtINR(d.holdTotal)],
    ["Dues added this period", fmtINR(d.duesAdded)],
    ["Room revenue", fmtINR(roomRev)],
    ["Food / KOT revenue", fmtINR(foodRev)],
    ["Complimentary food given (not revenue)", fmtINR(sum(compFood, (r) => r.total))],
    ["Direct restaurant revenue", fmtINR(restRev)],
    ["Banquet revenue", fmtINR(bqRev)],
    ["Grand total revenue", fmtINR(r2(roomRev + foodRev + restRev + bqRev))],
    ["Total GST collected (all categories)", fmtINR(r2(
      sum(d.rooms, (r) => r.cgst + r.sgst + r.igst) + sum(realFood, (r) => r.gst) + sum(d.banquet, (r) => r.gst),
    ))],
  ];
}

export interface BuiltSection {
  key: SectionKey;
  title: string;
  columns: ReportColumn<any>[];
  rows: any[];
  summary: Array<[string, string]>;
  emptyText: string;
}

export function buildSections(d: DailyReportData, only?: SectionKey): BuiltSection[] {
  const all: BuiltSection[] = [
    { key: "rooms", title: SECTION_TITLES.rooms, columns: roomColumns, rows: d.rooms, summary: sectionSummary("rooms", d), emptyText: "No occupied rooms for this date" },
    { key: "food", title: SECTION_TITLES.food, columns: foodColumns, rows: d.food, summary: sectionSummary("food", d), emptyText: "No food orders for this date" },
    { key: "restaurant", title: SECTION_TITLES.restaurant, columns: restaurantColumns, rows: d.restaurant, summary: sectionSummary("restaurant", d), emptyText: "No direct restaurant sales for this date" },
    { key: "banquet", title: SECTION_TITLES.banquet, columns: banquetColumns, rows: d.banquet, summary: sectionSummary("banquet", d), emptyText: "No banquet events on this date" },
    { key: "payments", title: SECTION_TITLES.payments, columns: paymentColumns, rows: d.payments, summary: sectionSummary("payments", d), emptyText: "No payments recorded for this date" },
  ];
  return only ? all.filter((s) => s.key === only) : all;
}

export { fmtDate };
