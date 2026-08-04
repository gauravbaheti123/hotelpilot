/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Banquet events on the unified `bookings` model (Part 4).
 *
 * Source of truth is the `bookings` row with booking_type = 'banquet'.
 * `banquet_bookings` is kept as a legacy mirror (DB triggers sync both ways)
 * because extras, bulk rooms, master bills and room blocks still FK to it and
 * the list page / reports still read it.
 *
 * Every screen resolves whichever id it was handed (unified or legacy) into
 * BOTH ids, then reads the event header from the unified row.
 */
import { supabase } from "@/integrations/supabase/client";
import { reportQueryError } from "@/lib/queryError";

/** Columns that live on `bookings`; everything else is written to the mirror. */
const UNIFIED_FIELDS = new Set([
  "hall_id",
  "guest_id",
  "function_type",
  "event_date",
  "event_end_date",
  "start_time",
  "end_time",
  "pax",
  "package_rate",
  "hall_charge",
  "fb_charge",
  "extra_charge",
  "extra_charge_description",
  "discount_type",
  "discount_value",
  "discount_amount",
  "round_off_amount",
  "total_amount",
  "advance_amount",
  "balance_amount",
  "event_name",
  "host_name",
  "host_mobile",
  "host_email",
  "notes",
  "cancelled_at",
  "cancelled_reason",
]);

export interface EventIds {
  bookingId: string;
  legacyId: string | null;
}

/** Accepts a unified bookings.id OR a legacy banquet_bookings.id. */
export async function resolveEventIds(id: string): Promise<EventIds | null> {
  const { data, error } = await supabase.rpc("resolve_event_ids" as any, { _id: id } as any);
  if (error) throw error;
  const row = data as any;
  if (!row?.booking_id) return null;
  return {
    bookingId: row.booking_id as string,
    legacyId: (row.banquet_booking_id ?? null) as string | null,
  };
}

/**
 * Event header, read from the unified booking and merged with the few
 * legacy-only fields (bill_type, line_discounts, advance_payment_mode,
 * total_room_charges) that have not been moved yet.
 *
 * `id` is intentionally the LEGACY id so existing child queries
 * (extras / bulk rooms / room blocks / master bill) keep working unchanged.
 */
export async function loadEventBooking(id: string) {
  const ids = await resolveEventIds(id);
  if (!ids) return null;

  const { data: u, error } = await supabase
    .from("bookings")
    .select(
      `
    id,property_id,banquet_number,status,guest_id,hall_id,event_name,function_type,
    event_date,event_end_date,start_time,end_time,pax,
    package_rate,hall_charge,fb_charge,extra_charge,extra_charge_description,
    discount_type,discount_value,discount_amount,round_off_amount,
    total_amount,advance_amount,balance_amount,notes,cancelled_at,cancelled_reason,
    halls(id,name,capacity),
    guests(id,name,mobile,email,gst_number,company,state,state_code)
  `,
    )
    .eq("id", ids.bookingId)
    .single();
  if (error) throw error;

  let legacy: any = null;
  if (ids.legacyId) {
    const { data: l, error: __qe1 } = await supabase
      .from("banquet_bookings")
      .select("id,status,bill_type,advance_payment_mode,line_discounts,total_room_charges")
      .eq("id", ids.legacyId)
      .maybeSingle();
    if (__qe1) reportQueryError("banquet bookings", __qe1);
    legacy = l ?? null;
  }

  const ev: any = {
    ...(u as any),
    // Legacy id space keeps every child table query working untouched.
    id: ids.legacyId ?? (u as any).id,
    booking_id: ids.bookingId,
    legacy_id: ids.legacyId,
    // Event lifecycle status stays on the legacy vocabulary
    // (reserved / confirmed / in_progress / completed / cancelled).
    status: legacy?.status ?? (u as any).status,
    bill_type: legacy?.bill_type ?? "gst_invoice",
    advance_payment_mode: legacy?.advance_payment_mode ?? null,
    line_discounts: legacy?.line_discounts ?? {},
    total_room_charges: Number(legacy?.total_room_charges ?? 0),
  };
  return ev as any;
}

/** Live advance/balance from folios (booking_financials view, Part 1). */
export async function loadEventFinancials(bookingId: string) {
  const { data, error: __qe2 } = await supabase
    .from("booking_financials" as any)
    .select("folio_total,advance_amount,balance_amount")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (__qe2) reportQueryError("booking financials", __qe2);
  const r = (data ?? null) as any;
  return {
    folioTotal: Number(r?.folio_total ?? 0),
    advance: Number(r?.advance_amount ?? 0),
    balance: Number(r?.balance_amount ?? 0),
    hasFolio: !!r,
  };
}

/**
 * Patch an event. Unified columns go to `bookings`; legacy-only columns go to
 * the mirror. DB triggers keep the other side in sync either way.
 */
export async function patchEventBooking(ids: EventIds, patch: Record<string, any>): Promise<void> {
  const unified: Record<string, any> = {};
  const legacyOnly: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === "halls" || k === "guests" || k === "id") continue;
    (UNIFIED_FIELDS.has(k) ? unified : legacyOnly)[k] = v;
  }
  if (Object.keys(unified).length > 0) {
    const { error } = await supabase
      .from("bookings")
      .update(unified as any)
      .eq("id", ids.bookingId);
    if (error) throw error;
  }
  if (Object.keys(legacyOnly).length > 0 && ids.legacyId) {
    const { error } = await supabase
      .from("banquet_bookings")
      .update(legacyOnly as any)
      .eq("id", ids.legacyId);
    if (error) throw error;
  }
}

/** Event lifecycle status lives on the mirror; cancellation mirrors to bookings. */
export async function setEventStatus(
  ids: EventIds,
  status: "reserved" | "confirmed" | "in_progress" | "completed" | "cancelled",
  extra?: { cancelled_reason?: string },
): Promise<void> {
  if (ids.legacyId) {
    const { error } = await supabase
      .from("banquet_bookings")
      .update({
        status,
        ...(status === "cancelled"
          ? {
              cancelled_at: new Date().toISOString(),
              cancelled_reason: extra?.cancelled_reason ?? null,
            }
          : {}),
      } as any)
      .eq("id", ids.legacyId);
    if (error) throw error;
  }
  if (status === "cancelled") {
    await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_reason: extra?.cancelled_reason ?? null,
      } as any)
      .eq("id", ids.bookingId);
  }
}

export interface CreateEventPayload {
  property_id: string;
  guest_id?: string | null;
  host_name: string;
  host_mobile?: string | null;
  host_email?: string | null;
  hall_id?: string | null;
  event_name?: string | null;
  function_type: string;
  event_date: string;
  event_end_date: string;
  start_time: string;
  end_time: string;
  pax: number;
  package_rate?: number;
  hall_charge?: number;
  fb_charge?: number;
  extra_charge?: number;
  discount_amount?: number;
  round_off_amount?: number;
  total_amount?: number;
  advance_amount?: number;
  balance_amount?: number;
  total_room_charges?: number;
  notes?: string | null;
  /** Named extra-charge lines, saved inside the same transaction. */
  extras?: { point_name: string; amount: number }[];
}

/** Creates the unified event booking (+ mirror) and returns both ids. */
export async function createEventBooking(payload: CreateEventPayload): Promise<{
  bookingId: string;
  legacyId: string;
  banquetNumber: string;
}> {
  const { data, error } = await supabase.rpc("create_event_booking" as any, { payload } as any);
  if (error) throw error;
  const r = data as any;
  return {
    bookingId: r.booking_id as string,
    legacyId: r.banquet_booking_id as string,
    banquetNumber: r.banquet_number as string,
  };
}

/** Seed hall + itemised extra charges onto the event folio. */
export async function seedEventFolioCharges(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc(
    "seed_event_folio_charges" as any,
    { _booking_id: bookingId } as any,
  );
  if (error) throw error;
}

/* ------------------------------------------------------------------ *
 * Part 5 — unified read paths
 * Every list / report / ledger screen reads the event header from the
 * unified `bookings` row (booking_type = 'banquet'). The legacy mirror is
 * consulted ONLY for the two columns that have not moved yet:
 * the event lifecycle status vocabulary and total_room_charges.
 * ------------------------------------------------------------------ */

export interface EventRow {
  booking_id: string;
  legacy_id: string | null;
  property_id: string;
  banquet_number: string;
  event_name: string | null;
  function_type: string;
  event_date: string;
  event_end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  pax: number;
  hall_id: string | null;
  hall_name: string;
  guest_id: string | null;
  guest_name: string | null;
  guest_mobile: string | null;
  host_name: string | null;
  host_mobile: string | null;
  hall_charge: number;
  fb_charge: number;
  extra_charge: number;
  total_room_charges: number;
  total_amount: number;
  advance_amount: number;
  balance_amount: number;
  status: string;
}

export interface ListEventOptions {
  from?: string;
  to?: string;
  guestId?: string;
  functionType?: string;
  status?: string;
  limit?: number;
}

const n = (v: any) => Number(v ?? 0) || 0;

/** Unified event list — primary source is `bookings`. */
export async function listEventBookings(
  propertyId: string,
  opts: ListEventOptions = {},
): Promise<EventRow[]> {
  let q = supabase
    .from("bookings")
    .select(
      `id,property_id,banquet_number,status,guest_id,hall_id,event_name,function_type,
       event_date,event_end_date,start_time,end_time,pax,
       hall_charge,fb_charge,extra_charge,total_amount,advance_amount,balance_amount,
       host_name,host_mobile,
       halls(name),guests(name,mobile)`,
    )
    .eq("property_id", propertyId)
    .eq("booking_type", "banquet" as any)
    .order("event_date", { ascending: false });
  if (opts.from) q = q.gte("event_date", opts.from);
  if (opts.to) q = q.lte("event_date", opts.to);
  if (opts.guestId) q = q.eq("guest_id", opts.guestId);
  if (opts.functionType) q = q.eq("function_type", opts.functionType);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  const base = (data ?? []) as any[];
  if (base.length === 0) return [];

  // Mirror lookup for the two not-yet-migrated columns.
  const numbers = base.map((b) => b.banquet_number).filter(Boolean) as string[];
  const mirror = new Map<string, any>();
  if (numbers.length) {
    const { data: legacy, error: __qe3 } = await supabase
      .from("banquet_bookings")
      .select("id,banquet_number,status,total_room_charges")
      .eq("property_id", propertyId)
      .in("banquet_number", numbers);
    if (__qe3) reportQueryError("banquet bookings", __qe3);
    for (const l of (legacy ?? []) as any[]) mirror.set(l.banquet_number, l);
  }

  const rows: EventRow[] = base.map((b) => {
    const m = mirror.get(b.banquet_number) ?? null;
    return {
      booking_id: b.id,
      legacy_id: m?.id ?? null,
      property_id: b.property_id,
      banquet_number: b.banquet_number,
      event_name: b.event_name ?? null,
      function_type: b.function_type ?? "",
      event_date: b.event_date,
      event_end_date: b.event_end_date ?? null,
      start_time: b.start_time ?? null,
      end_time: b.end_time ?? null,
      pax: n(b.pax),
      hall_id: b.hall_id ?? null,
      hall_name: b.halls?.name ?? "",
      guest_id: b.guest_id ?? null,
      guest_name: b.guests?.name ?? null,
      guest_mobile: b.guests?.mobile ?? null,
      host_name: b.host_name ?? null,
      host_mobile: b.host_mobile ?? null,
      hall_charge: n(b.hall_charge),
      fb_charge: n(b.fb_charge),
      extra_charge: n(b.extra_charge),
      total_room_charges: n(m?.total_room_charges),
      total_amount: n(b.total_amount),
      advance_amount: n(b.advance_amount),
      balance_amount: n(b.balance_amount),
      // Lifecycle vocabulary still lives on the mirror
      // (reserved / confirmed / in_progress / completed / cancelled).
      status: (m?.status ?? b.status ?? "reserved") as string,
    };
  });
  return opts.status ? rows.filter((r) => r.status === opts.status) : rows;
}

/** Banquet revenue per event_date, read from the unified model. */
export async function fetchEventRevenue(
  propertyId: string,
  from: string,
  to: string,
): Promise<{ event_date: string; total_amount: number }[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select("event_date,total_amount")
    .eq("property_id", propertyId)
    .eq("booking_type", "banquet" as any)
    .neq("status", "cancelled")
    .gte("event_date", from)
    .lte("event_date", to);
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    event_date: String(r.event_date),
    total_amount: n(r.total_amount),
  }));
}

/** Event payments now live on the standard payments table via the folio. */
export async function loadEventPayments(bookingId: string) {
  const { data, error } = await supabase
    .from("payments")
    .select("id,amount,mode,reference_no,paid_at,notes")
    .eq("booking_id", bookingId)
    .eq("is_wiped", false)
    .order("paid_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as any[]).map((p) => ({
    id: p.id as string,
    amount: n(p.amount),
    payment_mode: p.mode as string,
    reference: (p.reference_no ?? null) as string | null,
    paid_at: p.paid_at as string,
    notes: (p.notes ?? null) as string | null,
  }));
}

/** Record one or more event payments against the event folio. */
export async function recordEventPayments(
  args: {
    bookingId: string;
    propertyId: string;
    userId?: string | null;
    rows: { mode: string; amount: number; reference?: string | null }[];
  },
): Promise<void> {
  const { data: folioId, error: fErr } = await supabase.rpc(
    "get_or_create_folio" as any,
    { _booking_id: args.bookingId } as any,
  );
  if (fErr) throw fErr;
  const { error } = await supabase.from("payments").insert(
    args.rows.map((r) => ({
      property_id: args.propertyId,
      folio_id: folioId as unknown as string,
      booking_id: args.bookingId,
      amount: r.amount,
      mode: r.mode,
      reference_no: r.reference || null,
      created_by: args.userId ?? null,
    })) as any,
  );
  if (error) throw error;
}

/** Hard-delete an event: unified booking first, then the legacy mirror. */
export async function deleteEventBooking(ids: EventIds): Promise<void> {
  const { error } = await supabase.from("bookings").delete().eq("id", ids.bookingId);
  if (error) throw error;
  if (ids.legacyId) {
    await supabase.from("banquet_bookings").delete().eq("id", ids.legacyId);
  }
}
