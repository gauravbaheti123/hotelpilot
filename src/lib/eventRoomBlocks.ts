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

  // 3. booking_rooms
  const { error: brErr } = await supabase.from("booking_rooms").insert({
    booking_id: bookingId,
    property_id: propertyId,
    room_id: block.room_id,
    rate: block.special_rate ?? 0,
    check_in: block.checkin_date,
    check_out: block.checkout_date,
    actual_check_in: new Date().toISOString(),
  } as any);
  if (brErr) throw brErr;

  // 4. update room and block
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