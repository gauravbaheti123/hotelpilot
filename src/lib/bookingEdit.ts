// Booking edit — loads an existing booking into the wizard's guest /
// occupancy / bill-to / remark shape, and saves it back through the
// `update_booking_safe_fields` RPC.
//
// Phase 2 adds Stay & Room (dates / room / rate). Those changes are NOT saved
// by that RPC: they are replayed through the same operations the booking
// page's "Shift room" and "Modify dates" dialogs use (src/lib/roomOps.ts).
//
// Still out of scope here: taxes and payments.
import { supabase } from "@/integrations/supabase/client";
import {
  emptyBillTo, emptyExtraGuest, emptyGuest,
  type WizardBillTo, type WizardExtraGuest, type WizardGuest,
} from "@/lib/bookingWizard";
import { DEFAULT_NATION } from "@/lib/indiaGeo";
import { reportQueryError } from "@/lib/queryError";
import { changeRoomRateOp, modifyDatesOp, shiftRoomOp } from "@/lib/roomOps";
import { istToday } from "@/lib/date";

/** One editable room line of an existing booking. */
export interface StayRoomEdit {
  bookingRoomId: string;
  roomId: string | null;
  categoryId: string | null;
  rate: number;
  roomNumber: string | null;
  categoryName: string | null;
  /** Snapshot of the values as loaded, for the review diff and change detection. */
  origRoomId: string | null;
  origCategoryId: string | null;
  origRoomNumber: string | null;
  origCategoryName: string | null;
  origRate: number;
}

export interface StayEdit {
  checkIn: string;
  checkOut: string;
  origCheckIn: string;
  origCheckOut: string;
  advanceAmount: number;
  rooms: StayRoomEdit[];
  /** Required by the shift_room RPC whenever a checked-in guest is moved. */
  reason: string;
}

export interface BookingEditState {
  bookingId: string;
  propertyId: string;
  bookingNumber: string;
  status: string;
  guest: WizardGuest;
  adults: number;
  children: number;
  extraGuests: WizardExtraGuest[];
  billTo: WizardBillTo;
  customRemark: string;
  stay: StayEdit;
}

export function stayHasChanges(s: StayEdit): boolean {
  if (s.checkIn !== s.origCheckIn || s.checkOut !== s.origCheckOut) return true;
  return s.rooms.some(
    (r) => r.roomId !== r.origRoomId || Math.abs(r.rate - r.origRate) > 0.009,
  );
}

/** True when the booking is still in an editable state. Mirrors the RPC guard. */
export function isBookingEditable(status: string | null | undefined) {
  return status === "reserved" || status === "checked_in";
}

export async function loadBookingForEdit(bookingId: string): Promise<BookingEditState | null> {
  const { data, error } = await supabase
    .from("bookings")
    .select(
      `id, property_id, booking_number, status, adults, children, custom_remark, billing_company_id,
       check_in, check_out, advance_amount,
       guests!bookings_guest_id_fkey (
         id, name, mobile, email, dob, city, state, country, nationality, address, pincode,
         id_proof_type, id_proof_number, company, gst_number,
         id_document_url, id_document_name
       )`,
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error) {
    reportQueryError("booking", error);
    throw error;
  }
  if (!data) return null;
  const b = data as Record<string, unknown>;
  const g = (b.guests ?? null) as Record<string, unknown> | null;

  const guest: WizardGuest = {
    ...emptyGuest(),
    guestId: (g?.id as string) ?? null,
    name: (g?.name as string) ?? "",
    mobile: (g?.mobile as string) ?? "",
    email: (g?.email as string) ?? "",
    dob: (g?.dob as string) ?? "",
    city: (g?.city as string) ?? "",
    state: (g?.state as string) ?? "",
    nation: ((g?.country ?? g?.nationality) as string) || DEFAULT_NATION,
    address: (g?.address as string) ?? "",
    pincode: (g?.pincode as string) ?? "",
    idProofType: (g?.id_proof_type as string) ?? "",
    idProofNumber: (g?.id_proof_number as string) ?? "",
    company: (g?.company as string) ?? "",
    gstNumber: (g?.gst_number as string) ?? "",
    idDocViewUrl: (g?.id_document_url as string) ?? null,
    idDocName: (g?.id_document_name as string) ?? null,
  };

  const { data: bgData, error: bgErr } = await supabase
    .from("booking_guests")
    .select("guest_id, age, relation_to_primary, is_primary, guests(name, mobile, id_proof_type, id_proof_number)")
    .eq("booking_id", bookingId)
    .eq("is_primary", false);
  if (bgErr) reportQueryError("additional guests", bgErr);
  const extraGuests: WizardExtraGuest[] = ((bgData ?? []) as Array<Record<string, unknown>>).map((r) => {
    const eg = (r.guests ?? null) as Record<string, unknown> | null;
    return {
      ...emptyExtraGuest("adult"),
      guestId: (r.guest_id as string) ?? null,
      name: (eg?.name as string) ?? "",
      mobile: (eg?.mobile as string) ?? "",
      age: r.age != null ? String(r.age) : "",
      relation: (r.relation_to_primary as string) ?? "",
      idProofType: (eg?.id_proof_type as string) ?? "",
      idProofNumber: (eg?.id_proof_number as string) ?? "",
    };
  });

  let billTo = emptyBillTo();
  const companyId = (b.billing_company_id as string) ?? "";
  if (companyId) {
    const { data: c, error: cErr } = await supabase
      .from("billing_companies")
      .select("id, name, gstin, gst_status, address, email, state, nation")
      .eq("id", companyId)
      .maybeSingle();
    if (cErr) reportQueryError("billing company", cErr);
    const row = (c ?? null) as Record<string, unknown> | null;
    if (row) {
      billTo = {
        ...billTo,
        enabled: true,
        companyId: row.id as string,
        name: (row.name as string) ?? "",
        gstin: (row.gstin as string) ?? "",
        gstStatus: (row.gst_status as string) ?? "",
        address: (row.address as string) ?? "",
        email: (row.email as string) ?? "",
        state: (row.state as string) ?? billTo.state,
        nation: (row.nation as string) ?? billTo.nation,
      };
    }
  }

  // Active room lines only — `shifted` rows are closed-out audit history.
  const { data: brData, error: brErr } = await supabase
    .from("booking_rooms")
    .select(
      "id, room_id, category_id, rate, status, rooms:rooms!booking_rooms_room_id_fkey(room_number), room_categories(name)",
    )
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: true });
  if (brErr) reportQueryError("booking rooms", brErr);
  const stayRooms: StayRoomEdit[] = ((brData ?? []) as Array<Record<string, unknown>>)
    .filter((r) => ((r.status as string) ?? "active") !== "shifted" && (r.status as string) !== "cancelled")
    .map((r) => {
      const roomId = (r.room_id as string) ?? null;
      const categoryId = (r.category_id as string) ?? null;
      const roomNumber = ((r.rooms ?? null) as { room_number?: string } | null)?.room_number ?? null;
      const categoryName = ((r.room_categories ?? null) as { name?: string } | null)?.name ?? null;
      const rate = Number(r.rate ?? 0);
      return {
        bookingRoomId: r.id as string,
        roomId, categoryId, rate, roomNumber, categoryName,
        origRoomId: roomId, origCategoryId: categoryId,
        origRoomNumber: roomNumber, origCategoryName: categoryName,
        origRate: rate,
      };
    });

  const checkIn = String(b.check_in ?? "").slice(0, 10);
  const checkOut = String(b.check_out ?? "").slice(0, 10);

  return {
    bookingId: b.id as string,
    propertyId: b.property_id as string,
    bookingNumber: (b.booking_number as string) ?? "",
    status: (b.status as string) ?? "",
    guest,
    adults: Number(b.adults) > 0 ? Number(b.adults) : 1,
    children: Number(b.children) > 0 ? Number(b.children) : 0,
    extraGuests,
    billTo,
    customRemark: (b.custom_remark as string) ?? "",
    stay: {
      checkIn, checkOut,
      origCheckIn: checkIn, origCheckOut: checkOut,
      advanceAmount: Number(b.advance_amount ?? 0),
      rooms: stayRooms,
      reason: "",
    },
  };
}

/** Creates (or reuses) the Bill To company row selected in the edit form. */
async function resolveEditBillingCompanyId(propertyId: string, b: WizardBillTo): Promise<string | null> {
  if (!b.enabled) return null;
  if (b.companyId) {
    // Persist any GST-verified refresh back onto the master company record.
    await syncBillingCompanyRecord(b.companyId, b);
    return b.companyId;
  }
  if (!b.name.trim()) return null;
  const { data, error } = await supabase
    .from("billing_companies")
    .insert({
      property_id: propertyId,
      name: b.name.trim(),
      gstin: b.gstin.trim() || null,
      gst_status: b.gstStatus || null,
      address: b.address.trim() || null,
      email: b.email.trim() || null,
      state: b.state.trim() || null,
      nation: b.nation.trim() || "India",
      is_active: true,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function saveBookingEdit(s: BookingEditState, actorName: string | null): Promise<void> {
  const billingCompanyId = await resolveEditBillingCompanyId(s.propertyId, s.billTo);
  const g = s.guest;
  const { error } = await supabase.rpc("update_booking_safe_fields" as never, {
    payload: {
      booking_id: s.bookingId,
      guest: {
        name: g.name.trim(),
        mobile: g.mobile.trim() || null,
        email: g.email.trim() || null,
        dob: g.dob || null,
        id_proof_type: g.idProofType || null,
        id_proof_number: (g.idProofNumber || g.passportNumber).trim() || null,
        address: g.address.trim() || null,
        city: g.city.trim() || null,
        state: g.state.trim() || null,
        pincode: g.pincode.trim() || null,
        nation: g.nation.trim() || "India",
        gst_number: g.gstNumber.trim() || null,
        company: g.company.trim() || null,
      },
      adults: s.adults,
      children: s.children,
      extra_guests: s.extraGuests
        .filter((x) => x.name.trim())
        .map((x) => ({
          guest_id: x.guestId,
          name: x.name.trim(),
          mobile: x.mobile.trim() || null,
          age: x.age || null,
          id_proof_type: x.idProofType || null,
          id_proof_number: (x.idProofNumber || x.passportNumber).trim() || null,
          relation: x.relation || null,
        })),
      billing_company_id: billingCompanyId,
      custom_remark: s.customRemark.trim() || null,
      actor_name: actorName,
    },
  } as never);
  if (error) throw error;
}

/**
 * Applies the Stay & Room changes by REPLAYING the existing, proven operations —
 * never by writing bespoke folio logic:
 *
 *  - date change      -> modifyDatesOp()  (the "Modify dates" dialog's path)
 *  - room change      -> reserved: direct assignment (no folio/live state yet)
 *                        checked_in: shiftRoomOp() (the "Shift room" RPC, which
 *                        keeps the audit trail, room statuses and KOT transfer)
 *  - rate change      -> changeRoomRateOp(): whole-segment reprice while
 *                        reserved, forward-only night slicing once checked in
 *
 * Any blocking condition raised by those RPCs propagates unchanged so the caller
 * can show the same message the dialogs show.
 */
export async function saveStayEdits(s: BookingEditState, actorId: string | null): Promise<void> {
  const stay = s.stay;
  const checkedIn = s.status === "checked_in";
  if (!stayHasChanges(stay)) return;

  // 1. Dates first — booking_room ids survive this, rate slicing does not.
  if (stay.checkOut !== stay.origCheckOut || stay.checkIn !== stay.origCheckIn) {
    if (!checkedIn && stay.checkIn !== stay.origCheckIn) {
      for (const r of stay.rooms) {
        const { error } = await supabase.from("booking_rooms")
          .update({ check_in: stay.checkIn } as never).eq("id", r.bookingRoomId);
        if (error) throw error;
      }
      const { error: bErr } = await supabase.from("bookings")
        .update({ check_in: stay.checkIn } as never).eq("id", s.bookingId);
      if (bErr) throw bErr;
    }
    await modifyDatesOp({
      bookingId: s.bookingId,
      checkIn: checkedIn ? stay.origCheckIn : stay.checkIn,
      newCheckOut: stay.checkOut,
      advanceAmount: stay.advanceAmount,
      rooms: stay.rooms.map((r) => ({ id: r.bookingRoomId, rate: r.rate })),
    });
  }

  // 2. Per-room room / rate changes, each through its own mechanism.
  for (const r of stay.rooms) {
    const roomChanged = r.roomId !== r.origRoomId;
    const rateChanged = Math.abs(r.rate - r.origRate) > 0.009;
    if (!roomChanged && !rateChanged) continue;

    if (roomChanged && checkedIn) {
      if (!r.roomId) throw new Error("Pick a room to move this guest into");
      // shift_room carries the new rate for the new segment, so a combined
      // room + rate change is a single atomic operation.
      await shiftRoomOp({
        bookingId: s.bookingId,
        propertyId: s.propertyId,
        bookingRoomId: r.bookingRoomId,
        fromRoomId: r.origRoomId,
        toRoomId: r.roomId,
        newRate: r.rate,
        tariffChoice: rateChanged ? "custom" : "keep",
        reason: stay.reason.trim(),
        actorId,
        transferKots: true,
      });
      continue;
    }

    if (roomChanged) {
      // Reserved: no folio consumption yet, so a direct reassignment is safe.
      const { error } = await supabase.from("booking_rooms").update({
        room_id: r.roomId,
        category_id: r.categoryId,
      } as never).eq("id", r.bookingRoomId);
      if (error) throw error;
    }

    if (rateChanged || roomChanged) {
      await changeRoomRateOp({
        bookingId: s.bookingId,
        bookingRoomId: r.bookingRoomId,
        roomId: r.roomId,
        newRate: r.rate,
        fromDate: checkedIn ? istToday() : null,
        checkOut: stay.checkOut,
      });
    }
  }
}
