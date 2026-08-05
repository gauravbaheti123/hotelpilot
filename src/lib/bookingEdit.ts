// Booking edit (Phase 1) — loads an existing booking into the wizard's guest /
// occupancy / bill-to / remark shape, and saves it back through the
// `update_booking_safe_fields` RPC.
//
// Deliberately out of scope: dates, rooms, rates, taxes, payments. Those still
// go through the dedicated dialogs on the booking detail page.
import { supabase } from "@/integrations/supabase/client";
import {
  emptyBillTo, emptyExtraGuest, emptyGuest,
  type WizardBillTo, type WizardExtraGuest, type WizardGuest,
} from "@/lib/bookingWizard";
import { DEFAULT_NATION } from "@/lib/indiaGeo";
import { reportQueryError } from "@/lib/queryError";

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
  };
}

/** Creates (or reuses) the Bill To company row selected in the edit form. */
async function resolveEditBillingCompanyId(propertyId: string, b: WizardBillTo): Promise<string | null> {
  if (!b.enabled) return null;
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
