/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Banquet events on the unified `bookings` model (Part 6 — legacy mirror retired).
 *
 * Source of truth is the `bookings` row with booking_type = 'banquet'.
 * Extras, master bills and room blocks all FK to `bookings.id`.
 * `EventIds.legacyId` is kept only as a deprecated alias of `bookingId`.
 */
import { supabase } from "@/integrations/supabase/client";
import { reportQueryError } from "@/lib/queryError";

/** Columns that live on `bookings` (all of them now). */
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
  "event_status",
  "total_room_charges",
  "bill_type",
  "line_discounts",
  "advance_payment_mode",
]);

export interface EventIds {
  bookingId: string;
  /** @deprecated same value as bookingId; kept for call-site compatibility. */
  legacyId: string | null;
}

/** Resolves a unified bookings.id for a banquet event. */
export async function resolveEventIds(id: string): Promise<EventIds | null> {
  const { data, error } = await supabase.rpc("resolve_event_ids" as any, { _id: id } as any);
  if (error) throw error;
  const row = data as any;
  if (!row?.booking_id) return null;
  return {
    bookingId: row.booking_id as string,
    legacyId: row.booking_id as string,
  };
}

/**
 * Event header, read entirely from the unified booking.
 * `id` is the unified bookings.id, which every child table now points at.
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
    event_status,total_room_charges,bill_type,line_discounts,advance_payment_mode,
    halls(id,name,capacity),
    guests(id,name,mobile,email,gst_number,company,state,state_code)
  `,
    )
    .eq("id", ids.bookingId)
    .single();
  if (error) throw error;

  const row: any = u as any;
  const ev: any = {
    ...row,
    id: ids.bookingId,
    booking_id: ids.bookingId,
    legacy_id: ids.bookingId,
    // Event lifecycle vocabulary (confirmed / in_progress / completed / cancelled).
    status: row.event_status ?? row.status,
    bill_type: row.bill_type ?? "gst_invoice",
    advance_payment_mode: row.advance_payment_mode ?? null,
    line_discounts: row.line_discounts ?? {},
    total_room_charges: Number(row.total_room_charges ?? 0),
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

/** Patch an event. Everything is written straight to `bookings`. */
export async function patchEventBooking(ids: EventIds, patch: Record<string, any>): Promise<void> {
  const unified: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === "halls" || k === "guests" || k === "id" || k === "booking_id" || k === "legacy_id") continue;
    if (k === "status") {
      unified.event_status = v;
      continue;
    }
    if (UNIFIED_FIELDS.has(k)) unified[k] = v;
  }
  if (Object.keys(unified).length > 0) {
    const { error } = await supabase
      .from("bookings")
      .update(unified as any)
      .eq("id", ids.bookingId);
    if (error) throw error;
  }
}

/** Event lifecycle status lives on bookings.event_status. */
export async function setEventStatus(
  ids: EventIds,
  status: "reserved" | "confirmed" | "in_progress" | "completed" | "cancelled",
  extra?: { cancelled_reason?: string },
): Promise<void> {
  const patch: Record<string, any> = {
    event_status: status === "reserved" ? "confirmed" : status,
  };
  if (status === "cancelled") {
    patch.status = "cancelled";
    patch.cancelled_at = new Date().toISOString();
    patch.cancelled_reason = extra?.cancelled_reason ?? null;
  }
  const { error } = await supabase.from("bookings").update(patch as any).eq("id", ids.bookingId);
  if (error) throw error;
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

/** Creates the unified event booking and returns its id. */
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
    legacyId: r.booking_id as string,
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
 * Unified read paths — every list / report / ledger screen reads the
 * event header from the unified `bookings` row (booking_type='banquet').
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
       host_name,host_mobile,event_status,total_room_charges,
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

  const rows: EventRow[] = base.map((b) => {
    return {
      booking_id: b.id,
      legacy_id: b.id,
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
      total_room_charges: n(b.total_room_charges),
      total_amount: n(b.total_amount),
      advance_amount: n(b.advance_amount),
      balance_amount: n(b.balance_amount),
      // Lifecycle vocabulary (confirmed / in_progress / completed / cancelled).
      status: (b.event_status ?? b.status ?? "confirmed") as string,
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

/** Hard-delete an event (children cascade from bookings). */
export async function deleteEventBooking(ids: EventIds): Promise<void> {
  const { error } = await supabase.from("bookings").delete().eq("id", ids.bookingId);
  if (error) throw error;
}
