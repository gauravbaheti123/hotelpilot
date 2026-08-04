/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/integrations/supabase/client";

export interface RoomBlockRow {
  category_id: string;
  quantity: number;
  checkin_date: string;
  checkout_date: string;
  special_rate: number | null;
}

export interface AssignedBlock {
  room_id: string;
  room_number: string;
  room_category: string;
  category_id: string;
  checkin_date: string;
  checkout_date: string;
  checkin_time?: string;
  checkout_time?: string;
  special_rate: number | null;
  guest_name?: string;
  guest_mobile?: string;
}

export function nightsBetween(ci: string, co: string): number {
  const a = new Date(ci).getTime();
  const b = new Date(co).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

/**
 * Pick the first N vacant rooms in a category. Throws if not enough rooms.
 */
export async function pickAvailableRooms(
  propertyId: string,
  categoryId: string,
  qty: number,
): Promise<{ id: string; room_number: string; category_name: string }[]> {
  const { data: rs, error } = await supabase
    .from("rooms")
    .select("id, room_number, status, room_categories(name)")
    .eq("property_id", propertyId)
    .eq("category_id", categoryId)
    .eq("is_active", true)
    .eq("status", "vacant")
    .order("room_number")
    .limit(qty);
  if (error) throw error;
  if ((rs ?? []).length < qty) {
    const catName = (rs?.[0] as any)?.room_categories?.name ?? "category";
    throw new Error(`Only ${rs?.length ?? 0} rooms available in ${catName}, you requested ${qty}`);
  }
  return (rs ?? []).map((r: any) => ({
    id: r.id,
    room_number: r.room_number,
    category_name: r.room_categories?.name ?? "",
  }));
}

/**
 * Insert event_room_blocks for each assigned room and mark rooms as 'blocked'.
 */
export async function commitRoomBlocks(args: {
  propertyId: string;
  banquetBookingId: string;
  eventName: string;
  rows: AssignedBlock[];
}): Promise<number> {
  if (args.rows.length === 0) return 0;
  const inserts = args.rows.map((r) => ({
    property_id: args.propertyId,
    banquet_booking_id: args.banquetBookingId,
    event_name: args.eventName,
    room_id: r.room_id,
    room_number: r.room_number,
    room_category: r.room_category,
    guest_name: r.guest_name?.trim() || null,
    guest_mobile: r.guest_mobile?.trim() || null,
    checkin_date: r.checkin_date,
    checkout_date: r.checkout_date,
    checkin_time: r.checkin_time || "12:00",
    checkout_time: r.checkout_time || "11:00",
    special_rate: r.special_rate,
    status: "blocked",
  }));
  const { error } = await supabase.from("event_room_blocks").insert(inserts as any);
  if (error) throw error;

  // mark rooms blocked
  const ids = args.rows.map((r) => r.room_id);
  await supabase.from("rooms").update({ status: "blocked" } as any).in("id", ids);
  return inserts.length;
}

export interface EventBlockSummary {
  banquet_booking_id: string;
  event_name: string;
  function_type: string;
  event_date: string;
  total: number;
  blocked: number;
  checked_in: number;
  checked_out: number;
  blocks: EventBlockRecord[];
}

export interface EventBlockRecord {
  id: string;
  banquet_booking_id: string;
  event_name: string;
  room_id: string | null;
  room_number: string | null;
  room_category: string | null;
  guest_name: string | null;
  guest_mobile: string | null;
  checkin_date: string;
  checkout_date: string;
  checkin_time?: string | null;
  checkout_time?: string | null;
  special_rate: number | null;
  status: "blocked" | "checked_in" | "checked_out" | "cancelled";
  booking_id: string | null;
}

export async function loadEventSummaries(propertyId: string): Promise<EventBlockSummary[]> {
  const { data, error } = await supabase
    .from("event_room_blocks")
    .select("id, banquet_booking_id, event_name, room_id, room_number, room_category, guest_name, guest_mobile, checkin_date, checkout_date, checkin_time, checkout_time, special_rate, status, booking_id, banquet_bookings(function_type, event_date)")
    .eq("property_id", propertyId)
    .in("status", ["blocked", "checked_in"])
    .order("checkin_date");
  if (error) throw error;

  const byEvent = new Map<string, EventBlockSummary>();
  (data ?? []).forEach((row: any) => {
    const key = row.banquet_booking_id;
    const prev: EventBlockSummary = byEvent.get(key) ?? {
      banquet_booking_id: key,
      event_name: row.event_name,
      function_type: row.banquet_bookings?.function_type ?? "",
      event_date: row.banquet_bookings?.event_date ?? "",
      total: 0, blocked: 0, checked_in: 0, checked_out: 0,
      blocks: [] as EventBlockRecord[],
    };
    prev.total += 1;
    if (row.status === "blocked") prev.blocked += 1;
    if (row.status === "checked_in") prev.checked_in += 1;
    if (row.status === "checked_out") prev.checked_out += 1;
    prev.blocks.push(row as EventBlockRecord);
    byEvent.set(key, prev);
  });
  return Array.from(byEvent.values());
}

/**
 * Convert a blocked room into an active booking + booking_room.
 * Returns the new booking id.
 */
export async function checkInBlock(args: {
  propertyId: string;
  block: EventBlockRecord;
  userId: string;
}): Promise<string> {
  const { propertyId, block, userId } = args;
  // 1. find or create guest
  let guestId: string | null = null;
  if (block.guest_name && block.guest_mobile) {
    const { data: g } = await supabase
      .from("guests")
      .insert({
        property_id: propertyId,
        name: block.guest_name,
        mobile: block.guest_mobile,
      } as any)
      .select("id")
      .single();
    guestId = (g as any)?.id ?? null;
  }
  // 2. create booking
  const { data: bk, error: be } = await supabase
    .from("bookings")
    .insert({
      property_id: propertyId,
      guest_id: guestId,
      source: "event_block",
      status: "checked_in",
      check_in: block.checkin_date,
      check_out: block.checkout_date,
      adults: 1, children: 0,
      total_amount: 0, advance_amount: 0, balance_amount: 0,
      checked_in_at: new Date().toISOString(),
      checked_in_by: userId,
      notes: `Event: ${block.event_name}`,
      created_by: userId,
    } as any)
    .select("id")
    .single();
  if (be) throw be;
  const bookingId = (bk as any).id as string;

  // 3. update room and block.
  //    The booking_rooms row already exists (created as `reserved` the moment the
  //    block was made). The DB trigger on event_room_blocks repoints that SAME row
  //    to this stay booking and flips it to `checked_in` — no second row is created.
  await supabase.from("rooms").update({ status: "occupied" } as any).eq("id", block.room_id!);
  await supabase.from("event_room_blocks").update({
    status: "checked_in",
    booking_id: bookingId,
    checked_in_at: new Date().toISOString(),
    checked_in_by: userId,
    guest_id: guestId,
  } as any).eq("id", block.id);

  return bookingId;
}

/**
 * Bulk check-in: checks in every "blocked" room whose check-in date is today
 * or earlier and that already has guest name + mobile. Uses the same
 * `checkInBlock` path as an individual check-in.
 */
export async function bulkCheckInBlocks(args: {
  propertyId: string;
  blocks: EventBlockRecord[];
  userId: string;
}): Promise<{ done: number; failed: { room: string | null; message: string }[] }> {
  const failed: { room: string | null; message: string }[] = [];
  let done = 0;
  for (const block of args.blocks) {
    try {
      await checkInBlock({ propertyId: args.propertyId, block, userId: args.userId });
      done += 1;
    } catch (e) {
      failed.push({ room: block.room_number, message: (e as Error)?.message ?? "Check-in failed" });
    }
  }
  return { done, failed };
}

/** Rooms eligible for bulk check-in: blocked, guest assigned, arriving today or earlier. */
export function dueForCheckIn(blocks: EventBlockRecord[], today: string): EventBlockRecord[] {
  return blocks.filter(
    (b) =>
      b.status === "blocked" &&
      !!b.guest_name?.trim() &&
      !!b.guest_mobile?.trim() &&
      b.checkin_date <= today,
  );
}

/**
 * Shared checkout-completion step for banquet rooms.
 *
 * Closes every event_room_blocks row linked to a booking that has just been
 * checked out. Called from the standard CheckoutDialog flow so the block status
 * is updated no matter which screen initiated the checkout (this was the cause
 * of the "stuck event tile" bug — the block stayed `checked_in` forever).
 *
 * Returns the affected block rows (room id/number) so the caller can write the
 * same ROOM_STATUS_CHANGED activity entries a regular checkout writes.
 */
export async function closeEventBlocksForBooking(
  bookingId: string,
  userId: string,
): Promise<{ id: string; room_id: string | null; room_number: string | null }[]> {
  const { data, error } = await supabase
    .from("event_room_blocks")
    .select("id, room_id, room_number, status")
    .eq("booking_id", bookingId);
  if (error) throw error;
  const openRows = (data ?? []).filter((r: any) => r.status !== "checked_out" && r.status !== "cancelled");
  if (openRows.length === 0) return [];
  const { error: upErr } = await supabase
    .from("event_room_blocks")
    .update({
      status: "checked_out",
      checked_out_at: new Date().toISOString(),
      checked_out_by: userId,
    } as any)
    .in("id", openRows.map((r: any) => r.id));
  if (upErr) throw upErr;
  return openRows.map((r: any) => ({ id: r.id, room_id: r.room_id, room_number: r.room_number }));
}

/**
 * @deprecated Simplified checkout path — skips balance validation, payment
 * collection, pending KOT/segment-bill blocking and invoice display. All
 * banquet room checkouts now go through the standard CheckoutDialog instead.
 * Kept only until the bulk-checkout UX is migrated.
 */
export async function checkOutBlock(args: {
  block: EventBlockRecord;
  userId: string;
}) {
  const { block, userId } = args;
  if (block.booking_id) {
    await supabase.from("bookings").update({
      status: "checked_out",
      checked_out_at: new Date().toISOString(),
      checked_out_by: userId,
    } as any).eq("id", block.booking_id);
    await supabase.from("booking_rooms").update({
      actual_check_out: new Date().toISOString(),
    } as any).eq("booking_id", block.booking_id);
  }
  if (block.room_id) {
    await supabase.from("rooms").update({
      status: "vacant",
      housekeeping_status: "dirty",
    } as any).eq("id", block.room_id);
  }
  await supabase.from("event_room_blocks").update({
    status: "checked_out",
    checked_out_at: new Date().toISOString(),
    checked_out_by: userId,
  } as any).eq("id", block.id);
}