// Part 4 — turns the wizard state into a create_booking payload, then runs the
// post-transaction side effects (ID document linking, WhatsApp triggers) that
// deliberately live OUTSIDE the DB transaction.
import { supabase } from "@/integrations/supabase/client";
import { createBooking, type CreateBookingPayload, type CreateBookingResult } from "@/lib/bookingCreate";
import { roomsTotal, stayRange, type WizardBillTo, type WizardState } from "@/lib/bookingWizard";
import { earlyCheckinDescription } from "@/lib/earlyCheckin";
import { eventTotals } from "@/lib/bookingWizard";
import { createEventBooking, seedEventFolioCharges } from "@/lib/banquetEvent";
import { commitRoomBlocks } from "@/lib/eventRoomBlocks";
import {
  assignedBlocksTotal, buildAssignedBlocks, checkRoomBlockDiscounts, validateRoomBlocks,
  type RoomOption,
} from "@/lib/eventRoomsForm";
import type { DiscountLimit } from "@/lib/discountLimit";
import type { TariffPlan } from "@/lib/tariff";
import { errorMessage } from "@/lib/errorMessage";
import { reportQueryError } from "@/lib/queryError";

/**
 * Banquet → front-desk handoff context, carried in the URL as
 * ?eventId=…&blockId=…&eventName=…. The RPC links the booking to the event
 * and syncs the originating `event_room_blocks` row.
 */
export interface WizardEventContext {
  eventId?: string | null;
  blockId?: string | null;
  eventName?: string | null;
}

/** Creates (or reuses) the billing company row selected in Step 4. */
/**
 * Writes the (possibly GST-verified) Bill-To details back onto the master
 * billing_companies row so the record stays current for next time. Never
 * throws — a failed refresh must not block the booking save.
 */
export function billingCompanyPayload(b: WizardBillTo): Record<string, string> {
  const p: Record<string, string> = {};
  if (b.name.trim()) p.name = b.name.trim();
  if (b.gstin.trim()) p.gstin = b.gstin.trim().toUpperCase();
  if (b.gstStatus) p.gst_status = b.gstStatus;
  if (b.address.trim()) p.address = b.address.trim();
  if (b.email.trim()) p.email = b.email.trim();
  if (b.city.trim()) p.city = b.city.trim();
  if (b.state.trim()) p.state = b.state.trim();
  if (b.nation.trim()) p.nation = b.nation.trim();
  return p;
}

/**
 * Creates or refreshes the Bill-To company through the
 * `ensure_billing_company` security-definer RPC. Front-desk staff can add a
 * company while booking without needing direct master-data rights; the RPC
 * still rejects users with no booking permission.
 */
export async function upsertBillingCompany(
  propertyId: string,
  b: WizardBillTo,
  companyId?: string | null,
): Promise<string | null> {
  const payload = billingCompanyPayload(b);
  if (!companyId && !payload.name) return null;
  const { data, error } = await supabase.rpc("ensure_billing_company" as never, {
    _property_id: propertyId,
    _payload: payload,
    _company_id: companyId ?? null,
  } as never);
  if (error) throw error;
  return (data as string | null) ?? companyId ?? null;
}

/** Refreshes the master company record; never blocks the booking save. */
export async function syncBillingCompanyRecord(
  companyId: string,
  b: WizardBillTo,
  propertyId?: string,
): Promise<void> {
  if (!propertyId) return;
  try {
    await upsertBillingCompany(propertyId, b, companyId);
  } catch (e) {
    console.warn("billing company refresh failed", e);
  }
}

export async function resolveBillingCompanyId(
  propertyId: string,
  s: WizardState,
): Promise<string | null> {
  const b = s.billTo;
  if (s.reservation || !b.enabled) return null;
  if (b.companyId) {
    await syncBillingCompanyRecord(b.companyId, b, propertyId);
    return b.companyId;
  }
  if (!b.name.trim()) return null;
  return upsertBillingCompany(propertyId, b, null);
}

export function buildBookingPayload(opts: {
  propertyId: string;
  state: WizardState;
  checkInNow: boolean;
  billingCompanyId: string | null;
  actorName: string | null;
  event?: WizardEventContext;
}): CreateBookingPayload {
  const { propertyId, state: s, checkInNow, billingCompanyId, actorName, event } = opts;
  const range = stayRange(s.rooms);
  const total = roomsTotal(s.rooms);
  const advance = Number(s.payment.advance) || 0;
  const g = s.guest;
  const baseNotes = s.payment.notes.trim() || null;
  const notes = event?.eventName
    ? `Event: ${event.eventName}${baseNotes ? "\n" + baseNotes : ""}`
    : baseNotes;

  return {
    property_id: propertyId,
    check_in_now: checkInNow,
    guest: {
      guest_id: g.guestId,
      name: g.name.trim(),
      mobile: g.mobile.trim() || null,
      email: g.email.trim() || null,
      dob: g.dob || null,
      id_proof_type: g.idProofType || null,
      id_proof_number: (g.idProofNumber || g.passportNumber).trim() || null,
      address: g.address.trim() || null,
      city: g.city.trim() || null,
      state: g.state.trim() || null,
      nation: g.nation.trim() || "India",
      gst_number: g.gstNumber.trim() || null,
      company: g.company.trim() || null,
    },
    check_in: range.checkIn,
    check_out: range.checkOut,
    adults: s.adults,
    children: s.children,
    rate_type: s.rooms[0]?.rateType ?? "exclusive",
    rooms: s.rooms.map((r) => ({
      category_id: r.categoryId || null,
      room_id: r.assignLater ? null : (r.roomId || null),
      assign_later: r.assignLater,
      tariff_id: r.tariffId || null,
      meal_plan: r.mealPlan || "EP",
      rate: Number(r.rate) || 0,
      check_in: r.checkIn,
      check_out: r.checkOut,
    })),
    total_amount: total,
    balance_amount: Math.max(0, total - advance),
    extra_beds: s.rooms
      .filter((r) => r.extraBedEnabled && Number(r.extraBedQty) > 0 && Number(r.extraBedRate) > 0)
      .map((r) => ({
        qty: Number(r.extraBedQty) || 1,
        rate: Number(r.extraBedRate) || 0,
        from_date: r.checkIn || range.checkIn,
      })),
    early_checkins: s.rooms
      .filter((r) => r.earlyCheckinEnabled && Number(r.earlyCheckinAmount) > 0)
      .map((r) => ({
        amount: Number(r.earlyCheckinAmount) || 0,
        description: earlyCheckinDescription(Number(r.earlyCheckinHours) || 0),
        charged_on: r.checkIn || range.checkIn,
      })),
    advance,
    payment_mode: s.payment.mode,
    payment_ref: s.payment.reference.trim() || null,
    source: s.source,
    ota_partner_name:
      (s.source === "ota" || s.source === "agent" || s.source === "other") && s.otaPartnerName.trim()
        ? s.otaPartnerName.trim()
        : null,
    billing_company_id: billingCompanyId,
    notes,
    event_id: event?.eventId ?? null,
    block_id: event?.blockId ?? null,
    custom_remark: s.customRemark.trim() || null,
    extra_guests: s.extraGuests
      .filter((x) => x.name.trim())
      .map((x) => ({
        name: x.name.trim(),
        age: x.age || null,
        id_proof_type: x.idProofType || null,
        id_proof_number: (x.idProofNumber || x.passportNumber).trim() || null,
        relation: x.relation || null,
      })),
    actor_name: actorName,
  };
}

/** Front/back ID document persistence shared by primary and accompanying guests. */
async function saveIdDocs(
  propertyId: string,
  bookingId: string,
  guestId: string,
  g: {
    idDocFileId: string | null; idDocViewUrl: string | null; idDocName: string | null;
    idDocBackFileId: string | null; idDocBackViewUrl: string | null; idDocBackName: string | null;
  },
) {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  if (g.idDocFileId && g.idDocViewUrl) {
    patch.id_document_url = g.idDocViewUrl;
    patch.id_document_name = g.idDocName;
    patch.id_document_uploaded_at = now;
  }
  if (g.idDocBackFileId && g.idDocBackViewUrl) {
    patch.id_document_back_url = g.idDocBackViewUrl;
    patch.id_document_back_name = g.idDocBackName;
    patch.id_document_back_uploaded_at = now;
  }
  if (Object.keys(patch).length === 0) return;
  await supabase.from("guests").update(patch as never).eq("id", guestId);

  const rows: Record<string, unknown>[] = [];
  if (g.idDocFileId && g.idDocViewUrl) {
    rows.push({
      property_id: propertyId, guest_id: guestId, booking_id: bookingId, side: "front",
      document_name: g.idDocName, drive_file_id: g.idDocFileId,
      drive_view_url: g.idDocViewUrl, drive_folder_path: null,
    });
  }
  if (g.idDocBackFileId && g.idDocBackViewUrl) {
    rows.push({
      property_id: propertyId, guest_id: guestId, booking_id: bookingId, side: "back",
      document_name: g.idDocBackName, drive_file_id: g.idDocBackFileId,
      drive_view_url: g.idDocBackViewUrl, drive_folder_path: null,
    });
  }
  if (rows.length) await supabase.from("guest_documents").insert(rows as never);
}

/**
 * Links the already-uploaded Drive documents (Steps 1 and 2) to the saved
 * guests/booking. Best-effort: never throws.
 */
export async function linkIdDocuments(
  propertyId: string,
  bookingId: string,
  primaryGuestId: string,
  s: WizardState,
) {
  const g = s.guest;
  try {
    await saveIdDocs(propertyId, bookingId, primaryGuestId, g);

    const withDocs = s.extraGuests.filter((x) => (x.idDocFileId || x.idDocBackFileId) && x.name.trim());
    if (withDocs.length === 0) return;
    // The RPC creates the accompanying guests; match them back by name.
    const { data, error: __qe1 } = await supabase
      .from("booking_guests")
      .select("guest_id, guests(name)")
      .eq("booking_id", bookingId)
      .eq("is_primary", false);
    if (__qe1) reportQueryError("booking guests", __qe1);
    const rows = (data ?? []) as Array<{ guest_id: string; guests: { name: string } | null }>;
    for (const x of withDocs) {
      const hit = rows.find((r) => (r.guests?.name ?? "").trim().toLowerCase() === x.name.trim().toLowerCase());
      if (!hit) continue;
      await saveIdDocs(propertyId, bookingId, hit.guest_id, x);
    }
  } catch (e) {
    console.warn("ID document linking failed", e);
  }
}

/** Fires the same WhatsApp triggers the legacy form fires after saving. */
export async function fireBookingTriggers(
  propertyId: string,
  res: CreateBookingResult,
  s: WizardState,
  checkInNow: boolean,
) {
  try {
    const { fireTrigger } = await import("@/lib/whatsapp");
    fireTrigger("booking_confirm", {
      property_id: propertyId,
      booking_id: res.booking_id,
      guest_id: res.guest_id,
      phone: s.guest.mobile || null,
    });
    if (checkInNow) {
      fireTrigger("checkin_welcome", {
        property_id: propertyId,
        booking_id: res.booking_id,
        guest_id: res.guest_id,
        phone: s.guest.mobile || null,
      });
    }
  } catch (e) {
    console.warn("WhatsApp trigger failed", e);
  }
}

export async function submitWizard(opts: {
  propertyId: string;
  state: WizardState;
  checkInNow: boolean;
  actorName: string | null;
  event?: WizardEventContext;
}): Promise<CreateBookingResult> {
  const billingCompanyId = await resolveBillingCompanyId(opts.propertyId, opts.state);
  const payload = buildBookingPayload({ ...opts, billingCompanyId });
  const res = await createBooking(payload);
  await linkIdDocuments(opts.propertyId, res.booking_id, res.guest_id, opts.state);
  await fireBookingTriggers(opts.propertyId, res, opts.state, opts.checkInNow);
  return res;
}

/* ------------------------------------------------------------------ *
 * Banquet path
 * ------------------------------------------------------------------ */

export interface BanquetSubmitResult {
  bookingId: string;
  bookingNumber: string | null;
  roomsBlocked: number;
  /**
   * Non-fatal problems that happened AFTER the event row was committed
   * (room blocks / folio seeding). The event exists — these must be shown,
   * never swallowed, so the user can finish the job from the event page.
   */
  warnings: string[];
}

/**
 * Creates a banquet event from the wizard state.
 *
 * The chain is intentionally staged: `create_event_booking` is a single
 * transaction (booking + extras + folio seed), and only the room blocks and
 * the re-seed run afterwards. Anything that fails after the event exists is
 * surfaced as a warning instead of pretending the whole save failed.
 */
export async function submitBanquetWizard(opts: {
  propertyId: string;
  state: WizardState;
  rooms: RoomOption[];
  plans: TariffPlan[];
  discountLimit: DiscountLimit;
}): Promise<BanquetSubmitResult> {
  const { propertyId, state: s, rooms, plans, discountLimit } = opts;
  const ev = s.event;
  const ctx = {
    mode: ev.roomMode,
    rows: ev.roomRows,
    rooms,
    plans,
    eventDate: ev.eventDate,
    hostName: s.guest.name,
    hostMobile: s.guest.mobile,
  };

  const invalid = validateRoomBlocks(ctx, ev.eventName);
  if (invalid) throw new Error(invalid);
  const overLimit = checkRoomBlockDiscounts(discountLimit, ctx);
  if (overLimit) throw new Error(overLimit);

  const blocks = buildAssignedBlocks(ctx);
  const totalRoomCharges = assignedBlocksTotal(blocks);
  const t = eventTotals(ev, totalRoomCharges);
  const advance = Number(s.payment.advance) || 0;

  const billingCompanyId = await resolveBillingCompanyId(propertyId, s);

  const created = await createEventBooking({
    property_id: propertyId,
    hall_id: ev.hallId || null,
    guest_id: s.guest.guestId,
    host_name: s.guest.name.trim(),
    host_mobile: s.guest.mobile.trim() || null,
    host_email: s.guest.email.trim() || null,
    event_name: ev.eventName.trim() || null,
    function_type: ev.functionType,
    event_date: ev.eventDate,
    event_end_date: ev.eventEndDate,
    start_time: ev.startTime,
    end_time: ev.endTime,
    pax: Number(ev.pax) || 0,
    package_rate: 0,
    hall_charge: t.price,
    fb_charge: 0,
    extra_charge: t.extras,
    discount_amount: t.discount,
    total_amount: t.grandTotal,
    advance_amount: advance,
    balance_amount: Math.max(0, t.grandTotal - advance),
    total_room_charges: totalRoomCharges,
    notes: s.payment.notes.trim() || null,
    billing_company_id: billingCompanyId,
    advance_payment_mode: advance > 0 ? s.payment.mode : null,
    payment_ref: s.payment.reference.trim() || null,
    extras: ev.extras
      .map((x) => ({ point_name: x.pointName.trim(), amount: Number(x.amount) || 0 }))
      .filter((x) => x.point_name && x.amount > 0),
  });

  const warnings: string[] = [];
  let roomsBlocked = 0;
  if (blocks.length > 0) {
    try {
      roomsBlocked = await commitRoomBlocks({
        propertyId,
        eventBookingId: created.bookingId,
        eventName: ev.eventName.trim(),
        rows: blocks,
      });
    } catch (e) {
      warnings.push(
        `The event was saved, but the rooms could not be assigned. ${errorMessage(e, "assigning rooms")} Assign them from the event page.`,
      );
    }
  }

  if (roomsBlocked > 0) {
    try {
      await seedEventFolioCharges(created.bookingId);
    } catch (e) {
      warnings.push(
        `The event was saved, but the room charges could not be added to the folio. ${errorMessage(e, "adding folio charges")}`,
      );
    }
  }

  if (s.customRemark.trim()) {
    const { error } = await supabase
      .from("bookings")
      .update({ custom_remark: s.customRemark.trim() } as never)
      .eq("id", created.bookingId);
    if (error) warnings.push(`The custom remark could not be saved. ${errorMessage(error, "saving the remark")}`);
  }

  return {
    bookingId: created.bookingId,
    bookingNumber: created.bookingNumber,
    roomsBlocked,
    warnings,
  };
}
