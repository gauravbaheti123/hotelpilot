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
    const { data: l } = await supabase
      .from("banquet_bookings")
      .select("id,status,bill_type,advance_payment_mode,line_discounts,total_room_charges")
      .eq("id", ids.legacyId)
      .maybeSingle();
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
  const { data } = await supabase
    .from("booking_financials" as any)
    .select("folio_total,advance_amount,balance_amount")
    .eq("booking_id", bookingId)
    .maybeSingle();
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
