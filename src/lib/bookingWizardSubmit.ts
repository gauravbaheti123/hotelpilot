// Part 4 — turns the wizard state into a create_booking payload, then runs the
// post-transaction side effects (ID document linking, WhatsApp triggers) that
// deliberately live OUTSIDE the DB transaction.
import { supabase } from "@/integrations/supabase/client";
import { createBooking, type CreateBookingPayload, type CreateBookingResult } from "@/lib/bookingCreate";
import { roomsTotal, stayRange, type WizardState } from "@/lib/bookingWizard";
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
export async function resolveBillingCompanyId(
  propertyId: string,
  s: WizardState,
): Promise<string | null> {
  const b = s.billTo;
  if (s.reservation || !b.enabled) return null;
  if (b.companyId) return b.companyId;
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
    advance,
    payment_mode: s.payment.mode,
    payment_ref: s.payment.reference.trim() || null,
    source: s.source,
    ota_partner_name:
      (s.source === "ota" || s.source === "agent") && s.otaPartnerName.trim()
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
    if (g.idDocFileId && g.idDocViewUrl) {
      await supabase.from("guests").update({
        id_document_url: g.idDocViewUrl,
        id_document_name: g.idDocName,
        id_document_uploaded_at: new Date().toISOString(),
      } as never).eq("id", primaryGuestId);
      await supabase.from("guest_documents").insert({
        property_id: propertyId,
        guest_id: primaryGuestId,
        booking_id: bookingId,
        document_name: g.idDocName,
        drive_file_id: g.idDocFileId,
        drive_view_url: g.idDocViewUrl,
        drive_folder_path: null,
      } as never);
    }

    const withDocs = s.extraGuests.filter((x) => x.idDocFileId && x.name.trim());
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
      await supabase.from("guests").update({
        id_document_url: x.idDocViewUrl,
        id_document_name: x.idDocName,
        id_document_uploaded_at: new Date().toISOString(),
      } as never).eq("id", hit.guest_id);
      await supabase.from("guest_documents").insert({
        property_id: propertyId,
        guest_id: hit.guest_id,
        booking_id: bookingId,
        document_name: x.idDocName,
        drive_file_id: x.idDocFileId,
        drive_view_url: x.idDocViewUrl,
        drive_folder_path: null,
      } as never);
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
