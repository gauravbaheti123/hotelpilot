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
import { syncBillingCompanyRecord, upsertBillingCompany } from "@/lib/bookingWizardSubmit";
import { reportQueryError } from "@/lib/queryError";
import { changeRoomRateOp, modifyDatesOp, recomputeBookingFolioTotals, shiftRoomOp } from "@/lib/roomOps";
import { istToday } from "@/lib/date";
import { ACTIVITY, logActivity } from "@/lib/activityLog";

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
  /**
   * How the nightly tariff figures on this booking are to be read.
   * Mirrors `bookings.rate_type`, which `seed_room_charge_for_booking_room()`
   * already honours: "exclusive" (default) adds GST on top, "inclusive"
   * back-calculates the taxable value from the entered gross.
   */
  rateType: "exclusive" | "inclusive";
  origRateType: "exclusive" | "inclusive";
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
  /** `bookings.source` bucket (free text; see BookingSourceFields). */
  source: string;
  /** Free-text channel name — OTA partner, agent, or a custom "other" source. */
  otaPartnerName: string;
  stay: StayEdit;
}

export function stayHasChanges(s: StayEdit): boolean {
  if (s.checkIn !== s.origCheckIn || s.checkOut !== s.origCheckOut) return true;
  if (s.rateType !== s.origRateType) return true;
  return s.rooms.some(
    (r) => r.roomId !== r.origRoomId || Math.abs(r.rate - r.origRate) > 0.009,
  );
}

/**
 * Double-booking guard for a (possibly backdated) stay range. Mirrors the
 * `tg_booking_rooms_no_overlap` trigger so the wizard can block before saving
 * instead of surfacing a raw Postgres error.
 *
 * Returns the room numbers that clash, empty when the range is free.
 */
export async function findStayConflicts(
  bookingId: string,
  checkIn: string,
  checkOut: string,
  rooms: Array<{ roomId: string | null; roomNumber: string | null }>,
): Promise<string[]> {
  const roomIds = rooms.map((r) => r.roomId).filter((v): v is string => !!v);
  if (roomIds.length === 0) return [];
  const { data, error } = await supabase
    .from("booking_rooms")
    .select("room_id, status, bookings!booking_rooms_booking_id_fkey(id,status)")
    .in("room_id", roomIds)
    .lt("check_in", checkOut)
    .gt("check_out", checkIn);
  if (error) { reportQueryError("booking rooms", error); return []; }
  const clashing = new Set<string>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const bk = (row.bookings ?? null) as { id?: string; status?: string } | null;
    if (!bk?.id || bk.id === bookingId) continue;
    if ((row.status ?? "active") === "shifted") continue;
    if (["cancelled", "no_show", "checked_out"].includes(String(bk.status ?? ""))) continue;
    clashing.add(String(row.room_id));
  }
  return rooms
    .filter((r) => r.roomId && clashing.has(r.roomId))
    .map((r) => r.roomNumber ?? "—");
}

/** True when the booking is still in an editable state. Mirrors the RPC guard. */
export function isBookingEditable(status: string | null | undefined) {
  return status === "reserved" || status === "checked_in";
}

export async function loadBookingForEdit(bookingId: string): Promise<BookingEditState | null> {
  const { data, error } = await supabase
    .from("bookings")
    .select(
      `id, property_id, booking_number, status, adults, children, custom_remark, billing_company_id, rate_type,
       source, ota_partner_name,
       check_in, check_out, advance_amount,
       guests!bookings_guest_id_fkey (
         id, name, mobile, email, dob, city, state, country, nationality, address, pincode,
         id_proof_type, id_proof_number, company, gst_number,
         id_document_url, id_document_name,
         id_document_back_url, id_document_back_name
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
    idDocBackViewUrl: (g?.id_document_back_url as string) ?? null,
    idDocBackName: (g?.id_document_back_name as string) ?? null,
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
      .select("id, name, gstin, gst_status, address, email, city, state, nation")
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
        city: (row.city as string) ?? billTo.city,
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
  const rateType: "exclusive" | "inclusive" =
    String(b.rate_type ?? "exclusive") === "inclusive" ? "inclusive" : "exclusive";

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
    source: (b.source as string) ?? "walk_in",
    otaPartnerName: (b.ota_partner_name as string) ?? "",
    stay: {
      checkIn, checkOut,
      origCheckIn: checkIn, origCheckOut: checkOut,
      advanceAmount: Number(b.advance_amount ?? 0),
      rooms: stayRooms,
      rateType: rateType,
      origRateType: rateType,
      reason: "",
    },
  };
}

/** Creates (or reuses) the Bill To company row selected in the edit form. */
async function resolveEditBillingCompanyId(propertyId: string, b: WizardBillTo): Promise<string | null> {
  if (!b.enabled) return null;
  if (b.companyId) {
    // Persist any GST-verified refresh back onto the master company record.
    await syncBillingCompanyRecord(b.companyId, b, propertyId);
    return b.companyId;
  }
  if (!b.name.trim()) return null;
  return upsertBillingCompany(propertyId, b, null);
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
      source: s.source || null,
      ota_partner_name:
        (s.source === "ota" || s.source === "agent" || s.source === "other") && s.otaPartnerName.trim()
          ? s.otaPartnerName.trim()
          : null,
      actor_name: actorName,
    },
  } as never);
  if (error) throw error;
  await persistGuestIdDocs(s);
}

/**
 * Best-effort persistence of the front/back ID document links captured in the
 * edit wizard's Guest Details step. Never blocks the save.
 */
async function persistGuestIdDocs(s: BookingEditState) {
  const g = s.guest;
  if (!g.guestId) return;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  if (g.idDocViewUrl) {
    patch.id_document_url = g.idDocViewUrl;
    patch.id_document_name = g.idDocName;
    patch.id_document_uploaded_at = now;
  }
  if (g.idDocBackViewUrl) {
    patch.id_document_back_url = g.idDocBackViewUrl;
    patch.id_document_back_name = g.idDocBackName;
    patch.id_document_back_uploaded_at = now;
  }
  if (!Object.keys(patch).length) return;
  try {
    await supabase.from("guests").update(patch as never).eq("id", g.guestId);
    const rows: Record<string, unknown>[] = [];
    if (g.idDocFileId && g.idDocViewUrl) {
      rows.push({
        property_id: s.propertyId, guest_id: g.guestId, booking_id: s.bookingId, side: "front",
        document_name: g.idDocName, drive_file_id: g.idDocFileId, drive_view_url: g.idDocViewUrl,
      });
    }
    if (g.idDocBackFileId && g.idDocBackViewUrl) {
      rows.push({
        property_id: s.propertyId, guest_id: g.guestId, booking_id: s.bookingId, side: "back",
        document_name: g.idDocBackName, drive_file_id: g.idDocBackFileId, drive_view_url: g.idDocBackViewUrl,
      });
    }
    if (rows.length) await supabase.from("guest_documents").insert(rows as never);
  } catch { /* non-blocking */ }
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
export async function saveStayEdits(
  s: BookingEditState,
  actorId: string | null,
  actorName?: string | null,
): Promise<void> {
  const stay = s.stay;
  const checkedIn = s.status === "checked_in";
  if (!stayHasChanges(stay)) return;

  // 0. GST interpretation of the tariff figures. Persisted on the booking so
  //    seed_room_charge_for_booking_room() (and the checkout summary) read the
  //    new basis for every charge rebuilt below.
  const rateTypeChanged = stay.rateType !== stay.origRateType;
  if (rateTypeChanged) {
    const { error } = await supabase.from("bookings")
      .update({ rate_type: stay.rateType } as never).eq("id", s.bookingId);
    if (error) throw error;
  }

  // 1. Dates first — booking_room ids survive this, rate slicing does not.
  if (stay.checkOut !== stay.origCheckOut || stay.checkIn !== stay.origCheckIn) {
    if (stay.checkIn !== stay.origCheckIn) {
      // Double-booking guard (also enforced by tg_booking_rooms_no_overlap).
      const clashes = await findStayConflicts(s.bookingId, stay.checkIn, stay.checkOut, stay.rooms);
      if (clashes.length > 0) {
        throw new Error(
          `Room ${clashes.join(", ")} is already booked during the new date range.`,
        );
      }
      for (const r of stay.rooms) {
        const { error } = await supabase.from("booking_rooms")
          .update({ check_in: stay.checkIn } as never).eq("id", r.bookingRoomId);
        if (error) throw error;
      }
      const { error: bErr } = await supabase.from("bookings")
        .update({ check_in: stay.checkIn } as never).eq("id", s.bookingId);
      if (bErr) throw bErr;
      if (checkedIn) {
        await logActivity({
          ...ACTIVITY.BOOKING_MODIFIED,
          property_id: s.propertyId,
          user_id: actorId ?? "",
          user_name: actorName ?? "Unknown",
          reference_id: s.bookingId,
          reference_label: s.bookingNumber,
          details: {
            field: "check_in",
            old_value: stay.origCheckIn,
            new_value: stay.checkIn,
            reason: stay.reason.trim() || null,
            note: "Check-in date corrected after check-in",
          },
        });
      }
    }
    await modifyDatesOp({
      bookingId: s.bookingId,
      checkIn: stay.checkIn,
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

  // 3. A changed GST basis re-prices every room line, including the ones the
  //    user did not touch — refresh their charges and the folio totals.
  if (rateTypeChanged) {
    for (const r of stay.rooms) {
      const { error } = await supabase.rpc("seed_room_charge_for_booking_room", {
        _booking_room_id: r.bookingRoomId,
      } as never);
      if (error) reportQueryError("room charge refresh", error);
    }
    await recomputeBookingFolioTotals(s.bookingId);
    await logActivity({
      ...ACTIVITY.BOOKING_MODIFIED,
      property_id: s.propertyId,
      user_id: actorId ?? "",
      user_name: actorName ?? "Unknown",
      reference_id: s.bookingId,
      reference_label: s.bookingNumber,
      details: {
        field: "rate_type",
        old_value: stay.origRateType,
        new_value: stay.rateType,
        reason: stay.reason.trim() || null,
        note: "Nightly tariff GST basis changed",
      },
    });
  }
}
