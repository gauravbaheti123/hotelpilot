// Shared banquet room-block form logic, used by both the New Booking wizard
// (banquet path) and the legacy /banquet/new form so the two can never drift.
import { pickTariffPlan, type TariffPlan } from "@/lib/tariff";
import { nightsBetween, type AssignedBlock } from "@/lib/eventRoomBlocks";
import { isValidStayRange } from "@/lib/front-desk";
import { isValidMobile, MOBILE_ERROR } from "@/lib/mobile";
import { canApplyDiscount, describeLimit, type DiscountLimit } from "@/lib/discountLimit";
import type { RoomBlockMode, WizardEventRoomRow } from "@/lib/bookingWizard";

export interface RoomOption {
  id: string;
  room_number: string;
  category_id: string | null;
  category_name: string | null;
}

/** Single source of truth for the default nightly rate of a category/date. */
export function stdRateFor(
  plans: TariffPlan[],
  categoryId: string | null | undefined,
  date: string,
): number {
  return (
    Number(pickTariffPlan(plans, { categoryId: categoryId ?? null, date })?.rate ?? 0) || 0
  );
}

export interface RoomBlocksContext {
  mode: RoomBlockMode;
  rows: WizardEventRoomRow[];
  rooms: RoomOption[];
  plans: TariffPlan[];
  eventDate: string;
  hostName: string;
  hostMobile: string;
}

/** Rooms / categories / revenue summary shown under the grid. */
export function roomBlocksSummary(ctx: RoomBlocksContext) {
  const active = ctx.mode === "none" ? [] : ctx.mode === "single" ? ctx.rows.slice(0, 1) : ctx.rows;
  let totalRooms = 0;
  let revenue = 0;
  active.forEach((r) => {
    if (!r.roomId) return;
    const room = ctx.rooms.find((x) => x.id === r.roomId);
    const rate =
      Number(r.specialRate) || stdRateFor(ctx.plans, room?.category_id, r.checkIn || ctx.eventDate);
    const nights = r.checkIn && r.checkOut ? nightsBetween(r.checkIn, r.checkOut) : 1;
    totalRooms += 1;
    revenue += rate * nights;
  });
  const categories = new Set(
    active.map((r) => ctx.rooms.find((x) => x.id === r.roomId)?.category_id).filter(Boolean),
  ).size;
  return { totalRooms, revenue, categories };
}

/** Returns the first validation error, or null when the block set is valid. */
export function validateRoomBlocks(ctx: RoomBlocksContext, eventName: string): string | null {
  if (ctx.mode === "none") return null;
  if (!eventName.trim()) return "Event name required when assigning rooms";
  if (ctx.mode === "single") {
    const r = ctx.rows[0];
    if (!r?.roomId) return "Pick a room to assign";
    if (!isValidStayRange(r.checkIn, r.checkOut)) return "Room check-out must be after check-in";
    return null;
  }
  if (ctx.rows.length === 0) return "Add at least one room row";
  for (const [i, row] of ctx.rows.entries()) {
    const label = `Row ${i + 1}`;
    if (!row.roomId) return `${label}: pick a room`;
    if (!row.guestName.trim()) return `${label}: guest name required`;
    if (!isValidMobile(row.guestMobile)) return `${label}: ${MOBILE_ERROR.toLowerCase()}`;
    if (!row.checkIn || !row.checkOut) return `${label}: check-in / check-out dates required`;
    if (
      !isValidStayRange(row.checkIn, row.checkOut, row.checkInTime || "12:00", row.checkOutTime || "11:00")
    )
      return `${label}: check-out must be after check-in`;
  }
  const dupe = ctx.rows.map((r) => r.roomId).find((id, i, arr) => arr.indexOf(id) !== i);
  if (dupe) return "Same room selected in more than one row";
  return null;
}

/** Per-role discount enforcement on any overridden room rate. */
export function checkRoomBlockDiscounts(
  limit: DiscountLimit,
  ctx: RoomBlocksContext,
): string | null {
  const active = ctx.mode === "none" ? [] : ctx.mode === "single" ? ctx.rows.slice(0, 1) : ctx.rows;
  for (const row of active) {
    if (!row.roomId || !row.specialRate) continue;
    const room = ctx.rooms.find((x) => x.id === row.roomId);
    const base = stdRateFor(ctx.plans, room?.category_id, row.checkIn || ctx.eventDate);
    const proposed = Number(row.specialRate) || 0;
    if (base > 0 && proposed > 0 && proposed < base) {
      const chk = canApplyDiscount(limit, { discountRupees: base - proposed, base });
      if (!chk.allowed) {
        const reason = chk.reason ?? describeLimit(limit);
        return ctx.mode === "single" ? reason : `Room ${room?.room_number ?? ""}: ${reason}`;
      }
    }
  }
  return null;
}

/** Turns the form rows into event_room_blocks payloads. */
export function buildAssignedBlocks(ctx: RoomBlocksContext): AssignedBlock[] {
  if (ctx.mode === "none") return [];
  const active = ctx.mode === "single" ? ctx.rows.slice(0, 1) : ctx.rows;
  return active
    .filter((row) => row.roomId)
    .map((row) => {
      const room = ctx.rooms.find((x) => x.id === row.roomId)!;
      const rate = row.specialRate
        ? Number(row.specialRate)
        : stdRateFor(ctx.plans, room.category_id, row.checkIn || ctx.eventDate);
      return {
        room_id: room.id,
        room_number: room.room_number,
        room_category: room.category_name ?? "",
        category_id: room.category_id ?? "",
        checkin_date: row.checkIn,
        checkout_date: row.checkOut,
        checkin_time: row.checkInTime || "12:00",
        checkout_time: row.checkOutTime || "11:00",
        special_rate: rate,
        guest_name: ctx.mode === "single" ? ctx.hostName.trim() : row.guestName.trim(),
        guest_mobile: ctx.mode === "single" ? ctx.hostMobile.trim() : row.guestMobile.trim(),
      } as AssignedBlock;
    });
}

/** Total room revenue for the assigned blocks (nights x rate). */
export function assignedBlocksTotal(blocks: AssignedBlock[]): number {
  return blocks.reduce(
    (sum, b) => sum + Number(b.special_rate ?? 0) * nightsBetween(b.checkin_date, b.checkout_date),
    0,
  );
}
