// Shared room / stay mutation operations.
//
// These are the EXACT code paths the "Shift room" and "Modify dates" dialogs on
// front-desk.booking.$id.tsx have always used — extracted verbatim so the edit
// wizard can trigger the same, already-proven behaviour instead of
// reimplementing folio reseeding, audit trails and room-status updates.
//
// Nothing here is new logic: shiftRoomOp() wraps the `shift_room` RPC + folio
// recompute + KOT transfer, modifyDatesOp() wraps the booking/booking_rooms
// date update + `seed_room_charge_for_booking_room` refresh, and
// changeRoomRateOp() reuses the folio page's `split_room_night` slicing so a
// mid-stay rate change never reprices nights the guest has already been billed.
import { supabase } from "@/integrations/supabase/client";
import { recomputeFolio } from "@/lib/billing";
import { reportQueryError } from "@/lib/queryError";

/** Recomputes and persists folio totals for a booking. Mirrors the block that
 *  lived inline in both doShift() and modifyDate(). */
export async function recomputeBookingFolioTotals(bookingId: string): Promise<void> {
  const { data: folioId, error: fErr } = await supabase.rpc("get_or_create_folio", { _booking_id: bookingId });
  if (fErr) { reportQueryError("get or create folio", fErr); return; }
  const fId = folioId as unknown as string;
  if (!fId) return;
  const { data: allCharges, error: cErr } = await supabase.from("folio_charges").select("*").eq("folio_id", fId);
  if (cErr) reportQueryError("folio charges", cErr);
  const { data: folio, error: foErr } = await supabase
    .from("folios").select("gst_mode,paid_amount,discount_type,discount_value").eq("id", fId).single();
  if (foErr) reportQueryError("folios", foErr);
  const f = folio as Record<string, unknown> | null;
  const mode = ((f?.gst_mode as string) ?? "cash") as "cash" | "gst";
  const billDisc = f?.discount_type && Number(f?.discount_value) > 0
    ? { type: f.discount_type as "percent" | "amount", value: Number(f.discount_value) }
    : null;
  const t = recomputeFolio((allCharges ?? []) as never, mode, billDisc);
  const paid = Number(f?.paid_amount ?? 0);
  await supabase.from("folios").update({
    ...t, balance_amount: Math.max(0, t.total_amount - paid),
  } as never).eq("id", fId);
}

export interface ShiftRoomParams {
  bookingId: string;
  propertyId: string;
  bookingRoomId: string;
  fromRoomId: string | null;
  toRoomId: string;
  newRate: number;
  tariffChoice: string;
  reason: string;
  actorId: string | null;
  transferKots: boolean;
}

/** Atomic room shift. Throws the raw Postgres error so callers can surface the
 *  RPC's own blocking messages (missing reason, same room, overlap, …). */
export async function shiftRoomOp(p: ShiftRoomParams): Promise<{ movedKots: number; toRoomNumber: string | null }> {
  const { error: shiftErr } = await supabase.rpc("shift_room" as never, {
    _booking_room_id: p.bookingRoomId,
    _to_room_id: p.toRoomId,
    _new_rate: p.newRate,
    _tariff_choice: p.tariffChoice,
    _reason: p.reason,
    _shifted_by: p.actorId,
  } as never);
  if (shiftErr) throw shiftErr;

  try { await recomputeBookingFolioTotals(p.bookingId); }
  catch (e) { console.warn("folio rate update failed", e); }

  let movedKots = 0;
  let toRoomNumber: string | null = null;
  const { data: toRoom } = await supabase.from("rooms").select("room_number").eq("id", p.toRoomId).maybeSingle();
  toRoomNumber = (toRoom as { room_number?: string } | null)?.room_number ?? null;

  if (p.transferKots && p.fromRoomId) {
    try {
      const fromId = p.fromRoomId;
      const { data: openKots, error: kErr } = await supabase
        .from("kot_orders").select("id,kot_number")
        .eq("booking_id", p.bookingId).eq("room_id", fromId)
        .in("status", ["open", "printed", "served"]);
      if (kErr) reportQueryError("kot orders", kErr);
      const ids = ((openKots ?? []) as Array<{ id: string }>).map((k) => k.id);
      if (ids.length > 0) {
        await supabase.from("kot_orders").update({ room_id: p.toRoomId } as never).in("id", ids);
        const { data: frRoom } = await supabase.from("rooms").select("room_number").eq("id", fromId).maybeSingle();
        await (supabase as never as typeof supabase).from("kot_audit_log").insert(ids.map((kid) => ({
          property_id: p.propertyId,
          kot_order_id: kid,
          event_type: "room_shift",
          message: `Orders transferred from Room ${(frRoom as { room_number?: string } | null)?.room_number ?? "?"} to Room ${toRoomNumber ?? "?"}`,
          meta: { from_room_id: fromId, to_room_id: p.toRoomId },
          actor: p.actorId,
        })) as never);
        movedKots = ids.length;
      }
    } catch (e) { console.warn("KOT transfer failed", e); }
  }
  return { movedKots, toRoomNumber };
}

export interface ModifyDatesParams {
  bookingId: string;
  checkIn: string;
  newCheckOut: string;
  advanceAmount: number;
  rooms: Array<{ id: string; rate: number }>;
}

/** Extends / reduces the stay. Same sequence the "Modify dates" dialog runs:
 *  booking header totals -> every booking_room's check_out -> guarded room-charge
 *  refresh per room -> folio totals recompute. */
export async function modifyDatesOp(p: ModifyDatesParams): Promise<void> {
  const nights = Math.max(
    1,
    Math.round((new Date(p.newCheckOut).getTime() - new Date(p.checkIn).getTime()) / 86400000),
  );
  const newTotal = nights * Number(p.rooms[0]?.rate ?? 0);
  const newBalance = Math.max(0, newTotal - p.advanceAmount);
  const { error } = await supabase.from("bookings").update({
    check_out: p.newCheckOut,
    total_amount: newTotal,
    balance_amount: newBalance,
  } as never).eq("id", p.bookingId);
  if (error) throw error;

  for (const r of p.rooms) {
    const { error: brErr } = await supabase.from("booking_rooms")
      .update({ check_out: p.newCheckOut } as never).eq("id", r.id);
    if (brErr) throw brErr;
  }

  try {
    for (const r of p.rooms) {
      if (Number(r.rate) <= 0) continue;
      const { error: seedErr } = await supabase.rpc("seed_room_charge_for_booking_room", {
        _booking_room_id: r.id,
      } as never);
      if (seedErr) console.warn("room charge refresh failed", seedErr.message);
    }
    await recomputeBookingFolioTotals(p.bookingId);
  } catch (e) {
    console.warn("folio extend-stay recalculation failed", e);
  }
}

export interface ChangeRateParams {
  bookingId: string;
  bookingRoomId: string;
  roomId: string | null;
  newRate: number;
  /** Null => reprice the whole segment (used for `reserved` bookings, where no
   *  folio charge has been consumed yet). A date => forward-only: every night
   *  from this date to check-out is re-tariffed, earlier nights keep their
   *  original rate. */
  fromDate: string | null;
  checkOut: string;
}

function addDays(d: string, n: number): string {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Post-creation rate change.
 *
 *  `reserved` (fromDate = null): direct rate update + the idempotent
 *  seed_room_charge_for_booking_room refresh (it UPDATEs the existing room
 *  charge in place keyed on source_id, so no double-charge and no stale row).
 *
 *  `checked_in` (fromDate set): reuses split_room_night() — the folio page's
 *  tested per-night slicer — for each remaining night, so already-billed nights
 *  keep their original tariff. Throws the RPC's own errors (bill not OPEN,
 *  night-audit lock, missing invoices.edit permission). */
export async function changeRoomRateOp(p: ChangeRateParams): Promise<void> {
  if (!p.fromDate) {
    const { error } = await supabase.from("booking_rooms")
      .update({ rate: p.newRate } as never).eq("id", p.bookingRoomId);
    if (error) throw error;
    const { error: seedErr } = await supabase.rpc("seed_room_charge_for_booking_room", {
      _booking_room_id: p.bookingRoomId,
    } as never);
    if (seedErr) console.warn("room charge refresh failed", seedErr.message);
    await recomputeBookingFolioTotals(p.bookingId);
    return;
  }

  // Forward-only. Walk night by night; each split_room_night() call slices the
  // segment, so the row owning the NEXT night must be re-resolved every pass.
  let night = p.fromDate;
  let guard = 0;
  while (night < p.checkOut && guard < 120) {
    guard += 1;
    const { data: rows, error: rErr } = await supabase
      .from("booking_rooms")
      .select("id,rate,check_in,check_out,room_id,status")
      .eq("booking_id", p.bookingId)
      .lte("check_in", night)
      .gt("check_out", night);
    if (rErr) throw rErr;
    const seg = ((rows ?? []) as Array<Record<string, unknown>>).find(
      (r) => (r.room_id ?? null) === p.roomId && (r.status ?? "active") !== "shifted",
    );
    if (!seg) { night = addDays(night, 1); continue; }
    if (Math.abs(Number(seg.rate ?? 0) - p.newRate) > 0.009) {
      const { error } = await supabase.rpc("split_room_night" as never, {
        _booking_room_id: seg.id as string,
        _night: night,
        _new_rate: p.newRate,
      } as never);
      if (error) throw error;
    }
    night = addDays(night, 1);
  }
  await recomputeBookingFolioTotals(p.bookingId);
}
